const { request, uploadFile } = require("../../utils/request");
const app = getApp();

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function toDateValue(occurredAt) {
  if (!occurredAt) return "";
  return String(occurredAt).slice(0, 10);
}

function mapTimelineEvent(event) {
  const media = (event.media || []).map((rawUrl) => ({
    rawUrl,
    url: resolveMediaUrl(rawUrl),
  }));
  return {
    ...event,
    media,
    mediaUrls: media.map((item) => item.url),
    coverMedia: media[0] || null,
    thumbMedia: media.slice(1, 4),
    moreMediaCount: Math.max(0, media.length - 4),
  };
}

function createDefaultForm() {
  return {
    title: "",
    location: "",
    note: "",
    occurredDate: "",
    isPublic: true,
    mediaAssets: [],
  };
}

function chooseImages(remainCount) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: Math.min(remainCount, 9),
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

function parsePrivacyScopeApi(errMessage) {
  const text = String(errMessage || "");
  const match = text.match(/(chooseImage|chooseVideo|chooseMedia):fail api scope is not declared in the privacy agreement/i);
  return match ? match[1] : "";
}

function showPrivacyScopeGuide(apiName) {
  const scopeName = apiName || "chooseImage";
  wx.showModal({
    title: "需补充隐私声明",
    content: `当前小程序未在微信后台隐私指引声明 ${scopeName} 能力。请到微信公众平台 -> 设置 -> 服务内容声明 -> 用户隐私保护指引，勾选对应能力后重试。`,
    showCancel: false,
    confirmText: "知道了",
  });
}

Page({
  data: {
    loading: true,
    submitting: false,
    uploadingMedia: false,
    savingVisibility: false,
    timelineIsPublic: false,
    events: [],
    displayedEvents: [],
    filterType: "all",
    filterOptions: [
      { label: "全部", value: "all" },
      { label: "公开", value: "public" },
      { label: "私密", value: "private" },
    ],
    editingEventId: "",
    form: createDefaultForm(),
  },

  async onShow() {
    await app.loadFeatureFlags();
    if (!app.isFeatureEnabled("timeline_manage_enabled", true)) {
      wx.showToast({ title: "当前阶段未开放时间线管理", icon: "none" });
      wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({ url: "/pages/profile/profile" }),
      });
      return;
    }
    this.loadTimelineData();
  },

  async onPullDownRefresh() {
    try {
      await this.loadTimelineData();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  syncDisplayedEvents(nextEvents) {
    const source = Array.isArray(nextEvents) ? nextEvents : this.data.events;
    const filterType = this.data.filterType || "all";
    let displayedEvents = source;
    if (filterType === "public") {
      displayedEvents = source.filter((item) => Boolean(item.isPublic));
    } else if (filterType === "private") {
      displayedEvents = source.filter((item) => !Boolean(item.isPublic));
    }
    this.setData({ displayedEvents });
  },

  onFilterChange(e) {
    const filterType = e.currentTarget.dataset.value || "all";
    this.setData({ filterType }, () => this.syncDisplayedEvents());
  },

  async loadTimelineData() {
    this.setData({ loading: true });
    try {
      const [visibilityRes, timelineRes] = await Promise.all([
        request({ url: "/api/users/me/timeline/visibility", method: "GET" }),
        request({ url: "/api/users/me/timeline?limit=50&offset=0", method: "GET" }),
      ]);
      const events = (timelineRes.items || []).map(mapTimelineEvent);
      this.setData({
        timelineIsPublic: Boolean(visibilityRes.timelineIsPublic),
        events,
      });
      this.syncDisplayedEvents(events);
    } catch (err) {
      wx.showToast({ title: err.message || "加载时间线失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onFormInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({
      form: {
        ...this.data.form,
        [key]: value,
      },
    });
  },

  onDateChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        occurredDate: e.detail.value,
      },
    });
  },

  onEventPublicChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        isPublic: Boolean(e.detail.value),
      },
    });
  },

  async onTimelinePublicChange(e) {
    const nextValue = Boolean(e.detail.value);
    this.setData({ savingVisibility: true });
    try {
      await request({
        url: "/api/users/me/timeline/visibility",
        method: "POST",
        data: { timelineIsPublic: nextValue },
      });
      this.setData({ timelineIsPublic: nextValue });
      wx.showToast({ title: "共享状态已更新", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "更新失败", icon: "none" });
    } finally {
      this.setData({ savingVisibility: false });
    }
  },

  async chooseMedia() {
    if (this.data.uploadingMedia) return;
    const remainCount = 9 - this.data.form.mediaAssets.length;
    if (remainCount <= 0) {
      wx.showToast({ title: "最多上传9张图片", icon: "none" });
      return;
    }
    try {
      if (!app.globalData.token) {
        const joined = await app.ensureInteractiveAuth({ featureName: "上传时间线图片" });
        if (!joined) {
          return;
        }
      }
      const files = await chooseImages(Math.min(6, remainCount));
      if (files.length === 0) return;
      this.setData({ uploadingMedia: true });
      const uploaded = [];
      for (const file of files) {
        const uploadRes = await uploadFile({
          url: "/api/media/upload",
          filePath: file.tempFilePath,
          name: "file",
        });
        if (uploadRes.asset?.moderationStatus === "rejected") {
          wx.showToast({ title: "有图片未通过审核", icon: "none" });
          continue;
        }
        if (!uploadRes.asset?.id || !uploadRes.asset?.url) {
          continue;
        }
        uploaded.push({
          assetId: uploadRes.asset.id,
          rawUrl: uploadRes.asset.url,
          url: resolveMediaUrl(uploadRes.asset.url),
        });
      }
      if (uploaded.length) {
        this.setData({
          form: {
            ...this.data.form,
            mediaAssets: [...this.data.form.mediaAssets, ...uploaded].slice(0, 9),
          },
        });
      }
    } catch (err) {
      const message = String(err?.message || err?.errMsg || "");
      if (message.includes("cancel")) {
        return;
      }
      const apiName = parsePrivacyScopeApi(message);
      if (apiName) {
        showPrivacyScopeGuide(apiName);
        return;
      }
      wx.showToast({ title: message || "上传图片失败", icon: "none" });
    } finally {
      this.setData({ uploadingMedia: false });
    }
  },

  removeDraftMedia(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const next = this.data.form.mediaAssets.filter((_, i) => i !== index);
    this.setData({
      form: {
        ...this.data.form,
        mediaAssets: next,
      },
    });
  },

  moveDraftMediaLeft(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index) || index <= 0) return;
    const next = [...this.data.form.mediaAssets];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    this.setData({
      form: {
        ...this.data.form,
        mediaAssets: next,
      },
    });
  },

  moveDraftMediaRight(e) {
    const index = Number(e.currentTarget.dataset.index);
    const list = this.data.form.mediaAssets;
    if (Number.isNaN(index) || index < 0 || index >= list.length - 1) return;
    const next = [...list];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    this.setData({
      form: {
        ...this.data.form,
        mediaAssets: next,
      },
    });
  },

  previewDraftMedia(e) {
    const index = Number(e.currentTarget.dataset.index);
    const urls = this.data.form.mediaAssets.map((item) => item.url);
    if (Number.isNaN(index) || !urls[index]) return;
    wx.previewImage({
      current: urls[index],
      urls,
    });
  },

  startEdit(e) {
    const eventId = e.currentTarget.dataset.id;
    const event = this.data.events.find((item) => item.id === eventId);
    if (!event) return;
    this.setData({
      editingEventId: event.id,
      form: {
        title: event.title || "",
        location: event.location || "",
        note: event.note || "",
        occurredDate: toDateValue(event.occurredAt),
        isPublic: Boolean(event.isPublic),
        mediaAssets: (event.media || []).map((item) => ({
          assetId: "",
          rawUrl: item.rawUrl,
          url: item.url,
        })),
      },
    });
    if (typeof wx.pageScrollTo === "function") {
      wx.pageScrollTo({ scrollTop: 0, duration: 220 });
    }
  },

  cancelEdit() {
    this.setData({
      editingEventId: "",
      form: createDefaultForm(),
    });
  },

  async submitEvent() {
    if (this.data.submitting) return;
    const { title, location, note, occurredDate, isPublic, mediaAssets } = this.data.form;
    if (!title.trim() || !location.trim() || !occurredDate) {
      wx.showToast({ title: "请填写标题、地点和日期", icon: "none" });
      return;
    }
    const mediaAssetIds = mediaAssets.map((item) => item.assetId).filter(Boolean);
    const keepMediaUrls = mediaAssets.map((item) => item.rawUrl).filter(Boolean);
    this.setData({ submitting: true });
    try {
      if (this.data.editingEventId) {
        await request({
          url: `/api/users/me/timeline/${this.data.editingEventId}`,
          method: "PUT",
          data: {
            title: title.trim(),
            location: location.trim(),
            note: note.trim(),
            occurredAt: `${occurredDate}T00:00:00.000Z`,
            isPublic,
            mediaAssetIds,
            keepMediaUrls,
          },
        });
        wx.showToast({ title: "已更新记录", icon: "success" });
      } else {
        await request({
          url: "/api/users/me/timeline",
          method: "POST",
          data: {
            title: title.trim(),
            location: location.trim(),
            note: note.trim(),
            occurredAt: `${occurredDate}T00:00:00.000Z`,
            isPublic,
            mediaAssetIds,
          },
        });
        wx.showToast({ title: "已新增记录", icon: "success" });
      }
      this.setData({
        editingEventId: "",
        form: createDefaultForm(),
      });
      this.loadTimelineData();
    } catch (err) {
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  previewEventMedia(e) {
    const eventId = e.currentTarget.dataset.id;
    const index = Number(e.currentTarget.dataset.index);
    const event = this.data.events.find((item) => item.id === eventId);
    if (!event || Number.isNaN(index) || !event.mediaUrls[index]) return;
    wx.previewImage({
      current: event.mediaUrls[index],
      urls: event.mediaUrls,
    });
  },

  async removeEvent(e) {
    const eventId = e.currentTarget.dataset.id;
    if (!eventId) return;
    wx.showModal({
      title: "删除记录",
      content: "删除后不可恢复，确定删除吗？",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({
            url: `/api/users/me/timeline/${eventId}`,
            method: "DELETE",
          });
          wx.showToast({ title: "已删除", icon: "success" });
          if (this.data.editingEventId === eventId) {
            this.setData({
              editingEventId: "",
              form: createDefaultForm(),
            });
          }
          this.loadTimelineData();
        } catch (err) {
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }
      },
    });
  },
});
