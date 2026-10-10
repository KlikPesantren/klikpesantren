-- Additive Admin reads and reconciliation permission; no historical data write.
BEGIN;
INSERT INTO permissions(key,label,grup) VALUES('pos.reconcile','Rekonsiliasi POS','POS') ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='superadmin' AND p.key='pos.reconcile' ON CONFLICT DO NOTHING;
CREATE INDEX pos_sales_admin_date ON pos_sales(tenant_id,unit_id,business_date,created_at DESC,id DESC);
CREATE INDEX pos_sales_admin_merchant ON pos_sales(tenant_id,unit_id,merchant_id,created_at DESC,id DESC);
CREATE INDEX pos_shifts_admin_date ON pos_shifts(tenant_id,unit_id,opened_at DESC,id DESC);
CREATE INDEX pos_refunds_admin_date ON pos_refunds(tenant_id,unit_id,created_at DESC,id DESC);
CREATE INDEX pos_products_admin_merchant ON pos_products(tenant_id,unit_id,merchant_id,id);
COMMIT;
