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
assert.equal(
  notice(1, {}, { billing_account_number: "00123456" }).payment.account_number,
  "00123456",
  "account number must remain a string and preserve leading zeroes",
);

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

assert.ok(
  popup.includes("const hasPaymentDetails = Boolean("),
  "popup must compute whether payment details exist",
);
assert.ok(
  popup.includes("{hasPaymentDetails ? ("),
  "popup must not render an empty payment container",
);

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
assert.ok(
  settings.includes("warning_days_before_due harus bilangan bulat 0-365"),
  "backend warning-day validation must remain 0-365",
);

const settingsRoute = read("routes/platformSettingsRoutes.js");
assert.ok(settingsRoute.includes("router.use(platformAuthMiddleware)"));
assert.ok(settingsRoute.includes('requirePermission("platform.tenant.view")'));
assert.ok(settingsRoute.includes("router.patch("));
assert.ok(settingsRoute.includes('requirePermission("platform.tenant.update")'));

const platformAuth = read("middleware/platformAuthMiddleware.js");
assert.ok(platformAuth.includes("decoded.platform !== true"));
assert.ok(platformAuth.includes('decoded.role !== "platform_superadmin"'));
assert.ok(platformAuth.includes("decoded.tenant_id != null"));

const billingSettingKeys = [
  "warning_days_before_due",
  "billing_bank_name",
  "billing_account_number",
  "billing_account_holder",
  "billing_payment_instruction",
  "billing_confirmation_whatsapp",
  "billing_confirmation_message_template",
];
const billingPage = read("frontend/src/pages/platform/PlatformBillingOverviewPage.jsx");
assert.ok(billingPage.includes("Pengaturan Pembayaran Langganan"));
assert.ok(billingPage.includes('platformApi.get("/platform/settings")'));
assert.ok(billingPage.includes('platformApi.patch("/platform/settings"'));
assert.ok(billingPage.includes("Simpan Pengaturan Pembayaran"));
assert.ok(billingPage.includes('inputMode="numeric"'));
assert.ok(billingPage.includes("Placeholder yang didukung:"));
for (const key of billingSettingKeys) {
  assert.ok(billingPage.includes(key), "billing page must bind current field: " + key);
}

const profilePage = read("frontend/src/pages/platform/PlatformProfilePage.jsx");
for (const key of billingSettingKeys) {
  assert.ok(
    !profilePage.includes(key),
    "billing field must not remain duplicated in Platform Profile: " + key,
  );
}

const publicSettingsRoute = read("routes/publicPlatformRoutes.js");
assert.match(publicSettingsRoute, /getPublicPlatformSettings/);
assert.doesNotMatch(publicSettingsRoute, /getPlatformSettings\(\)/);

const publicSettingsAllowlist = settings.slice(
  settings.indexOf("const PUBLIC_SETTINGS_KEYS"),
  settings.indexOf("function normalizeOptionalString"),
);
for (const key of billingSettingKeys) {
  assert.ok(
    !publicSettingsAllowlist.includes(key),
    "private billing setting must not be publicly allowlisted: " + key,
  );
}

async function runSettingsPersistenceRegression() {
  const dbPath = require.resolve("../db");
  const servicePath = require.resolve("../services/platformSettingsService");
  const previousDbModule = require.cache[dbPath];
  const previousServiceModule = require.cache[servicePath];
  const tenantSnapshot = {
    subscription_amount: "399000",
    subscription_expires_at: "2026-12-31",
    billing_status: "active",
  };
  const tenantBefore = JSON.stringify(tenantSnapshot);
  let storedSettings = {};

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        const statement = String(sql).trim().toUpperCase();
        if (statement.startsWith("INSERT INTO PLATFORM_SETTINGS")) {
          return { rows: [] };
        }
        if (statement.startsWith("SELECT SETTINGS")) {
          return {
            rows: [{
              settings: storedSettings,
              updated_at: "2026-09-29T00:00:00.000Z",
            }],
          };
        }
        if (statement.startsWith("UPDATE PLATFORM_SETTINGS")) {
          storedSettings = JSON.parse(params[0]);
          return {
            rows: [{
              settings: storedSettings,
              updated_at: "2026-09-29T00:01:00.000Z",
            }],
          };
        }
        throw new Error("Unexpected settings query in regression");
      },
    },
  };
  delete require.cache[servicePath];

  try {
    const service = require("../services/platformSettingsService");
    const saved = await service.updatePlatformSettings({
      warning_days_before_due: 7,
      billing_bank_name: "Bank Fixture",
      billing_account_number: "00123456",
      billing_account_holder: "KlikPesantren Fixture",
      billing_payment_instruction: "Gunakan data fixture.",
      billing_confirmation_whatsapp: "+62 812-0000",
      billing_confirmation_message_template: "Konfirmasi {tenant_name}",
    });
    const reloaded = await service.getPlatformSettings();
    const publicSettings = await service.getPublicPlatformSettings();

    assert.equal(saved.settings.warning_days_before_due, 7);
    assert.equal(reloaded.settings.billing_bank_name, "Bank Fixture");
    assert.equal(reloaded.settings.billing_account_number, "00123456");
    assert.equal(reloaded.settings.billing_account_holder, "KlikPesantren Fixture");
    assert.equal(reloaded.settings.billing_payment_instruction, "Gunakan data fixture.");
    assert.equal(reloaded.settings.billing_confirmation_whatsapp, "+62 812-0000");
    assert.equal(
      reloaded.settings.billing_confirmation_message_template,
      "Konfirmasi {tenant_name}",
    );
    for (const key of billingSettingKeys) {
      assert.equal(publicSettings.settings[key], undefined);
    }
    assert.equal(
      JSON.stringify(tenantSnapshot),
      tenantBefore,
      "saving global settings must not mutate tenant billing state",
    );
    await assert.rejects(
      service.updatePlatformSettings({ warning_days_before_due: 366 }),
      /0-365/,
    );
  } finally {
    delete require.cache[servicePath];
    if (previousServiceModule) require.cache[servicePath] = previousServiceModule;
    if (previousDbModule) {
      require.cache[dbPath] = previousDbModule;
    } else {
      delete require.cache[dbPath];
    }
  }
}

runSettingsPersistenceRegression()
  .then(() => {
    console.log("Platform subscription billing regression: PASS");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
