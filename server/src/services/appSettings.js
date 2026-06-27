const { db } = require("../db");

const MOCK_DATA_KEY = "mock_data_enabled";

function getSetting(key, fallbackValue = "") {
  const row = db
    .prepare("SELECT setting_value AS value FROM app_settings WHERE setting_key = ?")
    .get(key);
  if (!row) {
    return fallbackValue;
  }
  return row.value;
}

function setSetting(key, value) {
  db.prepare(
    `
    INSERT INTO app_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = datetime('now')
    `
  ).run(key, String(value));
}

function isMockDataEnabled() {
  const value = String(getSetting(MOCK_DATA_KEY, "0")).trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function setMockDataEnabled(enabled) {
  setSetting(MOCK_DATA_KEY, enabled ? "1" : "0");
}

module.exports = {
  getSetting,
  setSetting,
  isMockDataEnabled,
  setMockDataEnabled,
  MOCK_DATA_KEY,
};
