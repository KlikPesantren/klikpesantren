const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { READINESS_ITEMS, keepMerchantSelection, shiftResourceChoice, cashierSetupState } = require("../src/merchantBootstrap.cjs");

const appSource = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
const serviceSource = fs.readFileSync(path.join(__dirname, "../../services/posBusinessService.js"), "utf8");

test("new merchant gets an owner setup path while cashier stays configuration-read-only", () => {
  assert.deepEqual(cashierSetupState([], [], true), {
    missingTerminal: true,
    missingDrawer: true,
    canConfigure: true,
    ready: false,
  });
  assert.equal(cashierSetupState([], [], false).canConfigure, false);
  assert.match(appSource, /can\("BUSINESS_SETTINGS_MANAGE"\)/);
  assert.match(appSource, /Buka Pengaturan Usaha/);
  assert.match(appSource, /Minta Owner menyiapkan terminal/);
});

test("existing merchant resources are reused and stale cross-merchant selections are dropped", () => {
  const terminals = [{ id: "terminal-a" }];
  assert.equal(keepMerchantSelection("", terminals), "terminal-a");
  assert.equal(keepMerchantSelection("terminal-a", terminals), "terminal-a");
  assert.equal(keepMerchantSelection("foreign-terminal", terminals), "terminal-a");
  assert.equal(keepMerchantSelection("foreign-terminal", [{ id: "a" }, { id: "b" }]), "");
  assert.equal(cashierSetupState(terminals, [{ id: "drawer-a" }], false).ready, true);
});

test("one terminal and drawer select automatically while multiple resources require an explicit valid choice", () => {
  assert.deepEqual(shiftResourceChoice("", [{ id: "only" }]), { selected: "only", automatic: true, needsChoice: false });
  assert.deepEqual(shiftResourceChoice("", [{ id: "a" }, { id: "b" }]), { selected: "", automatic: false, needsChoice: true });
  assert.deepEqual(shiftResourceChoice("b", [{ id: "a" }, { id: "b" }]), { selected: "b", automatic: false, needsChoice: false });
  assert.deepEqual(shiftResourceChoice("foreign", [{ id: "a" }, { id: "b" }]), { selected: "", automatic: false, needsChoice: true });
});

test("readiness links are permission-derived and home shows only actionable incomplete steps", () => {
  const terminal = READINESS_ITEMS.find(([key]) => key === "terminal");
  const drawer = READINESS_ITEMS.find(([key]) => key === "cash_drawer");
  assert.deepEqual(terminal.slice(2), ["PENGATURAN", "BUSINESS_SETTINGS_MANAGE"]);
  assert.deepEqual(drawer.slice(2), ["PENGATURAN", "BUSINESS_SETTINGS_MANAGE"]);
  assert.match(appSource, /!w\.readiness\[key\]&&can\(permission\)/);
  assert.match(appSource, /value="BELUM"/);
  assert.deepEqual(READINESS_ITEMS.find(([key]) => key === "initialization").slice(1), ["Posisi awal usaha", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"]);
});

test("existing-business initialization is guided, immutable and explicitly corrected", () => {
  assert.match(appSource, /Posisi Awal Usaha/);
  assert.match(appSource, /Aset = Kewajiban \+ Ekuitas/);
  assert.match(appSource, /confirmation:"FINALIZE"/);
  assert.match(appSource, /initialization\/corrections/);
  assert.match(appSource, /confirmation:"CORRECT"/);
  assert.doesNotMatch(appSource, /\["accounting_start_date","Tanggal mulai pembukuan/);
});

test("open shift uses selected merchant terminal and drawer; close remains server validated", () => {
  assert.match(appSource, /Card title="Mulai Jualan"/);
  assert.match(appSource, /terminalChoice\.automatic/);
  assert.match(appSource, /context\.terminals\.length>1/);
  assert.match(appSource, /drawerChoice\.automatic/);
  assert.match(appSource, /drawers\.length>1/);
  assert.match(appSource, /Kas awal adalah uang fisik/);
  assert.match(appSource, /terminal_id:selectedTerminal,cash_account_id:selectedDrawer,opening_cash:openingCash/);
  assert.match(appSource, /disabled=\{!selectedTerminal\|\|!selectedDrawer\|\|!validMoney\(openingCash\)\}/);
  assert.match(appSource, /submit\("\/shifts\/close",\{shift_id:open\.id,actual_cash:actual\}/);
});

test("configuration creation is merchant-scoped, permission-gated, and retry-idempotent by normalized name", () => {
  assert.match(serviceSource, /run\(req, 'BUSINESS_SETTINGS_MANAGE'/);
  assert.match(serviceSource, /pos-business-config:\$\{a\.business\}:terminal/);
  assert.match(serviceSource, /WHERE business_id=\$1 AND lower\(btrim\(name\)\)=lower\(btrim\(\$2\)\)/);
  assert.match(serviceSource, /pos-business-config:\$\{a\.business\}:account/);
  assert.match(serviceSource, /SELECT id,name,kind,true AS replay/);
});
