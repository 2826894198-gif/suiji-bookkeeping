const ledger = require('../../utils/ledger');
const { base, toast, navigate } = require('../../utils/page');
const motion = require('./motion');
const common = base(4);
Page({
  ...common,
  data: { ...common.data, groups: [], selectedGroup: null, selectedIndex: 0, swiperCurrent: 0,
    cardStyles: [], cardWidth: 176, cardHeight: 280, cardMargin: 95, motionDuration: 320, reducedMotion: false, compactLayout: false,
    selectedTabId: '', headerActionRight: 110, accountForm: {}, adjustAmount: '',
    accountKinds: ['银行', '电子钱包', '现金'], kindIndex: 1 },
  onShow() { common.onShow.call(this); this.measureCarousel(); },
  onHide() { this.finishMotion(); common.onHide.call(this); },
  onUnload() { clearTimeout(this._arrivalTimer); common.onUnload.call(this); },
  onResize() { this.measureCarousel(); },
  measureCarousel() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : { windowWidth: 390 };
    const geometry = motion.layout(info.windowWidth, info.windowHeight);
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    this.setData({ cardWidth: geometry.cardWidth, cardHeight: geometry.cardHeight, cardMargin: geometry.margin, compactLayout: geometry.compactLayout,
      headerActionRight: menu && menu.left ? Math.max(16, info.windowWidth - menu.left + 8) : 110 });
    if (this.createSelectorQuery) wx.nextTick(() => this.createSelectorQuery().select('.account-motion-preference')
      .fields({ computedStyle: ['transition-duration'] }, result => {
        if (!result) return;
        const reduced = parseFloat(result['transition-duration']) === 0;
        if (reduced !== this.data.reducedMotion) this.setData({ reducedMotion: reduced, motionDuration: reduced ? 0 : 320,
          cardStyles: motion.poses(this.data.groups.length, this.data.selectedIndex, reduced) });
      }).exec());
  },
  loadPage(state) {
    const accounts = ledger.allAccounts(state);
    const groups = state.accounts.map(g => ({
      ...g, ...motion.identity(g),
      icon: g.kind === 'bank' ? 'landmark' : g.kind === 'cash' ? 'banknote' : 'wallet',
      amountText: ledger.money(accounts.filter(a => a.groupId === g.id).reduce((n, a) => n + a.balance, 0)),
      children: accounts.filter(a => a.groupId === g.id).map(a => ({ ...a, amountText: ledger.money(a.balance) }))
    }));
    const previousId = this._preferredGroupId || (this.data.selectedGroup || {}).id;
    const retained = groups.findIndex(group => group.id === previousId);
    const index = retained >= 0 ? retained : Math.min(1, Math.max(0, groups.length - 1));
    this._preferredGroupId = null;
    this.finishMotion();
    this.setData({ groups, selectedIndex: index, swiperCurrent: index, selectedGroup: groups[index] || null,
      selectedTabId: groups[index] ? `bank-tab-${index}` : '', cardStyles: motion.poses(groups.length, index, this.data.reducedMotion) });
  },
  selectGroup(e) { this.goToGroup(Number(e.currentTarget.dataset.index)); },
  previousGroup() { this.goToGroup(this.data.selectedIndex - 1); },
  nextGroup() { this.goToGroup(this.data.selectedIndex + 1); },
  goToGroup(index) {
    if (!this.data.groups.length) return;
    index = Math.max(0, Math.min(this.data.groups.length - 1, index));
    if (index === this.data.selectedIndex) return;
    this._moving = this.data.motionDuration > 0;
    // One target update lets the native compositor finish translation and tilt
    // together. No per-frame bridge updates or final pose correction can rock it.
    this.setData({ selectedIndex: index, swiperCurrent: index, selectedGroup: this.data.groups[index], selectedTabId: `bank-tab-${index}`,
      cardStyles: motion.poses(this.data.groups.length, index, this.data.reducedMotion) });
    clearTimeout(this._arrivalTimer);
    if (this._moving) this._arrivalTimer = setTimeout(() => this.finishMotion(), this.data.motionDuration + 100);
    else this.finishMotion();
  },
  finishMotion(e) {
    if (e && e.detail && Number(e.detail.current) !== this.data.selectedIndex) return;
    clearTimeout(this._arrivalTimer);
    this._moving = false;
  },
  startSwipe(e) {
    const touch = (e.touches || [])[0];
    this._swipe = touch ? { clientX: touch.clientX, clientY: touch.clientY, index: this.data.selectedIndex } : null;
    this._suppressCardTap = false;
  },
  moveSwipe(e) {
    const touch = (e.touches || [])[0];
    if (!this._swipe || !touch) return;
    const dx = touch.clientX - this._swipe.clientX, dy = touch.clientY - this._swipe.clientY;
    if (Math.abs(dx) >= 8 && Math.abs(dx) > Math.abs(dy)) this._suppressCardTap = true;
  },
  endSwipe(e) {
    const start = this._swipe;
    this._swipe = null;
    if (!start) return;
    const end = (e.changedTouches || [])[0];
    const target = motion.swipeTarget(start, end, start.index, this.data.groups.length);
    if (target !== start.index) { this._suppressCardTap = true; this.goToGroup(target); }
  },
  cancelSwipe() { this._swipe = null; },
  tapCard(e) {
    if (this._suppressCardTap) { this._suppressCardTap = false; return; }
    const index = Number(e.currentTarget.dataset.index);
    if (index !== this.data.selectedIndex) return this.goToGroup(index);
    if (!this._moving) this.openGroup(e);
  },
  newAccount() { this.setData({ sheet: 'account', accountForm: { name: '', childName: '余额', balance: '' }, formError: '', kindIndex: 1 }); },
  openGroup(e) {
    const group = this.data.groups.find(g => g.id === e.currentTarget.dataset.id);
    this.setData({ selectedGroup: group, sheet: 'group' });
  },
  addChild() { if (this.data.selectedGroup) this.setData({ sheet: 'account', accountForm: { name: this.data.selectedGroup.name, childName: '', balance: '', groupId: this.data.selectedGroup.id }, formError: '' }); },
  accountInput(e) { this.setData({ [`accountForm.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  kindChange(e) { this.setData({ kindIndex: Number(e.detail.value) }); },
  saveAccount() {
    try {
      const form = this.data.accountForm;
      ledger.saveAccount({ ...form, kind: ['bank', 'wallet', 'cash'][this.data.kindIndex] });
      const saved = ledger.load().accounts.find(group => group.id === form.groupId || group.name === form.name.trim());
      this._preferredGroupId = saved && saved.id;
      this.closeSheet(); this.refresh(); toast('账户已添加');
    }
    catch (e) { this.setData({ formError: e.message }); }
  },
  renameGroup() {
    this.setData({ sheet: 'rename', renameValue: this.data.selectedGroup.name, formError: '' });
  },
  renameInput(e) { this.setData({ renameValue: e.detail.value }); },
  saveRename() {
    const name = this.data.renameValue.trim();
    if (!name) return this.setData({ formError: '请填写账户名称' });
    try {
      ledger.commit(state => {
        if (state.accounts.some(g => g.name === name && g.id !== this.data.selectedGroup.id)) throw new Error('账户名称已存在');
        const group = state.accounts.find(g => g.id === this.data.selectedGroup.id);
        if (!group) throw new Error('账户已不存在');
        group.name = name.slice(0, 20);
      });
      this.closeSheet(); this.refresh(); toast('名称已更新');
    } catch (e) { this.setData({ formError: e.message }); }
  },
  adjust(e) {
    const account = ledger.allAccounts().find(a => a.id === e.currentTarget.dataset.id);
    this.setData({ sheet: 'adjust', selectedAccount: account, adjustAmount: String(account.balance / 100), formError: '' });
  },
  openChild(e) {
    const account = ledger.allAccounts().find(a => a.id === e.currentTarget.dataset.id);
    if (account) this.setData({ sheet: 'child', selectedAccount: { ...account, amountText: ledger.money(account.balance) } });
  },
  adjustInput(e) { this.setData({ adjustAmount: e.detail.value }); },
  saveAdjustment() {
    try { ledger.adjustBalance(this.data.selectedAccount.id, this.data.adjustAmount); this.closeSheet(); this.refresh(); toast('余额已更新，调整记录已保留'); }
    catch (e) { this.setData({ formError: e.message }); }
  },
  transfer(e) {
    const id = e.currentTarget.dataset.id || (ledger.allAccounts()[0] || {}).id;
    if (ledger.allAccounts().length < 2) return toast('至少需要两个子账户才能转账');
    getApp().globalData.transferFrom = id;
    this.closeSheet(); navigate('entry');
  },
  history() { this.closeSheet(); navigate('ledger'); }
});
