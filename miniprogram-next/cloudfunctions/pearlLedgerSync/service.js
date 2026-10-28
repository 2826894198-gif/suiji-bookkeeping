const model = require('./shared/ledger');
const wire = require('./shared/cloud-protocol');
const APP_ID = 'YOUR_WECHAT_APPID';
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function publicHead(head) {
  if (!head || !head.revision) return null;
  const { revision, snapshotId, digest, bookId, stats, updatedAt, schema, protocol, recent } = head;
  return { revision, snapshotId, digest, bookId, stats, updatedAt, schema, protocol, recent };
}
function createService(repo, now = () => new Date().toISOString()) {
  async function chunksInGroups(count, run) {
    const result = [];
    for (let start = 0; start < count; start += 8) {
      const group = Array.from({ length: Math.min(8, count - start) }, (_, index) => run(start + index));
      result.push(...await Promise.all(group));
    }
    return result;
  }
  function ownerOf(context) {
    if (!context || context.APPID !== APP_ID || typeof context.OPENID !== 'string' || !context.OPENID) fail('UNAUTHORIZED', '请使用此小程序对应的微信身份登录');
    return wire.digest(`${context.APPID}:${context.OPENID}`).slice(0, 32);
  }
  function snapshotKey(owner, id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) fail('INVALID_REQUEST', '历史版本标识不正确');
    return `${owner}-snapshot-${id}`;
  }
  async function manifest(store, owner, id) {
    const row = await store.read(snapshotKey(owner, id));
    if (!row || row.owner !== owner || row.pruned) fail('NOT_FOUND', '此历史版本不可用，请刷新列表');
    return row;
  }
  async function prune(owner, ids) {
    for (const id of ids) {
      try {
        const key = snapshotKey(owner, id), item = await repo.read(key);
        if (!item) continue;
        // A committed snapshot is immutable. Restoring always creates a new version.
        await repo.write(key, { ...item, pruned: true });
        await chunksInGroups(item.chunks, index => repo.remove(`${key}-${index}`));
      } catch (_) { /* Retention cleanup cannot invalidate an acknowledged commit. */ }
    }
  }
  return {
    async handle(event, context) {
      const owner = ownerOf(context), headKey = `${owner}-head`;
      if (!event || event.protocol !== wire.PROTOCOL) fail('UPDATE_REQUIRED', '请更新小程序后再连接云端');
      const action = event.action;
      if (action === 'head') return { owner, head: publicHead(await repo.read(headKey)) };
      if (action === 'history') {
        const head = await repo.read(headKey);
        return { versions: head && head.recent || [] };
      }
      if (action === 'snapshot' || action === 'chunk') {
        const item = await manifest(repo, owner, event.snapshotId);
        if (item.status !== 'committed') fail('NOT_FOUND', '此备份尚未完整写入');
        if (action === 'snapshot') return { snapshot: { ...item, owner: undefined } };
        if (!Number.isInteger(event.index) || event.index < 0 || event.index >= item.chunks) fail('INVALID_REQUEST', '数据分片序号不正确');
        const part = await repo.read(`${snapshotKey(owner, event.snapshotId)}-${event.index}`);
        if (!part || typeof part.text !== 'string') fail('CORRUPT_BACKUP', '云端备份不完整，本机账本未改变');
        return { text: part.text, index: event.index };
      }
      if (action === 'begin') {
        const { operationId: id, digest, bytes, chunks, baseRevision } = event;
        const key = snapshotKey(owner, id);
        if (!/^[a-f0-9]{64}$/.test(digest || '') || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > wire.MAX_BYTES ||
            !Number.isInteger(chunks) || chunks < 1 || chunks > wire.MAX_CHUNKS || !Number.isSafeInteger(baseRevision) || baseRevision < 0) fail('INVALID_REQUEST', '账本上传参数不正确');
        return repo.transaction(async tx => {
          const head = await tx.read(headKey), existing = await tx.read(key);
          if (existing) {
            if (existing.digest !== digest || existing.bytes !== bytes || existing.chunks !== chunks || existing.baseRevision !== baseRevision) fail('REQUEST_REUSED', '上传标识已被其他数据使用');
            if (existing.status === 'committed') return { committed: true, head: publicHead(head) };
          }
          if ((head && head.revision || 0) !== baseRevision) fail('CONFLICT', '云端已有更新，两份账本均已保留，请选择处理方式');
          if (!existing) await tx.write(key, { owner, snapshotId: id, digest, bytes, chunks, baseRevision, protocol: wire.PROTOCOL, status: 'pending', createdAt: now() });
          return { committed: false };
        });
      }
      if (action === 'part') {
        const key = snapshotKey(owner, event.operationId);
        if (typeof event.text !== 'string' || wire.byteLength(event.text) > 256 * 1024) fail('INVALID_REQUEST', '上传分片过大');
        return repo.transaction(async tx => {
          const item = await manifest(tx, owner, event.operationId);
          if (!Number.isInteger(event.index) || event.index < 0 || event.index >= item.chunks) fail('INVALID_REQUEST', '上传分片序号不正确');
          if (item.status === 'committed') return { stored: true };
          const chunkKey = `${key}-${event.index}`, old = await tx.read(chunkKey);
          if (old && old.text !== event.text) fail('REQUEST_REUSED', '同一分片不可更换内容，请重新同步');
          if (!old) await tx.write(chunkKey, { owner, text: event.text });
          return { stored: true };
        });
      }
      if (action === 'commit') {
        const id = event.operationId, key = snapshotKey(owner, id);
        const item = await manifest(repo, owner, id);
        if (item.status === 'committed') return { head: publicHead(await repo.read(headKey)) };
        const texts = await chunksInGroups(item.chunks, async index => {
          const part = await repo.read(`${key}-${index}`);
          if (!part || typeof part.text !== 'string') fail('INCOMPLETE_UPLOAD', '账本尚未传完整，可以重试');
          return part.text;
        });
        const text = texts.join('');
        if (wire.byteLength(text) !== item.bytes || wire.digest(text) !== item.digest) fail('CORRUPT_BACKUP', '云端写入校验不一致，本机账本仍保留');
        let state;
        try { state = model.migrate(JSON.parse(text)); } catch (_) { fail('INVALID_LEDGER', '账本校验未通过，云端原账本未改变'); }
        if (state.demo) fail('DEMO_BOOK', '演示账本不上传，请先建立个人账本');
        // New clients migrate locally and upload their supported schema explicitly.
        if (JSON.parse(text).schema !== state.schema) fail('UPDATE_REQUIRED', '请更新小程序后再同步');
        const stats = { entries: state.entries.length, accounts: state.accounts.length, categories: state.categories.length,
          assets: model.allAccounts(state).reduce((sum, account) => sum + account.balance, 0) };
        const result = await repo.transaction(async tx => {
          const head = await tx.read(headKey), staged = await manifest(tx, owner, id);
          if (staged.status === 'committed') return { head: publicHead(head), evicted: [] };
          if ((head && head.revision || 0) !== item.baseRevision) fail('CONFLICT', '云端已有更新，两份账本均已保留，请选择处理方式');
          if (head && head.schema > state.schema) fail('UPDATE_REQUIRED', '此设备版本较旧，请先更新小程序');
          const revision = item.baseRevision + 1, updatedAt = now();
          const version = { snapshotId: id, revision, digest: item.digest, bookId: state.bookId, schema: state.schema, stats, updatedAt };
          const history = [version, ...(head && head.recent || [])];
          const next = { owner, protocol: wire.PROTOCOL, ...version, recent: history.slice(0, wire.HISTORY_LIMIT) };
          await tx.write(key, { ...staged, status: 'committed', revision, stats, bookId: state.bookId, schema: state.schema, updatedAt });
          await tx.write(headKey, next);
          return { head: publicHead(next), evicted: history.slice(wire.HISTORY_LIMIT).map(v => v.snapshotId) };
        });
        await prune(owner, result.evicted);
        return { head: result.head };
      }
      fail('INVALID_REQUEST', '不支持此云端操作');
    }
  };
}
module.exports = { createService, APP_ID };
