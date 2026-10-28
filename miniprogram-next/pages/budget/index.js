const ledger = require('../../utils/ledger');
const { base, toast } = require('../../utils/page');
const periodView = require('../../utils/period-view');
const common = base(3);
function budgetRing(percent, over) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#e0e6d2" stroke-width="7"/><circle cx="50" cy="50" r="42" fill="none" stroke="${over ? '#b67c6e' : '#819642'}" stroke-width="7" stroke-linecap="round" opacity="${value ? 1 : 0}" stroke-dasharray="${(263.89 * value / 100).toFixed(2)} 263.89" transform="rotate(-90 50 50)"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
Page({
  ...common,
  data: { ...common.data, categoryRows: [], limits: [], dayOptions: Array.from({ length: 28 }, (_, i) => `每月 ${i + 1} 日`), cycleIndex: 14 },
  loadPage(state, summary) {
    this.setData({ cycleDay: state.cycleDay, ringSrc: budgetRing(summary.usedPercent, summary.remaining < 0), categoryRows: summary.byCategory.filter(c => c.limit || c.used).map(c => ({
      ...c, usedText: ledger.money(c.used, false), limitText: ledger.money(c.limit, false),
      leftText: ledger.money(Math.abs(c.left), false), over: c.limit > 0 && c.left < 0,
      budgeted: c.limit > 0, useText: c.limit > 0 ? (c.used / c.limit * 100).toFixed(0) : '0'
    })) });
  },
  editBudget() {
    const state = ledger.load(), summary = ledger.summary(state, periodView.anchor(state));
    this.setData({ sheet: 'budget', formError: '', draftTotal: String(summary.budget.total / 100), budgetAnchor: summary.anchor,
      cycleLocked: state.entries.length > 0 || Object.keys(state.budgets).length > 0,
      limits: state.categories.filter(c => c.type === 'expense').map(c => ({ id: c.id, name: c.name, value: String((summary.budget.categories[c.id] || 0) / 100) })),
      cycleIndex: state.cycleDay - 1 });
  },
  totalInput(e) { this.setData({ draftTotal: e.detail.value }); },
  limitInput(e) { this.setData({ [`limits[${e.currentTarget.dataset.index}].value`]: e.detail.value }); },
  dayChange(e) { this.setData({ cycleIndex: Number(e.detail.value) }); },
  save() {
    if (this.data.busy) return;
    this.setData({ busy: true, formError: '' });
    try {
      ledger.saveBudget(this.data.draftTotal, Object.fromEntries(this.data.limits.map(c => [c.id, c.value])), this.data.cycleIndex + 1, this.data.budgetAnchor);
      this.closeSheet(); this.refresh(); toast('预算已更新');
    } catch (e) { this.setData({ formError: e.message }); }
    finally { this.setData({ busy: false }); }
  }
});
