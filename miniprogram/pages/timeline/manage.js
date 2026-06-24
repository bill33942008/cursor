const { request } = require("../../utils/request");

Page({
  data: {
    loading: true,
    savingVisibility: false,
    timelineIsPublic: false,
    events: [],
    form: {
      title: "",
      location: "",
      note: "",
      occurredDate: "",
      isPublic: true,
    },
  },

  onShow() {
    this.loadTimelineData();
  },

  async loadTimelineData() {
    this.setData({ loading: true });
    try {
      const [visibilityRes, timelineRes] = await Promise.all([
        request({ url: "/api/users/me/timeline/visibility", method: "GET" }),
        request({ url: "/api/users/me/timeline?limit=50&offset=0", method: "GET" }),
      ]);
      this.setData({
        timelineIsPublic: Boolean(visibilityRes.timelineIsPublic),
        events: timelineRes.items || [],
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载时间线失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onFormInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({
      form: {
        ...this.data.form,
        [key]: value,
      },
    });
  },

  onDateChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        occurredDate: e.detail.value,
      },
    });
  },

  onEventPublicChange(e) {
    this.setData({
      form: {
        ...this.data.form,
        isPublic: Boolean(e.detail.value),
      },
    });
  },

  async onTimelinePublicChange(e) {
    const nextValue = Boolean(e.detail.value);
    this.setData({ savingVisibility: true });
    try {
      await request({
        url: "/api/users/me/timeline/visibility",
        method: "POST",
        data: { timelineIsPublic: nextValue },
      });
      this.setData({ timelineIsPublic: nextValue });
      wx.showToast({ title: "共享状态已更新", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "更新失败", icon: "none" });
    } finally {
      this.setData({ savingVisibility: false });
    }
  },

  async createEvent() {
    const { title, location, note, occurredDate, isPublic } = this.data.form;
    if (!title.trim() || !location.trim() || !occurredDate) {
      wx.showToast({ title: "请填写标题、地点和日期", icon: "none" });
      return;
    }
    try {
      await request({
        url: "/api/users/me/timeline",
        method: "POST",
        data: {
          title: title.trim(),
          location: location.trim(),
          note: note.trim(),
          occurredAt: `${occurredDate}T00:00:00.000Z`,
          isPublic,
        },
      });
      this.setData({
        form: {
          title: "",
          location: "",
          note: "",
          occurredDate: "",
          isPublic: true,
        },
      });
      wx.showToast({ title: "已新增记录", icon: "success" });
      this.loadTimelineData();
    } catch (err) {
      wx.showToast({ title: err.message || "新增失败", icon: "none" });
    }
  },

  async removeEvent(e) {
    const eventId = e.currentTarget.dataset.id;
    if (!eventId) return;
    wx.showModal({
      title: "删除记录",
      content: "删除后不可恢复，确定删除吗？",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({
            url: `/api/users/me/timeline/${eventId}`,
            method: "DELETE",
          });
          wx.showToast({ title: "已删除", icon: "success" });
          this.loadTimelineData();
        } catch (err) {
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }
      },
    });
  },
});
