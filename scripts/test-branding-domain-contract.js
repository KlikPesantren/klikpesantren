const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const activeFiles = [
  "frontend/src/App.jsx",
  "frontend/src/utils/hostnameRouting.js",
  "frontend/src/utils/tenantProfile.js",
  "frontend/src/pages/LoginPage.jsx",
  "frontend/src/pages/AboutKlikPesantrenPage.jsx",
  "archive/firmware/EDC01/KasirRFID_V3.ino.source.txt",
  "archive/firmware/EDC02/KasirRFID_V3_Edc02.ino.source.txt",
  "FRONTEND_ENV.md",
  "ENVIRONMENT.md",
  "WALI_ENV.md",
  "DEPLOYMENT_CHECKLIST.md",
  "docs/PRODUCTION_DEPLOY_CHECKLIST.md",
  "PROJECT_CONTEXT.md",
];

const forbidden = /KlikSantri|kliksantridemo-production|kliksantri-demo2?\.vercel\.app/;
for (const file of activeFiles) {
  assert(!forbidden.test(read(file)), `active legacy reference: ${file}`);
}

const routing = read("frontend/src/utils/hostnameRouting.js");
assert(routing.includes('ROOT_DOMAIN = "klikpesantren.com"'));
assert(routing.includes('type: "app"'));
assert(!routing.includes("legacy-app"));

for (const file of activeFiles.filter((file) => file.endsWith(".ino"))) {
  assert(read(file).includes('"https://api.klikpesantren.com"'));
}

const stableCompatibility = [
  ["frontend/src/utils/tenantProfile.js", "kliksantri_tenant_profile"],
  ["frontend/src/utils/storage.js", "kliksantri:permissions-updated"],
  ["frontend/src/context/ThemeContext.jsx", "kliksantri_theme"],
  ["frontend/src/constants/tenant.js", "kliksantri:tenant-suspend-message"],
  ["frontend/src/components/Sidebar.jsx", "kliksantri_sidebar_scroll"],
  ["frontend/src/components/Sidebar.jsx", "kliksantri_sidebar_collapsed"],
  ["services/waliAppService.js", "kliksantri-wali"],
  ["services/platformBackupService.js", "kliksantri"],
  ["services/cloudinaryUploadService.js", "kliksantri"],
  ["wali-app/app.json", "kliksantridemo"],
  ["wali-app/app.json", "kliksantri-wali"],
];
for (const [file, marker] of stableCompatibility) {
  assert(read(file).includes(marker), `stable compatibility identifier changed: ${file}`);
}

console.log(JSON.stringify({
  status: "PASS",
  active_files_checked: activeFiles.length,
  canonical_app: "https://app.klikpesantren.com",
  canonical_api: "https://api.klikpesantren.com",
  stable_compatibility_identifiers_checked: stableCompatibility.length,
}, null, 2));
