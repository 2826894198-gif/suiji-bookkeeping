const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const wire = require('../utils/cloud-protocol');
const { createSync } = require('../utils/cloud-sync');
const { createService, APP_ID } = require('../cloudfunctions/pearlLedgerSync/service');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const context = { APPID: APP_ID, OPENID: 'personal-owner' };
function repository() {
  let docs = new Map(), chain = Promise.resolve();
  const methods = map => ({
    async read(id) { return copy(map.get(id)) || null; },
    async write(id, data) { map.set(id, copy(data)); },
    async remove(id) { map.delete(id); }
  });
  return {
    async read(id) { return methods(docs).read(id); },
    async write(id, data) { return methods(docs).write(id, data); },
    async remove(id) { return methods(docs).remove(id); },
    async transaction(run) {
      const result = chain.then(async () => {
        const draft = new Map([...docs].map(([key, value]) => [key, copy(value)]));
        const output = await run(methods(draft)); docs = draft; return output;
      });
      chain = result.catch(() => {}); return result;
    },
    documents() { return docs; }
  };
}
function server(repo = repository()) {
  const service = createService(repo);
  return { repo, service, async call(data, owner = context) {
    try { return copy({ ok: true, ...await service.handle(data, owner) }); }
    catch (error) { return { ok: false, code: error.code, message: error.message }; }
  } };
}
function device(backend, options = {}) {
  delete require.cache[require.resolve('../utils/ledger')];
  const ledger = require('../utils/ledger');
  let raw = copy(options.book), metadata = copy(options.meta), failSave = false, failMeta = false;
  const recoveries = [], jobs = [];
  ledger.setClock(() => new Date(2026,9,21,12,30));
  ledger.setAdapter({ get: () => copy(raw), set: data => { if (failSave) throw new Error('disk full'); raw = copy(data); },
    remove: () => { raw = undefined; }, checkpoint: (data, reason) => recoveries.push({ data: copy(data), reason }) });
  ledger.load();
  const sync = createSync({ ledger, config: { envId: options.env === undefined ? 'fixed-personal-env' : options.env },
    storage: { get: () => copy(metadata), set: data => { if (failMeta) throw new Error('metadata disk full'); metadata = copy(data); } },
    call: options.call || backend.call,
    delay: (fn, ms) => { const job = { fn, ms }; jobs.push(job); return job; }, cancel: job => { job.cancelled = true; }
  });
  sync.start();
  return { ledger, sync, recoveries, jobs, metadata: () => copy(metadata), book: () => copy(raw),
    failSaving: value => { failSave = value; }, failMetadata: value => { failMeta = value; } };
}
function setupBook(d) { d.ledger.saveAccount({ name: '日常账户', balance: '1000' }); return d.ledger.allAccounts()[0].id; }
function spend(d, amount = '12.34') {
  d.ledger.saveEntry({ type: 'expense', amount, accountId: d.ledger.allAccounts()[0].id, categoryId: 'food', subcategory: '午餐', date: '2026-10-21', time: '12:30' });
}
async function current(backend) { return (await backend.call({ protocol: 1, action: 'head' })).head; }

test('SHA-256 and chunk transport agree with Node for known, Chinese, emoji and multi-chunk payloads', () => {
  for (const text of ['', 'abc', '个人账本：🍊￥12.34', 'a'.repeat(65535) + '🍊' + '餐饮'.repeat(60000)]) {
    assert.equal(wire.digest(text), crypto.createHash('sha256').update(text).digest('hex'));
    assert.equal(wire.byteLength(text), Buffer.byteLength(text));
    assert.equal(wire.split(text).join(''), text);
    for (const part of wire.split(text)) assert.ok(!/[\uD800-\uDBFF]$/.test(part));
  }
});

test('WeChat cloud permission refusal keeps local data and shows an actionable message without a raw trace', async () => {
  const backend = server(), a = device(backend, { call: async () => {
    const error = new Error('cloud.callFunction:fail Error: errCode: -601034 | errMsg: 没有权限，请先开通云开发或者云托管 (callId: private-call-id) (trace: system error)');
    error.code = -601034; throw error;
  } });
  setupBook(a); spend(a); const before = a.book();
  assert.equal(a.sync.status().configured, true);
  assert.doesNotMatch(a.sync.status().message, /尚未配置/);
  const status = await a.sync.connect();
  assert.equal(status.phase, 'error'); assert.match(status.message, /-601034.*关联.*本机账目已保留/);
  assert.doesNotMatch(status.message, /cloud\.callFunction|private-call-id|trace:|abort/);
  assert.deepEqual(a.book(), before); assert.equal(await current(backend), null);
  assert.equal(a.jobs.length, 0);
});

test('existing personal data syncs and a fresh phone restores the same book, balances, categories and budget', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); a.ledger.saveBudget('500', { food: '200' }, 15);
  assert.equal((await a.sync.connect()).phase, 'synced');
  const expected = a.book(), b = device(backend);
  assert.equal((await b.sync.connect()).phase, 'synced');
  assert.deepEqual(b.book(), expected); assert.equal(b.ledger.summary().assets, 98766);
  assert.equal(b.ledger.summary().remaining, 48766); assert.equal((await current(backend)).revision, 1);
});

test('offline additions persist through restart, then upload without duplicate entries', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  a.sync.networkChanged(false); spend(a, '68');
  assert.equal((await a.sync.syncNow()).phase, 'offline');
  assert.equal((await current(backend)).stats.entries, 0);
  const before = a.book(), meta = a.metadata(); a.sync.stop();
  const reopened = device(backend, { book: before, meta });
  await reopened.sync.syncNow();
  assert.equal(reopened.sync.status().phase, 'synced');
  assert.equal((await current(backend)).stats.entries, 1);
  await reopened.sync.syncNow(); assert.equal((await current(backend)).revision, 2);
});

test('lost commit acknowledgement is recovered after restart with no duplicate cloud revision', async () => {
  const backend = server(); let drop = true;
  const a = device(backend, { call: async data => {
    const result = await backend.call(data);
    if (data.action === 'commit' && drop) { drop = false; const error = new Error('connection lost'); error.code = 'NETWORK'; throw error; }
    return result;
  } });
  setupBook(a); spend(a);
  assert.equal((await a.sync.connect()).phase, 'error'); assert.ok(a.metadata().pending);
  assert.equal((await current(backend)).revision, 1);
  a.sync.stop();
  const reopened = device(backend, { book: a.book(), meta: a.metadata() });
  await reopened.sync.syncNow();
  assert.equal(reopened.sync.status().phase, 'synced'); assert.equal((await current(backend)).revision, 1);
});

test('new edits during an upload remain local pending changes and are uploaded in the next revision', async () => {
  const backend = server(); let a, editDuringPart = true;
  a = device(backend, { call: async data => {
    const result = await backend.call(data);
    if (data.action === 'part' && editDuringPart) { editDuringPart = false; spend(a, '10'); }
    return result;
  } });
  setupBook(a); spend(a);
  assert.equal((await a.sync.connect()).phase, 'pending'); assert.equal(a.book().entries.length, 2);
  await a.sync.syncNow(); assert.equal(a.sync.status().phase, 'synced');
  assert.equal((await current(backend)).stats.entries, 2); assert.equal((await current(backend)).revision, 2);
});

test('two offline writers conflict without overwriting either book, and choosing cloud preserves a local recovery', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); await a.sync.connect();
  const b = device(backend); await b.sync.connect();
  b.sync.networkChanged(false); spend(b, '20'); const unsynced = b.book();
  spend(a, '10'); await a.sync.syncNow(); const remote = a.book();
  b.sync.networkChanged(true);
  assert.equal((await b.sync.syncNow()).phase, 'conflict');
  assert.deepEqual(b.book(), unsynced); assert.equal((await current(backend)).stats.entries, 2);
  await b.sync.useCloud(b.sync.status().review);
  assert.deepEqual(b.book(), remote); assert.deepEqual(b.recoveries.at(-1).data, unsynced);
});

test('choosing local uses compare-and-swap and keeps the superseded cloud book in history', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  const b = device(backend); await b.sync.connect();
  spend(a, '10'); await a.sync.syncNow(); const oldHead = await current(backend);
  spend(b, '20'); await b.sync.syncNow(); assert.equal(b.sync.status().phase, 'conflict');
  await b.sync.keepLocal(b.sync.status().review);
  assert.equal(b.sync.status().phase, 'synced');
  const head = await current(backend); assert.equal(head.revision, 3);
  assert.ok(head.recent.some(item => item.snapshotId === oldHead.snapshotId));
  assert.equal((await b.sync.prepareRestore(oldHead.snapshotId)).state.entries[0].amount, 1000);
});

test('a stale conflict confirmation cannot overwrite a newer cloud revision or newly edited local data', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  const b = device(backend); await b.sync.connect();
  spend(a); await a.sync.syncNow(); spend(b, '20'); await b.sync.syncNow();
  const reviewed = b.sync.status().review;
  spend(a, '30'); await a.sync.syncNow(); const head = await current(backend);
  await b.sync.keepLocal(reviewed); assert.equal(b.sync.status().phase, 'conflict');
  assert.equal((await current(backend)).revision, head.revision); assert.equal(b.book().entries[0].amount, 2000);
});

test('cloud rollback is a new version and preserves both pre-restore local data and newer cloud history', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); await a.sync.connect();
  const first = await current(backend); spend(a, '10'); await a.sync.syncNow(); const before = a.book();
  const prepared = await a.sync.prepareRestore(first.snapshotId);
  await a.sync.restoreVersion(prepared);
  assert.equal(a.sync.status().phase, 'synced'); assert.equal(a.book().entries.length, 1);
  assert.equal((await current(backend)).revision, 3); assert.deepEqual(a.recoveries.at(-1).data, before);
  assert.equal((await a.sync.history()).length, 3);
});

test('damaged cloud backup does not replace current local ledger', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); await a.sync.connect();
  const head = await current(backend), doc = [...backend.repo.documents().keys()].find(key => key.endsWith(`${head.snapshotId}-0`));
  backend.repo.documents().get(doc).text += 'damage';
  const b = device(backend), empty = b.book();
  assert.equal((await b.sync.connect()).phase, 'error'); assert.deepEqual(b.book(), empty);
  assert.equal((await current(backend)).revision, 1);
});

test('cloud never accepts client-supplied identities, cross-owner reads, wrong AppID or anonymous callers', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); await a.sync.connect(); const head = await current(backend);
  const other = { APPID: APP_ID, OPENID: 'different-owner' };
  assert.equal((await backend.call({ protocol: 1, action: 'head', OPENID: context.OPENID }, other)).head, null);
  assert.equal((await backend.call({ protocol: 1, action: 'snapshot', snapshotId: head.snapshotId }, other)).code, 'NOT_FOUND');
  assert.equal((await backend.call({ protocol: 1, action: 'head' }, { ...context, APPID: 'different-app' })).code, 'UNAUTHORIZED');
  assert.equal((await backend.call({ protocol: 1, action: 'head' }, { APPID: APP_ID })).code, 'UNAUTHORIZED');
});

test('incomplete and hash-mismatched staged uploads never advance the active cloud head', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect(); const before = await current(backend);
  const id = 'a'.repeat(32), text = wire.encode(a.book());
  await backend.call({ protocol: 1, action: 'begin', operationId: id, digest: wire.digest(text), chunks: 1, bytes: wire.byteLength(text), baseRevision: before.revision });
  assert.equal((await backend.call({ protocol: 1, action: 'commit', operationId: id })).code, 'INCOMPLETE_UPLOAD');
  await backend.call({ protocol: 1, action: 'part', operationId: id, index: 0, text: 'tampered' });
  assert.equal((await backend.call({ protocol: 1, action: 'commit', operationId: id })).code, 'CORRUPT_BACKUP');
  assert.equal((await current(backend)).revision, before.revision);
});

test('a different personal book requires a decision; a missing original cloud head never silently reinitializes', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  const other = device(backend); setupBook(other); spend(other);
  await other.sync.connect(); assert.equal(other.sync.status().phase, 'conflict');
  const owner = (await backend.call({ protocol: 1, action: 'head' })).owner;
  await backend.repo.remove(`${owner}-head`); spend(a);
  await a.sync.syncNow(); assert.equal(a.sync.status().phase, 'conflict'); assert.equal(await current(backend), null);
});

test('fixed environment and newer server schema guards prevent writes to a changed destination', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect(); a.sync.stop();
  let calls = 0;
  const wrong = device(backend, { book: a.book(), meta: a.metadata(), env: 'another-env', call: async data => { calls++; return backend.call(data); } });
  await wrong.sync.syncNow(); assert.equal(wrong.sync.status().phase, 'error'); assert.equal(calls, 0);
  const owner = (await backend.call({ protocol: 1, action: 'head' })).owner;
  backend.repo.documents().get(`${owner}-head`).schema = 99;
  const fresh = device(backend); const before = fresh.book();
  assert.equal((await fresh.sync.connect()).phase, 'error'); assert.deepEqual(fresh.book(), before);
});

test('retention exposes 30 recent committed versions and never removes the active head', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  for (let i=0;i<32;i++) { spend(a, '1'); await a.sync.syncNow(); }
  const history = await a.sync.history(), head = await current(backend);
  assert.equal(history.length, 30); assert.equal(head.revision, 33); assert.equal(history[0].snapshotId, head.snapshotId);
  assert.equal((await a.sync.prepareRestore(head.snapshotId)).state.entries.length, 32);
});

test('failed local ledger writes never publish rejected entries; demo ledgers never upload', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect(); a.failSaving(true);
  assert.throws(() => spend(a), /保存失败|无法确认/);
  await a.sync.syncNow(); assert.equal((await current(backend)).stats.entries, 0);
  const demo = device(server(), { book: a.ledger.seed(true) });
  assert.equal((await demo.sync.connect()).phase, 'demo');
});

test('ordinary app version initialization preserves book and sync metadata, checkpoints only on changed version', async () => {
  const backend = server(), a = device(backend); setupBook(a); spend(a); await a.sync.connect();
  delete require.cache[require.resolve('../utils/app-updates')];
  const { checkpointVersion } = require('../utils/app-updates');
  const book = a.book(), meta = a.metadata(); let release;
  const storage = { get: () => release, set: value => { release = value; } };
  checkpointVersion(storage); const count = a.recoveries.length;
  checkpointVersion(storage);
  assert.equal(a.recoveries.length, count); assert.equal(a.recoveries.at(-1).reason, 'upgrade');
  assert.deepEqual(a.book(), book); assert.deepEqual(a.metadata(), meta);
});

test('failed metadata acknowledgement keeps the local book and durable operation recoverable after restart', async () => {
  const backend = server(); let a;
  a = device(backend, { call: async data => {
    const result = await backend.call(data);
    if (data.action === 'commit') a.failMetadata(true);
    return result;
  } });
  setupBook(a); spend(a); const before = a.book();
  assert.equal((await a.sync.connect()).phase, 'error');
  assert.deepEqual(a.book(), before); assert.ok(a.metadata().pending);
  a.sync.stop();
  const reopened = device(backend, { book: before, meta: a.metadata() });
  await reopened.sync.syncNow();
  assert.equal(reopened.sync.status().phase, 'synced'); assert.equal((await current(backend)).revision, 1);
});

test('choosing cloud holds the sync lock, rejects a concurrent choice and rechecks edits made during download', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  let hold = false, entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const b = device(backend, { call: async data => {
    const result = await backend.call(data);
    if (hold && data.action === 'chunk') { hold = false; entered(); await gate; }
    return result;
  } });
  await b.sync.connect(); spend(a, '10'); await a.sync.syncNow(); spend(b, '20'); await b.sync.syncNow();
  const review = b.sync.status().review; hold = true;
  const choosing = b.sync.useCloud(review); await waiting;
  await assert.rejects(b.sync.keepLocal(review), error => error.code === 'BUSY');
  const auto = b.sync.syncNow(); spend(b, '30'); const before = b.book(); release();
  await assert.rejects(choosing, error => error.code === 'CONFLICT'); await assert.rejects(auto);
  assert.deepEqual(b.book(), before); assert.equal((await current(backend)).revision, 2);
});

test('cloud changes while a conflict choice downloads cannot silently replace the local book', async () => {
  const backend = server(), a = device(backend); setupBook(a); await a.sync.connect();
  let advance = false;
  const b = device(backend, { call: async data => {
    const result = await backend.call(data);
    if (advance && data.action === 'chunk') { advance = false; spend(a, '30'); await a.sync.syncNow(); }
    return result;
  } });
  await b.sync.connect(); spend(a, '10'); await a.sync.syncNow(); spend(b, '20'); await b.sync.syncNow();
  const before = b.book(); advance = true;
  await assert.rejects(b.sync.useCloud(b.sync.status().review), error => error.code === 'CONFLICT');
  assert.deepEqual(b.book(), before); assert.equal((await current(backend)).revision, 3);
});

test('backgrounding during a failed upload cancels retries until the app resumes', async () => {
  const backend = server(); let a;
  a = device(backend, { call: async data => {
    if (data.action === 'part') { a.sync.stop(); const error = new Error('offline'); error.code = 'NETWORK'; throw error; }
    return backend.call(data);
  } });
  setupBook(a); spend(a);
  await a.sync.connect();
  assert.equal(a.sync.status().phase, 'error'); assert.equal(a.jobs.filter(job => !job.cancelled).length, 0);
  assert.equal(await current(backend), null); assert.equal(a.book().entries.length, 1);
});
