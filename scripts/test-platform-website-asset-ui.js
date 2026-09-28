const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

const routes = read("routes/platformWebsiteRoutes.js");
const editor = read("frontend/src/pages/platform/PlatformWebsitePage.jsx");
const assetField = read("frontend/src/components/platform/WebsiteAssetField.jsx");
const preview = read("frontend/src/pages/platform/WebsitePreviewRenderPage.jsx");
const service = read("services/platformWebsiteService.js");

assert(
  routes.indexOf("platformRouter.use(platformAuthMiddleware)") < routes.indexOf('platformRouter.post("/assets"'),
  "asset upload remains behind Platform authentication",
);
assert(
  routes.includes("uploadImageBuffer") && routes.includes("storage: multer.memoryStorage()"),
  "existing Cloudinary upload infrastructure is reused",
);
assert(
  assetField.includes("Gambar saat ini") && assetField.includes("Belum ada asset"),
  "configured and empty asset states are rendered",
);
assert(
  assetField.includes("onError={() => setUnavailableUrl(value)}") && assetField.includes("Gambar tidak dapat ditampilkan"),
  "invalid asset URL has a safe unavailable state",
);
assert(
  assetField.includes("onChange(url)") && assetField.includes("Perubahan baru masuk Draft setelah Simpan Draft"),
  "uploaded asset only updates editor state before Save Draft",
);
assert(
  editor.includes('type: "asset"') && editor.includes("campaign.page.hero_image_url"),
  "all current website image fields use the asset control",
);
assert(
  service.includes("published_content = content") && preview.includes("WebsiteContentProvider content={content}"),
  "Draft Preview and explicit Publish contracts remain unchanged",
);

console.log("Platform Website asset UI regression: PASS");
