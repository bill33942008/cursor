const { db } = require("../db");

const MEMBERSHIP_TIERS = new Set(["normal", "vip"]);

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

function loadPolicyRow(userId) {
  return db
    .prepare(
      `
      SELECT
        id,
        membership_tier AS membershipTier,
        profile_change_limit_per_year AS profileChangeLimitPerYear,
        profile_change_used_this_year AS profileChangeUsedThisYear,
        profile_change_cycle_year AS profileChangeCycleYear
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

function getUserProfilePolicy(userId) {
  const row = syncProfileChangeCycle(userId);
  return formatProfilePolicy(row);
}

module.exports = {
  MEMBERSHIP_TIERS,
  getCurrentCycleYear,
  normalizeMembershipTier,
  getDefaultProfileChangeLimit,
  formatProfilePolicy,
  getUserProfilePolicy,
};
