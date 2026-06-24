App({
  globalData: {
    baseUrl: "http://localhost:3000",
    wsUrl: "",
    token: "",
    user: null,
  },

  onLaunch() {
    const token = wx.getStorageSync("accessToken");
    const user = wx.getStorageSync("currentUser");
    if (token) {
      this.globalData.token = token;
    }
    if (user) {
      this.globalData.user = user;
    }
    const wsBase = this.globalData.baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
    this.globalData.wsUrl = `${wsBase}/ws`;
  },
});
