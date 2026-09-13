import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const sidebar = read("src/components/Sidebar.jsx");
const permissions = read("src/constants/permissions.js");
const appShell = read("src/layouts/AppShell.jsx");
const activeUnitContext = read("src/context/ActiveUnitContext.jsx");
const selector = read("src/components/UnitWorkspaceSelector.jsx");
const unitPage = read("src/pages/UnitPendidikanPage.jsx");

assert.match(app, /import UnitPendidikanPage from "\.\/pages\/UnitPendidikanPage"/);
assert.match(app, /path="\/units" element=\{<ProtectedRoute><UnitPendidikanPage \/><\/ProtectedRoute>\}/);
assert.match(app, /<ActiveUnitProvider>[\s\S]*<Routes>[\s\S]*<\/Routes>[\s\S]*<\/ActiveUnitProvider>/);

assert.match(sidebar, /name: "Unit Pendidikan", path: "\/units", perm: "unit\.view", feature: null/);
assert.match(permissions, /"\/units":\s+"unit\.view"/);
assert.match(permissions, /"\/units":\s+null/);

const permissionHelper = read("src/utils/hasPermission.js");
assert.match(permissionHelper, /getUser\(\)\?\.role === "superadmin"/);

assert.match(appShell, /import UnitWorkspaceSelector/);
assert.match(appShell, /showUnitFoundation \? <UnitWorkspaceSelector \/> : null/);
assert.match(appShell, /const showUnitFoundation = isUnitAwareRoute\(location\.pathname\)/);
assert.match(permissions, /const TENANT_GLOBAL_ROUTES = new Set/);
assert.match(permissions, /"\/rfid-dashboard": "wallet"/);
assert.match(permissions, /"\/rfid-monitor": "rfid"/);
assert.match(sidebar, /path: "\/rfid-dashboard"[^\n]*unitFeature: "wallet"/);
assert.match(sidebar, /path: "\/rfid-monitor"[^\n]*unitFeature: "rfid"/);

assert.match(activeUnitContext, /response\.data\?\.access\?\.all_units === true/);
assert.match(activeUnitContext, /if \(allowAll\) \{[\s\S]*setActiveUnitIdState\(storedUnit \? Number\(storedUnit\.id\) : null\)/);
assert.match(activeUnitContext, /const scopedUnit = storedUnit \|\| nextActiveUnits\[0\]/);


assert.match(selector, /allUnitsAllowed \? <option value="all">Semua Unit<\/option> : null/);
assert.match(selector, /disabled=\{!allUnitsAllowed && activeUnits\.length <= 1\}/);
assert.match(selector, /if \(error\) return <div/);
assert.match(unitPage, /<AppShell title="Unit Pendidikan"/);

console.log("PASS frontend multi-unit wiring: route, selector, feature, and scope assertions");
