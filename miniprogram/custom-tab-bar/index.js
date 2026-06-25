const TABS = [
  {
    pagePath: "/pages/square/square",
    text: "发现",
    icon: "/assets/tabbar/discover-line.svg",
    activeIcon: "/assets/tabbar/discover-fill.svg",
  },
  {
    pagePath: "/pages/publish/publish",
    text: "发布",
    icon: "/assets/tabbar/publish-line.svg",
    activeIcon: "/assets/tabbar/publish-fill.svg",
  },
  {
    pagePath: "/pages/groups/groups",
    text: "群组",
    icon: "/assets/tabbar/groups-line.svg",
    activeIcon: "/assets/tabbar/groups-fill.svg",
  },
  {
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
    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      const index = Number(event.currentTarget.dataset.index);
      if (!path) return;

      // Write to global BEFORE wx.switchTab so every tabBar instance
      // (including the one on the target page) reads the correct value
      // in pageLifetimes.show().
      app.globalData.currentTabIndex = index;
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },

  pageLifetimes: {
    show() {
      // Each tab page has its own tabBar component instance.
      // Reading from globalData (already updated by switchTab or by the
      // page's own onShow) ensures all instances stay in sync.
      const index = app.globalData.currentTabIndex || 0;
      if (this.data.selected !== index) {
        this.setData({ selected: index });
      }
    },
  },

  lifetimes: {
    attached() {
      const index = app.globalData.currentTabIndex || 0;
      if (this.data.selected !== index) {
        this.setData({ selected: index });
      }
    },
  },
});
