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
    targetUserId: "",
  },

  onShow() {
    this.loadProfileData();
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
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTargetUserInput(e) {
    this.setData({ targetUserId: e.detail.value });
  },

  async sendFriendRequest() {
    if (!this.data.targetUserId.trim()) {
      wx.showToast({ title: "请输入用户ID", icon: "none" });
      return;
    }
    try {
      await request({
        url: "/api/friends/request",
        method: "POST",
        data: {
          toUserId: this.data.targetUserId.trim(),
          message: "你好，我也在路上",
        },
      });
      wx.showToast({ title: "申请已发送", icon: "success" });
      this.setData({ targetUserId: "" });
    } catch (err) {
      wx.showToast({ title: err.message || "发送失败", icon: "none" });
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

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  goPrivacy() {
    wx.navigateTo({ url: "/pages/settings/privacy" });
  },

  goSecurity() {
    wx.navigateTo({ url: "/pages/settings/security" });
  },
});
