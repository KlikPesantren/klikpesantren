BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pos_wallet_settlement_payouts WHERE merchant_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback blocked: destination-attributed Wallet settlement history exists';
  END IF;
END $$;
DROP TRIGGER pos_wallet_settlement_destination_guard ON pos_wallet_settlement_payouts;
DROP FUNCTION pos_wallet_settlement_destination_required();
DROP INDEX pos_wallet_settlement_destination_account;
ALTER TABLE pos_wallet_settlement_payouts
  DROP CONSTRAINT pos_wallet_settlement_destination_account_fk,
  DROP COLUMN merchant_account_id;
COMMIT;
