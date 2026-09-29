const express = require("express");
const { getPublicPlatformSettings } = require("../services/platformSettingsService");
const {
  listPublishedAnnouncementsForTenants,
} = require("../services/platformAnnouncementService");

const router = express.Router();

router.get("/settings", async (_req, res) => {
  try {
    const data = await getPublicPlatformSettings();
    res.json({
      success: true,
      data: data.settings,
      updated_at: data.updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/announcements", async (_req, res) => {
  try {
    const items = await listPublishedAnnouncementsForTenants();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
