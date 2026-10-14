BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pos_wallet_settlement_payouts) THEN
    RAISE EXCEPTION 'Rollback blocked: Wallet merchant settlement history exists';
  END IF;
END $$;
DROP TRIGGER pos_wallet_settlement_allocation_history ON pos_wallet_settlement_allocations;
DROP TRIGGER pos_wallet_settlement_payout_history ON pos_wallet_settlement_payouts;
DROP TRIGGER pos_wallet_settlement_allocation_reconciliation ON pos_wallet_settlement_allocations;
DROP TRIGGER pos_wallet_settlement_payout_reconciliation ON pos_wallet_settlement_payouts;
DROP FUNCTION pos_wallet_settlement_reconciles();
DROP TABLE pos_wallet_settlement_allocations;
DROP TABLE pos_wallet_settlement_payouts;
ALTER TABLE pos_business_wallet_links DROP CONSTRAINT pos_business_wallet_links_id_business_unique;
COMMIT;
