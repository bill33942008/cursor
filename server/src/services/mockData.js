function makeIso(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function getMockSquarePosts() {
  return [
    {
      id: "mock-post-train-1",
      content: "G102 已检票，7 号车厢今天人不多，窗边视野很好。",
      media: ["https://picsum.photos/seed/mock-train-1/640/420"],
      visibility: "public",
      isAnonymous: false,
      moderationStatus: "approved",
      likeCount: 18,
      commentCount: 6,
      likedByMe: false,
      createdAt: makeIso(12),
      userId: "mock-user-1",
      displayName: "旅行兔",
      transportType: "high_speed_rail",
      routeCode: "G102",
      origin: "上海虹桥",
      destination: "北京南",
    },
    {
      id: "mock-post-flight-1",
      content: "MU5108 预计准点起飞，值机人流比平时快很多。",
      media: ["https://picsum.photos/seed/mock-flight-1/640/420"],
      visibility: "public",
      isAnonymous: false,
      moderationStatus: "approved",
      likeCount: 9,
      commentCount: 3,
      likedByMe: false,
      createdAt: makeIso(24),
      userId: "mock-user-2",
      displayName: "云端打卡员",
      transportType: "flight",
      routeCode: "MU5108",
      origin: "上海浦东",
      destination: "成都天府",
    },
    {
      id: "mock-post-spot-1",
      content: "西湖今天晚霞绝了，断桥这边人不算多，适合散步。",
      media: ["https://picsum.photos/seed/mock-spot-1/640/420"],
      visibility: "public",
      isAnonymous: false,
      moderationStatus: "approved",
      likeCount: 26,
      commentCount: 8,
      likedByMe: false,
      createdAt: makeIso(36),
      userId: "mock-user-3",
      displayName: "小杭同学",
      transportType: "other",
      routeCode: "",
      origin: "杭州东",
      destination: "杭州西湖",
    },
  ];
}

function getMockGroups() {
  return [
    {
      id: "mock-group-g102",
      name: "G102 同行交换站",
      category: "rail",
      destination: "北京",
      routeCode: "G102",
      description: "同车旅友路线、换乘和座位信息交流。",
      status: "active",
      expiresAt: "",
      createdAt: makeIso(60),
      ownerUserId: "mock-user-1",
      ownerNickname: "旅行兔",
      memberCount: 58,
    },
    {
      id: "mock-group-west-lake",
      name: "西湖夜游搭子群",
      category: "destination",
      destination: "杭州西湖",
      routeCode: "",
      description: "集合看日落、夜游和路线建议。",
      status: "active",
      expiresAt: "",
      createdAt: makeIso(120),
      ownerUserId: "mock-user-3",
      ownerNickname: "小杭同学",
      memberCount: 34,
    },
  ];
}

function getMockSceneTracks() {
  const tracks = [
    {
      sceneId: "mock-scene-train-g102",
      sceneType: "transport",
      transportType: "high_speed_rail",
      routeCode: "G102",
      title: "G102 同列车剧场",
      subtitle: "上海虹桥 → 北京南",
      coverEmoji: "🚄",
      promptText: "尊敬的乘客您好，您乘坐的 G102 次列车即将发车，请准备好接收旅途信息。",
      posts: [
        {
          id: "mock-post-train-1",
          userId: "mock-user-1",
          nickname: "旅行兔",
          avatarUrl: "https://i.pravatar.cc/96?img=11",
          content: "7 号车厢有充电口，靠窗位风景很好。",
          media: ["https://picsum.photos/seed/mock-train-card-1/720/420"],
          createdAt: makeIso(8),
        },
        {
          id: "mock-post-train-2",
          userId: "mock-user-4",
          nickname: "北上通勤人",
          avatarUrl: "https://i.pravatar.cc/96?img=12",
          content: "餐车现在排队不长，推荐先去买热饮。",
          media: ["https://picsum.photos/seed/mock-train-card-2/720/420"],
          createdAt: makeIso(16),
        },
      ],
    },
    {
      sceneId: "mock-scene-flight-mu5108",
      sceneType: "transport",
      transportType: "flight",
      routeCode: "MU5108",
      title: "MU5108 同航班剧场",
      subtitle: "上海浦东 → 成都天府",
      coverEmoji: "✈️",
      promptText: "登机即将开始，系好安全带，准备查看同航班旅友更新。",
      posts: [
        {
          id: "mock-post-flight-1",
          userId: "mock-user-2",
          nickname: "云端打卡员",
          avatarUrl: "https://i.pravatar.cc/96?img=21",
          content: "A 区安检比较快，登机口附近座位充足。",
          media: ["https://picsum.photos/seed/mock-flight-card-1/720/420"],
          createdAt: makeIso(14),
        },
      ],
    },
    {
      sceneId: "mock-scene-west-lake",
      sceneType: "scenic",
      transportType: "other",
      routeCode: "",
      title: "杭州西湖 场景剧场",
      subtitle: "热门目的地聚合",
      coverEmoji: "🏞️",
      promptText: "已抵达西湖场景，正在为你调取同目的地旅友动态。",
      posts: [
        {
          id: "mock-post-spot-1",
          userId: "mock-user-3",
          nickname: "小杭同学",
          avatarUrl: "https://i.pravatar.cc/96?img=31",
          content: "苏堤这段适合慢走拍照，晚霞特别好看。",
          media: ["https://picsum.photos/seed/mock-spot-card-1/720/420"],
          createdAt: makeIso(20),
        },
        {
          id: "mock-post-spot-2",
          userId: "mock-user-5",
          nickname: "风景收藏家",
          avatarUrl: "https://i.pravatar.cc/96?img=32",
          content: "雷峰塔附近夜景灯光亮了，建议 19:00 后去。",
          media: ["https://picsum.photos/seed/mock-spot-card-2/720/420"],
          createdAt: makeIso(35),
        },
      ],
    },
  ];
  return tracks.map((item) => ({
    ...item,
    postCount: (item.posts || []).length,
    lastUpdatedAt: item.posts?.[0]?.createdAt || makeIso(5),
  }));
}

module.exports = {
  getMockSquarePosts,
  getMockGroups,
  getMockSceneTracks,
};
