const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const ledger = require('../utils/ledger');
const { daySummary } = require('../utils/day-summary');
const clone = value => JSON.parse(JSON.stringify(value));
let stored, failWrite;
function pageAt(path) {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(path)]; require(path);
  return { ...definition, data: clone(definition.data), setData(values) {
    for (const [path, value] of Object.entries(values)) {
      const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]];
      target[keys.at(-1)] = value;
    }
  } };
}
const event = dataset => ({ currentTarget: { dataset } });
beforeEach(() => {
  stored = ledger.seed(true); failWrite = false;
  ledger.setAdapter({ get: () => clone(stored), set: value => { if (failWrite) throw new Error('disk full'); stored = clone(value); } });
  global.getApp = () => ({ globalData: { statusHeight: 20, bottomInset: 0 } });
  global.wx = { nextTick: fn => fn(), showToast() {}, pageScrollTo() {} };
});
afterEach(() => { delete global.Page; delete global.wx; delete global.getApp; });

test('daily cash flow uses exact cents, excludes transfer and adjustment, and refunds may create negative net expense', () => {
  const rows = [{type:'expense',amount:5000},{type:'expense',amount:2560},{type:'expense',amount:1284},
    {type:'income',amount:12345},{type:'transfer',amount:99999},{type:'adjustment',amount:50000},{type:'refund',amount:10000}];
  assert.deepEqual(daySummary(rows), { expense:8844,income:12345,refund:10000,netExpense:-1156 });
  assert.deepEqual(daySummary([]), {expense:0,income:0,refund:0,netExpense:0});
});

test('day headers sum only displayed search/type/category results and match visible dates', () => {
  const page = pageAt('../pages/ledger/index');
  page.loadPage(ledger.load(), ledger.summary());
  const before = clone(ledger.load());
  for (const group of page.data.groups) {
    assert.equal(group.spentText, ledger.money(daySummary(group.rows).netExpense));
    assert.equal(group.incomeText, ledger.money(daySummary(group.rows).income));
    assert.ok(group.rows.every(row => row.date === group.date));
  }
  page.search({ detail: { value: '午餐' } });
  assert.equal(page.data.hasFilters, true);
  assert.ok(page.data.groups.every(g => g.rows.every(r => r.subcategory === '午餐')));
  page.setType(event({type:'income'}));
  assert.equal(page.data.count, 0); assert.deepEqual(page.data.groups, []);
  assert.deepEqual(ledger.load(), before);
});

test('ordered child arrays survive reload/export with comma-containing names; invalid arrays do not change the book', () => {
  const original = clone(ledger.load());
  ledger.saveCategory({ ...original.categories[0], children:['咖啡,茶饮','晚餐','午餐'] });
  assert.deepEqual(ledger.reload().categories[0].children,['咖啡,茶饮','晚餐','午餐']);
  assert.deepEqual(ledger.parseBackup(ledger.backup()).categories[0].children,['咖啡,茶饮','晚餐','午餐']);
  assert.deepEqual(ledger.load().entries, original.entries);
  const valid = clone(ledger.load());
  for (const children of [['同名','同名'],[' '],['正常',null]]) {
    assert.throws(() => ledger.saveCategory({ ...valid.categories[0], children }));
    assert.deepEqual(ledger.load(), valid);
  }
});

test('sorting, multi-delete and undo automatically persist without changing history or balances', () => {
  const page = pageAt('../pages/categories/index'), original=clone(ledger.load());
  page.edit(event({id:'food'}));
  page.selectChild(event({index:2})); page.moveChild(event({step:-1}));
  assert.equal(page.data.childRows[1].name,'晚餐');
  page.removeChild(event({index:1})); page.removeChild(event({index:0}));
  assert.equal(page.data.deletedChildren.length,2);
  page.undoRemoveChild(); page.undoRemoveChild();
  assert.deepEqual(page.data.childRows.map(c=>c.name),['早餐','晚餐','午餐','咖啡茶饮']);
  assert.equal(page.data.deletedChildren.length,0);
  page.closeSheet();
  assert.deepEqual(ledger.reload().categories.find(c=>c.id==='food').children,['早餐','晚餐','午餐','咖啡茶饮']);
  assert.deepEqual(ledger.load().entries,original.entries);
  assert.deepEqual(ledger.allAccounts().map(c=>c.balance),ledger.allAccounts(original).map(c=>c.balance));
});

test('drag boundaries and button reorder persist together; saved order reaches entry without rewriting old entries', () => {
  const page=pageAt('../pages/categories/index'), original=clone(ledger.load());
  page.edit(event({id:'food'}));
  page.startChildDrag({...event({index:2}),touches:[{clientY:200}]});
  page.moveChildDrag({touches:[{clientY:72}]}); page.endChildDrag();
  assert.equal(page.data.childRows[0].name,'晚餐');
  page.moveChild(event({step:-1})); assert.equal(page.data.childRows[0].name,'晚餐');
  page.removeChild(event({index:2}));
  page.newChildInput({detail:{value:'下午茶'}}); page.addChild();
  page.save(); assert.equal(page.data.sheet,'');
  assert.deepEqual(ledger.load().categories[0].children,['晚餐','早餐','咖啡茶饮','下午茶']);
  assert.deepEqual(ledger.load().entries,original.entries);
  const entry=pageAt('../pages/entry/index'); entry.loadPage(ledger.load());
  assert.deepEqual(entry.data.children,['晚餐','早餐','咖啡茶饮','下午茶']);
});

test('a removed historic subcategory remains unchanged when editing only the note, and empty child lists stay usable', () => {
  const original=clone(ledger.load().entries.find(e=>e.id==='demo-8'));
  ledger.saveCategory({...ledger.load().categories.find(c=>c.id==='food'),children:['新选项']});
  const entry=pageAt('../pages/entry/index');
  const app={globalData:{statusHeight:20,bottomInset:0,editId:'demo-8'}};global.getApp=()=>app;
  entry.loadPage(ledger.load());
  assert.equal(entry.data.subcategory, original.subcategory);assert.equal(entry.data.legacySubcategory,true);
  entry.noteInput({detail:{value:'只改备注'}});
  ledger.saveEntry({...entry.data, accountId:entry.data.accounts[entry.data.accountIndex].id},entry.data.editId);
  assert.equal(ledger.load().entries.find(e=>e.id==='demo-8').subcategory,original.subcategory);
  ledger.saveCategory({...ledger.load().categories.find(c=>c.id==='food'),children:[]});
  const fresh=pageAt('../pages/entry/index');fresh.loadPage(ledger.load());
  assert.deepEqual(fresh.data.children,[]);assert.equal(fresh.data.subcategory,'');
});

test('a failed category write preserves saved children and keeps the editor available for retry', () => {
  const page=pageAt('../pages/categories/index'),original=clone(ledger.load());
  page.edit(event({id:'food'}));failWrite=true;page.removeChild(event({index:0}));page.save();
  assert.equal(page.data.sheet,'category');assert.match(page.data.formError,/disk full/);
  assert.deepEqual(ledger.load(),original);assert.equal(page.data.busy,false);
});
