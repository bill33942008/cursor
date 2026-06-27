const app = getApp();

const MIN_STAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    entering: false,
    authHint: "轻触可进入",
  },

  onLoad() {
    app.globalData.splashShownThisLaunch = true;
    this.launchAt = Date.now();
    this.bootstrap();
  },

  async bootstrap() {
    await this.waitForMinimumStay();
    this.enterApp();
  },

  async waitForMinimumStay() {
    const elapsed = Date.now() - this.launchAt;
    const remain = Math.max(0, MIN_STAY_MS - elapsed);
    if (remain > 0) {
      await sleep(remain);
    }
  },

  async retryAuthorization() {
    if (this.data.entering) return;
    this.enterApp();
  },

  enterApp() {
    wx.switchTab({
      url: "/pages/square/square",
    });
  },
});
