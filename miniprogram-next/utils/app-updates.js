const ledger = require('./ledger');
const release = require('./release');
const KEY = 'pearl_app_release_v1';
function checkpointVersion(storage = { get: () => wx.getStorageSync(KEY), set: value => wx.setStorageSync(KEY, value) }) {
  if (storage.get() === release.version) return;
  ledger.createRecovery('upgrade');
  storage.set(release.version);
  if (storage.get() !== release.version) throw new Error('版本备份记录未能核验，原账本仍保留');
}
function watch() {
  if (!wx.getUpdateManager) return;
  const manager = wx.getUpdateManager();
  function checkpointUpdate() {
    try { ledger.createRecovery('upgrade'); return true; }
    catch (_) {
      wx.showModal({ title: '更新前备份未完成', content: '请先导出账本并检查手机空间，再重新进入小程序更新。', showCancel: false });
      return false;
    }
  }
  manager.onUpdateReady(() => {
    if (!checkpointUpdate()) return;
    wx.showModal({ title: '新版本已准备好', content: '已保存的账目会继续保留，未同步的记录仍在本机。重启会关闭当前页面；有未保存的编辑时，请先点“稍后”并保存。', confirmText: '重启更新', cancelText: '稍后',
      success: ({ confirm }) => {
        // Recheck at confirmation: cloud synchronization may have changed the book while the prompt was open.
        if (confirm && checkpointUpdate()) manager.applyUpdate();
      } });
  });
  manager.onUpdateFailed(() => wx.showToast({ title: '更新未完成，下次打开会重试', icon: 'none', duration: 2600 }));
}
module.exports = { checkpointVersion, watch, KEY };
