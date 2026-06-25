const { request } = require("../../utils/request");
const app = getApp();

function resolveMediaUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${app.globalData.baseUrl}${url}`;
}

function resolveMediaItems(mediaList) {
  let previewIndex = 0;
  return (mediaList || []).map((mediaUrl) => {
    const url = resolveMediaUrl(mediaUrl);
    const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
    const item = {
      url,
      type: isVideo ? "video" : "image",
      previewIndex: -1,
    };
    if (!isVideo) {
      item.previewIndex = previewIndex;
      previewIndex += 1;
    }
    return item;
  });
}

function estimatePostWeight(post) {
  const textWeight = Math.min((post.content || "").length, 180) * 0.65;
  const mediaWeight = (post.mediaItems || []).reduce((acc, media) => {
    if (media.type === "video") return acc + 180;
    return acc + 95;
  }, 0);
  const tagWeight = post.transportType ? 30 : 0;
  return 220 + textWeight + mediaWeight + tagWeight;
}

function splitWaterfall(posts) {
  const left = [];
  const right = [];
  let leftWeight = 0;
  let rightWeight = 0;

  posts.forEach((post) => {
    const weight = estimatePostWeight(post);
    if (leftWeight <= rightWeight) {
      left.push(post);
      leftWeight += weight;
    } else {
      right.push(post);
      rightWeight += weight;
    }
  });
  return { left, right };
}

function normalizeReply(reply) {
  return {
    ...reply,
    replies: [],
    replyToDisplayName: reply.replyToDisplayName || "",
  };
}

function normalizeComment(comment) {
  return {
    ...comment,
    replies: (comment.replies || []).map(normalizeReply),
  };
}

function appendCommentToTree(comments, comment) {
  if (!comment.parentCommentId) {
    return [...comments, normalizeComment(comment)];
  }
  let matched = false;
  return comments.map((item) => {
    if (item.id !== comment.parentCommentId) {
      return item;
    }
    matched = true;
    return {
      ...item,
      replies: [...(item.replies || []), normalizeReply(comment)],
    };
  }).concat(matched ? [] : [normalizeComment({ ...comment, parentCommentId: "" })]);
}

Page({
  data: {
    loading: false,
    posts: [],
    leftPosts: [],
    rightPosts: [],
    skeletonRows: [1, 2, 3, 4],
    error: "",
  },

  onShow() {
    this.syncTabBar();
    this.bootstrap();
  },

  syncTabBar() {
    app.globalData.currentTabIndex = 0;
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (tabBar && typeof tabBar.setData === "function") {
      tabBar.setData({ selected: 0 });
    }
  },

  async bootstrap() {
    this.setData({ loading: true, error: "" });
    try {
      if (!app.globalData.token) {
        await app.ensureAuthSession();
      }
      await this.loadSquare();
    } catch (err) {
      this.setData({ error: err.message || "加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadSquare() {
    const res = await request({
      url: "/api/posts/square?limit=20&offset=0",
      method: "GET",
    });
    const posts = (res.items || []).map((item) => {
      const mediaItems = resolveMediaItems(item.media || []);
      return {
        ...item,
        likeCount: Number(item.likeCount || 0),
        commentCount: Number(item.commentCount || 0),
        comments: [],
        commentsVisible: false,
        commentsLoading: false,
        commentDraft: "",
        commentPlaceholder: "写下你的评论...",
        replyTarget: null,
        mediaItems,
        imageUrls: mediaItems.filter((media) => media.type === "image").map((media) => media.url),
      };
    });
    this.applyPosts(posts);
  },

  applyPosts(posts) {
    const { left, right } = splitWaterfall(posts);
    this.setData({
      posts,
      leftPosts: left,
      rightPosts: right,
    });
  },

  updatePost(postId, updater) {
    const nextPosts = this.data.posts.map((post) => (post.id === postId ? updater(post) : post));
    this.applyPosts(nextPosts);
  },

  openUserProfile(e) {
    const userId = e.currentTarget.dataset.userid;
    const postId = e.currentTarget.dataset.postid;
    const post = this.data.posts.find((item) => item.id === postId);
    if (post && post.isAnonymous) {
      wx.showToast({ title: "匿名内容暂不支持查看主页", icon: "none" });
      return;
    }
    if (!userId) return;
    wx.navigateTo({
      url: `/pages/user/public?userId=${userId}`,
    });
  },

  async loadPostComments(postId) {
    this.updatePost(postId, (post) => ({
      ...post,
      commentsLoading: true,
    }));
    try {
      const res = await request({
        url: `/api/posts/${postId}/comments?limit=20&offset=0`,
        method: "GET",
      });
      this.updatePost(postId, (post) => ({
        ...post,
        commentsLoading: false,
        comments: (res.items || []).map(normalizeComment),
      }));
    } catch (err) {
      this.updatePost(postId, (post) => ({
        ...post,
        commentsLoading: false,
      }));
      wx.showToast({ title: err.message || "加载评论失败", icon: "none" });
    }
  },

  async toggleComments(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) return;
    const target = this.data.posts.find((post) => post.id === postId);
    if (!target) return;

    if (!target.commentsVisible) {
      this.updatePost(postId, (post) => ({
        ...post,
        commentsVisible: true,
      }));
      if (!target.comments || target.comments.length === 0) {
        await this.loadPostComments(postId);
      }
      return;
    }

    this.updatePost(postId, (post) => ({
      ...post,
      commentsVisible: false,
      replyTarget: null,
      commentPlaceholder: "写下你的评论...",
    }));
  },

  onCommentInput(e) {
    const postId = e.currentTarget.dataset.id;
    const value = e.detail.value;
    this.updatePost(postId, (post) => ({
      ...post,
      commentDraft: value,
    }));
  },

  beginReply(e) {
    const postId = e.currentTarget.dataset.postid;
    const commentId = e.currentTarget.dataset.commentid;
    const replyToUserId = e.currentTarget.dataset.replytouserid;
    const replyToName = e.currentTarget.dataset.replytoname || "旅友";
    if (!postId || !commentId || !replyToUserId) return;
    this.updatePost(postId, (post) => ({
      ...post,
      replyTarget: {
        parentCommentId: commentId,
        replyToUserId,
        replyToName,
      },
      commentPlaceholder: `回复 @${replyToName}`,
      commentDraft: (post.commentDraft || "").trim() ? post.commentDraft : `@${replyToName} `,
    }));
  },

  clearReplyTarget(e) {
    const postId = e.currentTarget.dataset.postid;
    if (!postId) return;
    this.updatePost(postId, (post) => ({
      ...post,
      replyTarget: null,
      commentPlaceholder: "写下你的评论...",
    }));
  },

  async submitComment(e) {
    const postId = e.currentTarget.dataset.id;
    const target = this.data.posts.find((post) => post.id === postId);
    if (!target) return;
    const content = (target.commentDraft || "").trim();
    if (!content) {
      wx.showToast({ title: "请输入评论内容", icon: "none" });
      return;
    }
    try {
      const res = await request({
        url: `/api/posts/${postId}/comments`,
        method: "POST",
        data: {
          content,
          isAnonymous: false,
          parentCommentId: target.replyTarget?.parentCommentId,
          replyToUserId: target.replyTarget?.replyToUserId,
        },
      });
      this.updatePost(postId, (post) => ({
        ...post,
        commentDraft: "",
        replyTarget: null,
        commentPlaceholder: "写下你的评论...",
        commentCount: post.commentCount + 1,
        comments: appendCommentToTree(post.comments || [], res.comment),
      }));
      wx.showToast({ title: "评论成功", icon: "success" });
    } catch (err) {
      wx.showToast({ title: err.message || "评论失败", icon: "none" });
    }
  },

  previewMedia(e) {
    const postId = e.currentTarget.dataset.postid;
    const current = Number(e.currentTarget.dataset.previewIndex);
    const post = this.data.posts.find((item) => item.id === postId);
    if (!post || !post.imageUrls || post.imageUrls.length === 0 || current < 0) {
      return;
    }
    wx.previewImage({
      current: post.imageUrls[current],
      urls: post.imageUrls,
    });
  },

  async likePost(e) {
    const postId = e.currentTarget.dataset.id;
    if (!postId) return;
    try {
      await request({
        url: `/api/posts/${postId}/like`,
        method: "POST",
      });
      wx.showToast({ title: "已点赞", icon: "success" });
      this.updatePost(postId, (post) => ({
        ...post,
        likeCount: post.likeCount + 1,
      }));
    } catch (err) {
      wx.showToast({ title: err.message || "点赞失败", icon: "none" });
    }
  },

  onShareTap(e) {
    const postId = e.currentTarget.dataset.id;
    const post = this.data.posts.find((item) => item.id === postId);
    if (!post) return;
    wx.setClipboardData({
      data: `${post.displayName}: ${post.content}`,
      success: () => wx.showToast({ title: "内容已复制", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
});
