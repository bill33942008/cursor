const { request } = require("../../utils/request");
const app = getApp();

Page({
  data: {
    groups: [],
    currentGroup: null,
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
    groupsEntryVisible: true,
    groupsJoinEnabled: true,
    groupsCreateEnabled: true,
    groupsChatEnabled: true,
  },

  async onShow() {
    await app.loadFeatureFlags();
    this.applyFeatureFlags();
    this.syncTabBar();
    if (!this.data.groupsEntryVisible) {
      wx.showToast({ title: "当前阶段未开放群组入口", icon: "none" });
      wx.switchTab({ url: "/pages/square/square" });
      return;
    }
    this.loadGroups();
    this.loadCurrentGroup();
  },

  async onPullDownRefresh() {
    try {
      await Promise.all([this.loadGroups(), this.loadCurrentGroup()]);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 2;
    app.globalData.currentTabPath = "/pages/groups/groups";
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 2 });
    }
  },

  applyFeatureFlags() {
    this.setData({
      groupsEntryVisible: app.isFeatureEnabled("groups_entry_visible", true),
      groupsJoinEnabled: app.isFeatureEnabled("groups_join_enabled", true),
      groupsCreateEnabled: app.isFeatureEnabled("groups_create_enabled", true),
      groupsChatEnabled: app.isFeatureEnabled("groups_chat_enabled", true),
    });
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
    if (!this.data.groupsEntryVisible) {
      this.setData({ groups: [] });
      return;
    }
    this.setData({ loading: true });
    try {
      const kw = encodeURIComponent(this.data.destinationKeyword.trim());
      const url = `/api/groups/discover?limit=20&offset=0${kw ? `&keyword=${kw}` : ""}`;
      const res = await request({ url, method: "GET" });
      this.setData({
        groups: (res.items || []).map((item) => ({
          ...item,
          categoryLabel: this.data.categoryOptions.find((option) => option.value === item.category)?.label || item.category,
          destinationDisplay: item.destination ? item.destination : "未设置目的地",
        })),
      });
    } catch (err) {
      wx.showToast({ title: err.message || "加载群组失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadCurrentGroup() {
    if (!app.globalData.token) {
      this.setData({ currentGroup: null });
      return;
    }
    try {
      const res = await request({
        url: "/api/groups/current",
        method: "GET",
      });
      this.setData({
        currentGroup: res.group
          ? {
              ...res.group,
              messageCount24hDisplay: Number(res.group.messageCount24h || 0),
            }
          : null,
      });
    } catch (_err) {
      this.setData({ currentGroup: null });
    }
  },

  openCurrentGroup() {
    const group = this.data.currentGroup;
    if (!group?.id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/chat/chat?groupId=${group.id}&groupName=${encodeURIComponent(group.name || "群聊")}`,
    });
  },

  async ensureFeatureAccess(featureName) {
    if (app.globalData.token) {
      return true;
    }
    return app.ensureInteractiveAuth({ featureName });
  },

  async enterChat(e) {
    if (!this.data.groupsJoinEnabled || !this.data.groupsChatEnabled) {
      wx.showToast({ title: "当前阶段未开放群聊能力", icon: "none" });
      return;
    }
    const groupId = e.currentTarget.dataset.id;
    const groupName = e.currentTarget.dataset.name || "群聊";
    const allowed = await this.ensureFeatureAccess("进入群组聊天");
    if (!allowed) {
      return;
    }
    try {
      const res = await request({
        url: `/api/groups/${groupId}/join`,
        method: "POST",
      });
      this.setData({
        currentGroup: res.currentGroup || this.data.currentGroup,
      });
      wx.showToast({ title: "进入成功", icon: "success" });
      wx.navigateTo({
        url: `/pages/chat/chat?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`,
      });
    } catch (err) {
      wx.showToast({ title: err.message || "进入群聊失败", icon: "none" });
    }
  },

  toggleCreate() {
    if (!this.data.groupsCreateEnabled) {
      wx.showToast({ title: "当前阶段未开放建群能力", icon: "none" });
      return;
    }
    this.setData({ creating: !this.data.creating });
  },

  async createGroup() {
    if (!this.data.groupsCreateEnabled) {
      wx.showToast({ title: "当前阶段未开放建群能力", icon: "none" });
      return;
    }
    const allowed = await this.ensureFeatureAccess("创建群组");
    if (!allowed) {
      return;
    }
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
        currentGroup: res.currentGroup || this.data.currentGroup,
      });
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
      this.loadCurrentGroup();
    } catch (err) {
      wx.showToast({ title: err.message || "建群失败", icon: "none" });
    }
  },
});
