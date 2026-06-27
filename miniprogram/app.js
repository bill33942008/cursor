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

    try {
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
    } catch (_err) {
      // Ignore storage read errors in unsupported environments.
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

  ensureInteractiveAuth(options = {}) {
    const { featureName = "该功能", forceRefresh = false } = options;
    if (this.globalData.token && this.globalData.user && !forceRefresh) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      wx.showModal({
        title: "加入同行",
        content: `${featureName}需要登录授权，加入同行即可开启更多功能。`,
        confirmText: "去加入",
        cancelText: "暂不",
        success: async (res) => {
          if (!res.confirm) {
            resolve(false);
            return;
          }
          try {
            let profile = null;
            if (!this.globalData.isTouristMode) {
              profile = await this.requestUserProfile();
            }
            await this.ensureAuthSession({ forceRefresh: true, profile });
            resolve(Boolean(this.globalData.token));
          } catch (err) {
            wx.showToast({ title: err.message || "授权失败", icon: "none" });
            resolve(false);
          }
        },
        fail: () => resolve(false),
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
    let persistedProfile = null;
    try {
      persistedProfile = wx.getStorageSync("wxUserProfile");
    } catch (_err) {
      persistedProfile = null;
    }
    const cachedProfile = this.globalData.wxUserProfile || persistedProfile;
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
            const serverUser = loginData.user || {};
            const syncedProfile = {
              nickname: (serverUser.nickname || mergedProfile.nickname || "").trim() || fallbackNickname,
              avatarUrl: serverUser.avatarUrl || mergedProfile.avatarUrl || "",
            };
            this.globalData.token = loginData.accessToken || "";
            this.globalData.user = serverUser || null;
            this.globalData.wxUserProfile = syncedProfile;
            try {
              wx.setStorageSync("accessToken", this.globalData.token);
              wx.setStorageSync("currentUser", this.globalData.user);
              wx.setStorageSync("wxUserProfile", syncedProfile);
            } catch (_err) {
              // Ignore storage persistence errors in limited environments.
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
