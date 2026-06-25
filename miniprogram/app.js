App({
  globalData: {
    baseUrl: "http://127.0.0.1:3000",
    wsUrl: "",
    token: "",
    user: null,
    isTouristMode: true,
    wxUserProfile: null,
    splashShownThisLaunch: false,
    currentTabIndex: 0,
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
      const wxUserProfile = wx.getStorageSync("wxUserProfile");
      if (token) {
        this.globalData.token = token;
      }
      if (user) {
        this.globalData.user = user;
      }
      if (wxUserProfile) {
        this.globalData.wxUserProfile = wxUserProfile;
      }
    }

    const wsBase = this.globalData.baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
    this.globalData.wsUrl = `${wsBase}/ws`;
  },

  onShow() {
    if (this.globalData.splashShownThisLaunch) {
      return;
    }
    const redirectToSplashIfNeeded = () => {
      if (this.globalData.splashShownThisLaunch) {
        return;
      }
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = current?.route || "";
      if (!route || route === "pages/splash/index") {
        return;
      }
      this.globalData.splashShownThisLaunch = true;
      wx.reLaunch({
        url: "/pages/splash/index",
      });
    };
    redirectToSplashIfNeeded();
    setTimeout(redirectToSplashIfNeeded, 60);
  },

  requestUserProfile() {
    return new Promise((resolve, reject) => {
      if (typeof wx.getUserProfile !== "function") {
        reject(new Error("当前微信版本不支持授权接口"));
        return;
      }
      wx.getUserProfile({
        desc: "用于完善个人资料（昵称和头像）",
        success: (res) => {
          const nickname = res?.userInfo?.nickName || "";
          const avatarUrl = res?.userInfo?.avatarUrl || "";
          resolve({ nickname, avatarUrl });
        },
        fail: (err) => {
          reject(new Error(err?.errMsg || "用户取消授权"));
        },
      });
    });
  },

  ensureAuthSession(options = {}) {
    const { forceRefresh = false, profile = null } = options;
    if (this.globalData.token && !forceRefresh) {
      return Promise.resolve({
        accessToken: this.globalData.token,
        user: this.globalData.user,
      });
    }

    const fallbackNickname = `旅友${Math.floor(Math.random() * 1000)}`;
    const cachedProfile = this.globalData.wxUserProfile || (!this.globalData.isTouristMode ? wx.getStorageSync("wxUserProfile") : null);
    const mergedProfile = {
      nickname: (profile?.nickname || cachedProfile?.nickname || "").trim() || fallbackNickname,
      avatarUrl: profile?.avatarUrl || cachedProfile?.avatarUrl || "",
    };

    const getLoginCode = () =>
      new Promise((resolve, reject) => {
        if (this.globalData.isTouristMode) {
          resolve(`tourist-${Date.now()}`);
          return;
        }
        wx.login({
          success: (res) => resolve(res.code || `dev-${Date.now()}`),
          fail: (err) => reject(new Error(err?.errMsg || "wx.login failed")),
        });
      });

    return getLoginCode().then((code) => {
      return new Promise((resolve, reject) => {
        wx.request({
          url: `${this.globalData.baseUrl}/api/auth/wx-login`,
          method: "POST",
          data: {
            code,
            nickname: mergedProfile.nickname,
            avatarUrl: mergedProfile.avatarUrl || undefined,
          },
          header: {
            "content-type": "application/json",
          },
          success: (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(res.data?.message || "登录失败"));
              return;
            }
            const loginData = res.data || {};
            this.globalData.token = loginData.accessToken || "";
            this.globalData.user = loginData.user || null;
            this.globalData.wxUserProfile = mergedProfile;
            if (!this.globalData.isTouristMode) {
              wx.setStorageSync("accessToken", this.globalData.token);
              wx.setStorageSync("currentUser", this.globalData.user);
              wx.setStorageSync("wxUserProfile", mergedProfile);
            }
            resolve(loginData);
          },
          fail: (err) => {
            reject(new Error(err?.errMsg || "网络异常，登录失败"));
          },
        });
      });
    });
  },
});
