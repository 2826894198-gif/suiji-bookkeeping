Component({
  properties: { title: { type: String, value: '我的账本' }, back: { type: Boolean, value: false } },
  data: { statusHeight: 44 },
  lifetimes: { attached() { this.setData({ statusHeight: getApp().globalData.statusHeight }); } },
  methods: {
    onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/dashboard/index' }) }); },
    openSettings() { if (!this.data.back) wx.navigateTo({ url: '/pages/settings/index' }); }
  }
});
