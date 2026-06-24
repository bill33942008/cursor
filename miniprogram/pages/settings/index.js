Page({
  goTimelineManage() {
    wx.navigateTo({ url: "/pages/timeline/manage" });
  },

  goPrivacy() {
    wx.navigateTo({ url: "/pages/settings/privacy" });
  },

  goSecurity() {
    wx.navigateTo({ url: "/pages/settings/security" });
  },
});
