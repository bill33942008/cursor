const { request } = require("../../utils/request");
const app = getApp();

Page({
  data: {
    user: null,
    friends: [],
    incomingRequests: [],
    targetUserId: "",
  },

  onShow() {
    this.loadProfileData();
  },

  async loadProfileData() {
    try {
      const [meRes, friendRes] = await Promise.all([
        request({ url: "/api/auth/me", method: "GET" }),
        request({ url: "/api/friends", method: "GET" }),
      ]);
      app.globalData.user = meRes.user;
      wx.setStorageSync("currentUser", meRes.user);
      this.setData({
        user: meRes.user,
        friends: friendRes.friends || [],
        incomingRequests: friendRes.incomingRequests || [],
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
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
});
