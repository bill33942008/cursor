const { request } = require("../../utils/request");
const app = getApp();

function canUseStorage() {
  try {
    if (typeof wx.getAccountInfoSync !== "function") {
      return false;
    }
    const appId = wx.getAccountInfoSync()?.miniProgram?.appId || "";
    return Boolean(appId && appId !== "touristappid");
  } catch (_err) {
    return false;
  }
}

Page({
  data: {
    loading: true,
    user: null,
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
  },

  onShow() {
    this.syncTabBar();
    this.loadProfileData();
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 3;
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 3 });
    }
  },

  async loadProfileData() {
    this.setData({ loading: true });
    try {
      const [meRes, friendRes] = await Promise.all([
        request({ url: "/api/auth/me", method: "GET" }),
        request({ url: "/api/friends", method: "GET" }),
      ]);
      app.globalData.user = meRes.user;
      if (canUseStorage()) {
        wx.setStorageSync("currentUser", meRes.user);
      }
      this.setData({
        user: meRes.user,
        friends: friendRes.friends || [],
        incomingRequests: friendRes.incomingRequests || [],
        outgoingRequests: friendRes.outgoingRequests || [],
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async handleRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    try {
      await request({
        url: `/api/friends/request/${requestId}/respond`,
        method: "POST",
        data: { action },
      });
      wx.showToast({ title: "已处理", icon: "success" });
      this.loadProfileData();
    } catch (err) {
      wx.showToast({ title: err.message || "处理失败", icon: "none" });
    }
  },

  async revokeRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    if (!requestId) return;
    try {
      await request({
        url: `/api/friends/request/${requestId}`,
        method: "DELETE",
      });
      wx.showToast({ title: "已撤回", icon: "success" });
      this.loadProfileData();
    } catch (err) {
      wx.showToast({ title: err.message || "撤回失败", icon: "none" });
    }
  },

  openUserProfile(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    wx.navigateTo({ url: `/pages/user/public?userId=${userId}` });
  },

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

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
