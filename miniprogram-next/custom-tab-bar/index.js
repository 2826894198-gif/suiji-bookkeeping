Component({
  data: {
    selected: 0, bottomInset: 24, keyboardOpen: false, sheetOpen: false,
    tabs: [
      { path: 'dashboard', name: '总览', icon: 'house' },
      { path: 'ledger', name: '账目', icon: 'file-text' },
      { path: 'entry', name: '记一笔', icon: 'plus' },
      { path: 'budget', name: '预算', icon: 'chart-pie' },
      { path: 'accounts', name: '账户', icon: 'user-round' }
    ]
  },
  lifetimes: {
    attached() {
      this.setData({ bottomInset: getApp().globalData.bottomInset });
      this._keyboardListener = ({ height }) => this.setData({ keyboardOpen: height > 0 });
      if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(this._keyboardListener);
    },
    detached() {
      if (wx.offKeyboardHeightChange && this._keyboardListener) wx.offKeyboardHeightChange(this._keyboardListener);
    }
  },
  methods: {
    setSheetVisible(key, open) {
      if (!this._openSheets) this._openSheets = {};
      if (open) this._openSheets[key] = true;
      else delete this._openSheets[key];
      this.setData({ sheetOpen: Object.keys(this._openSheets).length > 0 });
    },
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) {
        if (index === 2) {
          const pages = getCurrentPages();
          const page = pages[pages.length - 1];
          if (page && page.scrollToTop) page.scrollToTop();
        }
        return;
      }
      wx.switchTab({ url: `/pages/${this.data.tabs[index].path}/index`,
        success: () => this.setData({ selected: index }) });
    }
  }
});
