const ledger = require('../../utils/ledger');
const { base } = require('../../utils/page');
const charts = require('../../utils/charts');
const common = base();
Page({
  ...common,
  data: { ...common.data, ec: { lazyLoad: true }, rows: [], average: '0', days: 1 },
  loadPage(state, summary) {
    this._summary = summary; this._daily = charts.daily(state, summary);
    const days = summary.days;
    this.setData({ days, average: ledger.money(days ? Math.round(summary.spent / days) : 0, false),
      rows: summary.byCategory.filter(c => c.used > 0).sort((a, b) => b.used - a.used).map(c => ({
        ...c, amountText: ledger.money(c.used), proportion: summary.spent ? (c.used / summary.spent * 100).toFixed(1) : '0',
        width: summary.spent ? c.used / summary.spent * 100 : 0
      })) });
    if (this._ready) wx.nextTick(() => this.draw());
  },
  onReady() { this._ready = true; this.draw(); },
  draw() {
    if (!this._summary) return;
    charts.paint(this, '#composition', charts.donutOption(this._summary), '_donut');
    charts.paint(this, '#trend', charts.lineOption(this._daily), '_trend');
  },
  onResize() { if (this._donut) this._donut.resize(); if (this._trend) this._trend.resize(); },
  onUnload() { common.onUnload.call(this); charts.dispose(this, '_donut'); charts.dispose(this, '_trend'); }
});
