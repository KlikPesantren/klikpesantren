BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pos_business_wallet_links) OR EXISTS(SELECT 1 FROM pos_wallet_credentials) THEN
  RAISE EXCEPTION 'Refuse rollback after Wallet/credential history' USING ERRCODE='23514';END IF;
END $$;
DROP TRIGGER pos_business_wallet_payment_reconciliation ON pos_business_payments;
DROP TRIGGER pos_business_wallet_clearing_reconciliation ON pos_money_movements;
DROP TABLE pos_business_wallet_links,pos_wallet_credential_audits,pos_wallet_credentials;
DROP FUNCTION pos_business_wallet_reconciles();
ALTER TABLE pos_business_payments DROP CONSTRAINT pos_business_payments_check;
ALTER TABLE pos_business_payments DROP COLUMN credential_method;
ALTER TABLE pos_business_payments DROP CONSTRAINT pos_business_payments_method_check;
ALTER TABLE pos_business_payments DROP CONSTRAINT pos_business_payment_business_unique;
ALTER TABLE pos_business_payments ADD CONSTRAINT pos_business_payments_method_check CHECK(method IN('CASH','BANK','QRIS','CREDIT'));
ALTER TABLE pos_business_payments ADD CONSTRAINT pos_business_payments_check CHECK(
 (method='CASH' AND account_id IS NOT NULL AND tendered>=amount AND change=tendered-amount)
 OR (method IN('BANK','QRIS') AND account_id IS NOT NULL AND reference IS NOT NULL AND tendered IS NULL AND change IS NULL)
 OR (method='CREDIT' AND account_id IS NULL AND tendered IS NULL AND change IS NULL));
DROP INDEX pos_business_wallet_clearing_unique;
DROP INDEX pos_business_wallet_transaction_scope_unique;
COMMIT;
