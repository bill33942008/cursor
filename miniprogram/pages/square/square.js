const { request } = require("../../utils/request");
const app = getApp();

Page({
  data: {
    loading: false,
    posts: [],
    error: "",
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    this.setData({ loading: true, error: "" });
    try {
      if (!app.globalData.token) {
        await this.wxLogin();
      }
      await this.loadSquare();
    } catch (err) {
      this.setData({ error: err.message || "加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: async (wxRes) => {
          try {
            const loginRes = await request({
              url: "/api/auth/wx-login",
              method: "POST",
              data: {
                code: wxRes.code || `dev-${Date.now()}`,
                nickname: `旅友${Math.floor(Math.random() * 1000)}`,
              },
            });
            app.globalData.token = loginRes.accessToken;
            app.globalData.user = loginRes.user;
            wx.setStorageSync("accessToken", loginRes.accessToken);
            wx.setStorageSync("currentUser", loginRes.user);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        fail: reject,
      });
    });
  },

  async loadSquare() {
    const res = await request({
      url: "/api/posts/square?limit=20&offset=0",
      method: "GET",
    });
    this.setData({ posts: res.items || [] });
  },

  async likePost(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) return;
    try {
      await request({
        url: `/api/posts/${postId}/like`,
        method: "POST",
      });
      wx.showToast({ title: "已点赞", icon: "success" });
      this.loadSquare();
    } catch (err) {
      wx.showToast({ title: err.message || "点赞失败", icon: "none" });
    }
  },
});
