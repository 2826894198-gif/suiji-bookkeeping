let sheetSequence = 0;
Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: { open: { type: Boolean, value: false }, title: { type: String, value: '' }, contentKey: { type: String, value: '' }, fixedFooter: { type: Boolean, value: false } },
  data: { bottomInset: 24, scrollHeight: '70vh' },
  observers: {
    open(value) { this.syncDock(value); if (value) this.measureContent(); },
    contentKey() { if (this.data.open) this.measureContent(); }
  },
  lifetimes: {
    attached() {
      this.setData({ bottomInset: getApp().globalData.bottomInset });
      this.syncDock(this.data.open);
    },
    detached() { this.syncDock(false); }
  },
  pageLifetimes: {
    show() { this.syncDock(this.data.open); if (this.data.open) this.measureContent(); },
    hide() { this.syncDock(false); },
    resize() { if (this.data.open) this.measureContent(); }
  },
  methods: {
    measureContent() {
      // Native scroll-view needs an explicit viewport height. Measure the slot
      // so short sheets stay compact and long forms keep their save action reachable.
      this.setData({ scrollHeight: '70vh' });
      wx.nextTick(() => {
        if (!this.data.open) return;
        if (this.data.fixedFooter) {
          this.createSelectorQuery().select('.sheet-content').boundingClientRect()
            .select('.sheet-head').boundingClientRect().select('.sheet-footer').boundingClientRect().exec(rects => {
              if (!this.data.open || !rects[0] || !rects[1] || !rects[2]) return;
              const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
              const available = Math.floor(info.windowHeight * .88) - rects[1].height - rects[2].height - this.data.bottomInset - 38;
              this.setData({ scrollHeight: `${Math.max(32, Math.min(Math.ceil(rects[0].height), Math.floor(info.windowHeight * .7), available))}px` });
            });
          return;
        }
        this.createSelectorQuery().select('.sheet-content').boundingClientRect(rect => {
          if (!rect || !this.data.open) return;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const height = Math.min(Math.ceil(rect.height), Math.floor(info.windowHeight * .7));
          if (height > 0) this.setData({ scrollHeight: `${height}px` });
        }).exec();
      });
    },
    syncDock(open) {
      if (!this._sheetKey) this._sheetKey = `sheet-${++sheetSequence}`;
      if (open) {
        const pages = getCurrentPages();
        const page = pages[pages.length - 1];
        this._tabBar = page && page.getTabBar && page.getTabBar();
      }
      if (this._tabBar && this._tabBar.setSheetVisible) {
        this._tabBar.setSheetVisible(this._sheetKey, open);
      }
    },
    close() { this.triggerEvent('close'); },
    stop() {}
  }
});
