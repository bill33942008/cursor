(function () {
  const state = {
    token: sessionStorage.getItem("admin_access_token") || "",
    me: null,
    refreshTimer: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    const response = await fetch(`/api/admin${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  }

  function setPanel(loggedIn) {
    $("login-panel").classList.toggle("visible", !loggedIn);
    $("dashboard-panel").classList.toggle("visible", loggedIn);
  }

  function renderStats(overview) {
    const items = [
      ["在线人数", overview.onlineUsers],
      ["连接数(WS)", overview.connectedUsers],
      ["DAU", overview.dau],
      ["MAU", overview.mau],
      ["总用户", overview.totalUsers],
      ["今日新增", overview.newUsersToday],
      ["本月新增", overview.newUsersThisMonth],
      ["待审核动态", overview.pendingPosts],
      ["待审核媒体", overview.pendingMedia],
      ["待处理举报", overview.openReports],
    ];
    $("stats-cards").innerHTML = items
      .map(
        ([k, v]) =>
          `<div class="card"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`
      )
      .join("");
  }

  function statusBadge(status) {
    const badSet = new Set(["rejected", "banned", "open", "dismissed"]);
    return `<span class="badge ${badSet.has(status) ? "bad" : ""}">${escapeHtml(status)}</span>`;
  }

  function opButton(label, action, payload) {
    const encoded = encodeURIComponent(JSON.stringify(payload || {}));
    return `<button data-action="${action}" data-payload="${encoded}">${escapeHtml(label)}</button>`;
  }

  function bindActionButtons(containerId, handler) {
    const container = $(containerId);
    container.querySelectorAll("button[data-action]").forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.action;
        const payload = JSON.parse(decodeURIComponent(button.dataset.payload || "%7B%7D"));
        try {
          await handler(action, payload, button);
          await refreshActiveTab();
          await loadOverview();
        } catch (err) {
          alert(`操作失败: ${err.message}`);
        }
      };
    });
  }

  async function loadOverview() {
    const { overview } = await api("/overview");
    renderStats(overview);
  }

  async function loadMockDataSetting() {
    const data = await api("/settings/mock-data");
    const enabled = Boolean(data.enabled);
    $("mock-data-toggle").checked = enabled;
    $("mock-data-label").textContent = enabled ? "开启" : "关闭";
  }

  async function loadUsers() {
    const keyword = $("user-keyword").value.trim();
    const status = $("user-status").value;
    const query = new URLSearchParams({ limit: "50", offset: "0", status, keyword });
    const data = await api(`/users?${query.toString()}`);
    $("users-body").innerHTML = data.items
      .map(
        (item) => `
          <tr>
            <td>
              <div>${escapeHtml(item.nickname)}</div>
              <div class="muted">${escapeHtml(item.id)}</div>
            </td>
            <td>${statusBadge(item.isBanned ? "banned" : "active")}</td>
            <td>
              <div class="user-policy">
                <span class="badge ${item.membershipTier === "vip" ? "vip" : ""}">${escapeHtml(
                  item.membershipTier === "vip" ? "VIP" : "普通"
                )}</span>
                <div class="muted">年度资料修改：${escapeHtml(
                  `${item.profileChangeUsedThisYear}/${item.profileChangeLimitPerYear}`
                )}</div>
                <div class="muted">剩余：${escapeHtml(item.profileChangeRemaining)}</div>
                <div class="muted">每日发帖上限：${escapeHtml(item.featurePolicy?.dailyPostLimit || "-")}</div>
                <div class="muted">每日建群上限：${escapeHtml(
                  item.featurePolicy?.dailyGroupCreateLimit || "-"
                )}</div>
                <div class="muted">剧场时间窗上限：${escapeHtml(
                  item.featurePolicy?.sceneWindowMaxMinutes || "-"
                )} 分钟</div>
              </div>
            </td>
            <td>${escapeHtml(item.lastActiveAt || "-")}</td>
            <td>${escapeHtml(item.createdAt)}</td>
            <td>
              <div class="op-group">
                ${
                  item.isBanned
                    ? opButton("解封", "user_status", { userId: item.id, ban: false })
                    : opButton("封禁", "user_status", { userId: item.id, ban: true })
                }
                ${opButton("设VIP", "user_policy", {
                  userId: item.id,
                  membershipTier: "vip",
                })}
                ${opButton("设普通", "user_policy", {
                  userId: item.id,
                  membershipTier: "normal",
                })}
              </div>
              <div class="op-group">
                ${opButton("额度+1", "user_policy", {
                  userId: item.id,
                  profileChangeLimitPerYear: Number(item.profileChangeLimitPerYear || 0) + 1,
                })}
                ${opButton("额度-1", "user_policy", {
                  userId: item.id,
                  profileChangeLimitPerYear: Math.max(Number(item.profileChangeLimitPerYear || 0) - 1, 0),
                })}
                ${opButton("重置已用", "user_policy", {
                  userId: item.id,
                  resetUsage: true,
                })}
              </div>
              <div class="op-group">
                ${opButton("VIP默认权益", "user_policy", {
                  userId: item.id,
                  membershipTier: "vip",
                  clearFeatureOverrides: true,
                })}
                ${opButton("普通默认权益", "user_policy", {
                  userId: item.id,
                  membershipTier: "normal",
                  clearFeatureOverrides: true,
                })}
                ${opButton("自定义VIP权益", "user_policy_prompt", {
                  userId: item.id,
                  currentPost: item.featurePolicy?.dailyPostLimit || 30,
                  currentGroup: item.featurePolicy?.dailyGroupCreateLimit || 10,
                  currentWindow: item.featurePolicy?.sceneWindowMaxMinutes || 10080,
                })}
              </div>
            </td>
          </tr>
        `
      )
      .join("");
    bindActionButtons("users-body", async (action, payload) => {
      if (action === "user_status") {
        await api(`/users/${payload.userId}/status`, {
          method: "POST",
          body: { ban: payload.ban, reason: payload.ban ? "manual moderation" : "manual restore" },
        });
      }
      if (action === "user_policy") {
        const body = {};
        if (payload.membershipTier) {
          body.membershipTier = payload.membershipTier;
        }
        if (typeof payload.profileChangeLimitPerYear === "number") {
          body.profileChangeLimitPerYear = payload.profileChangeLimitPerYear;
        }
        if (payload.resetUsage) {
          body.resetUsage = true;
        }
        await api(`/users/${payload.userId}/profile-policy`, {
          method: "POST",
          body,
        });
      }
      if (action === "user_policy_prompt") {
        const postLimit = Number(prompt("请输入每日发帖上限（1-500）", String(payload.currentPost || 30)));
        if (!Number.isFinite(postLimit)) return;
        const groupLimit = Number(
          prompt("请输入每日创建群组上限（1-100）", String(payload.currentGroup || 10))
        );
        if (!Number.isFinite(groupLimit)) return;
        const sceneWindowMaxMinutes = Number(
          prompt("请输入剧场最大时间窗（分钟，30-10080）", String(payload.currentWindow || 10080))
        );
        if (!Number.isFinite(sceneWindowMaxMinutes)) return;
        await api(`/users/${payload.userId}/profile-policy`, {
          method: "POST",
          body: {
            dailyPostLimit: postLimit,
            dailyGroupCreateLimit: groupLimit,
            sceneWindowMaxMinutes,
          },
        });
      }
    });
  }

  async function loadMedia() {
    const status = $("media-status").value;
    const data = await api(`/media?status=${encodeURIComponent(status)}`);
    $("media-body").innerHTML = data.items
      .map(
        (item) => `
          <tr>
            <td>
              <div><a href="${escapeHtml(item.url)}" target="_blank">查看资源</a></div>
              <div class="muted">${escapeHtml(item.id)}</div>
            </td>
            <td>${escapeHtml(item.nickname || item.userId)}</td>
            <td>${escapeHtml(item.mimeType)}</td>
            <td>${statusBadge(item.moderationStatus)}</td>
            <td>${escapeHtml(item.createdAt)}</td>
            <td>
              <div class="op-group">
                ${opButton("通过", "media_mod", { mediaId: item.id, status: "approved" })}
                ${opButton("拒绝", "media_mod", { mediaId: item.id, status: "rejected" })}
              </div>
            </td>
          </tr>
        `
      )
      .join("");
    bindActionButtons("media-body", async (action, payload) => {
      if (action === "media_mod") {
        await api(`/media/${payload.mediaId}/moderate`, {
          method: "POST",
          body: { status: payload.status, reason: "manual moderation" },
        });
      }
    });
  }

  async function loadPosts() {
    const status = $("post-status").value;
    const data = await api(`/posts?status=${encodeURIComponent(status)}`);
    $("posts-body").innerHTML = data.items
      .map(
        (item) => `
          <tr>
            <td>
              <div>${escapeHtml(item.content)}</div>
              <div class="muted">${escapeHtml(item.id)}</div>
            </td>
            <td>${escapeHtml(item.nickname || item.userId)}</td>
            <td>${statusBadge(item.moderationStatus)}</td>
            <td>${escapeHtml(item.createdAt)}</td>
            <td>
              <div class="op-group">
                ${opButton("通过", "post_mod", { postId: item.id, status: "approved" })}
                ${opButton("拒绝", "post_mod", { postId: item.id, status: "rejected" })}
              </div>
            </td>
          </tr>
        `
      )
      .join("");
    bindActionButtons("posts-body", async (action, payload) => {
      if (action === "post_mod") {
        await api(`/posts/${payload.postId}/moderate`, {
          method: "POST",
          body: { status: payload.status, reason: "manual moderation" },
        });
      }
    });
  }

  async function loadReports() {
    const status = $("report-status").value;
    const data = await api(`/reports?status=${encodeURIComponent(status)}`);
    $("reports-body").innerHTML = data.items
      .map(
        (item) => `
          <tr>
            <td>
              <div>${escapeHtml(item.targetType)}: ${escapeHtml(item.targetId)}</div>
              <div class="muted">举报人: ${escapeHtml(item.reporterUserId)}</div>
            </td>
            <td>${escapeHtml(item.reason)}</td>
            <td>${statusBadge(item.status)}</td>
            <td>${escapeHtml(item.handledByAdmin || "-")}</td>
            <td>${escapeHtml(item.createdAt)}</td>
            <td>
              <div class="op-group">
                ${opButton("已解决", "report_resolve", { reportId: item.id, status: "resolved" })}
                ${opButton("忽略", "report_resolve", { reportId: item.id, status: "dismissed" })}
              </div>
            </td>
          </tr>
        `
      )
      .join("");
    bindActionButtons("reports-body", async (action, payload) => {
      if (action === "report_resolve") {
        await api(`/reports/${payload.reportId}/resolve`, {
          method: "POST",
          body: { status: payload.status },
        });
      }
    });
  }

  function currentTab() {
    const active = document.querySelector(".tab.active");
    return active ? active.dataset.tab : "users";
  }

  async function refreshActiveTab() {
    const tab = currentTab();
    if (tab === "users") return loadUsers();
    if (tab === "media") return loadMedia();
    if (tab === "posts") return loadPosts();
    return loadReports();
  }

  async function bootstrapDashboard() {
    const meData = await api("/auth/me");
    state.me = meData.admin;
    $("admin-meta").textContent = `当前登录: ${state.me.username} (${state.me.role})`;
    await loadOverview();
    await loadMockDataSetting();
    await refreshActiveTab();

    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }
    state.refreshTimer = setInterval(async () => {
      try {
        await loadOverview();
      } catch (_err) {
        // Ignore background refresh failure.
      }
    }, 10000);
  }

  async function login(username, password) {
    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "login failed");
    }
    state.token = data.accessToken;
    sessionStorage.setItem("admin_access_token", state.token);
  }

  function logout() {
    state.token = "";
    state.me = null;
    sessionStorage.removeItem("admin_access_token");
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    setPanel(false);
  }

  function setupTabs() {
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", async () => {
        document.querySelectorAll(".tab").forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        const tab = button.dataset.tab;
        document
          .querySelectorAll(".tab-panel")
          .forEach((panel) => panel.classList.toggle("visible", panel.dataset.panel === tab));
        await refreshActiveTab();
      });
    });
  }

  function bindEvents() {
    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("login-error").textContent = "";
      try {
        await login($("username").value.trim(), $("password").value);
        setPanel(true);
        await bootstrapDashboard();
      } catch (err) {
        $("login-error").textContent = err.message || "登录失败";
      }
    });

    $("logout-btn").addEventListener("click", logout);
    $("change-password-btn").addEventListener("click", async () => {
      const oldPassword = prompt("请输入当前密码");
      if (!oldPassword) return;
      const newPassword = prompt("请输入新密码（10位以上，含大小写、数字、符号）");
      if (!newPassword) return;
      try {
        await api("/auth/change-password", {
          method: "POST",
          body: { oldPassword, newPassword },
        });
        alert("密码修改成功，请重新登录");
        logout();
      } catch (err) {
        alert(`密码修改失败: ${err.message}`);
      }
    });
    $("refresh-btn").addEventListener("click", async () => {
      await loadOverview();
      await loadMockDataSetting();
      await refreshActiveTab();
    });

    $("mock-data-toggle").addEventListener("change", async (event) => {
      const enabled = Boolean(event.target.checked);
      try {
        const data = await api("/settings/mock-data", {
          method: "POST",
          body: { enabled },
        });
        $("mock-data-toggle").checked = Boolean(data.enabled);
        $("mock-data-label").textContent = data.enabled ? "开启" : "关闭";
      } catch (err) {
        event.target.checked = !enabled;
        $("mock-data-label").textContent = event.target.checked ? "开启" : "关闭";
        alert(`切换失败: ${err.message}`);
      }
    });

    $("load-users-btn").addEventListener("click", loadUsers);
    $("load-media-btn").addEventListener("click", loadMedia);
    $("load-posts-btn").addEventListener("click", loadPosts);
    $("load-reports-btn").addEventListener("click", loadReports);
  }

  async function init() {
    setupTabs();
    bindEvents();
    if (!state.token) {
      setPanel(false);
      return;
    }
    try {
      setPanel(true);
      await bootstrapDashboard();
    } catch (_err) {
      logout();
    }
  }

  init();
})();
