BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pos_business_operations) OR EXISTS(SELECT 1 FROM pos_business_shifts) THEN
  RAISE EXCEPTION 'Refuse rollback after merchant financial or shift history exists' USING ERRCODE='23514';
 END IF;
END $$;
DROP TABLE pos_business_payments,pos_debt_movements,pos_money_movements,pos_inventory_allocations,pos_inventory_layers,
 pos_inventory_movements,pos_business_lines,pos_business_operations;
DROP FUNCTION pos_business_reconciles();
DROP FUNCTION pos_inventory_lock_product();
DROP FUNCTION pos_business_immutable();
DROP TABLE pos_business_shifts;
DROP FUNCTION pos_business_shift_close();
DROP TABLE pos_business_terminals,pos_business_accounts,pos_business_parties,pos_business_products,pos_merchant_sessions,
 pos_merchant_memberships,pos_merchant_users,pos_merchant_login_limits,pos_business_units,pos_businesses;
COMMIT;
