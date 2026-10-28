const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const ledger = require('../utils/ledger');
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset } });
let page, stored, failWrite, writes;

beforeEach(() => {
  stored = ledger.seed(true); failWrite = false; writes = 0;
  ledger.setAdapter({ get: () => clone(stored), set: value => {
    if (failWrite) throw new Error('disk full');
    stored = clone(value); writes++;
  } });
  global.getApp = () => ({ globalData: { statusHeight: 24, bottomInset: 16 } });
  global.wx = { nextTick: fn => fn(), showToast() {} };
  global.Page = definition => { page = { ...definition, data: clone(definition.data), setData(values) {
    for (const [key,value] of Object.entries(values)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
      for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
      target[parts.at(-1)] = value;
    }
  } }; };
  delete require.cache[require.resolve('../pages/categories/index')];
  require('../pages/categories/index');
  page.edit(event({ id: 'food' }));
});
afterEach(() => { clearTimeout(page._saveTimer); delete global.Page; delete global.getApp; delete global.wx; });
const food = () => ledger.reload().categories.find(c => c.id === 'food');

test('Complete includes an unconfirmed new subcategory instead of silently dropping its text', () => {
  page.newChildInput({ detail: { value: '下午茶' } });
  page.save();
  assert.equal(page.data.sheet, '');
  assert.equal(food().children.at(-1), '下午茶');
  page.edit(event({ id: 'food' }));
  assert.equal(page.data.childRows.at(-1).name, '下午茶');
});

test('add, reorder, delete and undo survive leaving and reopening without an explicit Save', () => {
  const original = clone(ledger.load());
  page.newChildInput({ detail: { value: '咖啡,茶饮' } }); page.addChild();
  page.moveChild(event({ step: -1 }));
  assert.deepEqual(food().children, ['早餐','午餐','晚餐','咖啡,茶饮','咖啡茶饮']);
  page.removeChild(event({ key: page.data.childRows[0].key }));
  assert.equal(food().children.includes('早餐'), false);
  page.undoRemoveChild();
  page.closeSheet(); page.edit(event({ id: 'food' }));
  assert.deepEqual(page.data.childRows.map(c => c.name), ['早餐','午餐','晚餐','咖啡,茶饮','咖啡茶饮']);
  assert.equal(page.data.saveStatus, '已自动保存');
  assert.deepEqual(ledger.load().entries, original.entries);
  assert.deepEqual(ledger.load().accounts, original.accounts);
});

test('an input event arriving after reorder edits the same child using its stable key', () => {
  const key = page.data.childRows[1].key;
  page.selectChild(event({ key })); page.moveChild(event({ step: -1 }));
  page.childInput({ ...event({ key, index: 1 }), detail: { value: '午餐（工作日）' } });
  page.inputBlur();
  assert.deepEqual(food().children.slice(0, 2), ['午餐（工作日）','早餐']);
});

test('text edits debounce to durable storage, and backgrounding flushes pending text immediately', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const key = page.data.childRows[0].key;
  page.childInput({ ...event({ key }), detail: { value: '早饭' } });
  assert.equal(food().children[0], '早餐');
  t.mock.timers.tick(601);
  assert.equal(food().children[0], '早饭');
  page.newChildInput({ detail: { value: '宵夜' } });
  page.onHide();
  assert.equal(food().children.at(-1), '宵夜');
});

test('a new parent acquires one stable ID and subsequent automatic saves do not create duplicates', () => {
  const initial = ledger.load().categories.length;
  page.create(); page.formInput({ ...event({ field: 'name' }), detail: { value: '学习' } });
  page.inputBlur();
  const id = page.data.form.id; assert.ok(id);
  page.newChildInput({ detail: { value: '书籍' } }); page.addChild();
  page.formInput({ ...event({ field: 'name' }), detail: { value: '阅读学习' } });
  page.closeSheet();
  const state = ledger.reload();
  assert.equal(state.categories.length, initial + 1);
  assert.deepEqual(state.categories.find(c => c.id === id).children, ['书籍']);
  assert.equal(state.categories.find(c => c.id === id).name, '阅读学习');
});

test('duplicate and blank children keep the last good book and leave the editor open for correction', () => {
  const original = clone(ledger.load());
  page.newChildInput({ detail: { value: '早餐' } }); page.save();
  assert.equal(page.data.sheet, 'category'); assert.match(page.data.formError, /同名/);
  assert.deepEqual(ledger.load(), original);
  page.newChildInput({ detail: { value: '' } });
  const key = page.data.childRows[0].key;
  page.childInput({ ...event({ key }), detail: { value: '' } });
  page.inputBlur(); page.closeSheet();
  assert.equal(page.data.sheet, 'category'); assert.match(page.data.formError, /填写子分类/);
  assert.deepEqual(ledger.load(), original);
  page.childInput({ ...event({ key }), detail: { value: '早饭' } }); page.save();
  assert.equal(food().children[0], '早饭'); assert.equal(page.data.sheet, '');
});

test('storage refusal keeps the draft, reports failure and retries without losing child order', () => {
  const original = clone(ledger.load()); failWrite = true;
  page.selectChild(event({ index: 2 })); page.moveChild(event({ step: -1 }));
  page.closeSheet();
  assert.equal(page.data.sheet, 'category'); assert.equal(page.data.saveState, 'error');
  assert.match(page.data.formError, /disk full/); assert.deepEqual(ledger.load(), original);
  failWrite = false; page.save();
  assert.equal(page.data.sheet, '');
  assert.deepEqual(food().children, ['早餐','晚餐','午餐','咖啡茶饮']);
  assert.deepEqual(ledger.load().entries, original.entries);
});

test('opening and closing an unchanged editor does not rewrite the ledger', () => {
  const initialWrites = writes;
  page.closeSheet();
  assert.equal(writes, initialWrites);
  page.create(); page.closeSheet();
  assert.equal(page.data.sheet, ''); assert.equal(writes, initialWrites);
});
