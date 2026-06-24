const { request } = require("../../utils/request");
const app = getApp();

function toSafeError(input, fallbackMessage) {
  if (!input) {
    return { message: fallbackMessage };
  }
  if (typeof input === "string") {
    return { message: input };
  }
  if (typeof input.message === "string" && input.message) {
    return { message: input.message };
  }
  if (typeof input.errMsg === "string" && input.errMsg) {
    return { message: input.errMsg };
  }
  return { message: fallbackMessage };
}

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function resolveMediaItems(mediaList) {
  let previewIndex = 0;
  return (mediaList || []).map((mediaUrl) => {
    const url = resolveMediaUrl(mediaUrl);
    const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
    const item = {
      url,
      type: isVideo ? "video" : "image",
      previewIndex: -1,
    };
    if (!isVideo) {
      item.previewIndex = previewIndex;
      previewIndex += 1;
    }
    return item;
  });
}

function estimatePostWeight(post) {
  const textWeight = Math.min((post.content || "").length, 180) * 0.65;
  const mediaWeight = (post.mediaItems || []).reduce((acc, media) => {
    if (media.type === "video") return acc + 180;
    return acc + 95;
  }, 0);
  const tagWeight = post.transportType ? 30 : 0;
  return 220 + textWeight + mediaWeight + tagWeight;
}

function splitWaterfall(posts) {
  const left = [];
  const right = [];
  let leftWeight = 0;
  let rightWeight = 0;

  posts.forEach((post) => {
    const weight = estimatePostWeight(post);
    if (leftWeight <= rightWeight) {
      left.push(post);
      leftWeight += weight;
    } else {
      right.push(post);
      rightWeight += weight;
    }
  });
  return { left, right };
}

function getMiniProgramAppId() {
  try {
    if (typeof wx.getAccountInfoSync !== "function") {
      return "";
    }
    const info = wx.getAccountInfoSync();
    return info?.miniProgram?.appId || "";
  } catch (_err) {
    return "";
  }
}

function isTouristMode() {
  const appId = getMiniProgramAppId();
  return !appId || appId === "touristappid";
}

Page({
  data: {
    loading: false,
    posts: [],
    leftPosts: [],
    rightPosts: [],
    skeletonRows: [1, 2, 3, 4],
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
      const finishLogin = async (code) => {
        try {
          const loginRes = await request({
            url: "/api/auth/wx-login",
            method: "POST",
            data: {
              code: code || `dev-${Date.now()}`,
              nickname: `旅友${Math.floor(Math.random() * 1000)}`,
            },
          });
          app.globalData.token = loginRes.accessToken;
          app.globalData.user = loginRes.user;
          if (!isTouristMode()) {
            wx.setStorageSync("accessToken", loginRes.accessToken);
            wx.setStorageSync("currentUser", loginRes.user);
          }
          resolve();
        } catch (err) {
          reject(toSafeError(err, "wx login failed"));
        }
      };

      if (isTouristMode()) {
        finishLogin(`tourist-${Date.now()}`);
        return;
      }

      try {
        wx.login({
          success: async (wxRes) => {
            await finishLogin(wxRes.code || `dev-${Date.now()}`);
          },
          fail: (err) => reject(toSafeError(err, "wx.login failed")),
        });
      } catch (err) {
        reject(toSafeError(err, "wx.login invocation failed"));
      }
    });
  },

  async loadSquare() {
    const res = await request({
      url: "/api/posts/square?limit=20&offset=0",
      method: "GET",
    });
    const posts = (res.items || []).map((item) => {
      const mediaItems = resolveMediaItems(item.media || []);
      return {
        ...item,
        likeCount: Number(item.likeCount || 0),
        commentCount: Number(item.commentCount || 0),
        mediaItems,
        imageUrls: mediaItems.filter((media) => media.type === "image").map((media) => media.url),
      };
    });
    const { left, right } = splitWaterfall(posts);
    this.setData({ posts, leftPosts: left, rightPosts: right });
  },

  previewMedia(e) {
    const postId = e.currentTarget.dataset.postid;
    const current = Number(e.currentTarget.dataset.previewIndex);
    const post = this.data.posts.find((item) => item.id === postId);
    if (!post || !post.imageUrls || post.imageUrls.length === 0 || current < 0) {
      return;
    }
    wx.previewImage({
      current: post.imageUrls[current],
      urls: post.imageUrls,
    });
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
      await this.loadSquare();
    } catch (err) {
      wx.showToast({ title: err.message || "点赞失败", icon: "none" });
    }
  },

  onCommentTap() {
    wx.showToast({ title: "评论功能即将上线", icon: "none" });
  },

  onShareTap(e) {
    const postId = e.currentTarget.dataset.id;
    const post = this.data.posts.find((item) => item.id === postId);
    if (!post) return;
    wx.setClipboardData({
      data: `${post.displayName}: ${post.content}`,
      success: () => wx.showToast({ title: "内容已复制", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
});
