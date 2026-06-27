const { request } = require("../../utils/request");
const app = getApp();

function canUseStorage() {
  try {
    return typeof wx.getStorageSync === "function" && typeof wx.setStorageSync === "function";
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
      const wxProfile = app.globalData.wxUserProfile || (canUseStorage() ? wx.getStorageSync("wxUserProfile") : null);
      const mergedUser = {
        ...meRes.user,
        nickname: meRes.user?.nickname || wxProfile?.nickname || "旅友",
        avatarUrl: meRes.user?.avatarUrl || wxProfile?.avatarUrl || "",
      };
      app.globalData.user = mergedUser;
      if (canUseStorage()) {
        wx.setStorageSync("currentUser", mergedUser);
      }
      this.setData({
        user: mergedUser,
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
