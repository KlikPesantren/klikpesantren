BEGIN;
ALTER TABLE pos_wallet_settlement_payouts ADD COLUMN attributed_shift_id uuid,
 ADD CONSTRAINT pos_payout_shift_scope FOREIGN KEY(attributed_shift_id,business_id) REFERENCES pos_business_shifts(id,business_id);
CREATE FUNCTION pos_payout_shift_attribute() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s pos_business_shifts%ROWTYPE; zone text;
BEGIN
 SELECT timezone INTO zone FROM pos_businesses WHERE id=NEW.business_id;
 SELECT * INTO s FROM pos_business_shifts WHERE business_id=NEW.business_id AND cash_account_id=NEW.merchant_account_id AND status='OPEN' FOR SHARE NOWAIT;
 IF FOUND AND NEW.payout_date=(NEW.created_at AT TIME ZONE zone)::date AND NEW.created_at>=s.opened_at THEN
  NEW.attributed_shift_id:=s.id;
 ELSIF FOUND THEN RAISE EXCEPTION 'ACTIVE_DRAWER_REQUIRES_CURRENT_DATE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_payout_shift_attribute BEFORE INSERT ON pos_wallet_settlement_payouts FOR EACH ROW EXECUTE FUNCTION pos_payout_shift_attribute();
COMMIT;

