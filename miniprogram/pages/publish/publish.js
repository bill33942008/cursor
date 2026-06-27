const { request, uploadFile } = require("../../utils/request");
const app = getApp();

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function formatMediaAsset(asset) {
  const displayUrl = resolveMediaUrl(asset.url);
  const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(displayUrl);
  return {
    ...asset,
    displayUrl,
    mediaKind: isVideo ? "video" : "image",
  };
}

function chooseImages(maxCount) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: Math.min(maxCount, 9),
      sizeType: ["compressed", "original"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const tempFilePaths = res.tempFilePaths || [];
        resolve(tempFilePaths.map((path) => ({ tempFilePath: path })));
      },
      fail: reject,
    });
  });
}

function chooseSingleVideo() {
  return new Promise((resolve, reject) => {
    wx.chooseVideo({
      sourceType: ["album", "camera"],
      compressed: true,
      maxDuration: 60,
      success: (res) => resolve([{ tempFilePath: res.tempFilePath }]),
      fail: reject,
    });
  });
}

function chooseMediaType() {
  return new Promise((resolve, reject) => {
    wx.showActionSheet({
      itemList: ["上传图片", "上传视频"],
      success: (res) => resolve(res.tapIndex),
      fail: (err) => {
        if (String(err?.errMsg || "").includes("cancel")) {
          resolve(-1);
          return;
        }
        reject(err);
      },
    });
  });
}

Page({
  data: {
    content: "",
    contentCount: 0,
    isAnonymous: false,
    transportOptions: [
      { label: "高铁", value: "high_speed_rail" },
      { label: "飞机", value: "flight" },
      { label: "普通火车", value: "train" },
      { label: "自驾", value: "road_trip" },
      { label: "大巴", value: "bus" },
      { label: "其他", value: "other" },
    ],
    phaseOptions: [
      { label: "准备出发", value: "preparing" },
      { label: "正在候车/候机", value: "boarding" },
      { label: "在路上", value: "on_the_way" },
      { label: "已到达", value: "arrived" },
    ],
    transportIndex: 0,
    phaseIndex: 2,
    routeCode: "",
    origin: "",
    destination: "",
    departureWindow: "",
    mediaAssets: [],
    uploading: false,
  },

  onShow() {
    this.syncTabBar();
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 1;
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 1 });
    }
  },

  onContentInput(e) {
    const value = e.detail.value;
    this.setData({ content: value, contentCount: value.length });
  },

  onRouteCodeInput(e) {
    this.setData({ routeCode: e.detail.value });
  },

  onOriginInput(e) {
    this.setData({ origin: e.detail.value });
  },

  onDestinationInput(e) {
    this.setData({ destination: e.detail.value });
  },

  onDepartureWindowInput(e) {
    this.setData({ departureWindow: e.detail.value });
  },

  onTransportChange(e) {
    this.setData({ transportIndex: Number(e.detail.value) });
  },

  onPhaseChange(e) {
    this.setData({ phaseIndex: Number(e.detail.value) });
  },

  onAnonymousChange(e) {
    this.setData({ isAnonymous: e.detail.value });
  },

  async chooseMedia() {
    if (this.data.uploading) return;
    if (this.data.mediaAssets.length >= 9) {
      wx.showToast({ title: "最多上传9个媒体文件", icon: "none" });
      return;
    }
    try {
      if (!app.globalData.token) {
        await app.ensureAuthSession();
      }
    } catch (err) {
      wx.showToast({ title: err.message || "登录状态异常，请重试", icon: "none" });
      return;
    }
    this.setData({ uploading: true });
    try {
      const typeIndex = await chooseMediaType();
      if (typeIndex < 0) {
        return;
      }
      const remain = 9 - this.data.mediaAssets.length;
      const selectedFiles =
        typeIndex === 0 ? await chooseImages(Math.min(remain, 9)) : await chooseSingleVideo();
      const assets = [...this.data.mediaAssets];
      for (const file of selectedFiles) {
        const uploaded = await uploadFile({
          url: "/api/media/upload",
          filePath: file.tempFilePath,
        });
        assets.push(formatMediaAsset(uploaded.asset));
      }
      this.setData({ mediaAssets: assets.slice(0, 9) });
      wx.showToast({ title: "上传完成", icon: "success" });
    } catch (err) {
      const msg = String(err?.message || err?.errMsg || "");
      if (msg.includes("cancel")) {
        return;
      }
      wx.showToast({ title: msg || "上传失败", icon: "none" });
    } finally {
      this.setData({ uploading: false });
    }
  },

  removeMedia(e) {
    const mediaId = e.currentTarget.dataset.id;
    this.setData({
      mediaAssets: this.data.mediaAssets.filter((item) => item.id !== mediaId),
    });
  },

  async submit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: "请输入动态内容", icon: "none" });
      return;
    }
    if (!this.data.origin.trim() || !this.data.destination.trim()) {
      wx.showToast({ title: "请填写出发地和目的地", icon: "none" });
      return;
    }

    const transportType = this.data.transportOptions[this.data.transportIndex].value;
    const phase = this.data.phaseOptions[this.data.phaseIndex].value;

    try {
      const journeyRes = await request({
        url: "/api/journeys/status",
        method: "POST",
        data: {
          transportType,
          routeCode: this.data.routeCode.trim(),
          origin: this.data.origin.trim(),
          destination: this.data.destination.trim(),
          phase,
          departureWindow: this.data.departureWindow.trim(),
          visibility: "public",
        },
      });

      const postRes = await request({
        url: "/api/posts",
        method: "POST",
        data: {
          content: this.data.content.trim(),
          isAnonymous: this.data.isAnonymous,
          journeyId: journeyRes.journey.id,
          visibility: "public",
          mediaAssetIds: this.data.mediaAssets.map((item) => item.id),
        },
      });

      if (postRes.post.moderationStatus === "approved") {
        wx.showToast({ title: "发布成功", icon: "success" });
      } else {
        wx.showToast({ title: "发布成功，等待审核", icon: "none" });
      }
      this.setData({
        content: "",
        contentCount: 0,
        routeCode: "",
        origin: "",
        destination: "",
        departureWindow: "",
        isAnonymous: false,
        mediaAssets: [],
      });
      setTimeout(() => {
        wx.switchTab({ url: "/pages/square/square" });
      }, 500);
    } catch (err) {
      wx.showToast({ title: err.message || "发布失败", icon: "none" });
    }
  },
});
