BEGIN;
DO $$ DECLARE t text; BEGIN
 IF EXISTS(SELECT 1 FROM pos_business_operations WHERE kind IN ('SALE_RETURN','PURCHASE_RETURN')) THEN
  RAISE EXCEPTION 'Refuse removing return protections after posted return history' USING ERRCODE='23514';
 END IF;
 FOREACH t IN ARRAY ARRAY['pos_business_operations','pos_business_lines','pos_money_movements','pos_debt_movements','pos_inventory_movements'] LOOP
 EXECUTE format('DROP TRIGGER pos_return_reconciliation ON %I',t);
 END LOOP;
END $$;
DROP FUNCTION pos_business_return_guard();
COMMIT;
