BEGIN;

ALTER TABLE pos_wallet_settlement_payouts
  ADD COLUMN merchant_account_id uuid,
  ADD CONSTRAINT pos_wallet_settlement_destination_account_fk
    FOREIGN KEY (merchant_account_id, business_id)
    REFERENCES pos_business_accounts(id, business_id);

CREATE INDEX pos_wallet_settlement_destination_account
  ON pos_wallet_settlement_payouts (business_id, merchant_account_id, payout_date, id);

CREATE FUNCTION pos_wallet_settlement_destination_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pos_business_accounts a
    WHERE a.id=NEW.merchant_account_id AND a.business_id=NEW.business_id
      AND a.active AND a.kind IN ('CASH','BANK')
  ) THEN
    RAISE EXCEPTION 'Active merchant cash/bank destination is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pos_wallet_settlement_destination_guard
  BEFORE INSERT ON pos_wallet_settlement_payouts
  FOR EACH ROW EXECUTE FUNCTION pos_wallet_settlement_destination_required();

COMMIT;
