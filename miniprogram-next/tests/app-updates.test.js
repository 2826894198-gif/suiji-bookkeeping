const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const ledger = require('../utils/ledger');
const updates = require('../utils/app-updates');
const copy = value => JSON.parse(JSON.stringify(value));
let stored, recoveries, failBackup, callbacks, dialogs, toasts, applied, metadata;
beforeEach(() => {
  stored = undefined; recoveries = []; failBackup = false; callbacks = {}; dialogs = []; toasts = []; applied = 0;
  metadata = { enabled: true, owner: 'existing-owner', revision: 12, pending: { id: 'interrupted-upload' } };
  ledger.setClock(() => new Date(2026, 9, 22, 12, 30));
  ledger.setAdapter({ get: () => stored && copy(stored), set: value => { stored = copy(value); },
    checkpoint(raw, reason) {
      if (failBackup) throw new Error('storage full');
      recoveries.push({ raw: copy(raw), reason });
    } });
  ledger.load(); ledger.saveAccount({ name: '已有账户', balance: '1000' });
  global.wx = {
    getUpdateManager: () => ({ onUpdateReady: fn => { callbacks.ready = fn; },
      onUpdateFailed: fn => { callbacks.failed = fn; },
      applyUpdate() { applied++; assert.deepEqual(recoveries.at(-1).raw, stored); } }),
    showModal: value => dialogs.push(value), showToast: value => toasts.push(value),
    getStorageSync: () => copy(metadata)
  };
});
afterEach(() => { ledger.setClock(); delete global.wx; delete global.Page; delete global.getApp; });
function spend() {
  ledger.saveEntry({ type: 'expense', accountId: ledger.allAccounts()[0].id,
    categoryId: 'food', amount: '12.34', date: '2026-10-22', time: '12:30' });
}

test('confirmed update backs up the latest book again before restart, preserving pending synchronization', () => {
  const originalMetadata = copy(metadata);
  updates.watch(); callbacks.ready();
  const prompt = dialogs.at(-1), beforePrompt = copy(stored);
  assert.equal(recoveries.at(-1).reason, 'upgrade');
  spend(); const latest = copy(stored);
  assert.notDeepEqual(latest, beforePrompt);
  prompt.success({ confirm: true });
  assert.equal(applied, 1); assert.deepEqual(recoveries.at(-1).raw, latest);
  assert.deepEqual(stored, latest); assert.deepEqual(metadata, originalMetadata);
});

test('postponing a downloaded update never restarts or alters the saved book', () => {
  spend(); const before = copy(stored);
  updates.watch(); callbacks.ready(); dialogs.at(-1).success({ confirm: false });
  assert.equal(applied, 0); assert.deepEqual(stored, before);
});

test('backup failure before prompting blocks restart and leaves all existing records intact', () => {
  spend(); const before = copy(stored); failBackup = true;
  updates.watch(); callbacks.ready();
  assert.equal(applied, 0); assert.equal(dialogs.at(-1).title, '更新前备份未完成');
  assert.equal(dialogs.at(-1).showCancel, false); assert.deepEqual(stored, before);
});

test('backup failure after the update prompt also blocks restart without clearing local or pending cloud data', () => {
  spend(); const before = copy(stored), originalMetadata = copy(metadata);
  updates.watch(); callbacks.ready(); const prompt = dialogs.at(-1);
  failBackup = true; prompt.success({ confirm: true });
  assert.equal(applied, 0); assert.equal(dialogs.at(-1).title, '更新前备份未完成');
  assert.deepEqual(stored, before); assert.deepEqual(metadata, originalMetadata);
});

test('a failed download and an unsupported update API preserve a working local ledger', () => {
  spend(); const before = copy(stored);
  updates.watch(); callbacks.failed();
  assert.equal(applied, 0); assert.match(toasts.at(-1).title, /下次打开/);
  delete wx.getUpdateManager; assert.doesNotThrow(() => updates.watch());
  assert.deepEqual(stored, before);
});

test('settings identifies actual release/trial/develop environments without touching the ledger', () => {
  let page;
  global.Page = value => { page = value; };
  global.getApp = () => ({ globalData: {} });
  delete require.cache[require.resolve('../pages/settings/index')]; require('../pages/settings/index');
  const instance = { ...page, data: copy(page.data), setData(value) { Object.assign(this.data, value); } };
  const before = copy(stored);
  assert.equal(instance.data.appName, '随记');
  for (const [envVersion, expected] of [['develop', '开发版'], ['trial', '体验版'], ['release', '正式版']]) {
    wx.getAccountInfoSync = () => ({ miniProgram: { envVersion } });
    instance.loadPage(ledger.load()); assert.equal(instance.data.releaseEnvironment, expected);
  }
  delete wx.getAccountInfoSync; instance.loadPage(ledger.load());
  assert.equal(instance.data.releaseEnvironment, ''); assert.deepEqual(stored, before);
});
