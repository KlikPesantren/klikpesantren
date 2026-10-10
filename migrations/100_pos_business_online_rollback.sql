BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pos_online_orders) OR EXISTS(SELECT 1 FROM pos_online_customer_access) THEN
 RAISE EXCEPTION 'Refuse rollback after online order/access history' USING ERRCODE='23514';END IF;END $$;
DROP TRIGGER pos_online_inventory_guard ON pos_inventory_movements;
DROP TABLE pos_online_order_events,pos_online_reservations,pos_online_order_lines,pos_online_orders,pos_online_customer_access,pos_online_request_limits;
DROP FUNCTION pos_online_order_guard(),pos_online_stock_guard(),pos_online_lock_product(),pos_online_transition_guard();
ALTER TABLE pos_businesses DROP CONSTRAINT pos_businesses_logo_url_check,DROP CONSTRAINT pos_businesses_banner_url_check;
ALTER TABLE pos_businesses ADD CONSTRAINT pos_businesses_logo_url_check CHECK(logo_url IS NULL OR logo_url ~ '^https://[^[:space:]]{1,2040}$') NOT VALID,
 ADD CONSTRAINT pos_businesses_banner_url_check CHECK(banner_url IS NULL OR banner_url ~ '^https://[^[:space:]]{1,2040}$') NOT VALID;
ALTER TABLE pos_business_products DROP CONSTRAINT pos_business_products_image_url_check;
ALTER TABLE pos_business_products ADD CONSTRAINT pos_business_products_image_url_check CHECK(image_url IS NULL OR image_url ~ '^https://[^[:space:]]{1,2040}$') NOT VALID;
ALTER TABLE pos_business_products DROP COLUMN online_description,DROP COLUMN online_long_description,DROP COLUMN online_featured,DROP COLUMN online_sort;
ALTER TABLE pos_businesses DROP COLUMN public_phone,DROP COLUMN hours_text,DROP COLUMN storefront_footer,DROP COLUMN payment_instructions,DROP COLUMN shipping_charge,DROP COLUMN reservation_minutes;
COMMIT;
