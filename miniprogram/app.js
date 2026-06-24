App({
  globalData: {
    baseUrl: "http://localhost:3000",
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
  },
});
