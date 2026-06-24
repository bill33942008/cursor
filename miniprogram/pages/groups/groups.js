const { request } = require("../../utils/request");

Page({
  data: {
    groups: [],
    destinationKeyword: "",
    creating: false,
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

  async loadGroups() {
    try {
      const kw = encodeURIComponent(this.data.destinationKeyword.trim());
      const url = `/api/groups/discover?limit=20&offset=0${kw ? `&destination=${kw}` : ""}`;
      const res = await request({ url, method: "GET" });
      this.setData({ groups: res.items || [] });
    } catch (err) {
      wx.showToast({ title: err.message || "加载群组失败", icon: "none" });
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

  toggleCreate() {
    this.setData({ creating: !this.data.creating });
  },

  async createGroup() {
    if (!this.data.createForm.name.trim()) {
      wx.showToast({ title: "请输入群名称", icon: "none" });
      return;
    }
    try {
      await request({
        url: "/api/groups",
        method: "POST",
        data: this.data.createForm,
      });
      wx.showToast({ title: "建群成功", icon: "success" });
      this.setData({
        creating: false,
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
