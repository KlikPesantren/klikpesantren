BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pos_business_payments WHERE credential_ref_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback blocked: credential-attributed Wallet payment history exists';
  END IF;
END $$;
DROP TRIGGER pos_business_payment_credential_ref_guard ON pos_business_payments;
DROP FUNCTION pos_business_payment_credential_ref_required();
ALTER TABLE pos_business_payments
  DROP CONSTRAINT pos_business_payment_credential_ref_format,
  DROP COLUMN credential_ref_hash;
COMMIT;
