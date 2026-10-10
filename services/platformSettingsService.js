const pool = require("../db");

const DEFAULT_SETTINGS = {
  platform_name: "KlikPesantren",
  tagline: "Sistem Administrasi Pesantren Modern",
  description: "Platform administrasi digital untuk pesantren.",
  logo_url: null,
  support_whatsapp: null,
  support_email: null,
  website_url: null,
  about_text:
    "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, dan komunikasi wali santri.",
  tutorial_video_url: null,
  warning_days_before_due: 3,
  billing_bank_name: null,
  billing_account_number: null,
  billing_account_holder: null,
  billing_payment_instruction: null,
  billing_confirmation_whatsapp: null,
  billing_confirmation_message_template:
    "Assalamu'alaikum, saya dari {tenant_name} ingin mengonfirmasi pembayaran langganan KlikPesantren.",
};

const EDITABLE_KEYS = Object.keys(DEFAULT_SETTINGS);
const PUBLIC_SETTINGS_KEYS = [
  "platform_name",
  "tagline",
  "description",
  "logo_url",
  "support_whatsapp",
  "support_email",
  "website_url",
  "about_text",
  "tutorial_video_url",
];

function normalizeOptionalString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function mergeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of EDITABLE_KEYS) {
    if (raw[key] !== undefined) {
      if (key === "warning_days_before_due") {
        const days = Number(raw[key]);
        if (!Number.isInteger(days) || days < 0 || days > 365) {
          const err = new Error("warning_days_before_due harus bilangan bulat 0-365");
          err.status = 400;
          throw err;
        }
        merged[key] = days;
      } else {
        merged[key] =
          typeof DEFAULT_SETTINGS[key] === "string"
            ? normalizeOptionalString(raw[key])
            : raw[key] ?? null;
      }
    }
  }
  return merged;
}

async function ensureSettingsRow() {
  await pool.query(
    `INSERT INTO platform_settings (id, settings)
     VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_SETTINGS)]
  );
}

async function getPlatformSettings() {
  await ensureSettingsRow();
  const { rows } = await pool.query(
    `SELECT settings, updated_at FROM platform_settings WHERE id = 1`
  );
  const row = rows[0];
  return {
    settings: mergeSettings(row?.settings || {}),
    updated_at: row?.updated_at || null,
  };
}

async function updatePlatformSettings(patch = {}) {
  const current = await getPlatformSettings();
  const next = mergeSettings({ ...current.settings, ...patch });

  const { rows } = await pool.query(
    `UPDATE platform_settings
     SET settings = $1::jsonb, updated_at = NOW()
     WHERE id = 1
     RETURNING settings, updated_at`,
    [JSON.stringify(next)]
  );

  return {
    settings: mergeSettings(rows[0]?.settings || next),
    updated_at: rows[0]?.updated_at || null,
  };
}

async function getPublicPlatformSettings() {
  const data = await getPlatformSettings();
  return {
    ...data,
    settings: Object.fromEntries(
      PUBLIC_SETTINGS_KEYS.map((key) => [key, data.settings[key] ?? null])
    ),
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  EDITABLE_KEYS,
  PUBLIC_SETTINGS_KEYS,
  getPlatformSettings,
  getPublicPlatformSettings,
  updatePlatformSettings,
};
