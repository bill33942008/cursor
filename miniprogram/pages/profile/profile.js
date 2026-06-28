const { request } = require("../../utils/request");
const app = getApp();

function canUseStorage() {
  try {
    return typeof wx.getStorageSync === "function" && typeof wx.setStorageSync === "function";
  } catch (_err) {
    return false;
  }
}

function formatVipExpiryTip(featurePolicy) {
  const policy = featurePolicy || null;
  if (!policy) return "";
  const rawTier = String(policy.rawMembershipTier || policy.membershipTier || "normal");
  if (rawTier === "normal") return "当前为普通用户";
  const vipExpiresAt = String(policy.vipExpiresAt || "").trim();
  const tierLabel = rawTier === "svip" ? "SVIP" : "VIP";
  if (!vipExpiresAt) return `${tierLabel}有效期：永久`;
  const text = vipExpiresAt.replace("T", " ").slice(0, 16);
  if (policy.membershipTier !== "normal") {
    return `${tierLabel}到期：${text}`;
  }
  return `${tierLabel}已过期：${text}`;
}

function buildMemberVisual(featurePolicy) {
  const tier = String(featurePolicy?.membershipTier || "normal");
  if (tier === "svip") {
    return {
      label: "SVIP",
      icon: "/assets/membership/member-svip.svg",
    };
  }
  if (tier === "vip") {
    return {
      label: "VIP",
      icon: "/assets/membership/member-vip.svg",
    };
  }
  return {
    label: "普通",
    icon: "/assets/membership/member-normal.svg",
  };
}

Page({
  data: {
    loading: true,
    user: null,
    userInitial: "U",
    profilePolicy: null,
    featurePolicy: null,
    vipExpiryTip: "",
    memberTierLabel: "普通",
    memberTierIcon: "/assets/membership/member-normal.svg",
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    guestMode: false,
  },

  onShow() {
    this.syncTabBar();
    if (!app.globalData.token) {
      this.setData({
        loading: false,
        user: null,
        profilePolicy: null,
        featurePolicy: null,
        vipExpiryTip: "",
        memberTierLabel: "普通",
        memberTierIcon: "/assets/membership/member-normal.svg",
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
        guestMode: true,
      });
      return;
    }
    this.loadProfileData();
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 3;
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 3 });
    }
  },

  async loadProfileData() {
    this.setData({ loading: true });
    try {
      const [meRes, friendRes] = await Promise.all([
        request({ url: "/api/auth/me", method: "GET" }),
        request({ url: "/api/friends", method: "GET" }),
      ]);
      const wxProfile = app.globalData.wxUserProfile || (canUseStorage() ? wx.getStorageSync("wxUserProfile") : null);
      const mergedUser = {
        ...meRes.user,
        nickname: meRes.user?.nickname || wxProfile?.nickname || "旅友",
        avatarUrl: meRes.user?.avatarUrl || wxProfile?.avatarUrl || "",
      };
      const visual = buildMemberVisual(meRes.featurePolicy);
      app.globalData.user = mergedUser;
      if (canUseStorage()) {
        wx.setStorageSync("currentUser", mergedUser);
      }
      this.setData({
        memberTierLabel: visual.label,
        memberTierIcon: visual.icon,
        user: mergedUser,
        userInitial: String(mergedUser.nickname || "U").charAt(0) || "U",
        profilePolicy: meRes.profilePolicy || null,
        featurePolicy: meRes.featurePolicy || null,
        vipExpiryTip: formatVipExpiryTip(meRes.featurePolicy),
        friends: friendRes.friends || [],
        incomingRequests: friendRes.incomingRequests || [],
        outgoingRequests: friendRes.outgoingRequests || [],
        guestMode: false,
      });
    } catch (err) {
      if (err?.statusCode === 401 || err?.code === "UNAUTHORIZED") {
        this.setData({
          user: null,
          profilePolicy: null,
          featurePolicy: null,
          vipExpiryTip: "",
          memberTierLabel: "普通",
          memberTierIcon: "/assets/membership/member-normal.svg",
          friends: [],
          incomingRequests: [],
          outgoingRequests: [],
          guestMode: true,
        });
      } else {
        wx.showToast({ title: err.message || "加载失败", icon: "none" });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  async joinTongxing() {
    const ok = await app.ensureInteractiveAuth({ featureName: "个人中心" });
    if (!ok) {
      return;
    }
    this.loadProfileData();
  },

  async handleRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    try {
      await request({
        url: `/api/friends/request/${requestId}/respond`,
        method: "POST",
        data: { action },
      });
      wx.showToast({ title: "已处理", icon: "success" });
      this.loadProfileData();
    } catch (err) {
      wx.showToast({ title: err.message || "处理失败", icon: "none" });
    }
  },

  async revokeRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    if (!requestId) return;
    try {
      await request({
        url: `/api/friends/request/${requestId}`,
        method: "DELETE",
      });
      wx.showToast({ title: "已撤回", icon: "success" });
      this.loadProfileData();
    } catch (err) {
      wx.showToast({ title: err.message || "撤回失败", icon: "none" });
    }
  },

  openUserProfile(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId) return;
    wx.navigateTo({ url: `/pages/user/public?userId=${userId}` });
  },

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/index" });
  },

  goTimelineManage() {
    wx.navigateTo({ url: "/pages/timeline/manage" });
  },

  goProfileEdit() {
    wx.navigateTo({ url: "/pages/profile/edit" });
  },

  goPrivacy() {
    wx.navigateTo({ url: "/pages/settings/privacy" });
  },

  goSecurity() {
    wx.navigateTo({ url: "/pages/settings/security" });
  },
});
