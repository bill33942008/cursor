const app = getApp();

const MIN_STAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    entering: false,
    authHint: "",
  },

  onLoad() {
    app.globalData.splashShownThisLaunch = true;
    this.launchAt = Date.now();
    this.bootstrap();
  },

  async bootstrap() {
    try {
      const hasSession = Boolean(app.globalData.token);
      const cachedProfile = app.globalData.wxUserProfile || (!app.globalData.isTouristMode ? wx.getStorageSync("wxUserProfile") : null);
      const hasProfile = Boolean(cachedProfile?.nickname || cachedProfile?.avatarUrl);

      if (hasSession && hasProfile) {
        await this.waitForMinimumStay();
        this.enterApp();
        return;
      }

      if (!hasSession && hasProfile) {
        await app.ensureAuthSession({ profile: cachedProfile });
        await this.waitForMinimumStay();
        this.enterApp();
        return;
      }

      await this.waitForMinimumStay();
      if (app.globalData.isTouristMode) {
        await app.ensureAuthSession();
        this.enterApp();
        return;
      }
      await this.promptAuthorization();
    } catch (err) {
      await this.waitForMinimumStay();
      this.setData({
        authHint: err.message || "初始化失败，请重新进入",
      });
    }
  },

  async waitForMinimumStay() {
    const elapsed = Date.now() - this.launchAt;
    const remain = Math.max(0, MIN_STAY_MS - elapsed);
    if (remain > 0) {
      await sleep(remain);
    }
  },

  async authorizeAndEnter() {
    if (this.data.entering) return;
    this.setData({ entering: true, authHint: "" });
    try {
      const profile = await app.requestUserProfile();
      await app.ensureAuthSession({ forceRefresh: true, profile });
      this.enterApp();
    } catch (err) {
      this.setData({ authHint: err.message || "授权失败，请重试" });
      throw err;
    } finally {
      this.setData({ entering: false });
    }
  },

  promptAuthorization() {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: "微信授权",
        content: "为同步你的昵称和头像，请先完成微信授权",
        confirmText: "授权并进入",
        cancelText: "取消",
        success: async (res) => {
          if (!res.confirm) {
            this.setData({ authHint: "已取消授权，无法进入应用" });
            reject(new Error("用户取消授权"));
            return;
          }
          try {
            await this.authorizeAndEnter();
            resolve();
          } catch (err) {
            wx.showToast({ title: err.message || "授权失败", icon: "none" });
            reject(err);
          }
        },
        fail: (err) => {
          reject(new Error(err?.errMsg || "授权弹窗失败"));
        },
      });
    });
  },

  async retryAuthorization() {
    if (this.data.entering) return;
    if (app.globalData.token && app.globalData.user) return;
    if (app.globalData.isTouristMode) return;
    try {
      await this.promptAuthorization();
    } catch (_err) {
      // Keep splash visible, user can tap again to retry.
    }
  },

  enterApp() {
    wx.switchTab({
      url: "/pages/square/square",
    });
  },
});
