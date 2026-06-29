(function () {
  const state = {
    token: sessionStorage.getItem("admin_access_token") || "",
    me: null,
    refreshTimer: null,
    activePanel: "overview",
    featureFlags: [],
    featureModules: [],
    featureStage: null,
    featurePresets: [],
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
      ["群组总量", overview.totalGroups],
      ["动态总量", overview.totalPosts],
      ["消息总量", overview.totalMessages],
      ["今日新增", overview.newUsersToday],
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

  function formatVipExpiryLabel(item) {
    const rawTier = String(item.rawMembershipTier || item.membershipTier || "normal");
    if (rawTier === "normal") {
      return "非VIP";
    }
    const expiresAt = String(item.vipExpiresAt || "");
    if (!expiresAt) {
      return rawTier === "svip" ? "永久SVIP" : "永久VIP";
    }
    const text = expiresAt.replace("T", " ").slice(0, 16);
    if (item.membershipTier !== "normal") {
      return `到期：${text}`;
    }
    return `已过期：${text}`;
  }

  function tierLabel(tier) {
    const value = String(tier || "normal");
    if (value === "svip") return "SVIP";
    if (value === "vip") return "VIP";
    return "普通";
  }

  function opButton(label, action, payload, className) {
    const encoded = encodeURIComponent(JSON.stringify(payload || {}));
    return `<button class="${escapeHtml(className || "")}" data-action="${action}" data-payload="${encoded}">${escapeHtml(
      label
    )}</button>`;
  }

  function bindActionButtons(containerId, handler) {
    const container = $(containerId);
    if (!container) return;
    container.querySelectorAll("button[data-action]").forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.action;
        const payload = JSON.parse(decodeURIComponent(button.dataset.payload || "%7B%7D"));
        try {
          await handler(action, payload, button);
          await refreshActivePanel();
          await loadOverview();
        } catch (err) {
          alert(`操作失败: ${err.message}`);
        }
      };
    });
  }

  function renderStageSummary() {
    const stage = state.featureStage || {};
    const text = `${stage.stageLabel || "未知阶段"} (${stage.stageKey || "n/a"})`;
    $("feature-stage-meta").textContent = `当前策略：${text}`;
    $("overview-stage").textContent = `开关阶段：${text}`;
  }

  function renderPresetButtons() {
    $("preset-actions").innerHTML = (state.featurePresets || [])
      .map((item) =>
        opButton(
          item.label,
          "apply_preset",
          { presetKey: item.key, presetLabel: item.label },
          "stage-btn tiny-btn"
        )
      )
      .join("");
    bindActionButtons("preset-actions", async (action, payload) => {
      if (action !== "apply_preset") return;
      const ok = window.confirm(`确认应用预设：${payload.presetLabel} ?`);
      if (!ok) return;
      await api("/feature-flags/apply-preset", {
        method: "POST",
        body: { presetKey: payload.presetKey },
      });
      await loadFeatureFlags();
      await loadFeatureAudit();
      await loadMockDataSetting();
    });
  }

  function renderFeatureFlagRows() {
    const keyword = $("flag-keyword").value.trim().toLowerCase();
    const moduleFilter = $("flag-module-filter").value;
    const items = (state.featureFlags || []).filter((item) => {
      if (moduleFilter !== "all" && item.module !== moduleFilter) {
        return false;
      }
      if (!keyword) return true;
      const fields = [
        item.key,
        item.label,
        item.moduleLabel,
        item.page,
        item.control,
        item.description,
      ]
        .join(" ")
        .toLowerCase();
      return fields.includes(keyword);
    });

    $("feature-flags-body").innerHTML = items
      .map((item) => {
        const statusClass = item.enabled ? "on" : "off";
        return `
          <tr>
            <td>${escapeHtml(item.moduleLabel)}</td>
            <td>
              <div>${escapeHtml(item.page)}</div>
              <div class="muted">${escapeHtml(item.control)}</div>
            </td>
            <td><code>${escapeHtml(item.key)}</code></td>
            <td>
              <div>${escapeHtml(item.label)}</div>
              <div class="cell-note">${escapeHtml(item.description)}</div>
            </td>
            <td><span class="flag-status ${statusClass}">${item.enabled ? "已开启" : "已关闭"}</span></td>
            <td>
              ${opButton(item.enabled ? "关闭" : "开启", "feature_toggle", {
                key: item.key,
                enabled: !item.enabled,
              })}
            </td>
          </tr>
        `;
      })
      .join("");

    bindActionButtons("feature-flags-body", async (action, payload) => {
      if (action !== "feature_toggle") return;
      await api(`/feature-flags/${encodeURIComponent(payload.key)}`, {
        method: "POST",
        body: {
          enabled: Boolean(payload.enabled),
        },
      });
      await loadFeatureFlags();
      await loadFeatureAudit();
      await loadMockDataSetting();
    });
  }

  function renderFeatureModules() {
    const moduleSelect = $("flag-module-filter");
    const current = moduleSelect.value || "all";
    moduleSelect.innerHTML = `<option value="all">全部模块</option>${(state.featureModules || [])
      .map((item) => `<option value="${escapeHtml(item.module)}">${escapeHtml(item.moduleLabel)}</option>`)
      .join("")}`;
    if ([...moduleSelect.options].some((option) => option.value === current)) {
      moduleSelect.value = current;
    }
  }

  async function loadFeatureFlags() {
    const data = await api("/feature-flags");
    state.featureFlags = data.items || [];
    state.featureModules = data.modules || [];
    state.featureStage = data.stage || null;
    state.featurePresets = data.presets || [];
    renderFeatureModules();
    renderStageSummary();
    renderPresetButtons();
    renderFeatureFlagRows();
  }

  function describeAuditAction(item) {
    if (item.actionType === "apply_feature_preset") {
      return "应用阶段预设";
    }
    if (item.actionType === "toggle_mock_data") {
      return "切换Mock数据";
    }
    if (item.actionType === "update_feature_flag") {
      return "更新功能开关";
    }
    return item.actionType || "unknown";
  }

  async function loadFeatureAudit() {
    const data = await api("/feature-flags/audit?limit=50");
    $("feature-audit-body").innerHTML = (data.items || [])
      .map((item) => {
        const payload = item.payload || {};
        const adminId = payload.adminId || "-";
        const details = escapeHtml(JSON.stringify(payload.payload || {}));
        return `
          <tr>
            <td>${escapeHtml(item.createdAt)}</td>
            <td>${escapeHtml(describeAuditAction(item))}</td>
            <td>${escapeHtml(item.targetId || "-")}</td>
            <td>${escapeHtml(adminId)}</td>
            <td><code>${details}</code></td>
          </tr>
        `;
      })
      .join("");
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
                <span class="badge ${item.membershipTier === "svip" ? "svip" : item.membershipTier === "vip" ? "vip" : ""}">${escapeHtml(
                  tierLabel(item.membershipTier)
                )}</span>
                <div class="muted">${escapeHtml(formatVipExpiryLabel(item))}</div>
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
                ${opButton("设SVIP", "user_policy", {
                  userId: item.id,
                  membershipTier: "svip",
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
                ${opButton("SVIP默认权益", "user_policy", {
                  userId: item.id,
                  membershipTier: "svip",
                  clearFeatureOverrides: true,
                })}
                ${opButton("VIP+30天", "user_policy", {
                  userId: item.id,
                  grantVipDays: 30,
                })}
                ${opButton("VIP+90天", "user_policy", {
                  userId: item.id,
                  grantVipDays: 90,
                })}
                ${opButton("SVIP+30天", "user_policy", {
                  userId: item.id,
                  membershipTier: "svip",
                  grantVipDays: 30,
                })}
                ${opButton("永久VIP", "user_policy", {
                  userId: item.id,
                  membershipTier: "vip",
                  makeVipPermanent: true,
                })}
                ${opButton("永久SVIP", "user_policy", {
                  userId: item.id,
                  membershipTier: "svip",
                  makeVipPermanent: true,
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
        if (typeof payload.grantVipDays === "number") {
          body.grantVipDays = payload.grantVipDays;
        }
        if (payload.makeVipPermanent) {
          body.makeVipPermanent = true;
        }
        if (payload.clearFeatureOverrides) {
          body.clearFeatureOverrides = true;
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

  function setActivePanel(panelKey) {
    state.activePanel = panelKey;
    document.querySelectorAll(".menu-item-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.panelTarget === panelKey);
    });
    document.querySelectorAll(".content-panel").forEach((panel) => {
      panel.classList.toggle("visible", panel.dataset.panel === panelKey);
    });
  }

  async function refreshActivePanel() {
    if (state.activePanel === "users") return loadUsers();
    if (state.activePanel === "media") return loadMedia();
    if (state.activePanel === "posts") return loadPosts();
    if (state.activePanel === "reports") return loadReports();
    if (state.activePanel === "feature-flags") {
      await loadFeatureFlags();
      return loadFeatureAudit();
    }
    if (state.activePanel === "overview") {
      await loadMockDataSetting();
      if (!state.featureStage) {
        await loadFeatureFlags();
      } else {
        renderStageSummary();
      }
    }
  }

  async function bootstrapDashboard() {
    const meData = await api("/auth/me");
    state.me = meData.admin;
    $("admin-meta").textContent = `当前登录: ${state.me.username} (${state.me.role})`;
    await loadOverview();
    await loadMockDataSetting();
    await loadFeatureFlags();
    await refreshActivePanel();

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
    state.featureFlags = [];
    state.featureModules = [];
    state.featureStage = null;
    state.featurePresets = [];
    sessionStorage.removeItem("admin_access_token");
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    setPanel(false);
  }

  function setupMenuNavigation() {
    document.querySelectorAll(".menu-item-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const panelKey = button.dataset.panelTarget;
        if (!panelKey) return;
        setActivePanel(panelKey);
        await refreshActivePanel();
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
      await refreshActivePanel();
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
        await loadFeatureFlags();
        if (state.activePanel === "feature-flags") {
          await loadFeatureAudit();
        }
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
    $("load-flags-btn").addEventListener("click", renderFeatureFlagRows);
    $("flag-module-filter").addEventListener("change", renderFeatureFlagRows);
  }

  async function init() {
    setupMenuNavigation();
    bindEvents();
    setActivePanel(state.activePanel);
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
