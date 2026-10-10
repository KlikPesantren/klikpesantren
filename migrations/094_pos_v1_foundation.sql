BEGIN;

-- POS is additive. Legacy merchants/devices are NOT enabled or reassigned.
ALTER TABLE merchant_rfid ADD COLUMN pos_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN pos_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX pos_merchant_scope ON merchant_rfid(id,tenant_id,unit_id);
CREATE UNIQUE INDEX pos_terminal_scope ON devices(id,tenant_id,unit_id,merchant_id);

CREATE TABLE pos_cashier_assignments (
 tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, user_id integer NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,merchant_id,user_id),
 FOREIGN KEY(merchant_id,tenant_id,unit_id) REFERENCES merchant_rfid(id,tenant_id,unit_id),
 FOREIGN KEY(user_id,tenant_id) REFERENCES users(id,tenant_id)
);
CREATE TABLE pos_categories (
 id uuid PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, name varchar(120) NOT NULL CHECK(length(trim(name))>0),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(merchant_id,tenant_id,unit_id) REFERENCES merchant_rfid(id,tenant_id,unit_id)
);
CREATE TABLE pos_products (
 id uuid PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, category_id uuid,
 sku varchar(80) NOT NULL CHECK(length(trim(sku))>0), name varchar(160) NOT NULL CHECK(length(trim(name))>0),
 price bigint NOT NULL CHECK(price>0), active boolean NOT NULL DEFAULT true, available boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,merchant_id,sku), UNIQUE(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(merchant_id,tenant_id,unit_id) REFERENCES merchant_rfid(id,tenant_id,unit_id),
 FOREIGN KEY(category_id,tenant_id,unit_id,merchant_id) REFERENCES pos_categories(id,tenant_id,unit_id,merchant_id)
);
CREATE TABLE pos_shifts (
 id uuid PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, terminal_id integer NOT NULL, cashier_id integer NOT NULL,
 status text NOT NULL CHECK(status IN ('OPEN','CLOSED')), opening_cash bigint NOT NULL CHECK(opening_cash>=0),
 opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, closed_by integer,
 expected_cash bigint, actual_cash bigint CHECK(actual_cash>=0), difference bigint,
 UNIQUE(id,tenant_id,unit_id,merchant_id), UNIQUE(id,tenant_id,unit_id,merchant_id,terminal_id,cashier_id),
 FOREIGN KEY(terminal_id,tenant_id,unit_id,merchant_id) REFERENCES devices(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(merchant_id,tenant_id,unit_id) REFERENCES merchant_rfid(id,tenant_id,unit_id),
 FOREIGN KEY(cashier_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(closed_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK((status='OPEN' AND closed_at IS NULL AND closed_by IS NULL AND expected_cash IS NULL AND actual_cash IS NULL AND difference IS NULL)
 OR (status='CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND expected_cash IS NOT NULL AND actual_cash IS NOT NULL AND difference IS NOT NULL AND difference=actual_cash-expected_cash))
);
CREATE UNIQUE INDEX pos_one_open_terminal ON pos_shifts(tenant_id,terminal_id) WHERE status='OPEN';
CREATE UNIQUE INDEX pos_one_open_cashier ON pos_shifts(tenant_id,cashier_id) WHERE status='OPEN';
CREATE TABLE pos_sales (
 id uuid PRIMARY KEY, receipt text NOT NULL UNIQUE,
 tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, terminal_id integer NOT NULL, cashier_id integer NOT NULL, shift_id uuid NOT NULL,
 merchant_name text NOT NULL, cashier_name text NOT NULL, terminal_name text NOT NULL,
 business_date date NOT NULL, timezone text NOT NULL,
 subtotal bigint NOT NULL CHECK(subtotal>0), discount bigint NOT NULL CHECK(discount>=0 AND discount<subtotal),
 discount_reason text, grand_total bigint NOT NULL CHECK(grand_total=subtotal-discount),
 status text NOT NULL CHECK(status IN ('DRAFT','PAID','VOID')),
 request_id varchar(160) NOT NULL CHECK(length(request_id)>=8), request_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), void_reason text, void_by integer, void_at timestamptz,
 UNIQUE(tenant_id,request_id), UNIQUE(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(shift_id,tenant_id,unit_id,merchant_id,terminal_id,cashier_id) REFERENCES pos_shifts(id,tenant_id,unit_id,merchant_id,terminal_id,cashier_id),
 FOREIGN KEY(void_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK(discount=0 OR (discount_reason IS NOT NULL AND length(trim(discount_reason))>=5)),
 CHECK((status='VOID' AND void_by IS NOT NULL AND void_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason))>=5)
 OR (status<>'VOID' AND void_by IS NULL AND void_at IS NULL AND void_reason IS NULL))
);
CREATE TABLE pos_sale_items (
 id uuid PRIMARY KEY, sale_id uuid NOT NULL, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, product_id uuid NOT NULL,
 sku text NOT NULL, name text NOT NULL, category_name text,
 quantity integer NOT NULL CHECK(quantity>0), unit_price bigint NOT NULL CHECK(unit_price>0),
 gross bigint NOT NULL CHECK(gross=quantity::bigint*unit_price), discount bigint NOT NULL CHECK(discount>=0 AND discount<=gross),
 total bigint NOT NULL CHECK(total=gross-discount),
 UNIQUE(sale_id,product_id),
 FOREIGN KEY(sale_id,tenant_id,unit_id,merchant_id) REFERENCES pos_sales(id,tenant_id,unit_id,merchant_id) ON DELETE CASCADE,
 FOREIGN KEY(product_id,tenant_id,unit_id,merchant_id) REFERENCES pos_products(id,tenant_id,unit_id,merchant_id)
);
CREATE TABLE pos_payments (
 id uuid PRIMARY KEY, sale_id uuid NOT NULL UNIQUE, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL,
 method text NOT NULL CHECK(method IN ('RFID','CASH','TRANSFER_QRIS')),
 status text NOT NULL CHECK(status IN ('PENDING','CONFIRMED')), amount bigint NOT NULL CHECK(amount>0),
 wallet_account_id bigint, wallet_transaction_id bigint UNIQUE REFERENCES wallet_transactions(id),
 tendered bigint, change bigint, provider text, external_reference text, verified_by integer, verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(sale_id,tenant_id,unit_id,merchant_id) REFERENCES pos_sales(id,tenant_id,unit_id,merchant_id) ON DELETE CASCADE,
 FOREIGN KEY(wallet_account_id,tenant_id,unit_id) REFERENCES wallet_accounts(id,tenant_id,unit_id),
 FOREIGN KEY(verified_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK((status='CONFIRMED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL) OR (status='PENDING' AND verified_by IS NULL AND verified_at IS NULL)),
 CHECK((method='RFID' AND status='CONFIRMED' AND wallet_account_id IS NOT NULL AND wallet_transaction_id IS NOT NULL AND tendered IS NULL AND change IS NULL)
 OR (method='CASH' AND status='CONFIRMED' AND wallet_account_id IS NULL AND wallet_transaction_id IS NULL AND tendered IS NOT NULL AND change IS NOT NULL AND tendered>=amount AND change=tendered-amount)
 OR (method='TRANSFER_QRIS' AND wallet_account_id IS NULL AND wallet_transaction_id IS NULL AND tendered IS NULL AND change IS NULL))
);
CREATE TABLE pos_refunds (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 unit_id integer NOT NULL, merchant_id integer NOT NULL, shift_id uuid,
 amount bigint NOT NULL CHECK(amount>0), status text NOT NULL CHECK(status IN ('PENDING','CONFIRMED')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500), actor_id integer NOT NULL,
 request_id varchar(160) NOT NULL CHECK(length(request_id)>=8), request_hash char(64) NOT NULL,
 wallet_transaction_id bigint UNIQUE REFERENCES wallet_transactions(id), external_reference text,
 confirmed_by integer, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,request_id),
 FOREIGN KEY(payment_id,tenant_id,unit_id,merchant_id) REFERENCES pos_payments(id,tenant_id,unit_id,merchant_id) ON DELETE CASCADE,
 FOREIGN KEY(shift_id,tenant_id,unit_id,merchant_id) REFERENCES pos_shifts(id,tenant_id,unit_id,merchant_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES users(id,tenant_id),
 FOREIGN KEY(confirmed_by,tenant_id) REFERENCES users(id,tenant_id),
 CHECK((status='CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
 OR (status='PENDING' AND confirmed_by IS NULL AND confirmed_at IS NULL AND wallet_transaction_id IS NULL))
);
CREATE INDEX pos_catalog ON pos_products(tenant_id,unit_id,merchant_id,active,available);
CREATE INDEX pos_sale_history ON pos_sales(tenant_id,unit_id,business_date,created_at);
CREATE INDEX pos_sale_shift ON pos_sales(shift_id);
CREATE INDEX pos_refund_payment ON pos_refunds(payment_id,status);
CREATE INDEX pos_refund_shift ON pos_refunds(shift_id);
CREATE UNIQUE INDEX pos_wallet_reference ON wallet_transactions(tenant_id,reference_type,reference_id) WHERE source='pos';

-- No DELETE trigger: authorized tenant lifecycle cleanup remains possible.
-- Normal POS services expose no DELETE path; runtime grants exclude DELETE.
CREATE FUNCTION pos_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='pos_sale_items' THEN RAISE EXCEPTION 'POS item snapshots are immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='pos_shifts' THEN
  IF OLD.status<>'OPEN' OR NEW.status<>'CLOSED' OR
   (to_jsonb(OLD)-ARRAY['status','closed_at','closed_by','expected_cash','actual_cash','difference']) IS DISTINCT FROM
   (to_jsonb(NEW)-ARRAY['status','closed_at','closed_by','expected_cash','actual_cash','difference'])
  THEN RAISE EXCEPTION 'POS shift history is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='pos_sales' THEN
  IF OLD.status<>'DRAFT' OR NEW.status NOT IN ('PAID','VOID') OR
   (to_jsonb(OLD)-ARRAY['status','void_reason','void_by','void_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','void_reason','void_by','void_at'])
  THEN RAISE EXCEPTION 'POS sale history is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status<>'PENDING' OR NEW.status<>'CONFIRMED' OR
   (to_jsonb(OLD)-ARRAY['status','verified_by','verified_at','external_reference','confirmed_by','confirmed_at']) IS DISTINCT FROM
   (to_jsonb(NEW)-ARRAY['status','verified_by','verified_at','external_reference','confirmed_by','confirmed_at'])
  THEN RAISE EXCEPTION 'POS payment/refund history is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_items_immutable BEFORE UPDATE ON pos_sale_items FOR EACH ROW EXECUTE FUNCTION pos_history_guard();
CREATE TRIGGER pos_sales_immutable BEFORE UPDATE ON pos_sales FOR EACH ROW EXECUTE FUNCTION pos_history_guard();
CREATE TRIGGER pos_payments_immutable BEFORE UPDATE ON pos_payments FOR EACH ROW EXECUTE FUNCTION pos_history_guard();
CREATE TRIGGER pos_refunds_immutable BEFORE UPDATE ON pos_refunds FOR EACH ROW EXECUTE FUNCTION pos_history_guard();
CREATE TRIGGER pos_shifts_immutable BEFORE UPDATE ON pos_shifts FOR EACH ROW EXECUTE FUNCTION pos_history_guard();

CREATE FUNCTION pos_sale_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s pos_sales%ROWTYPE; p pos_payments%ROWTYPE; sid uuid; g bigint; d bigint;
BEGIN
 IF TG_TABLE_NAME='pos_sales' THEN sid := NEW.id; ELSE sid := NEW.sale_id; END IF;
 SELECT * INTO s FROM pos_sales WHERE id=sid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum(gross),0),coalesce(sum(discount),0) INTO g,d FROM pos_sale_items WHERE sale_id=sid;
 IF g<>s.subtotal OR d<>s.discount THEN RAISE EXCEPTION 'POS item/total mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM pos_payments WHERE sale_id=sid;
 IF NOT FOUND OR p.amount<>s.grand_total OR (s.status='PAID')<>(p.status='CONFIRMED') THEN
  RAISE EXCEPTION 'POS sale/payment mismatch' USING ERRCODE='23514';
 END IF;
 IF p.method='RFID' AND NOT EXISTS (
  SELECT 1 FROM wallet_transactions w WHERE w.id=p.wallet_transaction_id AND w.wallet_account_id=p.wallet_account_id
   AND w.tenant_id=p.tenant_id AND w.unit_id=p.unit_id AND w.amount=p.amount AND w.type='payment'
   AND w.direction='debit' AND w.source='pos' AND w.reference_type='pos_payment' AND w.reference_id=p.id::text
 ) THEN RAISE EXCEPTION 'POS wallet debit mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_sale_reconciliation AFTER INSERT OR UPDATE ON pos_sales DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_sale_reconciles();
CREATE CONSTRAINT TRIGGER pos_item_reconciliation AFTER INSERT ON pos_sale_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_sale_reconciles();
CREATE CONSTRAINT TRIGGER pos_payment_reconciliation AFTER INSERT OR UPDATE ON pos_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_sale_reconciles();

CREATE FUNCTION pos_refund_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r pos_refunds%ROWTYPE; p pos_payments%ROWTYPE; refunded bigint;
BEGIN
 SELECT * INTO r FROM pos_refunds WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM pos_payments WHERE id=r.payment_id FOR UPDATE;
 SELECT coalesce(sum(amount),0) INTO refunded FROM pos_refunds WHERE payment_id=p.id;
 IF p.status<>'CONFIRMED' OR refunded>p.amount THEN RAISE EXCEPTION 'POS over/unpaid refund' USING ERRCODE='23514'; END IF;
 IF p.method='RFID' THEN
  IF r.status<>'CONFIRMED' OR NOT EXISTS (
   SELECT 1 FROM wallet_transactions w WHERE w.id=r.wallet_transaction_id AND w.wallet_account_id=p.wallet_account_id
    AND w.tenant_id=p.tenant_id AND w.unit_id=p.unit_id AND w.amount=r.amount AND w.type='refund'
    AND w.direction='credit' AND w.source='pos' AND w.reference_type='pos_refund' AND w.reference_id=r.id::text
  ) THEN RAISE EXCEPTION 'POS wallet refund mismatch' USING ERRCODE='23514'; END IF;
 ELSIF r.wallet_transaction_id IS NOT NULL THEN RAISE EXCEPTION 'Non wallet refund has ledger' USING ERRCODE='23514';
 END IF;
 IF p.method='CASH' AND (r.status<>'CONFIRMED' OR r.shift_id IS NULL) THEN RAISE EXCEPTION 'Cash refund requires shift' USING ERRCODE='23514'; END IF;
 IF p.method='TRANSFER_QRIS' AND r.status='CONFIRMED' AND coalesce(length(trim(r.external_reference)),0)=0 THEN
  RAISE EXCEPTION 'External refund requires return evidence' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_refund_reconciliation AFTER INSERT OR UPDATE ON pos_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_refund_reconciles();

INSERT INTO permissions(key,label,grup) VALUES
 ('pos.view','Lihat POS','POS'),('pos.sell','Penjualan POS','POS'),
 ('pos.products.manage','Kelola Produk POS','POS'),('pos.shifts.manage','Kelola Shift POS','POS'),
 ('pos.refund','Refund POS','POS'),('pos.discount','Diskon POS','POS'),('pos.config.manage','Konfigurasi POS','POS')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='superadmin' AND p.key IN
 ('pos.view','pos.sell','pos.products.manage','pos.shifts.manage','pos.refund','pos.discount','pos.config.manage')
ON CONFLICT DO NOTHING;
COMMIT;
