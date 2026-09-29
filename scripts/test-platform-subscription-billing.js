const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildTenantSubscriptionNotice,
} = require("../utils/tenantSubscriptionBilling");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function notice(daysUntilDue, overrides = {}, settingsOverrides = {}) {
  return buildTenantSubscriptionNotice({
    nama: "Pesantren Uji",
    status: "active",
    billing_status: "active",
    subscription_started_at: "2026-09-01",
    subscription_expires_at: "2026-10-02",
    subscription_amount: "1250000",
    days_until_due: daysUntilDue,
    ...overrides,
  }, {
    warning_days_before_due: 3,
    billing_bank_name: "Bank Uji",
    billing_account_number: "123456",
    billing_account_holder: "KlikPesantren",
    billing_payment_instruction: "Cantumkan nama pesantren.",
    billing_confirmation_whatsapp: "62 812-0000",
    billing_confirmation_message_template: "Konfirmasi dari {tenant_name}",
    ...settingsOverrides,
  });
}

assert.equal(notice(4).warning.show, false, "H-4 must not warn");
assert.equal(notice(3).warning.show, true, "H-3 must warn");
assert.equal(notice(2).warning.show, true, "H-2 must warn");
assert.equal(notice(1).warning.show, true, "H-1 must warn");
assert.equal(notice(0).warning.show, true, "deadline day must warn");
assert.equal(notice(0).warning.urgent, true, "deadline day must be urgent");
assert.equal(notice(-1).warning.show, false, "expired tenant must not receive warning");
assert.equal(notice(6, {}, { warning_days_before_due: 7 }).warning.show, true, "Platform H-7 config must apply");
assert.equal(notice(6).warning.show, false, "H-3 config must not warn at H-6");
assert.equal(notice(30).warning.show, false, "renewed deadline must remove warning");
assert.equal(notice(1, { status: "suspended", billing_status: "suspended" }).warning.show, false);
assert.equal(notice(1).subscription.amount, 1250000);
assert.equal(notice(1).payment.account_number, "123456");
assert.match(notice(1).payment.confirmation_url, /Konfirmasi%20dari%20Pesantren%20Uji/);

const enforcement = read("services/tenantBillingEnforcementService.js");
assert.match(enforcement, /subscription_expires_at::date[\s\S]*< \(CURRENT_TIMESTAMP AT TIME ZONE \$3\)::date/);
assert.match(enforcement, /status = 'active'/);
assert.match(enforcement, /billing_status IN \('active', 'trial', 'overdue'\)/);
assert.match(enforcement, /WITH suspended AS[\s\S]*audited AS/);
assert.match(enforcement, /platform\.tenant\.billing\.auto_suspended/);
assert.match(enforcement, /COALESCE\(suspended_at, NOW\(\)\)/);

const route = read("routes/dashboardRoutes.js");
assert.match(route, /getTenantSubscriptionNotice\(req\.tenantId\)/);
assert.doesNotMatch(route, /getTenantSubscriptionNotice\(req\.(body|query|params)/);

const popup = read("frontend/src/components/SubscriptionBillingNotice.jsx");
assert.match(popup, /api\.get\("\/dashboard\/subscription-billing"\)/);
assert.doesNotMatch(popup, /api\.(post|put|patch|delete)/);
assert.match(popup, /navigator\.clipboard\.writeText/);

const migration = read("migrations/091_platform_subscription_billing_controls.sql");
assert.match(migration, /ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC\(15,2\)/);
assert.match(migration, /warning_days_before_due', 3/);

const settings = read("services/platformSettingsService.js");
for (const key of [
  "warning_days_before_due",
  "billing_bank_name",
  "billing_account_number",
  "billing_account_holder",
  "billing_payment_instruction",
  "billing_confirmation_whatsapp",
  "billing_confirmation_message_template",
]) {
  assert.ok(settings.includes(key), `missing Platform setting: ${key}`);
}
const publicSettingsRoute = read("routes/publicPlatformRoutes.js");
assert.match(publicSettingsRoute, /getPublicPlatformSettings/);
assert.doesNotMatch(publicSettingsRoute, /getPlatformSettings\(\)/);

console.log("Platform subscription billing regression: PASS");
