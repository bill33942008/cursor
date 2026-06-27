const { request } = require("../../utils/request");
const app = getApp();

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function normalizeTrack(track) {
  const posts = (track.posts || []).map((item) => ({
    ...item,
    media: (item.media || []).map((url) => resolveMediaUrl(url)),
  }));
  const firstPost = posts[0] || null;
  return {
    ...track,
    posts,
    currentPostIndex: 0,
    currentPost: firstPost,
    avatarWindows: posts.slice(0, 6).map((item) => ({
      avatarUrl: item.avatarUrl,
      nickname: item.nickname,
    })),
    postAnimateToken: Date.now(),
  };
}

Page({
  data: {
    loading: false,
    error: "",
    keyword: "",
    sceneType: "all",
    sceneTypeOptions: [
      { label: "全部场景", value: "all" },
      { label: "交通剧场", value: "transport" },
      { label: "景点剧场", value: "scenic" },
    ],
    tracks: [],
    activeSceneIndex: 0,
    mockDataEnabled: false,
  },

  onLoad() {
    this.loadSceneTracks();
  },

  async onPullDownRefresh() {
    try {
      await this.loadSceneTracks();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  async onSearchTap() {
    await this.loadSceneTracks();
  },

  async onSceneTypeChange(e) {
    const sceneType = e.currentTarget.dataset.value || "all";
    this.setData({ sceneType, activeSceneIndex: 0 });
    await this.loadSceneTracks();
  },

  getActiveScene() {
    const list = this.data.tracks || [];
    return list[this.data.activeSceneIndex] || null;
  },

  updateScene(sceneId, updater) {
    const nextTracks = (this.data.tracks || []).map((item) => {
      if (item.sceneId !== sceneId) return item;
      return updater(item);
    });
    this.setData({ tracks: nextTracks });
  },

  async loadSceneTracks() {
    this.setData({ loading: true, error: "" });
    try {
      const query = encodeURIComponent((this.data.keyword || "").trim());
      const res = await request({
        url: `/api/scenes/vertical-feed?sceneType=${encodeURIComponent(this.data.sceneType)}${
          query ? `&keyword=${query}` : ""
        }`,
        method: "GET",
      });
      const tracks = (res.items || []).map(normalizeTrack);
      this.setData({
        tracks,
        activeSceneIndex: tracks.length ? Math.min(this.data.activeSceneIndex, tracks.length - 1) : 0,
        mockDataEnabled: Boolean(res.mockDataEnabled),
      });
    } catch (err) {
      this.setData({ error: err.message || "加载聚合剧场失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSelectScene(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    this.setData({ activeSceneIndex: index });
  },

  onContinueJourney() {
    const scene = this.getActiveScene();
    if (!scene) return;
    if (!scene.posts || scene.posts.length === 0) return;

    const hasNextPost = scene.currentPostIndex < scene.posts.length - 1;
    if (hasNextPost) {
      const nextIndex = scene.currentPostIndex + 1;
      this.updateScene(scene.sceneId, (current) => ({
        ...current,
        currentPostIndex: nextIndex,
        currentPost: current.posts[nextIndex] || null,
        postAnimateToken: Date.now(),
      }));
      return;
    }

    const nextSceneIndex = this.data.activeSceneIndex + 1;
    if (nextSceneIndex < this.data.tracks.length) {
      this.setData({ activeSceneIndex: nextSceneIndex });
      return;
    }
    wx.showToast({ title: "已到达终点站", icon: "none" });
  },

  previewCurrentMedia(e) {
    const sceneId = e.currentTarget.dataset.sceneid;
    const scene = (this.data.tracks || []).find((item) => item.sceneId === sceneId);
    const post = scene?.currentPost;
    if (!post || !post.media || post.media.length === 0) {
      return;
    }
    const currentIndex = Number(e.currentTarget.dataset.index || 0);
    const current = post.media[currentIndex] || post.media[0];
    wx.previewImage({
      current,
      urls: post.media,
    });
  },
});
