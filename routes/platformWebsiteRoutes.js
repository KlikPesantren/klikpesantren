const express = require("express");
const multer = require("multer");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { uploadImageBuffer } = require("../services/cloudinaryUploadService");
const {
  getPublishedWebsiteContent,
  getWebsiteSettingsForPlatform,
  publishWebsiteContent,
  updateWebsiteDraft,
} = require("../services/platformWebsiteService");

const platformRouter = express.Router();
const publicRouter = express.Router();
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ALLOWED_IMAGE_TYPES.has(file.mimetype);
    callback(allowed ? null : new Error("Format gambar tidak didukung"), allowed);
  },
});

publicRouter.get("/content", async (_req, res) => {
  try {
    const data = await getPublishedWebsiteContent();
    res.json({
      success: true,
      data: data.content,
      updated_at: data.updated_at,
      published_at: data.published_at,
    });
  } catch (err) {
    console.error("[publicWebsiteContent]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

platformRouter.use(platformAuthMiddleware);

platformRouter.get("/content", async (_req, res) => {
  try {
    const data = await getWebsiteSettingsForPlatform();
    res.json({ success: true, data });
  } catch (err) {
    console.error("[platformWebsiteContent]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

platformRouter.post("/assets", (req, res) => {
  upload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE"
        ? "Ukuran gambar maksimal 5MB"
        : uploadError.message || "Upload gambar gagal";
      return res.status(400).json({ success: false, error: message });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: "File gambar wajib dipilih" });
    }

    try {
      const result = await uploadImageBuffer(req.file.buffer, {
        originalName: req.file.originalname,
      });
      return res.json({
        success: true,
        data: { url: result.secure_url, public_id: result.public_id },
      });
    } catch (error) {
      console.error("[platformWebsiteAssetUpload]", error);
      return res.status(500).json({
        success: false,
        error: error.code === "CLOUDINARY_NOT_CONFIGURED"
          ? error.message
          : "Upload gambar gagal",
      });
    }
  });
});

platformRouter.put("/content", async (req, res) => {
  try {
    const data = await updateWebsiteDraft(
      req.body?.content,
      req.platformUser?.id
    );
    res.json({ success: true, data });
  } catch (err) {
    console.error("[platformWebsiteUpdate]", err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  }
});

platformRouter.post("/publish", async (req, res) => {
  try {
    const data = await publishWebsiteContent(req.platformUser?.id);
    res.json({ success: true, data });
  } catch (err) {
    console.error("[platformWebsitePublish]", err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = {
  platformWebsiteRoutes: platformRouter,
  publicWebsiteRoutes: publicRouter,
};
