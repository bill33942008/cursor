const { request, uploadFile } = require("../../utils/request");
const app = getApp();

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function canUseStorage() {
  try {
    return typeof wx.getStorageSync === "function" && typeof wx.setStorageSync === "function";
  } catch (_err) {
    return false;
  }
}

Page({
  data: {
    loading: true,
    saving: false,
    nickname: "",
    nicknameInitial: "U",
    avatarUrl: "",
    avatarPreviewUrl: "",
    profilePolicy: null,
    featurePolicy: null,
  },

  onLoad() {
    this.loadProfileForEdit();
  },

  async loadProfileForEdit() {
    this.setData({ loading: true });
    try {
      const [meRes, policyRes] = await Promise.all([
        request({ url: "/api/auth/me", method: "GET" }),
        request({ url: "/api/users/me/profile-policy", method: "GET" }),
      ]);
      const user = meRes.user || {};
      const nickname = String(user.nickname || "").trim() || "旅友";
      const avatarUrl = String(user.avatarUrl || "").trim();
      this.setData({
        nickname,
        nicknameInitial: nickname.charAt(0) || "U",
        avatarUrl,
        avatarPreviewUrl: resolveMediaUrl(avatarUrl),
        profilePolicy: policyRes.profilePolicy || meRes.profilePolicy || null,
        featurePolicy: policyRes.featurePolicy || meRes.featurePolicy || null,
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onNicknameInput(e) {
    const nickname = String(e.detail.value || "");
    this.setData({
      nickname,
      nicknameInitial: nickname.trim().charAt(0) || "U",
    });
  },

  chooseAvatar() {
    if (this.data.saving) return;
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed", "original"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const tempFilePath = res.tempFilePaths && res.tempFilePaths[0];
        if (!tempFilePath) return;
        this.setData({ saving: true });
        try {
          const uploaded = await uploadFile({
            url: "/api/media/upload",
            filePath: tempFilePath,
          });
          const avatarUrl = uploaded?.asset?.url || "";
          this.setData({
            avatarUrl,
            avatarPreviewUrl: resolveMediaUrl(avatarUrl),
          });
        } catch (err) {
          wx.showToast({ title: err.message || "头像上传失败", icon: "none" });
        } finally {
          this.setData({ saving: false });
        }
      },
      fail: (err) => {
        const message = String(err?.errMsg || "");
        if (message.includes("cancel")) return;
        wx.showToast({ title: "选择图片失败", icon: "none" });
      },
    });
  },

  async submitProfile() {
    if (this.data.saving) return;
    const nickname = String(this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await request({
        url: "/api/users/me/profile",
        method: "PUT",
        data: {
          nickname,
          avatarUrl: this.data.avatarUrl || "",
        },
      });
      const user = res.user || {};
      const profilePolicy = res.profilePolicy || null;
      const featurePolicy = res.featurePolicy || null;
      const syncedProfile = {
        nickname: user.nickname || nickname,
        avatarUrl: user.avatarUrl || "",
      };
      app.globalData.user = user;
      app.globalData.wxUserProfile = syncedProfile;
      if (canUseStorage()) {
        wx.setStorageSync("currentUser", user);
        wx.setStorageSync("wxUserProfile", syncedProfile);
      }
      this.setData({
        nickname: syncedProfile.nickname,
        nicknameInitial: syncedProfile.nickname.charAt(0) || "U",
        avatarUrl: syncedProfile.avatarUrl,
        avatarPreviewUrl: resolveMediaUrl(syncedProfile.avatarUrl),
        profilePolicy,
        featurePolicy,
      });
      wx.showToast({ title: "资料已更新", icon: "success" });
      setTimeout(() => {
        wx.navigateBack();
      }, 450);
    } catch (err) {
      wx.showToast({ title: err.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
