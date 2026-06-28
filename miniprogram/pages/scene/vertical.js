const { request } = require("../../utils/request");
const app = getApp();

const SCENE_COVER_MAP = {
  scenic: "/assets/scene/scenic-q.svg",
  transport: {
    high_speed_rail: "/assets/scene/train-q.svg",
    train: "/assets/scene/train-q.svg",
    flight: "/assets/scene/plane-q.svg",
    bus: "/assets/scene/bus-q.svg",
    road_trip: "/assets/scene/car-q.svg",
    other: "/assets/scene/train-q.svg",
  },
};

const LOCAL_AVATAR_POOL = [
  "/assets/scene/avatar-a.svg",
  "/assets/scene/avatar-b.svg",
  "/assets/scene/avatar-c.svg",
  "/assets/scene/avatar-d.svg",
];

const BASE_WINDOW_OPTIONS = [
  { label: "近2小时", value: 120 },
  { label: "近6小时", value: 360 },
  { label: "近24小时", value: 1440 },
  { label: "近3天", value: 4320 },
  { label: "近7天", value: 10080 },
];

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function getSeedHash(seed) {
  const text = String(seed || "scene-user");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 1000000;
  }
  return hash;
}

function pickLocalAvatar(seed) {
  const index = getSeedHash(seed) % LOCAL_AVATAR_POOL.length;
  return LOCAL_AVATAR_POOL[index];
}

function resolveAvatarUrl(url, seed) {
  const value = String(url || "").trim();
  const baseUrl = String(app.globalData.baseUrl || "");
  if (!value) return pickLocalAvatar(seed);
  if (value.startsWith("/assets/")) return value;
  if (baseUrl && value.startsWith(baseUrl)) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return pickLocalAvatar(seed);
  }
  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }
  return `${baseUrl}/${value}`.replace(/([^:]\/)\/+/g, "$1");
}

function isVideoUrl(url) {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(String(url || ""));
}

function getSceneCoverImage(sceneType, transportType) {
  if (sceneType === "scenic") {
    return SCENE_COVER_MAP.scenic;
  }
  return SCENE_COVER_MAP.transport[transportType] || SCENE_COVER_MAP.transport.other;
}

function normalizeTrack(track) {
  const posts = (track.posts || []).map((item, idx) => {
    const seed = `${item.userId || "u"}-${item.nickname || "n"}-${idx}`;
    return {
      ...item,
      avatarUrl: resolveAvatarUrl(item.avatarUrl, seed),
      media: (item.media || []).map((url) => resolveMediaUrl(url)).filter((url) => !isVideoUrl(url)),
    };
  });
  const firstPost = posts[0] || null;
  return {
    ...track,
    postCount: Number(track.postCount || posts.length),
    posts,
    currentPostIndex: 0,
    currentPost: firstPost,
    avatarWindows: posts.slice(0, 8).map((item) => ({
      avatarUrl: item.avatarUrl,
      nickname: item.nickname,
    })),
    postAnimateToken: Date.now(),
    stagePhase: "avatars",
    coverImage: getSceneCoverImage(track.sceneType, track.transportType),
  };
}

function buildWindowOptions(maxWindowMinutes) {
  const maxWindow = Math.max(30, Number(maxWindowMinutes || 1440));
  return BASE_WINDOW_OPTIONS.filter((item) => item.value <= maxWindow);
}

function getMemberTierLabel(tier) {
  const value = String(tier || "normal");
  if (value === "svip") return "SVIP";
  if (value === "vip") return "VIP";
  return "普通";
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
    windowMinutes: 120,
    windowOptions: buildWindowOptions(1440),
    maxWindowMinutes: 1440,
    tracks: [],
    activeSceneIndex: 0,
    mockDataEnabled: false,
    membershipTier: "normal",
    memberTierLabel: "普通",
    featurePolicy: null,
  },

  onLoad() {
    this.sceneTimers = {};
    this.loadSceneTracks();
  },

  onUnload() {
    this.clearSceneTimers();
  },

  clearSceneTimers() {
    Object.keys(this.sceneTimers || {}).forEach((key) => {
      clearTimeout(this.sceneTimers[key]);
    });
    this.sceneTimers = {};
  },

  clearSceneTimer(sceneId) {
    if (!sceneId || !this.sceneTimers || !this.sceneTimers[sceneId]) return;
    clearTimeout(this.sceneTimers[sceneId]);
    delete this.sceneTimers[sceneId];
  },

  startSceneAnimation(sceneId) {
    if (!sceneId) return;
    this.clearSceneTimer(sceneId);
    this.updateScene(sceneId, (scene) => ({
      ...scene,
      stagePhase: "avatars",
    }));
    this.sceneTimers[sceneId] = setTimeout(() => {
      this.updateScene(sceneId, (scene) => ({
        ...scene,
        stagePhase: "post",
        postAnimateToken: Date.now(),
      }));
      this.clearSceneTimer(sceneId);
    }, 900);
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

  async onWindowChange(e) {
    const windowMinutes = Number(e.currentTarget.dataset.value || 120);
    if (Number.isNaN(windowMinutes)) return;
    if (windowMinutes > Number(this.data.maxWindowMinutes || 1440)) {
      wx.showToast({ title: "该时间窗需VIP权限", icon: "none" });
      return;
    }
    this.setData({ windowMinutes, activeSceneIndex: 0 });
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
        url: `/api/scenes/vertical-feed?sceneType=${encodeURIComponent(this.data.sceneType)}&windowMinutes=${
          this.data.windowMinutes
        }${query ? `&keyword=${query}` : ""}`,
        method: "GET",
      });
      this.clearSceneTimers();
      const tracks = (res.items || []).map(normalizeTrack);
      const maxWindowMinutes = Number(res.maxWindowMinutes || 1440);
      const windowOptions = buildWindowOptions(maxWindowMinutes);
      const currentWindowMinutes = Number(res.windowMinutes || this.data.windowMinutes || 120);
      const hasCurrentWindow = windowOptions.some((item) => item.value === currentWindowMinutes);
      const windowMinutes = hasCurrentWindow
        ? currentWindowMinutes
        : windowOptions.length
        ? windowOptions[0].value
        : 120;
      const featurePolicy = res.featurePolicy || null;
      this.setData(
        {
          tracks,
          activeSceneIndex: tracks.length ? Math.min(this.data.activeSceneIndex, tracks.length - 1) : 0,
          mockDataEnabled: Boolean(res.mockDataEnabled),
          maxWindowMinutes,
          windowOptions,
          windowMinutes,
          membershipTier: featurePolicy && featurePolicy.membershipTier ? featurePolicy.membershipTier : "normal",
          memberTierLabel: getMemberTierLabel(
            featurePolicy && featurePolicy.membershipTier ? featurePolicy.membershipTier : "normal"
          ),
          featurePolicy,
        },
        () => {
          const active = this.getActiveScene();
          if (active) {
            this.startSceneAnimation(active.sceneId);
          }
        }
      );
    } catch (err) {
      this.setData({ error: err.message || "加载聚合剧场失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSelectScene(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    this.setData({ activeSceneIndex: index }, () => {
      const active = this.getActiveScene();
      if (active) {
        this.startSceneAnimation(active.sceneId);
      }
    });
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
        stagePhase: "avatars",
      }));
      this.startSceneAnimation(scene.sceneId);
      return;
    }

    const nextSceneIndex = this.data.activeSceneIndex + 1;
    if (nextSceneIndex < this.data.tracks.length) {
      this.setData({ activeSceneIndex: nextSceneIndex }, () => {
        const active = this.getActiveScene();
        if (active) {
          this.startSceneAnimation(active.sceneId);
        }
      });
      return;
    }
    wx.showToast({ title: "已到达终点站", icon: "none" });
  },

  previewCurrentMedia(e) {
    const sceneId = e.currentTarget.dataset.sceneid;
    const scene = (this.data.tracks || []).find((item) => item.sceneId === sceneId);
    const post = scene && scene.currentPost ? scene.currentPost : null;
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
