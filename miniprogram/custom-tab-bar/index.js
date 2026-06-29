const TABS = [
  {
    key: "square",
    pagePath: "/pages/square/square",
    text: "发现",
    icon: "/assets/tabbar/discover-line.svg",
    activeIcon: "/assets/tabbar/discover-fill.svg",
  },
  {
    key: "publish",
    pagePath: "/pages/publish/publish",
    text: "发布",
    icon: "/assets/tabbar/publish-line.svg",
    activeIcon: "/assets/tabbar/publish-fill.svg",
  },
  {
    key: "groups",
    pagePath: "/pages/groups/groups",
    text: "群组",
    icon: "/assets/tabbar/groups-line.svg",
    activeIcon: "/assets/tabbar/groups-fill.svg",
  },
  {
    key: "profile",
    pagePath: "/pages/profile/profile",
    text: "我的",
    icon: "/assets/tabbar/profile-line.svg",
    activeIcon: "/assets/tabbar/profile-fill.svg",
  },
];

const app = getApp();

Component({
  data: {
    selected: 0,
    tabs: TABS,
  },

  methods: {
    refreshTabs() {
      const visible = app.getVisibleTabKeys ? app.getVisibleTabKeys() : {};
      const tabs = TABS.filter((item) => {
        if (item.key === "publish") return Boolean(visible.publish !== false);
        if (item.key === "groups") return Boolean(visible.groups !== false);
        if (item.key === "profile") return Boolean(visible.profile !== false);
        return true;
      });
      this.setData({ tabs });
      this.syncSelected();
    },
    syncSelected() {
      const currentPath = app.globalData.currentTabPath || "/pages/square/square";
      const index = this.data.tabs.findIndex((item) => item.pagePath === currentPath);
      this.setData({ selected: index >= 0 ? index : 0 });
    },
    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      const index = Number(event.currentTarget.dataset.index || 0);
      if (!path) return;

      const allIndex = TABS.findIndex((item) => item.pagePath === path);
      app.globalData.currentTabIndex = index;
      app.globalData.currentTabPath = path;
      if (allIndex >= 0) {
        app.globalData.currentTabIndex = allIndex;
      }
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },

  pageLifetimes: {
    show() {
      if (typeof app.loadFeatureFlags === "function") {
        app.loadFeatureFlags().then(() => this.refreshTabs());
        return;
      }
      this.refreshTabs();
    },
  },

  lifetimes: {
    attached() {
      this.refreshTabs();
    },
  },
});
