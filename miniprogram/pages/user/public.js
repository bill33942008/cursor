const { request } = require("../../utils/request");
const app = getApp();

function resolveAvatar(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

Page({
  data: {
    userId: "",
    loading: true,
    profile: null,
    relation: null,
    timeline: [],
    timelineAllowed: false,
    timelineLoading: false,
  },

  onLoad(options) {
    this.setData({ userId: options.userId || "" });
    this.loadPageData();
  },

  async loadPageData() {
    if (!this.data.userId) {
      wx.showToast({ title: "用户信息缺失", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      const profileRes = await request({
        url: `/api/users/${this.data.userId}/public-profile`,
        method: "GET",
      });
      const profile = {
        ...profileRes.profile,
        avatarUrl: resolveAvatar(profileRes.profile.avatarUrl || ""),
      };
      this.setData({
        profile,
        relation: profileRes.relation,
      });

      if (profile.canViewTimeline) {
        await this.loadTimeline();
      } else {
        this.setData({ timelineAllowed: false, timeline: [] });
      }
    } catch (err) {
      wx.showToast({ title: err.message || "加载用户资料失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadTimeline() {
    this.setData({ timelineLoading: true });
    try {
      const res = await request({
        url: `/api/users/${this.data.userId}/timeline?limit=50&offset=0`,
        method: "GET",
      });
      this.setData({
        timelineAllowed: Boolean(res.allowed),
        timeline: res.items || [],
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载时间线失败", icon: "none" });
    } finally {
      this.setData({ timelineLoading: false });
    }
  },

  async sendFriendRequest() {
    if (!this.data.profile || !this.data.profile.id) return;
    try {
      await request({
        url: "/api/friends/request",
        method: "POST",
        data: {
          toUserId: this.data.profile.id,
          message: "你好，很高兴在路上遇见你",
        },
      });
      wx.showToast({ title: "好友申请已发送", icon: "success" });
      this.setData({
        relation: {
          ...this.data.relation,
          hasOutgoingPendingRequest: true,
        },
      });
    } catch (err) {
      wx.showToast({ title: err.message || "发送申请失败", icon: "none" });
    }
  },

  goTimelineManage() {
    wx.navigateTo({ url: "/pages/timeline/manage" });
  },
});
