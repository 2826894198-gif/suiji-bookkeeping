const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const ledger = require('../utils/ledger');
const charts = require('../utils/charts');

let stored;
beforeEach(() => {
  stored = ledger.seed(true);
  ledger.setAdapter({
    get: () => stored,
    set: value => { stored = JSON.parse(JSON.stringify(value)); }
  });
});
function expense(amount = '10.25') {
  return { type: 'expense', amount, accountId: 'wx-change', categoryId: 'food',
    subcategory: '午餐', date: '2026-10-20', time: '12:30' };
}

test('reference data, budget ratio, account aggregation and daily chart agree', () => {
  const state = ledger.load();
  const summary = ledger.summary(state);
  assert.equal(summary.spent, 326000);
  assert.equal(summary.remaining, 474000);
  assert.equal(summary.assets, 2865000);
  assert.equal(summary.usedPercent, 40.75);
  assert.equal(summary.accountCount, 4);
  assert.equal(ledger.allAccounts().length, 6);
  assert.deepEqual(charts.daily(state, summary).map(d => d.amount), [320,450,280,760,970,480]);
});
test('create, edit, delete and reload keep accounts, categories and budget in sync', () => {
  const original = ledger.summary();
  const originalBalance = ledger.allAccounts().find(a => a.id === 'wx-change').balance;
  ledger.saveEntry(expense());
  const id = ledger.load().entries.at(-1).id;
  assert.equal(ledger.summary().spent, original.spent + 1025);
  assert.equal(ledger.summary().assets, original.assets - 1025);
  assert.equal(ledger.allAccounts().find(a => a.id === 'wx-change').balance, originalBalance - 1025);
  ledger.saveEntry(expense('20.01'), id);
  assert.equal(ledger.summary().spent, original.spent + 2001);
  ledger.reload();
  assert.equal(ledger.summary().remaining, original.remaining - 2001);
  ledger.removeEntry(id);
  assert.equal(ledger.summary().spent, original.spent);
  assert.equal(ledger.summary().assets, original.assets);
});
test('transfer changes both leaf accounts without changing assets, income or budget', () => {
  const before = ledger.summary();
  const balances = ledger.allAccounts();
  ledger.saveEntry({ type: 'transfer', amount: '125.35', accountId: 'bank-current',
    toAccountId: 'wx-change', date: '2026-10-20' });
  const after = ledger.summary();
  for (const field of ['assets', 'spent', 'income', 'remaining']) assert.equal(after[field], before[field]);
  const next = ledger.allAccounts();
  assert.equal(next.find(a => a.id === 'bank-current').balance, balances.find(a => a.id === 'bank-current').balance - 12535);
  assert.equal(next.find(a => a.id === 'wx-change').balance, balances.find(a => a.id === 'wx-change').balance + 12535);
});
test('linked refunds reduce net spend, cannot exceed original or cross cycles', () => {
  const before = ledger.summary();
  ledger.refund('demo-8', '20.10', '2026-10-20');
  assert.equal(ledger.summary().spent, before.spent - 2010);
  assert.equal(ledger.summary().income, before.income);
  assert.equal(ledger.summary().assets, before.assets + 2010);
  assert.equal(ledger.summary().byCategory.find(c => c.id === 'food').used, 96790);
  assert.throws(() => ledger.refund('demo-8', '48', '2026-10-20'), /超过/);
  assert.throws(() => ledger.refund('demo-8', '1', '2026-11-15'), /今天/);
  ledger.saveEntry({ ...expense('10'), date: '2026-10-14' });
  assert.throws(() => ledger.refund(ledger.load().entries.at(-1).id, '1', '2026-10-20'), /跨预算周期/);
  assert.throws(() => ledger.removeEntry('demo-8'), /关联回款/);
});
test('balance adjustments are recorded without inventing income or spend', () => {
  const before = ledger.summary();
  ledger.adjustBalance('bank-invest', '6500');
  const after = ledger.summary();
  assert.equal(after.assets, before.assets + 50000);
  assert.equal(after.income, before.income);
  assert.equal(after.spent, before.spent);
  assert.equal(ledger.load().entries.at(-1).type, 'adjustment');
});
test('failed storage writes preserve current data as well as persisted data', () => {
  const initial = JSON.parse(JSON.stringify(ledger.load()));
  ledger.setAdapter({ get: () => initial, set: () => { throw new Error('disk full'); } });
  assert.throws(() => ledger.saveEntry(expense()), /disk full/);
  assert.deepEqual(ledger.load(), initial);
  assert.deepEqual(ledger.reload(), initial);
});
test('backup round trip preserves data and malformed files cannot replace it', () => {
  const initial = JSON.parse(JSON.stringify(ledger.load()));
  const backup = ledger.backup();
  ledger.saveEntry(expense());
  ledger.restore(backup);
  assert.deepEqual(ledger.load(), initial);
  assert.throws(() => ledger.restore('{"format":"other"}'));
  const malformed = JSON.parse(backup);
  malformed.data.entries[0].accountId = 'missing';
  assert.throws(() => ledger.restore(JSON.stringify(malformed)), /账目数据/);
  assert.deepEqual(ledger.load(), initial);
});
test('integer precision, invalid money, cycle boundaries and empty states', () => {
  assert.equal(ledger.cents('0.29'), 29);
  assert.equal(ledger.cents('99999999.99'), 9999999999);
  for (const value of ['0', '-1', '0.001', '1e5', 'NaN', '']) assert.throws(() => ledger.cents(value));
  assert.equal(ledger.period('2026-10-14',15).start,'2026-09-15');
  assert.equal(ledger.period('2026-10-15',15).end,'2026-11-14');
  assert.equal(ledger.period('2026-01-01',15).start,'2025-12-15');
  ledger.reset(false);
  assert.equal(ledger.summary().assets, 0);
  assert.equal(ledger.summary().spent, 0);
  ledger.saveAccount({ name: '现金', balance: '100' });
  assert.equal(ledger.summary().assets, 10000);
});
test('category renaming preserves historical grouping by stable ID', () => {
  const before = ledger.summary().byCategory.find(c => c.id === 'food').used;
  ledger.saveCategory({ id: 'food', name: '吃饭', type: 'expense', icon: 'utensils', children: '午餐,晚餐' });
  const after = ledger.summary().byCategory.find(c => c.id === 'food');
  assert.equal(after.name, '吃饭');
  assert.equal(after.used, before);
});
