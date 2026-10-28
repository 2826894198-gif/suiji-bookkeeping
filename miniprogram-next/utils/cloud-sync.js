const wire = require('./cloud-protocol');
const KEY = 'pearl_cloud_sync_v1';
const clone = value => JSON.parse(JSON.stringify(value));
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
function readableError(error) {
  const message = error && (error.message || error.errMsg) || '';
  if (String(error && error.code) === '-601034' || /-601034\b/.test(message)) {
    return coded('CLOUD_NOT_ENABLED', '微信云开发权限尚未就绪（-601034）。请联系开发者完成小程序与云环境关联后再试。本机账目已保留。');
  }
  if (/cloud\.callFunction|callId:|\btrace:/i.test(message)) return coded('NETWORK', '暂时无法连接云服务，请稍后重试。本机账目已保留。');
  return error;
}
function createSync({ ledger, config, storage, call, now = () => new Date().toISOString(), delay = setTimeout, cancel = clearTimeout }) {
  const listeners = new Set();
  let meta, metaError = '', running, timer, again = false, online = true, active = false, unsubscribe, retries = 0, override;
  try {
    const raw = storage.get();
    if (raw && (raw.format !== 1 || typeof raw.enabled !== 'boolean' || typeof raw.env !== 'string' || !Number.isSafeInteger(raw.revision) || raw.revision < 0)) throw new Error('同步设置损坏，请先导出本机账本，再联系开发者核对');
    meta = raw || { format: 1, enabled: false, env: '', owner: '', revision: 0, lastDigest: '', bookId: '', lastSyncedAt: '', pending: null };
  } catch (error) { metaError = error.message; }
  let state = { phase: metaError ? 'error' : config.envId ? meta.enabled ? 'pending' : 'disabled' : 'unconfigured',
    message: metaError || (!config.envId ? '云服务尚未配置，当前账目保存在本机；可先导出独立备份。' : meta.enabled ? '本机账目已保留，正在准备核对云端' : '启用后，将当前个人账本同步至你的微信身份'),
    configured: !!config.envId, enabled: !!(meta && meta.enabled), lastSyncedAt: meta && meta.lastSyncedAt || '', remote: null, local: null };
  function report(phase, extra = {}) {
    state = { ...state, phase, enabled: !!(meta && meta.enabled), lastSyncedAt: meta && meta.lastSyncedAt || '', ...extra };
    listeners.forEach(listener => { try { listener(clone(state)); } catch (_) {} });
    return clone(state);
  }
  function saveMeta() {
    storage.set(clone(meta));
    if (wire.encode(storage.get()) !== wire.encode(meta)) throw coded('LOCAL_STORAGE', '同步设置保存校验失败，本机账目仍保留');
  }
  function summary(book) {
    return { entries: book.entries.length, accounts: book.accounts.length, categories: book.categories.length,
      assets: ledger.allAccounts(book).reduce((sum, account) => sum + account.balance, 0) };
  }
  async function rpc(action, args = {}) {
    const result = await call({ protocol: wire.PROTOCOL, action, ...args });
    if (!result || result.ok !== true) throw coded(result && result.code || 'NETWORK', result && result.message || '云服务未返回有效结果，本机账本仍保留');
    return result;
  }
  function checkConfig() {
    if (metaError) throw coded('LOCAL_STORAGE', metaError);
    if (!config.envId) throw coded('NOT_CONFIGURED', '云服务尚未配置，本机记账可以继续');
    if (meta.env && meta.env !== config.envId) throw coded('ENVIRONMENT_CHANGED', '云环境已变化，已暂停同步。请先导出本机账本并核对迁移');
  }
  async function head() {
    const result = await rpc('head');
    if (meta.owner && meta.owner !== result.owner) throw coded('IDENTITY_CHANGED', '当前微信身份与原云账本不一致，已停止同步');
    if (!result.owner) throw coded('UNAUTHORIZED', '无法核对微信身份');
    if (!meta.owner) { meta.owner = result.owner; saveMeta(); }
    if (result.head && (result.head.protocol !== wire.PROTOCOL || result.head.schema > ledger.load().schema)) throw coded('UPDATE_REQUIRED', '云账本来自更新的版本，请先更新小程序');
    return result.head;
  }
  async function download(snapshotId) {
    const { snapshot } = await rpc('snapshot', { snapshotId });
    if (!snapshot || snapshot.protocol !== wire.PROTOCOL || snapshot.chunks < 1 || snapshot.chunks > wire.MAX_CHUNKS || snapshot.bytes > wire.MAX_BYTES) throw coded('CORRUPT_BACKUP', '云端备份描述不正确，本机账本未改变');
    const parts = [];
    for (let i = 0; i < snapshot.chunks; i++) {
      const part = await rpc('chunk', { snapshotId, index: i });
      if (part.index !== i || typeof part.text !== 'string') throw coded('CORRUPT_BACKUP', '云端备份分片不完整');
      parts.push(part.text);
    }
    const text = parts.join('');
    if (wire.digest(text) !== snapshot.digest || wire.byteLength(text) !== snapshot.bytes) throw coded('CORRUPT_BACKUP', '云端备份校验失败，本机账本未改变');
    return { state: ledger.migrate(JSON.parse(text)), snapshot };
  }
  function accept(remote) {
    meta.revision = remote.revision; meta.lastDigest = remote.digest; meta.bookId = remote.bookId;
    meta.pending = null; meta.lastSyncedAt = now(); saveMeta();
    retries = 0;
  }
  function conflict(remote, local, message) {
    override = null;
    return report('conflict', { message: message || '本机和云端都有变化，已保留两份账本，请先核对', remote, local: summary(local),
      review: { localDigest: wire.digest(wire.encode(local)), remoteRevision: remote && remote.revision || 0 } });
  }
  async function upload(local, remote, text) {
    const hash = wire.digest(text), baseRevision = remote && remote.revision || 0, chunks = wire.split(text);
    if (!meta.pending || meta.pending.digest !== hash || meta.pending.baseRevision !== baseRevision) {
      meta.pending = { id: wire.digest(`${hash}:${now()}:${Math.random()}`).slice(0,32), digest: hash, baseRevision };
      saveMeta(); // Durable operation ID makes an interrupted acknowledgement safe to retry.
    }
    const operationId = meta.pending.id;
    const begun = await rpc('begin', { operationId, digest: hash, bytes: wire.byteLength(text), chunks: chunks.length, baseRevision });
    let result = begun;
    if (!begun.committed) {
      for (let i = 0; i < chunks.length; i++) await rpc('part', { operationId, index: i, text: chunks[i] });
      result = await rpc('commit', { operationId });
    }
    if (!result.head || result.head.digest !== hash) return conflict(result.head || remote, ledger.load(), '同步期间云端又有变化，已保留本机账本，请先核对');
    accept(result.head); override = null;
    if (wire.digest(wire.encode(ledger.load())) !== hash) { again = true; return report('pending', { message: '新增修改已存本机，继续同步', remote: result.head }); }
    return report('synced', { message: '本机与云端校验一致', remote: result.head, local: summary(local), review: null });
  }
  async function once() {
    checkConfig();
    if (!meta.enabled) return report('disabled', { message: '启用后，将当前个人账本同步至你的微信身份' });
    if (!online) return report('offline', { message: '账目已保存在本机，恢复网络后重试' });
    report('syncing', { message: '正在核对本机与云端账本' });
    const remote = await head(), local = ledger.load(), text = wire.encode(local), hash = wire.digest(text);
    if (local.demo) return report('demo', { message: '演示账本不上传。可建立个人账本，或从云端历史恢复', remote, local: summary(local) });
    if (remote && remote.digest === hash) {
      accept(remote); override = null;
      return report('synced', { message: '本机与云端校验一致', remote, local: summary(local), review: null });
    }
    if (remote && meta.pending && remote.snapshotId === meta.pending.id && remote.digest === meta.pending.digest) accept(remote);
    if (override) {
      if ((remote && remote.revision || 0) !== override.remoteRevision || hash !== override.localDigest) return conflict(remote, local, '核对后数据再次变化，请重新确认');
      return upload(local, remote, text);
    }
    if (remote && (wire.pristine(local) || hash === meta.lastDigest)) {
      const downloaded = await download(remote.snapshotId);
      if (wire.digest(wire.encode(ledger.load())) !== hash) { again = true; return report('pending', { message: '本机刚有修改，重新核对后再同步' }); }
      ledger.applyCloud(downloaded.state);
      accept(remote);
      return report('synced', { message: '已恢复并核对云端账本，替换前数据保留在本机恢复点', remote, local: summary(downloaded.state), review: null });
    }
    if (remote && (!meta.lastDigest || remote.digest !== meta.lastDigest || meta.bookId !== local.bookId)) return conflict(remote, local);
    if (!remote && meta.revision > 0) return conflict(null, local, '原云端账本暂不可见，已停止写入，请核对云环境与历史备份');
    return upload(local, remote, text);
  }
  function schedule(ms = 900) {
    if (timer) cancel(timer);
    if (active && meta && meta.enabled && online && config.envId) timer = delay(() => { timer = null; flush(); }, ms);
  }
  async function failed(error) {
    error = readableError(error);
    if (error.code === 'CONFLICT') {
      try { return conflict(await head(), ledger.load()); } catch (_) {}
    }
    report(online ? 'error' : 'offline', { message: error.message || '同步暂未完成，本机账目仍保留' });
    if (['NETWORK','CLOUD_ERROR'].includes(error.code) && retries++ < 3) schedule([2000,5000,15000][retries - 1]);
    return clone(state);
  }
  function finished() {
    running = null;
    if (again) { again = false; if (!['conflict','error','offline','demo'].includes(state.phase)) schedule(0); }
  }
  function exclusive(task) {
    if (running) throw coded('BUSY', '请等待当前同步完成');
    if (timer) cancel(timer);
    timer = null;
    running = Promise.resolve().then(task).finally(finished);
    return running;
  }
  function flush() {
    if (running) { again = true; return running; }
    running = once().catch(failed).finally(finished);
    return running;
  }
  function changed({ reason }) {
    if (reason === 'cloud' || reason === 'initial') return;
    if (meta && meta.enabled) {
      report('pending', { message: '修改已保存在本机，等待云端核对' });
      schedule();
    }
  }
  return {
    start() { active = true; if (!unsubscribe) unsubscribe = ledger.subscribe(changed); if (meta && meta.enabled && config.envId) flush(); },
    stop() { active = false; if (unsubscribe) unsubscribe(); unsubscribe = null; if (timer) cancel(timer); timer = null; },
    status() { return clone(state); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    networkChanged(connected) { online = !!connected; if (!online && meta && meta.enabled) report('offline', { message: '账目已保存在本机，恢复网络后重试' }); else schedule(0); },
    async connect() { checkConfig(); meta.env = config.envId; meta.enabled = true; saveMeta(); return flush(); },
    syncNow: flush,
    disconnect() { if (running) throw coded('BUSY', '请等待当前同步完成'); checkConfig(); meta.enabled = false; saveMeta(); if (timer) cancel(timer); report('disabled', { message: '已暂停云同步，本机与云端账本均保留' }); },
    async history() { checkConfig(); return (await rpc('history')).versions; },
    async prepareRestore(snapshotId) {
      checkConfig();
      const reviewedHead = await head(), prepared = await download(snapshotId);
      return { ...prepared, localDigest: wire.digest(wire.encode(ledger.load())), remoteRevision: reviewedHead && reviewedHead.revision || 0 };
    },
    async restoreVersion(prepared) {
      return exclusive(async () => {
        checkConfig();
        const remote = await head();
        if ((remote && remote.revision || 0) !== prepared.remoteRevision || wire.digest(wire.encode(ledger.load())) !== prepared.localDigest) throw coded('CONFLICT', '核对后数据发生变化，请重新选择历史版本');
        if (prepared.state.demo) throw coded('DEMO_BOOK', '云端历史不能恢复为演示账本');
        ledger.applyCloud(prepared.state);
        meta.enabled = true; meta.env = config.envId; meta.revision = remote && remote.revision || 0;
        meta.lastDigest = remote && remote.digest || ''; meta.bookId = prepared.state.bookId; meta.pending = null; saveMeta();
        report('pending', { message: '历史版本已存本机，正在建立新的云端版本' });
        return once().catch(failed);
      });
    },
    async keepLocal(review) {
      return exclusive(() => {
        if (!review || state.phase !== 'conflict') throw coded('CONFLICT', '请先重新核对两份账本');
        override = clone(review); return once().catch(failed);
      });
    },
    async useCloud(review) {
      return exclusive(async () => {
        checkConfig();
        const remote = await head();
        if (!remote || !review || remote.revision !== review.remoteRevision) throw coded('CONFLICT', '云端又有更新，请重新核对');
        const downloaded = await download(remote.snapshotId), latest = await head();
        if (!latest || latest.revision !== remote.revision) throw coded('CONFLICT', '下载期间云端又有更新，请重新核对');
        if (wire.digest(wire.encode(ledger.load())) !== review.localDigest) throw coded('CONFLICT', '本机刚有修改，请重新核对');
        ledger.applyCloud(downloaded.state); accept(remote);
        return report('synced', { message: '已使用云端版本，替换前账本保留在本机恢复点', remote, local: summary(downloaded.state), review: null });
      });
    }
  };
}
let live;
function runtime() {
  if (live) return live;
  const config = require('./cloud-config');
  let initialized = false;
  live = createSync({ ledger: require('./ledger'), config, storage: { get: () => wx.getStorageSync(KEY), set: data => wx.setStorageSync(KEY, data) },
    async call(data) {
      if (!wx.cloud || !wx.cloud.callFunction) throw coded('UNSUPPORTED', '当前微信不支持云服务，请更新微信；本机记账不受影响');
      if (!initialized) { wx.cloud.init({ env: config.envId, traceUser: false }); initialized = true; }
      let timer;
      try {
        const result = await Promise.race([wx.cloud.callFunction({ name: config.functionName, data, config: { env: config.envId } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(coded('NETWORK', '云同步连接超时，本机账目仍保留')), 30000); })]);
        return result.result;
      } catch (error) { throw readableError(coded(error.code || 'NETWORK', error.message || error.errMsg || '云连接暂不可用，本机账目仍保留')); }
      finally { clearTimeout(timer); }
    }
  });
  if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(event => live.networkChanged(event.isConnected));
  if (wx.getNetworkType) wx.getNetworkType({ success: event => { if (event.networkType === 'none') live.networkChanged(false); } });
  return live;
}
module.exports = { createSync, KEY };
['start','stop','status','subscribe','networkChanged','connect','syncNow','disconnect','history','prepareRestore','restoreVersion','keepLocal','useCloud'].forEach(name => {
  module.exports[name] = (...args) => runtime()[name](...args);
});
