BEGIN;
-- Non-production rehearsal only. Never discard persisted POS history.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pos_sales) OR EXISTS(SELECT 1 FROM pos_refunds) OR EXISTS(SELECT 1 FROM pos_shifts) THEN
  RAISE EXCEPTION 'POS_HISTORY_PRESENT_ROLLBACK_FORBIDDEN';
 END IF;
END $$;
DROP TABLE pos_refunds,pos_payments,pos_sale_items,pos_sales,pos_shifts,pos_products,pos_categories,pos_cashier_assignments;
DROP FUNCTION pos_refund_reconciles();
DROP FUNCTION pos_sale_reconciles();
DROP FUNCTION pos_history_guard();
DROP INDEX pos_wallet_reference;
DROP INDEX pos_terminal_scope;
DROP INDEX pos_merchant_scope;
ALTER TABLE devices DROP COLUMN pos_enabled;
ALTER TABLE merchant_rfid DROP COLUMN pos_enabled;
-- These new keys must be absent in the pre-UP rehearsal baseline.
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key IN
 ('pos.view','pos.sell','pos.products.manage','pos.shifts.manage','pos.refund','pos.discount','pos.config.manage'));
DELETE FROM permissions WHERE key IN
 ('pos.view','pos.sell','pos.products.manage','pos.shifts.manage','pos.refund','pos.discount','pos.config.manage');
COMMIT;
