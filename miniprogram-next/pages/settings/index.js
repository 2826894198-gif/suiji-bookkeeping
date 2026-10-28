const ledger = require('../../utils/ledger');
const backupFiles = require('../../utils/backup-files');
const periodView = require('../../utils/period-view');
const cloudSync = require('../../utils/cloud-sync');
const release = require('../../utils/release');
const { base, toast, navigate } = require('../../utils/page');
const common = base();
function localStamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : `${ledger.dateKey(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
Page({
  ...common,
  data: { ...common.data, backupTime: '', backupPath: '', restoreSummary: '', recoveryRows: [],
    appName: release.name, releaseVersion: release.version, releaseEnvironment: '',
    recoveryCount: 0, backupError: '', entryCount: 0, accountTotal: 0, storageMode: '个人账本', updatedText: '尚未修改',
    cloudPhase: 'unconfigured', cloudTitle: '云服务准备中', cloudMessage: '当前账目保存在本机', cloudConfigured: false,
    cloudEnabled: false, cloudActionBusy: false, cloudHistory: [], cloudHistoryLoading: false, cloudError: '', cloudLastSync: '', storageNotice: '' },
  onShow() {
    common.onShow.call(this); this.refreshRecoveryList(); this.renderCloud(cloudSync.status());
    if (!this._cloudListener) this._cloudListener = cloudSync.subscribe(state => this.renderCloud(state));
  },
  onHide() { common.onHide.call(this); if (this._cloudListener) this._cloudListener(); this._cloudListener = null; },
  onUnload() { common.onUnload.call(this); if (this._cloudListener) this._cloudListener(); this._cloudListener = null; },
  loadPage(state) {
    let releaseEnvironment = '';
    try {
      const version = wx.getAccountInfoSync().miniProgram.envVersion;
      releaseEnvironment = { develop: '开发版', trial: '体验版', release: '正式版' }[version] || '';
    } catch (_) {}
    this.setData({ entryCount: state.entries.length, updatedText: state.updatedAt ? localStamp(state.updatedAt) : '尚未修改',
      accountTotal: state.accounts.length, storageMode: state.demo ? '演示账本' : '个人账本', storageNotice: getApp().globalData.storageError || '', releaseEnvironment });
  },
  privacy() {
    if (!wx.openPrivacyContract) { toast('请更新微信后查看隐私保护指引'); return; }
    wx.openPrivacyContract({ fail: error => {
      if (!/cancel/i.test(error.errMsg || '')) toast('暂时无法打开隐私保护指引，请稍后重试');
    } });
  },
  renderCloud(state) {
    const labels = { unconfigured: '云服务准备中', disabled: '自动同步已暂停', pending: '已存本机 · 等待同步', offline: '离线 · 已存本机',
      syncing: '正在核对云端', synced: '本机与云端一致', conflict: '两份账本需要核对', demo: '演示账本不上传', error: '云同步未完成' };
    this.setData({ cloudPhase: state.phase, cloudTitle: labels[state.phase] || '云同步',
      cloudMessage: state.message || '云服务尚未配置，当前账目保存在本机；可先导出独立备份。',
      cloudConfigured: state.configured, cloudEnabled: state.enabled,
      cloudLastSync: state.lastSyncedAt ? localStamp(state.lastSyncedAt) : '', cloudReview: state.review || null,
      cloudRemote: state.remote ? { ...state.remote.stats, amount: ledger.money(state.remote.stats.assets), revision: state.remote.revision } : null,
      cloudLocal: state.local ? { ...state.local, amount: ledger.money(state.local.assets) } : null });
  },
  async syncCloud() {
    if (this.data.cloudActionBusy) return;
    this.setData({ cloudActionBusy: true, cloudError: '' });
    try { this.renderCloud(await (this.data.cloudEnabled ? cloudSync.syncNow() : cloudSync.connect())); }
    catch (error) { this.setData({ cloudError: error.message }); }
    finally { this.setData({ cloudActionBusy: false }); }
  },
  pauseCloud() {
    try { cloudSync.disconnect(); } catch (error) { this.setData({ cloudError: error.message }); }
  },
  async openCloudHistory() {
    if (!this.data.cloudConfigured) { this.cloudInfo(); return; }
    this.setData({ sheet: 'cloud-history', cloudHistoryLoading: true, cloudError: '' });
    try {
      const versions = await cloudSync.history();
      this.setData({ cloudHistory: versions.map(item => ({ ...item, timeText: localStamp(item.updatedAt), amount: ledger.money(item.stats.assets) })) });
    } catch (error) { this.setData({ cloudError: error.message }); }
    finally { this.setData({ cloudHistoryLoading: false }); }
  },
  async chooseCloudVersion(event) {
    if (this.data.cloudActionBusy) return;
    this.setData({ cloudActionBusy: true, cloudError: '' });
    try {
      this._cloudRestore = await cloudSync.prepareRestore(event.currentTarget.dataset.id);
      const item = this._cloudRestore.snapshot;
      this.setData({ sheet: 'cloud-restore', cloudRestore: { ...item, timeText: localStamp(item.updatedAt), amount: ledger.money(item.stats.assets) } });
    } catch (error) { this.setData({ cloudError: error.message }); }
    finally { this.setData({ cloudActionBusy: false }); }
  },
  async confirmCloudRestore() {
    if (this.data.cloudActionBusy || !this._cloudRestore) return;
    this.setData({ cloudActionBusy: true, cloudError: '' });
    try {
      const status = await cloudSync.restoreVersion(this._cloudRestore);
      this._cloudRestore = null; periodView.reset(); this.refresh(); this.refreshRecoveryList(); this.renderCloud(status);
      this.setData({ sheet: 'cloud' });
      toast(status.phase === 'synced' ? '已恢复并核对云端版本' : '已恢复至本机，请查看云同步状态');
    } catch (error) { this.setData({ cloudError: error.message }); }
    finally { this.setData({ cloudActionBusy: false }); }
  },
  resolveCloud(event) {
    if (this.data.cloudActionBusy) return;
    const local = event.currentTarget.dataset.source === 'local', review = this.data.cloudReview;
    wx.showModal({ title: local ? '使用本机账本？' : '使用云端账本？',
      content: local ? '将本机账本保存为新的云端版本，原云端版本保留在最近的历史中。两份账本不会自动合并。' : '先备份当前本机账本，再读取云端版本。未同步的本机更改可从恢复点找回。',
      confirmText: '确认使用', success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ cloudActionBusy: true, cloudError: '' });
        try { this.renderCloud(await (local ? cloudSync.keepLocal(review) : cloudSync.useCloud(review))); this.refresh(); this.refreshRecoveryList(); }
        catch (error) { this.setData({ cloudError: error.message }); }
        finally { this.setData({ cloudActionBusy: false }); }
      } });
  },
  refreshRecoveryList() {
    try {
      const files = backupFiles.list();
      this.setData({ recoveryRows: files.slice(0, 20).map(file => ({ ...file, timeText: localStamp(file.savedAt) })),
        recoveryCount: files.length, backupError: '' });
    } catch (_) { this.setData({ backupError: '暂时无法读取本机备份，请检查可用空间后重试。' }); }
  },
  exportBackup() {
    if (this.data.busy) return;
    this.setData({ busy: true, backupError: '' });
    try {
      const text = ledger.backup();
      ledger.parseBackup(text);
      const file = backupFiles.save(text);
      this.setData({ backupPath: file.path, backupTime: localStamp(file.savedAt), sheet: 'backup' });
      this.refreshRecoveryList();
    } catch (e) { this.setData({ backupError: `备份未完成：${e.message}` }); }
    finally { this.setData({ busy: false }); }
  },
  shareBackup() {
    if (!this.data.backupPath) return;
    if (wx.shareFileMessage) wx.shareFileMessage({ filePath: this.data.backupPath, fileName: '个人账本备份.json',
      fail: error => { if (!/cancel/i.test(error.errMsg || '')) toast('文件已保留，可从本机恢复点找回'); } });
    else toast('请在支持文件分享的手机微信中导出');
  },
  prepareRestore(text, label) {
    const data = ledger.parseBackup(text);
    const accounts = ledger.allAccounts(data);
    this._restoreText = text;
    this.setData({ sheet: 'restore', restoreSummary: `${data.entries.length} 笔账目 · ${data.accounts.length} 个账户 · ${data.categories.length} 个分类`,
      restoreBalance: ledger.money(accounts.reduce((sum, account) => sum + account.balance, 0)),
      restoreSource: label, restoreKind: data.demo ? '演示账本' : '个人账本', formError: '' });
  },
  importBackup() {
    if (this.data.busy) return;
    this.setData({ busy: true, backupError: '' });
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'],
      success: result => {
        try {
          const file = result.tempFiles[0];
          if (!file || file.size > 8 * 1024 * 1024) throw new Error('请选择不超过 8 MB 的 JSON 账本备份');
          const text = wx.getFileSystemManager().readFileSync(file.path, 'utf8');
          this.prepareRestore(text, file.name || '导入的备份文件');
        } catch (e) { this.setData({ backupError: `无法读取此备份：${e.message}。当前账本未替换。` }); }
      },
      fail: error => { if (!/cancel/i.test(error.errMsg || '')) this.setData({ backupError: '未能打开文件选择，请重试。' }); },
      complete: () => this.setData({ busy: false })
    });
  },
  openRecoveries() { this.refreshRecoveryList(); this.setData({ sheet: 'recoveries', formError: this.data.backupError }); },
  chooseRecovery(event) {
    const file = this.data.recoveryRows.find(item => item.name === event.currentTarget.dataset.name);
    if (!file) return;
    try { this.prepareRestore(backupFiles.read(file.name), `${file.label} · ${file.timeText}`); }
    catch (e) { this.setData({ formError: `此恢复点无法读取：${e.message}。请选择其他备份。` }); }
  },
  confirmRestore() {
    if (this.data.busy || !this._restoreText) return;
    this.setData({ busy: true, formError: '' });
    try {
      ledger.restore(this._restoreText);
      periodView.reset(); this._restoreText = null; this.closeSheet(); this.refresh(); this.refreshRecoveryList();
      toast('恢复完成，恢复前账本已保留在本机恢复点');
    } catch (e) { this.setData({ formError: `恢复未完成：${e.message}` }); }
    finally { this.setData({ busy: false }); }
  },
  closeSheet() { this._restoreText = null; this._cloudRestore = null; common.closeSheet.call(this); },
  cloudInfo() { this.renderCloud(cloudSync.status()); this.setData({ sheet: 'cloud', cloudError: '' }); },
  appearance() { this.setData({ sheet: 'appearance' }); },
  startPersonal() {
    wx.showModal({ title: '建立空白个人账本？', content: '先保存当前账本的本机恢复点，再建立空白账本，保留默认分类。以后可从恢复点找回。', confirmText: '建立账本',
      success: ({ confirm }) => { if (!confirm) return;
        try {
          ledger.reset(false); periodView.reset(); this.refresh(); this.refreshRecoveryList();
          toast('个人账本已准备好，请先添加账户'); navigate('accounts');
        } catch (e) { this.setData({ backupError: `操作未完成：${e.message}` }); }
      } });
  }
});
