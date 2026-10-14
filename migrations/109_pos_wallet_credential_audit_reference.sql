BEGIN;

ALTER TABLE pos_business_payments
  ADD COLUMN credential_ref_hash char(64),
  ADD CONSTRAINT pos_business_payment_credential_ref_format CHECK (
    credential_ref_hash IS NULL OR credential_ref_hash ~ '^[0-9a-f]{64}$'
  );

CREATE FUNCTION pos_business_payment_credential_ref_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.method='DOMPET_SANTRI' AND NEW.credential_ref_hash IS NULL THEN
    RAISE EXCEPTION 'Wallet payment credential audit reference is required' USING ERRCODE='23514';
  END IF;
  IF NEW.method<>'DOMPET_SANTRI' AND NEW.credential_ref_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Credential audit reference is Wallet-only' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pos_business_payment_credential_ref_guard
  BEFORE INSERT ON pos_business_payments
  FOR EACH ROW EXECUTE FUNCTION pos_business_payment_credential_ref_required();

COMMIT;
