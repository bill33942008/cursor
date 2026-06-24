const { request } = require("../../utils/request");
const app = getApp();
const POST_PREVIEW_LIMIT = 88;

function resolveAvatar(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function buildFoldableContent(content) {
  const normalized = String(content || "");
  const needFold = normalized.length > POST_PREVIEW_LIMIT;
  return {
    needFold,
    expanded: false,
    previewContent: needFold ? `${normalized.slice(0, POST_PREVIEW_LIMIT)}...` : normalized,
  };
}

Page({
  data: {
    userId: "",
    loading: true,
    profile: null,
    relation: null,
    friendNote: "",
    timeline: [],
    timelineAllowed: false,
    timelineLoading: false,
    posts: [],
    postsLoading: false,
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
      await this.loadPublicPosts();
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
        timeline: (res.items || []).map((item) => ({
          ...item,
          media: (item.media || []).map((rawUrl) => ({
            rawUrl,
            url: resolveAvatar(rawUrl),
          })),
          mediaUrls: (item.media || []).map(resolveAvatar),
          coverMedia: (item.media || []).length ? resolveAvatar(item.media[0]) : "",
          thumbMedia: (item.media || []).slice(1, 4).map(resolveAvatar),
          moreMediaCount: Math.max(0, (item.media || []).length - 4),
        })),
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载时间线失败", icon: "none" });
    } finally {
      this.setData({ timelineLoading: false });
    }
  },

  async loadPublicPosts() {
    this.setData({ postsLoading: true });
    try {
      const res = await request({
        url: `/api/users/${this.data.userId}/public-posts?limit=20&offset=0`,
        method: "GET",
      });
      this.setData({
        posts: (res.items || []).map((item) => {
          const fold = buildFoldableContent(item.content);
          return {
            ...item,
            ...fold,
            mediaUrls: (item.media || []).map(resolveAvatar),
          };
        }),
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载公开动态失败", icon: "none" });
    } finally {
      this.setData({ postsLoading: false });
    }
  },

  onFriendNoteInput(e) {
    this.setData({ friendNote: e.detail.value || "" });
  },

  async sendFriendRequest() {
    if (!this.data.profile || !this.data.profile.id) return;
    try {
      await request({
        url: "/api/friends/request",
        method: "POST",
        data: {
          toUserId: this.data.profile.id,
          message: (this.data.friendNote || "").trim() || "你好，很高兴在路上遇见你",
        },
      });
      wx.showToast({ title: "好友申请已发送", icon: "success" });
      this.setData({
        friendNote: "",
        relation: {
          ...this.data.relation,
          hasOutgoingPendingRequest: true,
          outgoingPendingRequestId: "",
        },
      });
      this.loadPageData();
    } catch (err) {
      wx.showToast({ title: err.message || "发送申请失败", icon: "none" });
    }
  },

  async revokeRequest() {
    const requestId = this.data.relation?.outgoingPendingRequestId;
    if (!requestId) {
      wx.showToast({ title: "未找到可撤回申请", icon: "none" });
      return;
    }
    try {
      await request({
        url: `/api/friends/request/${requestId}`,
        method: "DELETE",
      });
      wx.showToast({ title: "已撤回申请", icon: "success" });
      this.loadPageData();
    } catch (err) {
      wx.showToast({ title: err.message || "撤回失败", icon: "none" });
    }
  },

  previewTimelineMedia(e) {
    const eventId = e.currentTarget.dataset.eventid;
    const index = Number(e.currentTarget.dataset.index);
    const target = this.data.timeline.find((item) => item.id === eventId);
    if (!target || Number.isNaN(index) || !target.mediaUrls[index]) return;
    wx.previewImage({
      current: target.mediaUrls[index],
      urls: target.mediaUrls,
    });
  },

  previewPostMedia(e) {
    const postId = e.currentTarget.dataset.postid;
    const index = Number(e.currentTarget.dataset.index);
    const target = this.data.posts.find((item) => item.id === postId);
    if (!target || Number.isNaN(index) || !target.mediaUrls[index]) return;
    wx.previewImage({
      current: target.mediaUrls[index],
      urls: target.mediaUrls,
    });
  },

  togglePostExpand(e) {
    const postId = e.currentTarget.dataset.postid;
    if (!postId) return;
    const nextPosts = this.data.posts.map((item) => {
      if (item.id !== postId) return item;
      return {
        ...item,
        expanded: !item.expanded,
      };
    });
    this.setData({ posts: nextPosts });
  },

  goTimelineManage() {
    wx.navigateTo({ url: "/pages/timeline/manage" });
  },
});
