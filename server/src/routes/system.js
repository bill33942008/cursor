const express = require("express");
const {
  getFeatureFlagCatalog,
  getFeatureFlagsSnapshot,
  getFeatureStageSummary,
} = require("../services/featureFlags");

const router = express.Router();

router.get("/feature-flags", (_req, res) => {
  const catalog = getFeatureFlagCatalog({ clientOnly: true }).map((item) => ({
    key: item.key,
    label: item.label,
    module: item.module,
    moduleLabel: item.moduleLabel,
    page: item.page,
    control: item.control,
    enabled: Boolean(item.enabled),
  }));

  res.json({
    flags: getFeatureFlagsSnapshot({ clientOnly: true }),
    stage: getFeatureStageSummary({ clientOnly: true }),
    catalog,
    fetchedAt: new Date().toISOString(),
  });
});

module.exports = router;
