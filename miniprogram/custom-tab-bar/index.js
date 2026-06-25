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
    // Called by each tab page's onShow() to keep state in sync
    setSelected(index) {
      if (index !== this.data.selected) {
        this.setData({ selected: index });
      }
    },

    switchTab(event) {
      const path = event.currentTarget.dataset.path;
      const index = Number(event.currentTarget.dataset.index);
      if (!path) return;

      // Update visual state immediately on tap — do not wait for navigation
      this.setData({ selected: index });
      wx.switchTab({ url: path });
    },
  },

  // pageLifetimes.show() is intentionally removed.
  // It fires while wx.switchTab is still in flight, so getCurrentPages()
  // may still point to the outgoing page and overwrite the correct index.
  // Each tab page calls tabBar.setSelected(n) inside its own onShow() instead.

  lifetimes: {
    attached() {
      // Sync on first mount in case the component attaches after the page shows
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (!current || !current.route) return;
      const index = TABS.findIndex((tab) => tab.pagePath === `/${current.route}`);
      if (index >= 0) {
        this.setData({ selected: index });
      }
    },
  },
});
