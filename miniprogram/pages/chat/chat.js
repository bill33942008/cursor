const { request } = require("../../utils/request");
const app = getApp();

function normalizeMessages(messages, currentUserId) {
  return (messages || []).map((item) => ({
    ...item,
    isMine: item.userId === currentUserId,
    domId: `msg-${item.id}`,
  }));
}

Page({
  data: {
    groupId: "",
    groupName: "群聊",
    messages: [],
    inputText: "",
    isAnonymous: false,
    emojiPanelVisible: false,
    emojiList: ["😀", "😁", "😂", "🥹", "😊", "😎", "😍", "🤔", "😭", "😡", "👍", "👏", "🎉", "🙏", "🚄", "✈️", "🚗", "🧳", "📍", "❤️"],
    wsConnected: false,
    currentUserId: "",
    scrollIntoView: "",
    groupsChatEnabled: true,
    groupsAnonymousEnabled: true,
  },

  async onLoad(options) {
    await app.loadFeatureFlags();
    const groupsChatEnabled = app.isFeatureEnabled("groups_chat_enabled", true);
    const groupsAnonymousEnabled = app.isFeatureEnabled("groups_anonymous_chat_enabled", true);
    if (!groupsChatEnabled) {
      wx.showToast({ title: "当前阶段未开放群聊能力", icon: "none" });
      wx.switchTab({ url: "/pages/groups/groups" });
      return;
    }
    this.setData({
      groupId: options.groupId || "",
      groupName: decodeURIComponent(options.groupName || "群聊"),
      currentUserId: app.globalData.user?.id || "",
      groupsChatEnabled,
      groupsAnonymousEnabled,
    });
    wx.setNavigationBarTitle({ title: this.data.groupName });
    this.loadMessages();
    this.openSocket();
  },

  onUnload() {
    this.closeSocket();
  },

  async loadMessages() {
    try {
      const res = await request({
        url: `/api/groups/${this.data.groupId}/messages?limit=50&offset=0`,
        method: "GET",
      });
      const messages = normalizeMessages(res.items || [], this.data.currentUserId);
      const last = messages[messages.length - 1];
      this.setData({
        messages,
        scrollIntoView: last ? last.domId : "",
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载消息失败", icon: "none" });
    }
  },

  openSocket() {
    if (!app.globalData.token) {
      return;
    }
    const wsUrl = `${app.globalData.wsUrl}?token=${encodeURIComponent(app.globalData.token)}`;
    this.socketTask = wx.connectSocket({ url: wsUrl });
    this.socketTask.onOpen(() => {
      this.setData({ wsConnected: true });
      this.socketTask.send({
        data: JSON.stringify({
          type: "subscribe_group",
          groupId: this.data.groupId,
        }),
      });
    });
    this.socketTask.onMessage((event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "group_message" && payload.groupId === this.data.groupId) {
          const incoming = normalizeMessages([payload.message], this.data.currentUserId)[0];
          const messages = [...this.data.messages, incoming];
          const last = messages[messages.length - 1];
          this.setData({
            messages,
            scrollIntoView: last ? last.domId : "",
          });
        }
      } catch (_err) {
        // Ignore malformed payloads.
      }
    });
    this.socketTask.onClose(() => {
      this.setData({ wsConnected: false });
    });
    this.socketTask.onError(() => {
      this.setData({ wsConnected: false });
    });
  },

  closeSocket() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({ wsConnected: false });
  },

  onInputText(e) {
    this.setData({ inputText: e.detail.value });
  },

  openGroupSettings() {
    const actions = [];
    if (this.data.groupsAnonymousEnabled) {
      actions.push(this.data.isAnonymous ? "关闭匿名发送" : "开启匿名发送");
    }
    actions.push("离开该群组");
    wx.showActionSheet({
      itemList: actions,
      success: async (res) => {
        const leaveIndex = actions.length - 1;
        if (this.data.groupsAnonymousEnabled && res.tapIndex === 0) {
          const next = !this.data.isAnonymous;
          this.setData({ isAnonymous: next });
          wx.showToast({ title: next ? "已开启匿名发送" : "已关闭匿名发送", icon: "none" });
          return;
        }
        if (res.tapIndex === leaveIndex) {
          await this.leaveCurrentGroup();
        }
      },
    });
  },

  async leaveCurrentGroup() {
    try {
      await request({
        url: `/api/groups/${this.data.groupId}/leave`,
        method: "POST",
      });
      wx.showToast({ title: "已离开群组", icon: "success" });
      this.closeSocket();
      setTimeout(() => {
        wx.switchTab({
          url: "/pages/groups/groups",
        });
      }, 250);
    } catch (err) {
      wx.showToast({ title: err.message || "离开失败", icon: "none" });
    }
  },

  toggleEmojiPanel() {
    this.setData({
      emojiPanelVisible: !this.data.emojiPanelVisible,
    });
  },

  appendEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji || "";
    if (!emoji) return;
    this.setData({
      inputText: `${this.data.inputText || ""}${emoji}`,
    });
  },

  async sendMessage() {
    if (!this.data.groupsChatEnabled) {
      wx.showToast({ title: "当前阶段未开放群聊能力", icon: "none" });
      return;
    }
    const content = this.data.inputText.trim();
    if (!content) {
      return;
    }
    try {
      const res = await request({
        url: `/api/groups/${this.data.groupId}/messages`,
        method: "POST",
        data: {
          content,
          isAnonymous: this.data.isAnonymous,
        },
      });
      if (res.moderationStatus !== "approved") {
        wx.showToast({ title: "消息进入审核队列", icon: "none" });
      }
      this.setData({ inputText: "", emojiPanelVisible: false });
    } catch (err) {
      wx.showToast({ title: err.message || "发送失败", icon: "none" });
    }
  },
});
