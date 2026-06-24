const app = getApp();

Page({
  clearCache() {
    wx.showModal({
      title: "清理缓存",
      content: "将清理本地缓存并重新拉取数据，是否继续？",
      success: (res) => {
        if (!res.confirm) return;
        try {
          wx.clearStorageSync();
          app.globalData.token = "";
          app.globalData.user = null;
          wx.showToast({ title: "缓存已清理", icon: "success" });
        } catch (_err) {
          wx.showToast({ title: "清理失败", icon: "none" });
        }
      },
    });
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后需要重新登录才能继续互动，是否确认退出？",
      success: (res) => {
        if (!res.confirm) return;
        try {
          wx.removeStorageSync("accessToken");
          wx.removeStorageSync("currentUser");
        } catch (_err) {
          // Ignore storage removal errors.
        }
        app.globalData.token = "";
        app.globalData.user = null;
        wx.showToast({ title: "已退出", icon: "success" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/square/square" });
        }, 300);
      },
    });
  },
});
