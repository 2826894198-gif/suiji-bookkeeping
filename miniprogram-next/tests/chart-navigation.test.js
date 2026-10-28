const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const ledger = require('../utils/ledger');
const charts = require('../utils/charts');
const echarts = require('../utils/vendor/echarts.min');
const clone = value => JSON.parse(JSON.stringify(value));
let app, scrolls;
function pageAt(path) {
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[require.resolve(path)]; require(path);
  return { ...definition, data: clone(definition.data), setData(value) { Object.assign(this.data, value); } };
}
beforeEach(() => {
  let state = ledger.seed(true);
  ledger.setAdapter({ get: () => clone(state), set: value => { state = clone(value); } });
  app = { globalData: { statusHeight: 20, bottomInset: 0 } }; scrolls = [];
  global.getApp = () => app;
  global.wx = { nextTick: fn => fn(), pageScrollTo: value => scrolls.push(value), switchTab() {} };
});
afterEach(() => { delete global.Page; delete global.Component; delete global.getApp; delete global.getCurrentPages; delete global.wx; });

test('opening cached entry and editing another entry return to the top without erasing the draft or saved data', () => {
  const page = pageAt('../pages/entry/index');
  const stored = clone(ledger.load());
  try {
    page.onShow();
    page.inputAmount({ detail: { value: '12.34' } });
    page.noteInput({ detail: { value: '未保存的备注' } });
    page.onHide(); page.onShow();
    assert.equal(page.data.amount, '12.34'); assert.equal(page.data.note, '未保存的备注');
    app.globalData.editId = 'demo-8';
    page.onHide(); page.onShow();
    assert.equal(page.data.editId, 'demo-8'); assert.equal(page.data.amount, '68');
    assert.deepEqual(scrolls, Array(3).fill({ scrollTop: 0, duration: 0 }));
    assert.deepEqual(ledger.load(), stored);
  } finally { page.onUnload(); }
});

test('tapping the already selected entry tab also returns to the top', () => {
  let component, called = 0;
  global.Component = value => { component = value; };
  global.getCurrentPages = () => [{ scrollToTop() { called++; } }];
  delete require.cache[require.resolve('../custom-tab-bar/index')]; require('../custom-tab-bar/index');
  component.methods.switchTab.call({ data: { selected: 2 } }, { currentTarget: { dataset: { index: 2 } } });
  assert.equal(called, 1);
});

test('selecting a chart date changes its amount, highlight and expense rows; range and book changes drop an invalid day', () => {
  const page = pageAt('../pages/dashboard/index');
  const state = ledger.load(), summary = ledger.summary(state), stored = clone(state);
  page.draw = () => {};
  page.loadPage(state, summary);
  assert.equal(page.data.selectedDate, '2026-10-20'); assert.equal(page.data.dayAmount, '480.00');
  page.dateChange({ detail: { value: '2026-10-16' } });
  assert.equal(page.data.dayAmount, '450.00'); assert.equal(page.data.dayLabel, '10月16日');
  assert.ok(page.data.todayRows.length); assert.ok(page.data.todayRows.every(e => e.date === '2026-10-16' && e.type === 'expense'));
  assert.equal(charts.lineOption(page._chartData, page.data.selectedDate).series[0].markPoint.data[0].coord[0], 1);
  page.chooseDay();
  assert.equal(page.data.sheet, 'day-picker');
  assert.equal(page.data.calendarDays.filter(d => !d.empty).length, page._chartData.length);
  page.pickDay({ currentTarget: { dataset: { date: '2026-10-16' } } });
  assert.equal(page.data.sheet, '');
  page.selectDay('2026-10-10'); assert.equal(page.data.selectedDate, '2026-10-16');
  page.viewDayEntries(); assert.equal(app.globalData.ledgerDate, '2026-10-16');
  page.loadPage(state, ledger.summary(state, '2026-09-15'));
  assert.equal(page.data.selectedDate, '2026-10-14'); assert.equal(page.data.dayAmount, '0.00');
  page.loadPage(state, ledger.summary(state, '2026-11-15'));
  assert.equal(page.data.selectedDate, ''); assert.equal(page.data.hasChartDays, false);
  assert.deepEqual(ledger.load(), stored);
});

test('viewing all selected-day expenses applies a visible, removable date filter and resets ledger scroll', () => {
  const page = pageAt('../pages/ledger/index');
  app.globalData.ledgerDate = '2026-10-16';
  page.loadPage(ledger.load(), ledger.summary());
  assert.equal(page.data.dateFilter, '2026-10-16'); assert.equal(page.data.type, 'expense');
  assert.equal(app.globalData.ledgerDate, undefined);
  assert.ok(page.data.count > 0); assert.ok(page.data.groups.every(g => g.date === '2026-10-16'));
  assert.deepEqual(scrolls, [{ scrollTop: 0, duration: 0 }]);
  page.clearDateFilter(); assert.equal(page.data.dateFilter, ''); assert.ok(page.data.groups.length > 1);
});

test('adaptive axes keep cents, daily spending, refunds and large amounts inside a useful plotting range', () => {
  for (const amounts of [[0, .29], [0, 12.34, 68], [-68, 0, 12], [0, 99999999.99], [0, 0]]) {
    const data = amounts.map((amount, index) => ({ date: `2026-10-${15 + index}`, label: String(15 + index), amount }));
    const option = charts.lineOption(data, data[0].date);
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 288, height: 176 });
    try {
      chart.setOption(option);
      assert.ok(option.yAxis.min <= Math.min(...amounts)); assert.ok(option.yAxis.max >= Math.max(...amounts));
      assert.ok(option.yAxis.interval > 0); assert.ok(!chart.renderToSVGString().includes('NaN'));
      if (Math.max(...amounts) !== Math.min(...amounts)) {
        const low = chart.convertToPixel({ yAxisIndex: 0 }, Math.min(...amounts));
        const peak = chart.convertToPixel({ yAxisIndex: 0 }, Math.max(...amounts));
        assert.ok(low - peak > 20, `daily variation must not be flattened: ${amounts}`);
      }
    } finally { chart.dispose(); }
  }
});

test('refund adjustments retain net spending, zero-net activity dots and full date keys across a month boundary', () => {
  ledger.refund('demo-0', '320', '2026-10-15');
  ledger.refund('demo-8', '8', '2026-10-20');
  const page = pageAt('../pages/dashboard/index');
  page.loadPage(ledger.load(), ledger.summary());
  assert.equal(page.data.dayAmount, '472.00'); assert.equal(page.data.dayRefund, '8.00');
  page.chooseDay();
  const zeroDay = page.data.calendarDays.find(d => d.date === '2026-10-15');
  assert.equal(zeroDay.amountText, '0.00'); assert.equal(zeroDay.hasExpense, true);
  const data = charts.daily(ledger.load(), ledger.summary(ledger.load(), '2026-09-15'));
  assert.equal(data[15].date, '2026-09-30'); assert.equal(data[16].date, '2026-10-01');
});
