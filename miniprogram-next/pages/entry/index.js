const ledger = require('../../utils/ledger');
const { base, toast, navigate } = require('../../utils/page');
const periodView = require('../../utils/period-view');
const common = base(2);
Page({
  ...common,
  data: { ...common.data, type: 'expense', amount: '', categoryId: '', subcategory: '', note: '',
    accountIndex: 0, toIndex: 1, accounts: [], categories: [], children: [], date: '', time: '',
    showNote: false, editId: '', formError: '', initialized: false },
  onShow() {
    this._entryVisible = true;
    common.onShow.call(this);
    this.scrollToTop();
  },
  onHide() { this._entryVisible = false; common.onHide.call(this); },
  onUnload() { this._entryVisible = false; common.onUnload.call(this); },
  scrollToTop() {
    wx.nextTick(() => { if (this._entryVisible) wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
  },
  loadPage(state) {
    if (this._bookId !== state.bookId || this._generation !== ledger.generation()) {
      this._bookId = state.bookId; this._generation = ledger.generation();
      this._dirty = false; this._manualDate = false; this._manualTime = false;
      this.setData({ initialized: false, editId: '', amount: '', note: '', type: 'expense',
        accountIndex: 0, toIndex: 1, categoryId: '', subcategory: '', showNote: false, formError: '' });
    }
    const accounts = ledger.allAccounts(state);
    const moment = ledger.entryMoment(state);
    this.setData({ accounts, hasAccounts: accounts.length > 0 });
    const app = getApp();
    const editId = app.globalData.editId;
    const transferFrom = app.globalData.transferFrom;
    if (editId) {
      this._manualDate = true; this._manualTime = true; this._dirty = true;
      const row = state.entries.find(e => e.id === editId);
      delete app.globalData.editId;
      if (row) this.setData({ ...row, editId, amount: String(row.amount / 100),
        accountIndex: Math.max(0, accounts.findIndex(a => a.id === row.accountId)),
        toIndex: Math.max(0, accounts.findIndex(a => a.id === row.toAccountId)), showNote: !!row.note, initialized: true });
    } else if (transferFrom) {
      delete app.globalData.transferFrom;
      this._manualDate = false; this._manualTime = false; this._dirty = false;
      this.setData({ type: 'transfer', accountIndex: Math.max(0, accounts.findIndex(a => a.id === transferFrom)),
        toIndex: Math.max(0, accounts.findIndex(a => a.id !== transferFrom)), amount: '', note: '', editId: '',
        ...moment, initialized: true });
    } else if (!this.data.initialized) {
      this._manualDate = false; this._manualTime = false; this._dirty = false;
      this.setData({ ...moment, initialized: true });
    } else if (!this.data.editId) {
      if (!this._manualDate) this.setData({ date: moment.date });
      if (!this._manualTime && !this._dirty) this.setData({ time: moment.time });
    }
    this.updateCategories();
  },
  updateCategories() {
    const state = ledger.load();
    const list = state.categories.filter(c => c.type === this.data.type);
    const category = list.find(c => c.id === this.data.categoryId) || list[0];
    const original = state.entries.find(e => e.id === this.data.editId);
    const keepHistorical = !!(category && original && original.categoryId === category.id &&
      original.subcategory && original.subcategory === this.data.subcategory && !category.children.includes(original.subcategory));
    this.setData({ categories: list, categoryId: category ? category.id : '',
      categoryName: category ? category.name : '', legacySubcategory: keepHistorical,
      children: category ? category.children : [],
      subcategory: keepHistorical ? this.data.subcategory : category && category.children.includes(this.data.subcategory) ? this.data.subcategory : category ? category.children[0] || '' : '' });
  },
  setType(e) { this.setData({ type: e.currentTarget.dataset.type, categoryId: '', subcategory: '', formError: '' }); this.updateCategories(); },
  inputAmount(e) { this._dirty = true; this.setData({ amount: e.detail.value, formError: '' }); },
  chooseCategory(e) { this.setData({ categoryId: e.currentTarget.dataset.id, subcategory: '' }); this.updateCategories(); },
  chooseChild(e) { this.setData({ subcategory: e.currentTarget.dataset.name, legacySubcategory: false }); },
  accountChange(e) { this.setData({ accountIndex: Number(e.detail.value) }); },
  toChange(e) { this.setData({ toIndex: Number(e.detail.value) }); },
  dateChange(e) { this._manualDate = true; this.setData({ date: e.detail.value }); },
  timeChange(e) { this._manualTime = true; this.setData({ time: e.detail.value }); },
  noteInput(e) { this._dirty = true; this.setData({ note: e.detail.value }); },
  toggleNote() { this.setData({ showNote: !this.data.showNote }); },
  futureInput(e) { this.setData({ sheet: 'input-info', inputName: e.currentTarget.dataset.name }); },
  cancelEdit() { this.setData({ editId: '', amount: '', note: '', initialized: false }); this.refresh(); this.scrollToTop(); },
  save() {
    if (this.data.busy) return;
    this.setData({ busy: true, formError: '' });
    try {
      const account = this.data.accounts[this.data.accountIndex];
      const to = this.data.accounts[this.data.toIndex];
      ledger.saveEntry({ ...this.data, accountId: account ? account.id : '', toAccountId: to ? to.id : '' }, this.data.editId);
      periodView.select(this.data.date);
      this._dirty = false; this._manualDate = false; this._manualTime = false;
      this.setData({ amount: '', note: '', editId: '', showNote: false, initialized: false });
      toast('已保存，账户与预算已更新');
      navigate('ledger');
    } catch (e) { this.setData({ formError: e.message }); }
    finally { this.setData({ busy: false }); }
  }
});
