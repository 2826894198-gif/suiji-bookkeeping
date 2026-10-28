const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const ledger = require('../utils/ledger');
const motion = require('../pages/accounts/motion');
const clone = value => JSON.parse(JSON.stringify(value));
const event = dataset => ({ currentTarget: { dataset } });
let stored, page, writes;

beforeEach(() => {
  stored = ledger.seed(true); writes = 0;
  ledger.setAdapter({ get: () => clone(stored), set: value => { stored = clone(value); writes++; } });
  global.getApp = () => ({ globalData: { statusHeight: 24, bottomInset: 16 } });
  global.wx = { nextTick: fn => fn(), showToast() {}, getWindowInfo: () => ({ windowWidth: 390 }) };
  global.Page = definition => { page = { ...definition, data: clone(definition.data), setData: values => {
    for (const [key,value] of Object.entries(values)) {
      const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.'); let target=page.data;
      for (let i=0;i<parts.length-1;i++) target=target[parts[i]];
      target[parts.at(-1)]=value;
    }
  } }; };
  delete require.cache[require.resolve('../pages/accounts/index')];
  require('../pages/accounts/index');
  page.refresh();
});
afterEach(() => { page.onUnload(); delete global.Page; delete global.getApp; delete global.wx; });

test('card rotation approaches its center monotonically without the old overshoot', () => {
  let previous = 36;
  for (let step = 0; step <= 40; step++) {
    const style = motion.poses(3, step / 40)[1];
    const angle = Math.abs(Number(style.match(/rotateY\(([-.\d]+)deg\)/)[1]));
    assert.ok(angle <= previous, `rotation reverses at ${step}: ${angle} > ${previous}`);
    previous = angle;
  }
  assert.equal(previous, 0);
});

test('rapid reversal and late arrival events never repaint a settled card or unlock the wrong transition', () => {
  page.goToGroup(2); page.goToGroup(0);
  const styles = clone(page.data.cardStyles);
  let updates = 0;
  const setData = page.setData; page.setData = values => { updates++; setData(values); };
  page.finishMotion({ detail: { current: 2 } });
  assert.equal(page._moving, true); assert.equal(page.data.selectedIndex, 0);
  page.finishMotion({ detail: { current: 0 } });
  page.finishMotion({ detail: { current: 2 } });
  assert.equal(page._moving, false); assert.equal(updates, 0);
  assert.deepEqual(page.data.cardStyles, styles);
  assert.match(styles[0], /rotateY\(0\.00deg\)/);
});

test('account browsing preserves ledger data and computes real parent and child balances without duplicate assets', () => {
  const original = clone(ledger.load()), initialWrites = writes;
  for (let index = 0; index < page.data.groups.length; index++) {
    page.goToGroup(index); page.finishMotion();
    const group = page.data.selectedGroup;
    const sum = ledger.allAccounts().filter(account => account.groupId === group.id).reduce((total, account) => total + account.balance, 0);
    assert.equal(group.amountText, ledger.money(sum));
    assert.equal(page.data.assetsText, ledger.money(ledger.summary().assets));
    assert.match(page.data.cardStyles[index], /rotateY\(0\.00deg\)/);
  }
  assert.deepEqual(ledger.load(), original); assert.equal(writes, initialWrites);
});

test('short and long deliberate swipes each choose one complete account; first and last edges stay put', () => {
  for (const dx of [-8, -16, -300]) {
    assert.equal(motion.swipeTarget({ clientX: 320, clientY: 100 }, { clientX: 320 + dx, clientY: 102 }, 0, 4), 1);
  }
  assert.equal(motion.swipeTarget({clientX:100,clientY:100},{clientX:116,clientY:100},2,4),1);
  assert.equal(motion.swipeTarget({clientX:100,clientY:100},{clientX:200,clientY:100},0,4),0);
  assert.equal(motion.swipeTarget({clientX:100,clientY:100},{clientX:0,clientY:100},3,4),3);
});

test('vertical gestures, cancelled gestures and tap slop do not switch accounts or write balances', () => {
  const selected = page.data.selectedIndex, initialWrites = writes;
  for (const end of [{clientX:102,clientY:220},{clientX:106,clientY:100}]) {
    page.startSwipe({touches:[{clientX:100,clientY:100}]});
    page.moveSwipe({touches:[end]}); page.endSwipe({changedTouches:[end]});
    assert.equal(page.data.selectedIndex,selected);
  }
  page.startSwipe({touches:[{clientX:100,clientY:100}]}); page.cancelSwipe();
  page.endSwipe({changedTouches:[{clientX:0,clientY:100}]});
  assert.equal(page.data.selectedIndex,selected); assert.equal(writes,initialWrites);
});

test('a completed swipe cannot open details, while a fresh tap still opens the selected group', () => {
  page.startSwipe({touches:[{clientX:200,clientY:100}]});
  page.moveSwipe({touches:[{clientX:184,clientY:100}]});
  page.endSwipe({changedTouches:[{clientX:184,clientY:100}]}); page.finishMotion();
  const index=page.data.selectedIndex, id=page.data.groups[index].id;
  page.tapCard(event({index,id})); assert.equal(page.data.sheet,'');
  page.startSwipe({touches:[{clientX:100,clientY:100}]});
  page.endSwipe({changedTouches:[{clientX:100,clientY:100}]});
  page.tapCard(event({index,id})); assert.equal(page.data.sheet,'group');
});

test('refresh retains the selected group by ID and balance adjustment still records an exact adjustment', () => {
  page.goToGroup(0); page.finishMotion();
  const groupId=page.data.selectedGroup.id, child=page.data.selectedGroup.children[0];
  page.openChild(event({id:child.id})); assert.equal(page.data.sheet,'child');
  page.adjust(event({id:child.id})); page.adjustInput({detail:{value:'123.45'}}); page.saveAdjustment();
  assert.equal(page.data.selectedGroup.id,groupId);
  assert.equal(ledger.allAccounts().find(account=>account.id===child.id).balance,12345);
  assert.equal(ledger.load().entries.at(-1).type,'adjustment');
  assert.equal(page.data.selectedGroup.children[0].amountText,'123.45');
});

test('account and subaccount forms remain functional and newly created groups are selected without changing previous entries', () => {
  const previousEntries=clone(ledger.load().entries);
  page.newAccount(); page.accountInput({...event({field:'name'}),detail:{value:'测试银行'}});
  page.accountInput({...event({field:'balance'}),detail:{value:'200.01'}}); page.kindChange({detail:{value:'0'}}); page.saveAccount();
  assert.equal(page.data.selectedGroup.name,'测试银行'); assert.equal(page.data.selectedGroup.amountText,'200.01');
  page.addChild(); page.accountInput({...event({field:'childName'}),detail:{value:'定期'}});
  page.accountInput({...event({field:'balance'}),detail:{value:'99.99'}}); page.saveAccount();
  assert.equal(page.data.selectedGroup.amountText,'300.00'); assert.equal(page.data.selectedGroup.children.length,2);
  page.renameGroup(); page.renameInput({detail:{value:'我的银行'}}); page.saveRename();
  assert.equal(page.data.selectedGroup.name,'我的银行'); assert.deepEqual(ledger.load().entries,previousEntries);
});

test('empty and single-account books stay usable; brand materials depend on identity rather than array order', () => {
  const empty=ledger.seed(false);page.loadPage(empty); assert.equal(page.data.selectedGroup,null);page.nextGroup();page.addChild();
  const one=ledger.seed(false);one.accounts=[{id:'boc',name:'中国银行',kind:'bank',children:[{id:'leaf',name:'余额',opening:99999999999}]}];
  page.loadPage(one);page.measureCarousel();page.nextGroup();page.finishMotion();
  assert.equal(page.data.selectedIndex,0); assert.equal(page.data.selectedGroup.amountText,'999,999,999.99');
  for (const [name,material] of [['中国银行','champagne'],['建设银行','silver'],['微信','sage']]) assert.equal(motion.identity({id:name,name}).material,material);
  assert.equal(motion.layout(320).step,194); assert.equal(motion.layout(768).margin,280);
});
