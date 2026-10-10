const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

const routes = read("routes/platformWebsiteRoutes.js");
const service = read("services/platformWebsiteService.js");
const app = read("frontend/src/App.jsx");
const editor = read("frontend/src/pages/platform/PlatformWebsitePage.jsx");
const preview = read("frontend/src/pages/platform/WebsitePreviewRenderPage.jsx");
const landing = read("frontend/src/pages/LandingPage.jsx");
const campaign = read("frontend/src/pages/FoundingPartnerPage.jsx");
const demo = read("frontend/src/pages/OfficialWebsitePages.jsx");
const whatsapp = read("frontend/src/hooks/usePublicWebsiteContact.js");

assert(routes.indexOf("platformRouter.use(platformAuthMiddleware)") < routes.indexOf('platformRouter.get("/content"'), "draft API remains authenticated");
assert(routes.includes('publicRouter.get("/content"') && service.includes("settings.published_content || settings.content"), "public API remains published-only");
assert(service.includes("published_content = content"), "publish still copies draft to published atomically");
assert(app.includes('/platform/website/preview/render') && app.includes("PlatformProtectedRoute"), "preview renderer is behind Platform auth");
assert(preview.includes('/platform/website/content') && preview.includes("WebsiteContentProvider content={content}"), "preview reads draft and reuses website provider");
assert(editor.includes("Simpan Draft terlebih dahulu") && editor.includes("Preview"), "editor distinguishes saved draft before preview");
assert(landing.includes("campaignEnabled") && landing.includes("homepageSections"), "homepage obeys campaign and section visibility");
assert(campaign.includes("campaign.enabled === false") && campaign.includes("<Navigate to=\"/\" replace"), "disabled campaign is removed from public route");
assert(demo.includes("window.open(whatsappUrl") && demo.includes("Assalamu'alaikum, saya ingin minta demo KlikPesantren."), "Demo submit workflow remains unchanged");
assert(whatsapp.includes("normalizeWhatsAppNumber") && whatsapp.includes("useWebsiteContent"), "WhatsApp normalization uses shared Published/Draft source");

console.log("Platform Website CMS regression: PASS");
