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

Component({
  data: {
    selected: 0,
    tabs: TABS,
  },

  methods: {
    updateSelectedByRoute(route) {
      const selected = TABS.findIndex((tab) => tab.pagePath === route);
      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },

    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      const index = Number(event.currentTarget.dataset.index);
      if (!path) return;

      this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },

  pageLifetimes: {
    show() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current || !current.route) return;
      this.updateSelectedByRoute(`/${current.route}`);
    },
  },
});
