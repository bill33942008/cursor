const { request, uploadFile } = require("../../utils/request");
const app = getApp();

const HOT_DESTINATION_SPOTS = [
  "北京故宫",
  "八达岭长城",
  "颐和园",
  "上海外滩",
  "上海迪士尼",
  "东方明珠",
  "杭州西湖",
  "千岛湖",
  "乌镇",
  "西溪湿地",
  "苏州园林",
  "拙政园",
  "南京夫子庙",
  "中山陵",
  "黄山风景区",
  "九华山",
  "厦门鼓浪屿",
  "武夷山",
  "深圳世界之窗",
  "广州长隆",
  "珠海长隆海洋王国",
  "桂林漓江",
  "阳朔西街",
  "张家界国家森林公园",
  "凤凰古城",
  "武汉黄鹤楼",
  "三峡大坝",
  "洛阳龙门石窟",
  "西安兵马俑",
  "华山",
  "大唐不夜城",
  "成都宽窄巷子",
  "都江堰",
  "九寨沟",
  "稻城亚丁",
  "重庆洪崖洞",
  "磁器口古镇",
  "青岛栈桥",
  "泰山",
  "大连老虎滩",
  "哈尔滨冰雪大世界",
  "长白山天池",
  "呼伦贝尔草原",
  "敦煌莫高窟",
  "鸣沙山月牙泉",
  "青海湖",
  "茶卡盐湖",
  "拉萨布达拉宫",
  "纳木错",
  "三亚亚龙湾",
  "蜈支洲岛",
  "丽江古城",
  "玉龙雪山",
  "大理洱海",
  "西双版纳",
];

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

function parsePrivacyScopeApi(errMessage) {
  const text = String(errMessage || "");
  const match = text.match(/(chooseImage|chooseVideo|chooseMedia):fail api scope is not declared in the privacy agreement/i);
  return match ? match[1] : "";
}

function showPrivacyScopeGuide(apiName) {
  const scopeName = apiName || "chooseImage/chooseVideo";
  wx.showModal({
    title: "需补充隐私声明",
    content: `当前小程序未在微信后台隐私指引声明 ${scopeName} 能力。请到微信公众平台 -> 设置 -> 服务内容声明 -> 用户隐私保护指引，勾选对应能力后重试。`,
    showCancel: false,
    confirmText: "知道了",
  });
}

function formatRegion(region) {
  if (!Array.isArray(region) || region.length === 0) {
    return "";
  }
  return region.filter(Boolean).join(" ");
}

function normalizeKeyword(value) {
  return String(value || "").trim().toLowerCase();
}

function buildSpotSuggestions(keyword) {
  const q = normalizeKeyword(keyword);
  if (!q) {
    return HOT_DESTINATION_SPOTS.slice(0, 10);
  }
  return HOT_DESTINATION_SPOTS.filter((item) => item.toLowerCase().includes(q)).slice(0, 10);
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
    destinationModeOptions: [
      { label: "省市区", value: "region" },
      { label: "景点/地点", value: "spot" },
    ],
    destinationModeIndex: 0,
    routeCode: "",
    originRegion: [],
    destinationRegion: [],
    originRegionText: "出发地（必填）",
    destinationRegionText: "目的地（必填）",
    destinationSpotInput: "",
    destinationSpotSuggestions: HOT_DESTINATION_SPOTS.slice(0, 10),
    departureWindow: "",
    mediaAssets: [],
    uploading: false,
    publishEntryVisible: true,
    publishSubmitEnabled: true,
  },

  async onShow() {
    await app.loadFeatureFlags();
    this.applyFeatureFlags();
    this.syncTabBar();
    if (!this.data.publishEntryVisible) {
      wx.showToast({ title: "当前阶段未开放发布入口", icon: "none" });
      wx.switchTab({ url: "/pages/square/square" });
    }
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 1;
    app.globalData.currentTabPath = "/pages/publish/publish";
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 1 });
    }
  },

  applyFeatureFlags() {
    this.setData({
      publishEntryVisible: app.isFeatureEnabled("publish_entry_visible", true),
      publishSubmitEnabled: app.isFeatureEnabled("publish_submit_enabled", true),
    });
  },

  onContentInput(e) {
    const value = e.detail.value;
    this.setData({ content: value, contentCount: value.length });
  },

  onRouteCodeInput(e) {
    this.setData({ routeCode: e.detail.value });
  },

  onOriginRegionChange(e) {
    const region = e.detail.value || [];
    const text = formatRegion(region);
    this.setData({
      originRegion: region,
      originRegionText: text ? `出发地：${text}` : "出发地（必填）",
    });
  },

  onDestinationRegionChange(e) {
    const region = e.detail.value || [];
    const text = formatRegion(region);
    this.setData({
      destinationRegion: region,
      destinationRegionText: text ? `目的地：${text}` : "目的地（必填）",
    });
  },

  onDestinationModeChange(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const option = this.data.destinationModeOptions[index];
    const isSpotMode = option?.value === "spot";
    this.setData({
      destinationModeIndex: index,
      destinationSpotSuggestions: buildSpotSuggestions(isSpotMode ? this.data.destinationSpotInput : ""),
    });
  },

  onDestinationSpotInput(e) {
    const value = e.detail.value;
    this.setData({
      destinationSpotInput: value,
      destinationSpotSuggestions: buildSpotSuggestions(value),
    });
  },

  onDestinationSuggestionTap(e) {
    const value = e.currentTarget.dataset.value || "";
    this.setData({
      destinationSpotInput: value,
      destinationSpotSuggestions: buildSpotSuggestions(value),
    });
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

  async ensureFeatureAccess(featureName) {
    if (app.globalData.token) {
      return true;
    }
    return app.ensureInteractiveAuth({ featureName });
  },

  async chooseMedia() {
    if (!this.data.publishSubmitEnabled) {
      wx.showToast({ title: "当前阶段未开放发布功能", icon: "none" });
      return;
    }
    if (this.data.uploading) return;
    if (this.data.mediaAssets.length >= 9) {
      wx.showToast({ title: "最多上传9个媒体文件", icon: "none" });
      return;
    }
    const uploadAllowed = await this.ensureFeatureAccess("上传媒体并发布动态");
    if (!uploadAllowed) {
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
      const apiName = parsePrivacyScopeApi(msg);
      if (apiName) {
        showPrivacyScopeGuide(apiName);
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
    if (!this.data.publishSubmitEnabled) {
      wx.showToast({ title: "当前阶段未开放发布功能", icon: "none" });
      return;
    }
    const allowed = await this.ensureFeatureAccess("发布动态");
    if (!allowed) {
      return;
    }
    if (!this.data.content.trim()) {
      wx.showToast({ title: "请输入动态内容", icon: "none" });
      return;
    }
    const originText = formatRegion(this.data.originRegion);
    const isSpotMode = this.data.destinationModeOptions[this.data.destinationModeIndex]?.value === "spot";
    const destinationText = isSpotMode
      ? String(this.data.destinationSpotInput || "").trim()
      : formatRegion(this.data.destinationRegion);
    if (!originText || !destinationText) {
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
          origin: originText,
          destination: destinationText,
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
        originRegion: [],
        destinationRegion: [],
        originRegionText: "出发地（必填）",
        destinationRegionText: "目的地（必填）",
        destinationModeIndex: 0,
        destinationSpotInput: "",
        destinationSpotSuggestions: HOT_DESTINATION_SPOTS.slice(0, 10),
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
