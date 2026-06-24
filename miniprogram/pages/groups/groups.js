const { request } = require("../../utils/request");

Page({
  data: {
    groups: [],
    loading: false,
    skeletonRows: [1, 2, 3],
    destinationKeyword: "",
    creating: false,
    categoryOptions: [
      { label: "目的地同行", value: "destination" },
      { label: "航班同行", value: "flight" },
      { label: "铁路同行", value: "rail" },
      { label: "自驾同行", value: "road_trip" },
      { label: "其他主题", value: "custom" },
    ],
    categoryIndex: 0,
    createForm: {
      name: "",
      category: "destination",
      destination: "",
      routeCode: "",
      description: "",
    },
  },

  onShow() {
    this.loadGroups();
  },

  onDestinationKeywordInput(e) {
    this.setData({ destinationKeyword: e.detail.value });
  },

  onCreateFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({
      createForm: {
        ...this.data.createForm,
        [key]: value,
      },
    });
  },

  onCategoryChange(e) {
    const index = Number(e.detail.value);
    const option = this.data.categoryOptions[index];
    this.setData({
      categoryIndex: index,
      createForm: {
        ...this.data.createForm,
        category: option.value,
      },
    });
  },

  async loadGroups() {
    this.setData({ loading: true });
    try {
      const kw = encodeURIComponent(this.data.destinationKeyword.trim());
      const url = `/api/groups/discover?limit=20&offset=0${kw ? `&destination=${kw}` : ""}`;
      const res = await request({ url, method: "GET" });
      this.setData({
        groups: (res.items || []).map((item) => ({
          ...item,
          categoryLabel: this.data.categoryOptions.find((option) => option.value === item.category)?.label || item.category,
        })),
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载群组失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async joinGroup(e) {
    const groupId = e.currentTarget.dataset.id;
    try {
      await request({
        url: `/api/groups/${groupId}/join`,
        method: "POST",
      });
      wx.showToast({ title: "加入成功", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "加入失败", icon: "none" });
    }
  },

  async enterChat(e) {
    const groupId = e.currentTarget.dataset.id;
    const groupName = e.currentTarget.dataset.name || "群聊";
    try {
      await request({
        url: `/api/groups/${groupId}/join`,
        method: "POST",
      });
    } catch (_err) {
      // Ignore join errors here; if already a member, navigation should still continue.
    }
    wx.navigateTo({
      url: `/pages/chat/chat?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`,
    });
  },

  toggleCreate() {
    this.setData({ creating: !this.data.creating });
  },

  async createGroup() {
    if (!this.data.createForm.name.trim()) {
      wx.showToast({ title: "请输入群名称", icon: "none" });
      return;
    }
    try {
      const res = await request({
        url: "/api/groups",
        method: "POST",
        data: this.data.createForm,
      });
      if (res.moderationStatus === "approved") {
        wx.showToast({ title: "建群成功", icon: "success" });
      } else {
        wx.showToast({ title: "建群成功，等待审核", icon: "none" });
      }
      this.setData({
        creating: false,
        categoryIndex: 0,
        createForm: {
          name: "",
          category: "destination",
          destination: "",
          routeCode: "",
          description: "",
        },
      });
      this.loadGroups();
    } catch (err) {
      wx.showToast({ title: err.message || "建群失败", icon: "none" });
    }
  },
});
