BEGIN;
-- Record root transaction IDs for cross-page visibility; xmin alone is a subtransaction ID under savepoints.
-- Legacy rows stay unchanged and use their committed xmin. No financial backfill.
ALTER TABLE pos_money_movements ADD COLUMN recorded_xid xid8;
ALTER TABLE pos_wallet_settlement_payouts ADD COLUMN recorded_xid xid8;
CREATE FUNCTION pos_finance_recorded_xid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.recorded_xid:=pg_current_xact_id(); RETURN NEW; END $$;
CREATE TRIGGER pos_money_recorded_xid BEFORE INSERT ON pos_money_movements FOR EACH ROW EXECUTE FUNCTION pos_finance_recorded_xid();
CREATE TRIGGER pos_payout_recorded_xid BEFORE INSERT ON pos_wallet_settlement_payouts FOR EACH ROW EXECUTE FUNCTION pos_finance_recorded_xid();
COMMIT;

