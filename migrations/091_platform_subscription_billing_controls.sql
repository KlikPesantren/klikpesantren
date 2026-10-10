BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC(15,2);

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_subscription_amount_non_negative;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_subscription_amount_non_negative
  CHECK (subscription_amount IS NULL OR subscription_amount >= 0);

INSERT INTO platform_settings (id, settings)
VALUES (
  1,
  jsonb_build_object(
    'warning_days_before_due', 3,
    'billing_bank_name', NULL,
    'billing_account_number', NULL,
    'billing_account_holder', NULL,
    'billing_payment_instruction', NULL,
    'billing_confirmation_whatsapp', NULL,
    'billing_confirmation_message_template',
      'Assalamu''alaikum, saya dari {tenant_name} ingin mengonfirmasi pembayaran langganan KlikPesantren.'
  )
)
ON CONFLICT (id) DO UPDATE
SET settings = platform_settings.settings
  || jsonb_strip_nulls(jsonb_build_object(
    'warning_days_before_due',
      COALESCE(platform_settings.settings->'warning_days_before_due', '3'::jsonb),
    'billing_confirmation_message_template',
      COALESCE(
        platform_settings.settings->'billing_confirmation_message_template',
        to_jsonb('Assalamu''alaikum, saya dari {tenant_name} ingin mengonfirmasi pembayaran langganan KlikPesantren.'::text)
      )
  ));

COMMIT;
