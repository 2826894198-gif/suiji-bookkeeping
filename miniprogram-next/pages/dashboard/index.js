const ledger = require('../../utils/ledger');
const { base, entryView, navigate } = require('../../utils/page');
const charts = require('../../utils/charts');
const common = base(0);
Page({
  ...common,
  data: { ...common.data, ec: { lazyLoad: true }, range: '本期', todayRows: [], selectedDate: '', dayLabel: '',
    dayAmount: '0.00', dayCount: 0, dayRefund: '', chartStart: '', chartEnd: '', hasChartDays: false },
  loadPage(state, summary) {
    const previousDate = this._bookId === state.bookId && this._generation === ledger.generation() ? this.data.selectedDate : '';
    this._bookId = state.bookId; this._generation = ledger.generation();
    this._state = state;
    this._chartData = charts.daily(state, summary, this.data.range === '近 7 日');
    const days = this._chartData;
    const selectedDate = days.some(d => d.date === previousDate) ? previousDate : days.length ? days[days.length - 1].date : '';
    this.setData({ isEmpty: state.accounts.length === 0, chartStart: days.length ? days[0].date : '',
      chartEnd: days.length ? days[days.length - 1].date : '', hasChartDays: days.length > 0 });
    this.showDay(selectedDate);
    if (this._ready) wx.nextTick(() => this.draw());
  },
  showDay(date) {
    const state = this._state;
    const rows = state.entries.filter(e => e.date === date && (e.type === 'expense' || e.type === 'refund'))
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    const spent = rows.reduce((n, e) => n + (e.type === 'expense' ? e.amount : -e.amount), 0);
    const refund = rows.filter(e => e.type === 'refund').reduce((n, e) => n + e.amount, 0);
    const dayLabel = date ? date === ledger.today(state) ? '今日' : `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : '所选周期';
    this.setData({ selectedDate: date, dayLabel, dayAmount: ledger.money(spent), dayCount: rows.length,
      dayRefund: refund ? ledger.money(refund) : '', todayRows: rows.slice(0, 5).map(e => entryView(e, state)) });
  },
  selectDay(date) {
    if (!this._chartData.some(d => d.date === date) || date === this.data.selectedDate) return;
    this.showDay(date); this.draw();
  },
  dateChange(event) { this.selectDay(event.detail.value); },
  chooseDay() {
    if (!this._chartData.length) return;
    const activityDates = new Set(this._state.entries.filter(e => e.type === 'expense' || e.type === 'refund').map(e => e.date));
    const offset = (ledger.localDate(this._chartData[0].date).getDay() + 6) % 7;
    const calendarDays = Array.from({ length: offset }, (_, i) => ({ key: `blank-${i}`, empty: true }));
    this._chartData.forEach((day, index) => calendarDays.push({ ...day, key: day.date,
      label: index === 0 || day.label === '1' ? `${Number(day.date.slice(5, 7))}/${day.label}` : day.label,
      amountText: ledger.money(Math.round(day.amount * 100)), hasExpense: activityDates.has(day.date) }));
    this.setData({ calendarDays, sheet: 'day-picker' });
  },
  pickDay(event) { this.setData({ sheet: '' }); this.selectDay(event.currentTarget.dataset.date); },
  viewDayEntries() {
    if (!this.data.selectedDate) return;
    getApp().globalData.ledgerDate = this.data.selectedDate;
    navigate('ledger');
  },
  onReady() { this._ready = true; this.draw(); },
  draw() {
    if (this._chartData) charts.paint(this, '#daily-chart', charts.lineOption(this._chartData, this.data.selectedDate), '_chart', chart => {
      const zr = chart.getZr();
      let origin, moved = false;
      zr.on('mousedown', event => { origin = [event.offsetX, event.offsetY]; moved = false; });
      zr.on('mousemove', event => {
        if (origin && Math.hypot(event.offsetX - origin[0], event.offsetY - origin[1]) > 12) moved = true;
      });
      zr.on('click', event => {
        if (moved || this.data.sheet) return;
        origin = null;
        const index = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX));
        const day = this._chartData[index];
        if (day) this.selectDay(day.date);
      });
    });
  },
  toggleRange() { this.setData({ range: this.data.range === '本期' ? '近 7 日' : '本期' }); this.refresh(); },
  onResize() { if (this._chart) this._chart.resize(); },
  onUnload() { common.onUnload.call(this); charts.dispose(this); }
});
