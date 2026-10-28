const { base, entryView } = require('../../utils/page');
const ledger = require('../../utils/ledger');
const { daySummary } = require('../../utils/day-summary');
const common = base(1);
Page({
  ...common,
  data: { ...common.data, query: '', type: 'all', category: '', categoryName: '全部分类', groups: [], count: 0, dateFilter: '' },
  loadPage(state, summary) {
    this._state = state; this._rows = summary.rows;
    this.setData({ balanceText: ledger.money(summary.income - summary.spent) });
    const app = getApp();
    const date = app.globalData.ledgerDate;
    delete app.globalData.ledgerDate;
    if (date && ledger.validDate(date) && date >= summary.start && date <= summary.end) {
      this.setData({ dateFilter: date, type: 'expense', query: '', category: '', categoryName: '全部分类' });
      wx.nextTick(() => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
    } else if (this._bookId !== state.bookId || this.data.dateFilter < summary.start || this.data.dateFilter > summary.end) {
      this.setData({ dateFilter: '' });
    }
    this._bookId = state.bookId;
    this.filterRows();
  },
  filterRows() {
    const state = this._state; if (!state) return;
    const { query, type, category, dateFilter } = this.data;
    const rows = this._rows.filter(e => e.type !== 'adjustment')
      .filter(e => !dateFilter || e.date === dateFilter)
      .filter(e => type === 'all' || e.type === type || type === 'expense' && e.type === 'refund')
      .filter(e => !category || e.categoryId === category)
      .map(e => entryView(e, state))
      .filter(e => !query || `${e.name} ${e.subcategory} ${e.note} ${e.accountLabel} ${e.money}`.includes(query))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const groups = [];
    rows.forEach(row => {
      let group = groups.find(g => g.date === row.date);
      if (!group) { group = { date: row.date, label: row.date === ledger.today(state) ? '今日' : row.date.replace(/-/g, '.'), rows: [] }; groups.push(group); }
      group.rows.push(row);
    });
    groups.forEach(group => {
      const totals = daySummary(group.rows);
      Object.assign(group, { spentText: ledger.money(totals.netExpense), incomeText: ledger.money(totals.income),
        hasRefund: totals.refund > 0, refundText: ledger.money(totals.refund) });
    });
    this.setData({ groups, count: rows.length, hasFilters: !!(query || category || type !== 'all') });
  },
  search(e) { this.setData({ query: e.detail.value }); this.filterRows(); },
  clearDateFilter() { this.setData({ dateFilter: '' }); this.filterRows(); },
  setType(e) { this.setData({ type: e.currentTarget.dataset.type }); this.filterRows(); },
  chooseCategory() {
    const list = this._state.categories.filter(c => c.type === 'expense');
    wx.showActionSheet({ itemList: ['全部分类', ...list.map(c => c.name)],
      success: ({ tapIndex }) => { const selected = list[tapIndex - 1]; this.setData({ category: selected ? selected.id : '', categoryName: selected ? selected.name : '全部分类' }); this.filterRows(); } });
  }
});
