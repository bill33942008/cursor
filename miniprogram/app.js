App({
  globalData: {
    baseUrl: "http://127.0.0.1:3000",
    wsUrl: "",
    token: "",
    user: null,
    isTouristMode: true,
  },

  onLaunch() {
    let appId = "";
    try {
      if (typeof wx.getAccountInfoSync === "function") {
        appId = wx.getAccountInfoSync()?.miniProgram?.appId || "";
      }
    } catch (_err) {
      appId = "";
    }

    const isTourist = !appId || appId === "touristappid";
    this.globalData.isTouristMode = isTourist;

    if (!isTourist) {
      const token = wx.getStorageSync("accessToken");
      const user = wx.getStorageSync("currentUser");
      if (token) {
        this.globalData.token = token;
      }
      if (user) {
        this.globalData.user = user;
      }
    }

    const wsBase = this.globalData.baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
    this.globalData.wsUrl = `${wsBase}/ws`;
  },
});
