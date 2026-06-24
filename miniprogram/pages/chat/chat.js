const { request } = require("../../utils/request");
const app = getApp();

Page({
  data: {
    groupId: "",
    groupName: "群聊",
    messages: [],
    inputText: "",
    isAnonymous: false,
  },

  onLoad(options) {
    this.setData({
      groupId: options.groupId || "",
      groupName: decodeURIComponent(options.groupName || "群聊"),
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
      this.setData({ messages: res.items || [] });
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
          this.setData({
            messages: [...this.data.messages, payload.message],
          });
        }
      } catch (_err) {
        // Ignore malformed payloads.
      }
    });
  },

  closeSocket() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  },

  onInputText(e) {
    this.setData({ inputText: e.detail.value });
  },

  onAnonymousChange(e) {
    this.setData({ isAnonymous: e.detail.value });
  },

  async sendMessage() {
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
      this.setData({ inputText: "" });
    } catch (err) {
      wx.showToast({ title: err.message || "发送失败", icon: "none" });
    }
  },
});
