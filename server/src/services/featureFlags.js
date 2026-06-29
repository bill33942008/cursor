const { MOCK_DATA_KEY, getSetting, setSetting } = require("./appSettings");

const FLAG_SETTING_PREFIX = "feature_flag.";

const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "square_feed_visible",
    label: "广场内容流可见",
    module: "square",
    moduleLabel: "广场",
    page: "广场页",
    control: "动态列表",
    description: "控制广场主内容流是否展示。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "square_scene_theater_visible",
    label: "聚合剧场入口可见",
    module: "square",
    moduleLabel: "广场",
    page: "广场页",
    control: "同程聚合剧场入口",
    description: "控制广场头部剧场入口是否展示和可进入。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "square_like_enabled",
    label: "广场点赞按钮启用",
    module: "square",
    moduleLabel: "广场",
    page: "广场页",
    control: "点赞按钮",
    description: "关闭后前后端都不允许点赞。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "square_comment_enabled",
    label: "广场评论能力启用",
    module: "square",
    moduleLabel: "广场",
    page: "广场页",
    control: "评论展开/发布",
    description: "关闭后不允许查看评论区或发表评论。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "square_share_enabled",
    label: "广场复制分享启用",
    module: "square",
    moduleLabel: "广场",
    page: "广场页",
    control: "复制分享按钮",
    description: "控制广场内容复制分享按钮。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "publish_entry_visible",
    label: "发布页入口可见",
    module: "publish",
    moduleLabel: "发布",
    page: "底部Tab-发布",
    control: "发布入口",
    description: "控制发布Tab是否对用户展示。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "publish_submit_enabled",
    label: "发布提交启用",
    module: "publish",
    moduleLabel: "发布",
    page: "发布页",
    control: "发布按钮/提交接口",
    description: "关闭后前端不可提交，后端也拒绝创建动态。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "groups_entry_visible",
    label: "群组页入口可见",
    module: "groups",
    moduleLabel: "群组",
    page: "底部Tab-群组",
    control: "群组入口",
    description: "控制群组Tab是否展示。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "groups_join_enabled",
    label: "进入群聊(自动加群)启用",
    module: "groups",
    moduleLabel: "群组",
    page: "群组页",
    control: "进入群聊按钮",
    description: "关闭后禁止加入群组。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "groups_create_enabled",
    label: "创建群组启用",
    module: "groups",
    moduleLabel: "群组",
    page: "群组页",
    control: "我要建群/发布群组",
    description: "关闭后不允许新建群组。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "groups_chat_enabled",
    label: "群聊消息能力启用",
    module: "groups",
    moduleLabel: "群组",
    page: "群聊页",
    control: "消息拉取/发送",
    description: "关闭后禁止进入群聊和消息交互。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "groups_anonymous_chat_enabled",
    label: "群聊匿名发送启用",
    module: "groups",
    moduleLabel: "群组",
    page: "群聊页",
    control: "匿名发送开关",
    description: "关闭后群聊中不允许匿名发言。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "profile_entry_visible",
    label: "我的页入口可见",
    module: "profile",
    moduleLabel: "个人中心",
    page: "底部Tab-我的",
    control: "我的入口",
    description: "控制个人中心Tab是否展示。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "profile_social_enabled",
    label: "个人中心社交区块启用",
    module: "profile",
    moduleLabel: "个人中心",
    page: "我的页",
    control: "好友/申请列表",
    description: "关闭后隐藏好友与申请社交模块。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "timeline_manage_enabled",
    label: "我的时间线管理启用",
    module: "profile",
    moduleLabel: "个人中心",
    page: "我的页",
    control: "我的时间线入口",
    description: "关闭后个人时间线管理入口不可用。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "social_profile_view_enabled",
    label: "他人主页跳转启用",
    module: "profile",
    moduleLabel: "个人中心",
    page: "广场/好友列表",
    control: "查看他人主页",
    description: "关闭后不可查看其他用户主页。",
    defaultEnabled: true,
    clientVisible: true,
  },
  {
    key: "mock_data_enabled",
    settingKey: MOCK_DATA_KEY,
    label: "Mock测试数据注入",
    module: "system",
    moduleLabel: "系统",
    page: "全局",
    control: "Mock数据注入",
    description: "开启后接口会混入示例测试数据。",
    defaultEnabled: false,
    clientVisible: true,
  },
];

const FEATURE_FLAG_INDEX = new Map(FEATURE_FLAG_DEFINITIONS.map((item) => [item.key, item]));

const FEATURE_STAGE_PRESETS = [
  {
    key: "m1_tool_launch",
    label: "M1 工具版上架",
    description: "保留工具属性，关闭明显社交互动能力。",
    values: {
      square_feed_visible: true,
      square_scene_theater_visible: false,
      square_like_enabled: false,
      square_comment_enabled: false,
      square_share_enabled: false,
      publish_entry_visible: false,
      publish_submit_enabled: false,
      groups_entry_visible: false,
      groups_join_enabled: false,
      groups_create_enabled: false,
      groups_chat_enabled: false,
      groups_anonymous_chat_enabled: false,
      profile_entry_visible: true,
      profile_social_enabled: false,
      timeline_manage_enabled: true,
      social_profile_view_enabled: false,
      mock_data_enabled: false,
    },
  },
  {
    key: "m2_compliance_mode",
    label: "M2 资质准备版",
    description: "逐步恢复内容生产能力，社交互动仍受限。",
    values: {
      square_feed_visible: true,
      square_scene_theater_visible: true,
      square_like_enabled: false,
      square_comment_enabled: false,
      square_share_enabled: false,
      publish_entry_visible: true,
      publish_submit_enabled: true,
      groups_entry_visible: false,
      groups_join_enabled: false,
      groups_create_enabled: false,
      groups_chat_enabled: false,
      groups_anonymous_chat_enabled: false,
      profile_entry_visible: true,
      profile_social_enabled: false,
      timeline_manage_enabled: true,
      social_profile_view_enabled: false,
      mock_data_enabled: false,
    },
  },
  {
    key: "m3_full_social",
    label: "M3 全量社交版",
    description: "全部功能开放，进入完整社交阶段。",
    values: {
      square_feed_visible: true,
      square_scene_theater_visible: true,
      square_like_enabled: true,
      square_comment_enabled: true,
      square_share_enabled: true,
      publish_entry_visible: true,
      publish_submit_enabled: true,
      groups_entry_visible: true,
      groups_join_enabled: true,
      groups_create_enabled: true,
      groups_chat_enabled: true,
      groups_anonymous_chat_enabled: true,
      profile_entry_visible: true,
      profile_social_enabled: true,
      timeline_manage_enabled: true,
      social_profile_view_enabled: true,
      mock_data_enabled: false,
    },
  },
];

const STAGE_PRESET_INDEX = new Map(FEATURE_STAGE_PRESETS.map((item) => [item.key, item]));

function toBoolean(value, fallbackValue) {
  if (value === undefined || value === null || value === "") {
    return Boolean(fallbackValue);
  }
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return Boolean(fallbackValue);
}

function getFlagStorageKey(flagDefinition) {
  return flagDefinition.settingKey || `${FLAG_SETTING_PREFIX}${flagDefinition.key}`;
}

function getFeatureFlagDefinition(key) {
  return FEATURE_FLAG_INDEX.get(String(key || "").trim()) || null;
}

function getFeatureFlagValue(key, fallbackValue) {
  const definition = getFeatureFlagDefinition(key);
  if (!definition) {
    return Boolean(fallbackValue);
  }
  const rawValue = getSetting(getFlagStorageKey(definition), "");
  return toBoolean(rawValue, definition.defaultEnabled);
}

function isFeatureEnabled(key, fallbackValue) {
  return getFeatureFlagValue(key, fallbackValue);
}

function setFeatureFlagValue(key, enabled) {
  const definition = getFeatureFlagDefinition(key);
  if (!definition) {
    throw new Error(`unsupported feature flag: ${key}`);
  }
  const normalized = Boolean(enabled);
  setSetting(getFlagStorageKey(definition), normalized ? "1" : "0");
  return normalized;
}

function getFeatureFlagCatalog(options = {}) {
  const clientOnly = Boolean(options.clientOnly);
  return FEATURE_FLAG_DEFINITIONS.filter((item) => !clientOnly || item.clientVisible).map((item) => ({
    ...item,
    enabled: getFeatureFlagValue(item.key),
  }));
}

function getFeatureFlagsSnapshot(options = {}) {
  const snapshot = {};
  getFeatureFlagCatalog(options).forEach((item) => {
    snapshot[item.key] = Boolean(item.enabled);
  });
  return snapshot;
}

function getFeatureModules(options = {}) {
  const clientOnly = Boolean(options.clientOnly);
  const moduleMap = new Map();
  FEATURE_FLAG_DEFINITIONS.filter((item) => !clientOnly || item.clientVisible).forEach((item) => {
    if (!moduleMap.has(item.module)) {
      moduleMap.set(item.module, {
        module: item.module,
        moduleLabel: item.moduleLabel,
      });
    }
  });
  return Array.from(moduleMap.values());
}

function getFeatureStagePresets() {
  return FEATURE_STAGE_PRESETS.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
  }));
}

function applyFeatureStagePreset(stageKey) {
  const preset = STAGE_PRESET_INDEX.get(String(stageKey || "").trim());
  if (!preset) {
    throw new Error("unsupported stage preset");
  }
  Object.keys(preset.values).forEach((key) => {
    setFeatureFlagValue(key, Boolean(preset.values[key]));
  });
  return {
    stageKey: preset.key,
    stageLabel: preset.label,
    values: getFeatureFlagsSnapshot(),
  };
}

function detectMatchedStage(snapshot) {
  const keys = Object.keys(snapshot || {});
  for (const preset of FEATURE_STAGE_PRESETS) {
    const matched = keys.every((key) => {
      if (preset.values[key] === undefined) {
        return true;
      }
      return Boolean(snapshot[key]) === Boolean(preset.values[key]);
    });
    if (matched) {
      return { stageKey: preset.key, stageLabel: preset.label };
    }
  }
  return { stageKey: "custom", stageLabel: "自定义策略" };
}

function getFeatureStageSummary(options = {}) {
  const snapshot = getFeatureFlagsSnapshot(options);
  const matched = detectMatchedStage(snapshot);
  return {
    ...matched,
    values: snapshot,
  };
}

module.exports = {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_STAGE_PRESETS,
  getFeatureFlagDefinition,
  getFeatureFlagValue,
  isFeatureEnabled,
  setFeatureFlagValue,
  getFeatureFlagCatalog,
  getFeatureFlagsSnapshot,
  getFeatureModules,
  getFeatureStagePresets,
  applyFeatureStagePreset,
  getFeatureStageSummary,
};
