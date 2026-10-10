BEGIN;
-- Forward-only repair: PostgreSQL ARE rejects repetition bounds above 255.
-- Keep equivalent HTTPS/non-whitespace/length semantics; do not rewrite 097.
ALTER TABLE pos_businesses DROP CONSTRAINT pos_businesses_logo_url_check,DROP CONSTRAINT pos_businesses_banner_url_check;
ALTER TABLE pos_businesses ADD CONSTRAINT pos_businesses_logo_url_check CHECK(logo_url IS NULL OR (logo_url ~ '^https://[^[:space:]]+$' AND length(logo_url) BETWEEN 9 AND 2048)),
 ADD CONSTRAINT pos_businesses_banner_url_check CHECK(banner_url IS NULL OR (banner_url ~ '^https://[^[:space:]]+$' AND length(banner_url) BETWEEN 9 AND 2048));
ALTER TABLE pos_business_products DROP CONSTRAINT pos_business_products_image_url_check;
ALTER TABLE pos_business_products ADD CONSTRAINT pos_business_products_image_url_check CHECK(image_url IS NULL OR (image_url ~ '^https://[^[:space:]]+$' AND length(image_url) BETWEEN 9 AND 2048));
-- Presentation only. Price/stock remain in the existing canonical masters/ledgers.
ALTER TABLE pos_businesses ADD COLUMN public_phone boolean NOT NULL DEFAULT false,
 ADD COLUMN hours_text text, ADD COLUMN storefront_footer text, ADD COLUMN payment_instructions text,
 ADD COLUMN shipping_charge bigint NOT NULL DEFAULT 0 CHECK(shipping_charge>=0),
 ADD COLUMN reservation_minutes integer NOT NULL DEFAULT 30 CHECK(reservation_minutes BETWEEN 1 AND 1440);
ALTER TABLE pos_business_products ADD COLUMN online_description text,
 ADD COLUMN online_long_description text, ADD COLUMN online_featured boolean NOT NULL DEFAULT false,
 ADD COLUMN online_sort integer NOT NULL DEFAULT 0;
CREATE TABLE pos_online_customer_access(
 token_hash char(64) PRIMARY KEY,business_id uuid NOT NULL,customer_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(customer_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(business_id,created_by) REFERENCES pos_merchant_memberships(business_id,user_id)
);
CREATE TABLE pos_online_orders(
 id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES pos_businesses(id),order_number text NOT NULL,
 request_id text NOT NULL,request_hash char(64) NOT NULL,access_hash char(64) NOT NULL,
 status text NOT NULL DEFAULT 'ORDERED' CHECK(status IN('ORDERED','CONFIRMED','PROCESSING','READY_TO_SHIP','SHIPPED','COMPLETED','CANCELLED','REFUNDED')),
 payment_state text NOT NULL DEFAULT 'PENDING' CHECK(payment_state IN('PENDING','CONFIRMED','CANCELLED','REFUNDED')),
 payment_method text NOT NULL CHECK(payment_method IN('BANK','QRIS','CASH','CREDIT')),
 fulfillment text NOT NULL CHECK(fulfillment IN('DELIVERY','PICKUP')),
 customer_id uuid,recipient text NOT NULL,phone text NOT NULL,address text,notes text,
 merchandise_total bigint NOT NULL CHECK(merchandise_total>0),shipping_total bigint NOT NULL CHECK(shipping_total>=0),
 sale_id uuid,shipping_operation_id uuid,shipping_refund_id uuid,courier text,tracking text,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),shipped_at timestamptz,
 brand_snapshot jsonb NOT NULL,UNIQUE(id,business_id),UNIQUE(business_id,request_id),UNIQUE(business_id,order_number),UNIQUE(sale_id),
 FOREIGN KEY(customer_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(sale_id,business_id) REFERENCES pos_business_operations(id,business_id),
 FOREIGN KEY(shipping_operation_id,business_id) REFERENCES pos_business_operations(id,business_id),
 FOREIGN KEY(shipping_refund_id,business_id) REFERENCES pos_business_operations(id,business_id),
 CHECK(fulfillment<>'DELIVERY' OR length(btrim(address))>=10),
 CHECK(fulfillment<>'PICKUP' OR shipping_total=0),CHECK(payment_method<>'CASH' OR fulfillment='PICKUP'),
 CHECK(payment_method<>'CREDIT' OR customer_id IS NOT NULL),
 CHECK((sale_id IS NULL AND status IN('ORDERED','CANCELLED') AND payment_state IN('PENDING','CANCELLED'))
 OR (sale_id IS NOT NULL AND status NOT IN('ORDERED','CANCELLED') AND payment_state IN('CONFIRMED','REFUNDED')))
);
CREATE TABLE pos_online_order_lines(
 order_id uuid NOT NULL,business_id uuid NOT NULL,product_id uuid NOT NULL,
 name text NOT NULL,sku text NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),unit_price bigint NOT NULL CHECK(unit_price>0),
 PRIMARY KEY(order_id,product_id),FOREIGN KEY(order_id,business_id) REFERENCES pos_online_orders(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id)
);
CREATE TABLE pos_online_reservations(
 order_id uuid NOT NULL,business_id uuid NOT NULL,product_id uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','COMMITTED','RELEASED')),
 PRIMARY KEY(order_id,product_id),FOREIGN KEY(order_id,product_id) REFERENCES pos_online_order_lines(order_id,product_id),
 FOREIGN KEY(order_id,business_id) REFERENCES pos_online_orders(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id)
);
CREATE INDEX pos_online_reserved_product ON pos_online_reservations(business_id,product_id) WHERE state='RESERVED';
CREATE INDEX pos_online_expiry ON pos_online_orders(business_id,expires_at) WHERE status='ORDERED';
CREATE INDEX pos_online_order_period ON pos_online_orders(business_id,created_at);
CREATE TABLE pos_online_order_events(
 id uuid PRIMARY KEY,order_id uuid NOT NULL,business_id uuid NOT NULL,actor_id uuid,
 status text NOT NULL,reason text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(order_id,business_id) REFERENCES pos_online_orders(id,business_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id)
);
CREATE TABLE pos_online_request_limits(key char(64) PRIMARY KEY,attempts integer NOT NULL,started_at timestamptz NOT NULL);
CREATE FUNCTION pos_online_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(OLD)-ARRAY['status','payment_state','sale_id','shipping_operation_id','shipping_refund_id','courier','tracking','updated_at','shipped_at','expires_at']) IS DISTINCT FROM
    (to_jsonb(NEW)-ARRAY['status','payment_state','sale_id','shipping_operation_id','shipping_refund_id','courier','tracking','updated_at','shipped_at','expires_at'])
 OR (OLD.sale_id IS NOT NULL AND NEW.sale_id IS DISTINCT FROM OLD.sale_id)
 OR (OLD.shipping_operation_id IS NOT NULL AND NEW.shipping_operation_id IS DISTINCT FROM OLD.shipping_operation_id)
 OR (OLD.status<>NEW.status AND NOT (
  OLD.status='ORDERED' AND NEW.status IN('CONFIRMED','CANCELLED') OR
  OLD.status='CONFIRMED' AND NEW.status IN('PROCESSING','REFUNDED') OR
  OLD.status='PROCESSING' AND NEW.status IN('READY_TO_SHIP','REFUNDED') OR
  OLD.status='READY_TO_SHIP' AND (NEW.status IN('SHIPPED','REFUNDED') OR NEW.status='COMPLETED' AND OLD.fulfillment='PICKUP') OR
  OLD.status='SHIPPED' AND NEW.status IN('COMPLETED','REFUNDED') OR OLD.status='COMPLETED' AND NEW.status='REFUNDED'))
 OR (NEW.status='SHIPPED' AND NEW.fulfillment<>'DELIVERY') THEN
 RAISE EXCEPTION 'Invalid or immutable online order transition' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER pos_online_state_history BEFORE UPDATE ON pos_online_orders FOR EACH ROW EXECUTE FUNCTION pos_online_transition_guard();
CREATE TRIGGER pos_online_line_history BEFORE UPDATE ON pos_online_order_lines FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE TRIGGER pos_online_event_history BEFORE UPDATE ON pos_online_order_events FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE FUNCTION pos_online_lock_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM id FROM pos_business_products WHERE id=NEW.product_id AND business_id=NEW.business_id FOR UPDATE;RETURN NEW;END $$;
CREATE TRIGGER pos_online_reservation_lock BEFORE INSERT OR UPDATE ON pos_online_reservations FOR EACH ROW EXECUTE FUNCTION pos_online_lock_product();
CREATE FUNCTION pos_online_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stock bigint;reserved bigint;
BEGIN
 SELECT coalesce(sum(quantity),0) INTO stock FROM pos_inventory_movements WHERE business_id=NEW.business_id AND product_id=NEW.product_id;
 SELECT coalesce(sum(quantity),0) INTO reserved FROM pos_online_reservations WHERE business_id=NEW.business_id AND product_id=NEW.product_id AND state='RESERVED';
 IF stock<reserved OR reserved<0 THEN RAISE EXCEPTION 'Reserved stock cannot be consumed' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_online_inventory_guard AFTER INSERT ON pos_inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_online_stock_guard();
CREATE CONSTRAINT TRIGGER pos_online_reservation_guard AFTER INSERT OR UPDATE ON pos_online_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_online_stock_guard();
CREATE FUNCTION pos_online_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_online_orders%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='pos_online_orders' THEN SELECT * INTO o FROM pos_online_orders WHERE id=NEW.id;
 ELSE SELECT * INTO o FROM pos_online_orders WHERE id=NEW.order_id;END IF;
 IF o.merchandise_total<>(SELECT coalesce(sum(quantity*unit_price),0) FROM pos_online_order_lines WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM pos_online_order_lines l LEFT JOIN pos_online_reservations r USING(order_id,product_id)
 WHERE l.order_id=o.id AND (r.order_id IS NULL OR r.quantity<>l.quantity OR r.business_id<>l.business_id
 OR r.state<>CASE WHEN o.status='ORDERED' THEN 'RESERVED' WHEN o.status='CANCELLED' THEN 'RELEASED' ELSE 'COMMITTED' END))
 OR (o.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pos_business_operations s WHERE s.id=o.sale_id AND s.business_id=o.business_id AND s.kind='SALE' AND s.channel='ONLINE' AND s.total=o.merchandise_total AND s.party_id IS NOT DISTINCT FROM o.customer_id))
 OR (o.sale_id IS NOT NULL AND EXISTS(SELECT 1 FROM pos_online_order_lines l WHERE l.order_id=o.id AND NOT EXISTS(
  SELECT 1 FROM pos_business_lines s WHERE s.operation_id=o.sale_id AND s.product_id=l.product_id AND s.quantity=l.quantity AND s.unit_price=l.unit_price AND s.total=l.quantity*l.unit_price)))
 OR (o.status='REFUNDED' AND ((SELECT coalesce(sum(total),0) FROM pos_business_operations WHERE source_id=o.sale_id AND kind='SALE_RETURN')<>o.merchandise_total
  OR o.shipping_total>0 AND NOT EXISTS(SELECT 1 FROM pos_business_operations r WHERE r.id=o.shipping_refund_id AND r.business_id=o.business_id AND r.kind='EXPENSE' AND r.total=o.shipping_total)))
 OR (o.shipping_total>0 AND o.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pos_business_operations s WHERE s.id=o.shipping_operation_id AND s.business_id=o.business_id AND s.kind='OTHER_INCOME' AND s.total=o.shipping_total))
 THEN RAISE EXCEPTION 'Online order reconciliation mismatch' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_online_order_reconciliation AFTER INSERT OR UPDATE ON pos_online_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_online_order_guard();
CREATE CONSTRAINT TRIGGER pos_online_lines_reconciliation AFTER INSERT ON pos_online_order_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_online_order_guard();
CREATE CONSTRAINT TRIGGER pos_online_reservations_reconciliation AFTER INSERT OR UPDATE ON pos_online_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_online_order_guard();
COMMIT;
