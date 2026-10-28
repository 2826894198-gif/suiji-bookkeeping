const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ledger = require('../utils/ledger');
const view = require('../utils/period-view');
const charts = require('../utils/charts');
const backups = require('../utils/backup-files');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let stored, saved, recovery, now;
function adapter(extra = {}) {
  return { get: () => copy(stored), set(value) { stored = copy(value); saved++; },
    remove() { stored = undefined; }, checkpoint(raw, reason) { recovery.push({ raw: copy(raw), reason }); }, ...extra };
}
function openPersonal() {
  ledger.load(); ledger.saveAccount({ name: '日常账户', balance: '1000' });
  return ledger.allAccounts()[0].id;
}
function expense(accountId, amount = '12.34', date = ledger.today()) {
  return { type: 'expense', accountId, amount, categoryId: 'food', subcategory: '午餐', date, time: '12:30' };
}
beforeEach(() => {
  stored = undefined; saved = 0; recovery = []; now = new Date(2026, 9, 21, 9, 41);
  ledger.setClock(() => new Date(now)); ledger.setAdapter(adapter()); view.reset();
});
afterEach(() => { ledger.setClock(); backups.setAdapter(null); delete global.Page; delete global.getApp; delete global.wx; });

test('fresh installation is empty and uses device date/time; demo remains a clearly separate fixed reference', () => {
  assert.equal(ledger.load().demo, false);
  assert.equal(ledger.load().entries.length, 0);
  assert.deepEqual(ledger.entryMoment(), { date: '2026-10-21', time: '09:41' });
  assert.equal(ledger.today(ledger.seed(true)), '2026-10-20');
});

test('historical browsing does not persist, change new-entry date or stick after reset; boundaries follow the actual cycle', () => {
  ledger.load(); const count = saved, previous = copy(stored);
  now = new Date(2026, 9, 14, 23, 58);
  assert.equal(ledger.summary().start, '2026-09-15');
  view.move(-1); assert.equal(view.anchor(), '2026-08-15');
  view.move(1); assert.equal(view.anchor(), '2026-10-14');
  view.move(-1); assert.deepEqual(ledger.entryMoment(), { date: '2026-10-14', time: '23:58' });
  assert.equal(saved, count); assert.deepEqual(stored, previous);
  view.reset(); now = new Date(2026, 9, 15, 0, 1);
  assert.equal(view.anchor(), '2026-10-15'); assert.equal(ledger.summary().start, '2026-10-15');
});

test('completed historical charts cover the full cycle, recent seven days cross months, future periods stay empty', () => {
  const state = ledger.load();
  const old = ledger.summary(state, '2026-09-15');
  assert.equal(old.days, 30); assert.equal(charts.daily(state, old).length, 30);
  assert.deepEqual(charts.daily(state, old, true).map(d => d.label), ['8', '9', '10', '11', '12', '13', '14']);
  const future = ledger.summary(state, '2026-11-15');
  assert.equal(future.days, 0); assert.deepEqual(charts.daily(state, future), []);
  assert.ok(charts.lineOption([{ label: '20', amount: -68 }]).yAxis.min <= -68);
});

test('legacy migration preserves entries, balances, budgets and takes a checkpoint before the first write', () => {
  const legacy = ledger.seed(true); legacy.schema = 1; legacy.anchor = '2026-09-15'; delete legacy.bookId; delete legacy.demoDate;
  stored = copy(legacy);
  const beforeBalances = ledger.allAccounts(legacy);
  const upgraded = ledger.load();
  assert.equal(upgraded.schema, 2); assert.ok(upgraded.bookId); assert.equal(upgraded.anchor, undefined);
  assert.deepEqual(upgraded.entries, legacy.entries); assert.deepEqual(upgraded.budgets, legacy.budgets);
  assert.deepEqual(ledger.allAccounts(), beforeBalances);
  assert.equal(recovery[0].reason, 'migration'); assert.deepEqual(recovery[0].raw, legacy);
  const backup = JSON.stringify({ format: 'pearl-ledger-backup', version: 1, data: legacy });
  assert.deepEqual(ledger.parseBackup(backup).entries, legacy.entries);
  assert.equal(JSON.parse(ledger.backup()).version, 2);
  ledger.reload(); assert.equal(recovery.length, 1);
  const changedCycle = copy(legacy); changedCycle.cycleDay = 1;
  const imported = ledger.parseBackup(JSON.stringify({ format: 'pearl-ledger-backup', version: 1, data: changedCycle }));
  assert.deepEqual(imported.budgets, legacy.budgets);
  assert.deepEqual(ledger.allAccounts(imported), beforeBalances);
});

test('failed migration checkpoint and newer schema never overwrite stored data', () => {
  stored = { ...ledger.seed(true), schema: 1, anchor: '2026-10-20' };
  const original = copy(stored);
  ledger.setAdapter(adapter({ checkpoint() { throw new Error('backup full'); } }));
  assert.throws(() => ledger.load(), /backup full/); assert.deepEqual(stored, original); assert.equal(saved, 0);
  stored = { ...ledger.seed(true), schema: 99 }; ledger.setAdapter(adapter());
  assert.throws(() => ledger.load(), /更新/); assert.equal(stored.schema, 99); assert.equal(saved, 0);
});

test('complete personal daily flow persists through reload and JSON restore with balances and budget reconciled', () => {
  const first = openPersonal(); ledger.saveAccount({ name: '备用金', balance: '200' });
  const second = ledger.allAccounts()[1].id;
  ledger.saveBudget('500', { food: '200' }, 15);
  ledger.saveEntry(expense(first, '68')); const spending = ledger.load().entries.at(-1).id;
  ledger.saveEntry({ type: 'income', amount: '100', categoryId: 'salary', accountId: first, date: ledger.today() });
  ledger.saveEntry({ type: 'transfer', amount: '50', accountId: first, toAccountId: second, date: ledger.today() });
  ledger.refund(spending, '8', ledger.today());
  ledger.adjustBalance(second, '260');
  const expected = copy(ledger.load());
  assert.equal(ledger.summary().assets, 125000);
  assert.equal(ledger.summary().spent, 6000); assert.equal(ledger.summary().income, 10000); assert.equal(ledger.summary().remaining, 44000);
  const exported = ledger.backup();
  ledger.setAdapter(adapter()); assert.deepEqual(ledger.load(), expected);
  ledger.saveEntry(expense(first)); const beforeRestore = copy(ledger.load());
  ledger.restore(exported);
  assert.deepEqual(ledger.reload(), expected);
  assert.equal(recovery.at(-1).reason, 'restore'); assert.deepEqual(recovery.at(-1).raw, beforeRestore);
  const refundId = ledger.load().entries.find(e => e.type === 'refund').id;
  ledger.removeEntry(refundId); ledger.removeEntry(spending);
  assert.equal(ledger.summary().spent, 0); assert.equal(ledger.summary().assets, 131000);
});

test('invalid, truncated, over-refunded and wrong-category backups leave the current book unchanged', () => {
  const id = openPersonal(); ledger.saveEntry(expense(id, '10'));
  const original = copy(ledger.load()), file = JSON.parse(ledger.backup());
  const variants = ['{', 'null', JSON.stringify({ ...file, version: 9 })];
  const wrongAccount = copy(file); wrongAccount.data.entries[0].accountId = 'missing'; variants.push(JSON.stringify(wrongAccount));
  const wrongCategory = copy(file); wrongCategory.data.entries[0].categoryId = 'salary'; variants.push(JSON.stringify(wrongCategory));
  const over = copy(file); const e = over.data.entries[0];
  over.data.entries.push({ ...e, id: 'bad-refund', type: 'refund', originalId: e.id, amount: 1001 }); variants.push(JSON.stringify(over));
  const wrongBudget = copy(file); wrongBudget.data.budgets['2026-10-15'] = { total: 1, categories: { food: 2 } }; variants.push(JSON.stringify(wrongBudget));
  for (const text of variants) { assert.throws(() => ledger.restore(text)); assert.deepEqual(ledger.load(), original); assert.deepEqual(stored, original); }
});

test('readback failure rolls back a partial write; rollback failure is reported honestly and recovery point remains', () => {
  const id = openPersonal(), original = copy(ledger.load()); let writes = 0;
  ledger.setAdapter(adapter({ set(value) { writes++; stored = writes === 1 ? { ...copy(value), entries: [] } : copy(value); } }));
  assert.throws(() => ledger.saveEntry(expense(id)), /原账本已保留/);
  assert.deepEqual(stored, original); assert.deepEqual(ledger.load(), original);
  ledger.setAdapter(adapter({ set() { stored = { corrupt: true }; throw new Error('write interrupted'); } }));
  assert.throws(() => ledger.saveEntry(expense(id)), /无法确认保存结果/);
  assert.throws(() => ledger.load()); assert.deepEqual(recovery.at(-1).raw, original);
});

test('snapshot failure blocks modification and restore; normal modifications checkpoint once per session day', () => {
  const id = openPersonal(); assert.equal(recovery.length, 1);
  ledger.saveEntry(expense(id)); ledger.saveEntry(expense(id)); assert.equal(recovery.length, 1);
  now = new Date(2026, 9, 22, 0, 1); ledger.saveEntry(expense(id)); assert.equal(recovery.length, 2);
  const original = copy(ledger.load()), exported = ledger.backup();
  ledger.setAdapter(adapter({ checkpoint() { throw new Error('backup unavailable'); } }));
  assert.throws(() => ledger.saveEntry(expense(id)), /backup unavailable/);
  assert.throws(() => ledger.restore(exported), /backup unavailable/);
  assert.deepEqual(stored, original); assert.deepEqual(ledger.load(), original);
});

test('budget edit targets the selected period and never reinterprets recorded history by changing cycle day', () => {
  openPersonal(); ledger.saveBudget('500', { food: '200' }, 15);
  ledger.saveBudget('300', { food: '100' }, 15, '2026-09-15');
  assert.equal(ledger.summary().budget.total, 50000);
  assert.equal(ledger.summary(ledger.load(), '2026-09-15').budget.total, 30000);
  assert.throws(() => ledger.saveBudget('500', {}, 10), /历史统计/);
  assert.equal(ledger.load().cycleDay, 15);
});

test('entry page uses today after historical browsing, follows midnight, preserves manual dates and clears stale restored drafts', () => {
  openPersonal(); view.move(-1);
  let definition; global.Page = value => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  delete require.cache[require.resolve('../pages/entry/index')]; require('../pages/entry/index');
  const page = { ...definition, data: copy(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.loadPage(ledger.load()); assert.equal(page.data.date, '2026-10-21'); assert.equal(page.data.time, '09:41');
  now = new Date(2026, 9, 22, 0, 1); page.loadPage(ledger.load()); assert.equal(page.data.date, '2026-10-22');
  page.dateChange({ detail: { value: '2026-09-20' } }); page.inputAmount({ detail: { value: '12' } });
  now = new Date(2026, 9, 23, 0, 1); page.loadPage(ledger.load()); assert.equal(page.data.date, '2026-09-20'); assert.equal(page.data.amount, '12');
  const backup = ledger.backup(); ledger.restore(backup); page.loadPage(ledger.load());
  assert.equal(page.data.date, '2026-10-23'); assert.equal(page.data.amount, ''); assert.equal(page.data.editId, '');
});

test('filesystem backup roundtrip and rotation preserve manual/pre-restore files; corrupt readbacks and unsafe names fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pearl-backup-test-'));
  const wxFs = { ...fs, mkdirSync(dir) { fs.mkdirSync(dir, { recursive: true }); } };
  backups.setAdapter({ fs: wxFs, root: path.join(root, 'backups') });
  try {
    const text = ledger.backup();
    const manual = backups.save(text); backups.save(text, 'restore');
    for (let i = 0; i < 10; i++) backups.save(text, 'auto');
    assert.equal(backups.list().length, 9); assert.equal(backups.list().filter(x => x.reason === 'auto').length, 7);
    assert.equal(backups.read(manual.name), text); assert.throws(() => backups.read('../outside.json'));
    backups.setAdapter({ fs: { ...wxFs, readFileSync() { return 'corrupt'; } }, root: path.join(root, 'failed') });
    assert.throws(() => backups.save(text), /安全备份/); assert.equal(fs.readdirSync(path.join(root, 'failed')).length, 0);
    backups.setAdapter({ fs: { ...wxFs, readFileSync(file, encoding) { return file.endsWith('.tmp') ? fs.readFileSync(file, encoding) : 'corrupt'; } }, root: path.join(root, 'renamed') });
    assert.throws(() => backups.save(text), /安全备份/); assert.equal(fs.readdirSync(path.join(root, 'renamed')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
