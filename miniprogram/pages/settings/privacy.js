const PRIVACY_KEY = "privacy_settings_v1";

const DEFAULT_SETTINGS = {
  anonymousByDefault: false,
  allowNearbyRecommend: true,
  allowMessageInvite: true,
};

function readSettings() {
  try {
    const saved = wx.getStorageSync(PRIVACY_KEY);
    if (!saved || typeof saved !== "object") {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
    };
  } catch (_err) {
    return { ...DEFAULT_SETTINGS };
  }
}

Page({
  data: {
    settings: { ...DEFAULT_SETTINGS },
  },

  onShow() {
    this.setData({ settings: readSettings() });
  },

  onToggle(event) {
    const key = event.currentTarget.dataset.key;
    const value = Boolean(event.detail.value);
    const settings = {
      ...this.data.settings,
      [key]: value,
    };
    this.setData({ settings });
    try {
      wx.setStorageSync(PRIVACY_KEY, settings);
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (_err) {
      wx.showToast({ title: "保存失败", icon: "none" });
    }
  },
});
