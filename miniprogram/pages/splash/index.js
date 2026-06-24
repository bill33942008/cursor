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
  },

  onLoad() {
    this.launchAt = Date.now();
    this.bootstrap();
  },

  async bootstrap() {
    try {
      const hasSession = Boolean(app.globalData.token);
      if (hasSession) {
        await this.waitForMinimumStay();
        this.enterApp();
        return;
      }

      // If a profile was already authorized before, restore silently.
      const cachedProfile = app.globalData.isTouristMode ? null : wx.getStorageSync("wxUserProfile");
      if (cachedProfile && (cachedProfile.nickname || cachedProfile.avatarUrl)) {
        await app.ensureAuthSession({ profile: cachedProfile });
        await this.waitForMinimumStay();
        this.enterApp();
        return;
      }

      await this.waitForMinimumStay();
      this.setData({ readyToEnter: true });
    } catch (err) {
      await this.waitForMinimumStay();
      this.setData({
        readyToEnter: true,
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
