const ledger = require('./ledger');
const periodView = require('./period-view');
const routes = ['dashboard', 'ledger', 'entry', 'budget', 'accounts'];
function toast(message) { wx.showToast({ title: message, icon: 'none', duration: 2600 }); }
function navigate(page) {
  const url = `/pages/${page}/index`;
  if (routes.includes(page)) wx.switchTab({ url });
  else wx.navigateTo({ url });
}
function entryView(row, state) {
  const category = state.categories.find(c => c.id === row.categoryId);
  const account = ledger.allAccounts(state).find(a => a.id === row.accountId);
  const transfer = row.type === 'transfer';
  const plus = ['income', 'refund'].includes(row.type) || row.type === 'adjustment' && row.amount > 0;
  const name = transfer ? '账户转账' : row.type === 'adjustment' ? '余额调整' : row.type === 'refund' ? '退款 / AA 回款' : category ? category.name : '未分类';
  return { ...row, name, icon: transfer ? 'arrow-right-left' : row.type === 'adjustment' ? 'sliders-horizontal' : category ? category.icon : 'wallet',
    amountText: `${plus ? '+' : transfer ? '' : '−'}¥${ledger.money(Math.abs(row.amount))}`,
    isIncome: plus, subtitle: `${row.subcategory || row.note || name} · ${account ? account.groupName : ''}`,
    accountLabel: account ? account.label : '已归档账户', money: ledger.money(Math.abs(row.amount)), dateText: `${row.date} ${row.time || ''}` };
}
function base(tabIndex = -1) {
  return {
    data: { error: '', sheet: '', busy: false, statusHeight: 44, bottomInset: 24 },
    onShow() {
      this.refresh();
      if (!this._ledgerListener) this._ledgerListener = ledger.subscribe(({ reason }) => {
        if (reason === 'cloud') wx.nextTick(() => { if (this._ledgerListener) this.refresh(); });
      });
      clearInterval(this._clockTimer);
      this._clockTimer = setInterval(() => {
        try { if (this.data.today !== ledger.today()) this.refresh(); } catch (_) {}
      }, 30000);
    },
    onHide() { clearInterval(this._clockTimer); this._clockTimer = null; if (this._ledgerListener) this._ledgerListener(); this._ledgerListener = null; },
    onUnload() { clearInterval(this._clockTimer); this._clockTimer = null; if (this._ledgerListener) this._ledgerListener(); this._ledgerListener = null; },
    refresh() {
      try {
        const state = ledger.load();
        const summary = ledger.summary(state, periodView.anchor(state));
        const app = getApp();
        this.setData({ statusHeight: app.globalData.statusHeight, bottomInset: app.globalData.bottomInset,
          error: '', period: summary, anchor: summary.anchor, today: ledger.today(state), isCurrentPeriod: summary.isCurrent, isDemo: state.demo,
          spentText: ledger.money(summary.spent), incomeText: ledger.money(summary.income),
          remainingText: ledger.money(summary.remaining), assetsText: ledger.money(summary.assets),
          totalText: ledger.money(summary.budget.total, false), usedText: summary.usedPercent.toFixed(1),
          leftText: (100 - Number(summary.usedPercent.toFixed(1))).toFixed(1), progress: Math.min(100, Math.max(0, summary.usedPercent)),
          accountCount: summary.accountCount, hasBudget: summary.budget.total > 0 });
        if (tabIndex >= 0 && this.getTabBar) {
          const bar = this.getTabBar();
          if (bar) bar.setData({ selected: tabIndex, bottomInset: app.globalData.bottomInset });
        }
        if (this.loadPage) this.loadPage(state, summary);
      } catch (e) { this.setData({ error: `读取失败：${e.message}。请重试或到设置选择备份恢复。` }); }
    },
    retry() { try { ledger.reload(); this.refresh(); } catch (e) { toast(e.message); } },
    go(event) { navigate(event.currentTarget.dataset.page); },
    closeSheet() { this.setData({ sheet: '', formError: '' }); },
    stop() {},
    changePeriod() {
      const state = ledger.load();
      wx.showActionSheet({ itemList: ['上一预算周期', `回到本期（每月 ${state.cycleDay} 日起）`, '下一预算周期', '设置预算周期'],
        success: ({ tapIndex }) => {
          if (tapIndex === 3) return navigate('budget');
          try {
            if (tapIndex === 1) periodView.reset();
            else periodView.move(tapIndex === 0 ? -1 : 1, state);
            this.refresh();
          } catch (e) { toast(e.message); }
        } });
    },
    openEntry(event) {
      const id = event.detail.id || event.currentTarget.dataset.id;
      const state = ledger.load();
      const row = state.entries.find(e => e.id === id);
      if (row) this.setData({ sheet: 'detail', detail: entryView(row, state) });
    },
    editEntry() {
      const id = this.data.detail.id;
      getApp().globalData.editId = id;
      this.closeSheet();
      navigate('entry');
    },
    deleteEntry() {
      const id = this.data.detail.id;
      wx.showModal({ title: '删除这笔账目？', content: '对应账户余额和预算会同步恢复。', confirmText: '删除', confirmColor: '#a04d44',
        success: ({ confirm }) => { if (!confirm) return; try { ledger.removeEntry(id); this.closeSheet(); this.refresh(); toast('账目已删除'); } catch (e) { toast(e.message); } } });
    },
    showRefund() { this.setData({ sheet: 'refund', refundAmount: '', refundDate: ledger.today(), formError: '' }); },
    refundInput(e) { this.setData({ refundAmount: e.detail.value }); },
    refundDateChange(e) { this.setData({ refundDate: e.detail.value }); },
    saveRefund() {
      try { ledger.refund(this.data.detail.id, this.data.refundAmount, this.data.refundDate, '退款 / AA 回款'); this.closeSheet(); this.refresh(); toast('回款已抵减原支出'); }
      catch (e) { this.setData({ formError: e.message }); }
    }
  };
}
module.exports = { base, toast, navigate, entryView };
