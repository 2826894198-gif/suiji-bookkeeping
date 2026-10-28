const ledger = require('./utils/ledger');
const sync = require('./utils/cloud-sync');
const updates = require('./utils/app-updates');
App({
  globalData: { statusHeight: 44, bottomInset: 24, storageError: '' },
  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.globalData.statusHeight = info.statusBarHeight || 24;
    this.globalData.bottomInset = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 16;
    try { ledger.load(); updates.checkpointVersion(); } catch (error) { this.globalData.storageError = error.message; }
    updates.watch();
  },
  onShow() { sync.start(); },
  onHide() { sync.stop(); }
});
