const { db } = require("../db");

const MEMBERSHIP_TIERS = new Set(["normal", "vip"]);
const FEATURE_POLICY_LIMITS = {
  dailyPostLimit: { min: 1, max: 500 },
  dailyGroupCreateLimit: { min: 1, max: 100 },
  sceneWindowMaxMinutes: { min: 30, max: 10080 },
};

function getCurrentCycleYear() {
  return new Date().getFullYear();
}

function normalizeMembershipTier(value) {
  const tier = String(value || "").trim().toLowerCase();
  return MEMBERSHIP_TIERS.has(tier) ? tier : "normal";
}

function getDefaultProfileChangeLimit(tier) {
  return normalizeMembershipTier(tier) === "vip" ? 6 : 2;
}

function getTierFeatureDefaults(tier) {
  const normalizedTier = normalizeMembershipTier(tier);
  if (normalizedTier === "vip") {
    return {
      dailyPostLimit: 30,
      dailyGroupCreateLimit: 10,
      sceneWindowMaxMinutes: 10080,
    };
  }
  return {
    dailyPostLimit: 5,
    dailyGroupCreateLimit: 2,
    sceneWindowMaxMinutes: 1440,
  };
}

function clampFeatureValue(field, value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const spec = FEATURE_POLICY_LIMITS[field];
  if (!spec) {
    return Math.max(0, Math.floor(numeric));
  }
  const normalized = Math.floor(numeric);
  return Math.min(Math.max(normalized, spec.min), spec.max);
}

function loadPolicyRow(userId) {
  return db
    .prepare(
      `
      SELECT
        id,
        membership_tier AS membershipTier,
        profile_change_limit_per_year AS profileChangeLimitPerYear,
        profile_change_used_this_year AS profileChangeUsedThisYear,
        profile_change_cycle_year AS profileChangeCycleYear,
        daily_post_limit_override AS dailyPostLimitOverride,
        daily_group_create_limit_override AS dailyGroupCreateLimitOverride,
        scene_window_max_minutes_override AS sceneWindowMaxMinutesOverride
      FROM users
      WHERE id = ?
      `
    )
    .get(userId);
}

function syncProfileChangeCycle(userId) {
  const currentYear = getCurrentCycleYear();
  const current = loadPolicyRow(userId);
  if (!current) {
    return null;
  }
  if (Number(current.profileChangeCycleYear || 0) === currentYear) {
    return current;
  }
  db.prepare(
    `
    UPDATE users
    SET profile_change_used_this_year = 0,
        profile_change_cycle_year = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(currentYear, userId);
  return loadPolicyRow(userId);
}

function formatProfilePolicy(row) {
  if (!row) return null;
  const membershipTier = normalizeMembershipTier(row.membershipTier);
  const profileChangeLimitPerYear = Math.max(
    0,
    Number(row.profileChangeLimitPerYear || getDefaultProfileChangeLimit(membershipTier))
  );
  const profileChangeUsedThisYear = Math.max(0, Number(row.profileChangeUsedThisYear || 0));
  return {
    membershipTier,
    profileChangeLimitPerYear,
    profileChangeUsedThisYear,
    remainingChanges: Math.max(profileChangeLimitPerYear - profileChangeUsedThisYear, 0),
    cycleYear: Number(row.profileChangeCycleYear || getCurrentCycleYear()),
  };
}

function formatFeaturePolicy(row) {
  if (!row) return null;
  const membershipTier = normalizeMembershipTier(row.membershipTier);
  const defaults = getTierFeatureDefaults(membershipTier);
  const dailyPostLimit = clampFeatureValue(
    "dailyPostLimit",
    row.dailyPostLimitOverride,
    defaults.dailyPostLimit
  );
  const dailyGroupCreateLimit = clampFeatureValue(
    "dailyGroupCreateLimit",
    row.dailyGroupCreateLimitOverride,
    defaults.dailyGroupCreateLimit
  );
  const sceneWindowMaxMinutes = clampFeatureValue(
    "sceneWindowMaxMinutes",
    row.sceneWindowMaxMinutesOverride,
    defaults.sceneWindowMaxMinutes
  );
  return {
    membershipTier,
    dailyPostLimit,
    dailyGroupCreateLimit,
    sceneWindowMaxMinutes,
    hasCustomPostLimit: row.dailyPostLimitOverride !== null && row.dailyPostLimitOverride !== undefined,
    hasCustomGroupCreateLimit:
      row.dailyGroupCreateLimitOverride !== null && row.dailyGroupCreateLimitOverride !== undefined,
    hasCustomSceneWindow:
      row.sceneWindowMaxMinutesOverride !== null && row.sceneWindowMaxMinutesOverride !== undefined,
  };
}

function getUserFeatureUsage(userId) {
  const dailyPostsUsedToday = Number(
    db
      .prepare(
        `
        SELECT COUNT(1) AS c
        FROM posts
        WHERE user_id = ?
          AND date(created_at) = date('now')
        `
      )
      .get(userId)?.c || 0
  );
  const dailyGroupsCreatedToday = Number(
    db
      .prepare(
        `
        SELECT COUNT(1) AS c
        FROM groups_table
        WHERE owner_user_id = ?
          AND date(created_at) = date('now')
        `
      )
      .get(userId)?.c || 0
  );
  return {
    dailyPostsUsedToday,
    dailyGroupsCreatedToday,
  };
}

function withFeatureUsage(featurePolicy, usage) {
  if (!featurePolicy) return null;
  const dailyPostsUsedToday = Math.max(0, Number(usage?.dailyPostsUsedToday || 0));
  const dailyGroupsCreatedToday = Math.max(0, Number(usage?.dailyGroupsCreatedToday || 0));
  return {
    ...featurePolicy,
    dailyPostsUsedToday,
    dailyGroupsCreatedToday,
    remainingPostsToday: Math.max(featurePolicy.dailyPostLimit - dailyPostsUsedToday, 0),
    remainingGroupsToday: Math.max(featurePolicy.dailyGroupCreateLimit - dailyGroupsCreatedToday, 0),
    isVip: featurePolicy.membershipTier === "vip",
  };
}

function getUserProfilePolicy(userId) {
  const row = syncProfileChangeCycle(userId);
  return formatProfilePolicy(row);
}

function getUserFeaturePolicy(userId) {
  const row = syncProfileChangeCycle(userId);
  const featurePolicy = formatFeaturePolicy(row);
  if (!featurePolicy) {
    return null;
  }
  return withFeatureUsage(featurePolicy, getUserFeatureUsage(userId));
}

function getUserPolicyBundle(userId) {
  const row = syncProfileChangeCycle(userId);
  if (!row) {
    return null;
  }
  return {
    profilePolicy: formatProfilePolicy(row),
    featurePolicy: withFeatureUsage(formatFeaturePolicy(row), getUserFeatureUsage(userId)),
  };
}

module.exports = {
  MEMBERSHIP_TIERS,
  FEATURE_POLICY_LIMITS,
  getCurrentCycleYear,
  normalizeMembershipTier,
  getDefaultProfileChangeLimit,
  getTierFeatureDefaults,
  clampFeatureValue,
  formatProfilePolicy,
  formatFeaturePolicy,
  getUserFeatureUsage,
  withFeatureUsage,
  getUserProfilePolicy,
  getUserFeaturePolicy,
  getUserPolicyBundle,
};
