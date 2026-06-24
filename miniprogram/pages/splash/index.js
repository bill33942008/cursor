const app = getApp();

const MIN_STAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    readyToEnter: false,
    entering: false,
    authHint: "",
    authRequired: true,
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
      this.setData({
        readyToEnter: true,
        authRequired: !app.globalData.isTouristMode,
      });
    } catch (err) {
      await this.waitForMinimumStay();
      this.setData({
        readyToEnter: true,
        authRequired: !app.globalData.isTouristMode,
        authHint: err.message || "初始化失败，请点击下方进入",
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
      wx.showToast({ title: err.message || "授权失败", icon: "none" });
    } finally {
      this.setData({ entering: false });
    }
  },

  async quickEnter() {
    if (this.data.authRequired) {
      wx.showToast({ title: "请先授权微信资料", icon: "none" });
      return;
    }
    if (this.data.entering) return;
    this.setData({ entering: true, authHint: "" });
    try {
      await app.ensureAuthSession();
      this.enterApp();
    } catch (err) {
      this.setData({ authHint: err.message || "进入失败，请重试" });
      wx.showToast({ title: err.message || "进入失败", icon: "none" });
    } finally {
      this.setData({ entering: false });
    }
  },

  enterApp() {
    wx.switchTab({
      url: "/pages/square/square",
    });
  },
});
