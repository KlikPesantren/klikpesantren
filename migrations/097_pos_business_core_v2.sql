-- Local/development only until explicitly approved. No legacy ownership inference.
BEGIN;
CREATE TABLE pos_businesses (
 id uuid PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 ownership text NOT NULL CHECK(ownership IN ('INTERNAL','EXTERNAL')),
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 160),
 legal_name text, description text, address text, phone text, logo_url text, banner_url text,
 brand_color text CHECK(brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$'),
 receipt_name text, receipt_header text, receipt_footer text, receipt_logo boolean NOT NULL DEFAULT false,
 receipt_prefix text NOT NULL DEFAULT 'POS' CHECK(receipt_prefix ~ '^[A-Z0-9-]{1,16}$'),
 timezone text NOT NULL, currency text NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 storefront_slug text UNIQUE CHECK(storefront_slug IS NULL OR storefront_slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
 active boolean NOT NULL DEFAULT true, integration_enabled boolean NOT NULL DEFAULT false,
 wallet_enabled boolean NOT NULL DEFAULT false, storefront_enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tenant_id),
 CHECK(logo_url IS NULL OR logo_url ~ '^https://[^[:space:]]{1,2040}$'),
 CHECK(banner_url IS NULL OR banner_url ~ '^https://[^[:space:]]{1,2040}$')
);
CREATE TABLE pos_business_units (
 business_id uuid NOT NULL, tenant_id integer NOT NULL, unit_id integer NOT NULL,
 PRIMARY KEY(business_id,unit_id),
 FOREIGN KEY(business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(unit_id,tenant_id) REFERENCES unit_pendidikan(id,tenant_id)
);
CREATE TABLE pos_merchant_users (
 id uuid PRIMARY KEY, login text NOT NULL UNIQUE CHECK(length(login) BETWEEN 3 AND 120),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160), password_hash text NOT NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pos_merchant_memberships (
 business_id uuid NOT NULL, tenant_id integer NOT NULL, user_id uuid NOT NULL REFERENCES pos_merchant_users(id),
 role text NOT NULL CHECK(role IN ('OWNER','SUPERVISOR','CASHIER')),
 permissions text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(business_id,user_id), UNIQUE(business_id,tenant_id,user_id),
 FOREIGN KEY(business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id) ON DELETE CASCADE
);
CREATE TABLE pos_merchant_sessions (
 token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES pos_merchant_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_merchant_session_user ON pos_merchant_sessions(user_id);
CREATE TABLE pos_merchant_login_limits (
 key char(64) PRIMARY KEY, attempts integer NOT NULL CHECK(attempts>=0), started_at timestamptz NOT NULL
);
CREATE TABLE pos_business_products (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 sku text NOT NULL, barcode text, name text NOT NULL, category text, uom text NOT NULL DEFAULT 'pcs',
 image_url text, selling_price bigint NOT NULL CHECK(selling_price>0), minimum_stock bigint NOT NULL DEFAULT 0 CHECK(minimum_stock>=0),
 active boolean NOT NULL DEFAULT true, sellable boolean NOT NULL DEFAULT true,
 online_visible boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,sku), UNIQUE(id,business_id),
 CHECK(length(btrim(sku)) BETWEEN 1 AND 80), CHECK(length(btrim(name)) BETWEEN 1 AND 160),
 CHECK(image_url IS NULL OR image_url ~ '^https://[^[:space:]]{1,2040}$')
);
CREATE UNIQUE INDEX pos_business_product_barcode ON pos_business_products(business_id,barcode) WHERE barcode IS NOT NULL;
CREATE TABLE pos_business_parties (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('CUSTOMER','SUPPLIER')), name text NOT NULL,
 phone text, address text, notes text, active boolean NOT NULL DEFAULT true,
 credit_allowed boolean NOT NULL DEFAULT false, credit_limit bigint NOT NULL DEFAULT 0 CHECK(credit_limit>=0),
 due_days integer NOT NULL DEFAULT 0 CHECK(due_days BETWEEN 0 AND 365),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,business_id),
 FOREIGN KEY(business_id,created_by) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK(length(btrim(name)) BETWEEN 1 AND 160), CHECK(kind='CUSTOMER' OR NOT credit_allowed)
);
CREATE TABLE pos_business_accounts (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('CASH','BANK','QRIS','WALLET_CLEARING')),
 active boolean NOT NULL DEFAULT true, UNIQUE(id,business_id), UNIQUE(business_id,name)
);
CREATE TABLE pos_business_terminals (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(id,business_id)
);
CREATE TABLE pos_business_shifts (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, user_id uuid NOT NULL, terminal_id uuid NOT NULL,
 cash_account_id uuid NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 opening_cash bigint NOT NULL CHECK(opening_cash>=0), opened_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz, actual_cash bigint, expected_cash bigint, difference bigint,
 UNIQUE(id,business_id),
 FOREIGN KEY(business_id,user_id) REFERENCES pos_merchant_memberships(business_id,user_id),
 FOREIGN KEY(terminal_id,business_id) REFERENCES pos_business_terminals(id,business_id),
 FOREIGN KEY(cash_account_id,business_id) REFERENCES pos_business_accounts(id,business_id),
 CHECK((status='OPEN' AND closed_at IS NULL AND actual_cash IS NULL AND expected_cash IS NULL AND difference IS NULL)
 OR (status='CLOSED' AND closed_at IS NOT NULL AND actual_cash IS NOT NULL AND actual_cash>=0
 AND expected_cash IS NOT NULL AND difference IS NOT NULL AND difference=actual_cash-expected_cash))
);
CREATE UNIQUE INDEX pos_business_shift_user ON pos_business_shifts(business_id,user_id) WHERE status='OPEN';
CREATE UNIQUE INDEX pos_business_shift_terminal ON pos_business_shifts(business_id,terminal_id) WHERE status='OPEN';
CREATE UNIQUE INDEX pos_business_shift_drawer ON pos_business_shifts(business_id,cash_account_id) WHERE status='OPEN';
CREATE TABLE pos_business_operations (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN
 ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','AR_COLLECTION','AP_PAYMENT','STOCK_ADJUSTMENT',
 'OPENING','EXPENSE','OTHER_INCOME','CAPITAL','WITHDRAWAL','TRANSFER')),
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160), request_hash char(64) NOT NULL,
 total bigint NOT NULL CHECK(total>=0), paid bigint NOT NULL CHECK(paid BETWEEN 0 AND total),
 party_id uuid, due_date date, reference text, reason text,
 source_id uuid, channel text CHECK(channel IS NULL OR channel IN ('POS','ONLINE')),
 shift_id uuid, receipt_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,request_id), UNIQUE(id,business_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id),
 FOREIGN KEY(party_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(source_id,business_id) REFERENCES pos_business_operations(id,business_id),
 FOREIGN KEY(shift_id,business_id) REFERENCES pos_business_shifts(id,business_id),
 CHECK(kind NOT IN ('PURCHASE','SALE') OR total=paid OR (party_id IS NOT NULL AND due_date IS NOT NULL)),
 CHECK(kind<>'SALE' OR (channel IS NOT NULL AND receipt_snapshot IS NOT NULL AND (channel<>'POS' OR shift_id IS NOT NULL)))
);
CREATE TABLE pos_business_payments (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, operation_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('CASH','BANK','QRIS','CREDIT')),
 amount bigint NOT NULL CHECK(amount>0), account_id uuid, tendered bigint, change bigint, reference text,
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,business_id) REFERENCES pos_business_accounts(id,business_id),
 CHECK((method='CASH' AND account_id IS NOT NULL AND tendered>=amount AND change=tendered-amount)
 OR (method IN ('BANK','QRIS') AND account_id IS NOT NULL AND reference IS NOT NULL AND tendered IS NULL AND change IS NULL)
 OR (method='CREDIT' AND account_id IS NULL AND tendered IS NULL AND change IS NULL))
);
CREATE TABLE pos_business_lines (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, operation_id uuid NOT NULL, product_id uuid NOT NULL,
 sku text NOT NULL, name text NOT NULL, quantity bigint NOT NULL CHECK(quantity>0),
 unit_price bigint NOT NULL CHECK(unit_price>=0), discount bigint NOT NULL DEFAULT 0 CHECK(discount>=0),
 total bigint NOT NULL CHECK(total=quantity*unit_price-discount AND total>=0),
 cogs bigint NOT NULL CHECK(cogs>=0), UNIQUE(operation_id,product_id), UNIQUE(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id)
);
CREATE TABLE pos_inventory_movements (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, product_id uuid NOT NULL, operation_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity<>0), cost bigint NOT NULL CHECK(cost>=0),
 kind text NOT NULL CHECK(kind IN ('PURCHASE_IN','SALE_OUT','SALE_RETURN_IN','PURCHASE_RETURN_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','STOCK_OPNAME','DAMAGE')),
 reason text, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operation_id,product_id), UNIQUE(id,business_id), UNIQUE(id,business_id,product_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK((kind IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN') AND quantity>0)
 OR (kind IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT','DAMAGE') AND quantity<0) OR kind='STOCK_OPNAME')
);
CREATE TABLE pos_inventory_layers (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, product_id uuid NOT NULL, movement_id uuid NOT NULL,
 received_quantity bigint NOT NULL CHECK(received_quantity>0), unit_cost bigint NOT NULL CHECK(unit_cost>=0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,business_id), UNIQUE(id,business_id,product_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id),
 FOREIGN KEY(movement_id,business_id,product_id) REFERENCES pos_inventory_movements(id,business_id,product_id) ON DELETE CASCADE
);
CREATE TABLE pos_inventory_allocations (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, product_id uuid NOT NULL, layer_id uuid NOT NULL, movement_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),
 UNIQUE(layer_id,movement_id),
 FOREIGN KEY(layer_id,business_id,product_id) REFERENCES pos_inventory_layers(id,business_id,product_id) ON DELETE CASCADE,
 FOREIGN KEY(movement_id,business_id,product_id) REFERENCES pos_inventory_movements(id,business_id,product_id) ON DELETE CASCADE
);
CREATE TABLE pos_money_movements (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, account_id uuid NOT NULL, operation_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount<>0), actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operation_id,account_id),
 FOREIGN KEY(account_id,business_id) REFERENCES pos_business_accounts(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id)
);
CREATE TABLE pos_debt_movements (
 id uuid PRIMARY KEY, business_id uuid NOT NULL, party_id uuid NOT NULL, operation_id uuid NOT NULL,
 source_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('AR','AP')), amount bigint NOT NULL CHECK(amount<>0),
 due_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operation_id,source_id),
 FOREIGN KEY(party_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(source_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE
);
CREATE INDEX pos_stock_product ON pos_inventory_movements(business_id,product_id);
CREATE INDEX pos_layer_product ON pos_inventory_layers(business_id,product_id,created_at,id);
CREATE INDEX pos_debt_party ON pos_debt_movements(business_id,party_id,kind);
CREATE INDEX pos_money_account ON pos_money_movements(business_id,account_id);
CREATE INDEX pos_operation_period ON pos_business_operations(business_id,created_at);
CREATE FUNCTION pos_inventory_lock_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM pos_business_products WHERE id=NEW.product_id AND business_id=NEW.business_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_inventory_movement_lock BEFORE INSERT ON pos_inventory_movements FOR EACH ROW EXECUTE FUNCTION pos_inventory_lock_product();
CREATE TRIGGER pos_inventory_layer_lock BEFORE INSERT ON pos_inventory_layers FOR EACH ROW EXECUTE FUNCTION pos_inventory_lock_product();
CREATE TRIGGER pos_inventory_allocation_lock BEFORE INSERT ON pos_inventory_allocations FOR EACH ROW EXECUTE FUNCTION pos_inventory_lock_product();

-- No DELETE trigger: authorized tenant lifecycle remains possible. No API delete.
CREATE FUNCTION pos_business_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted merchant history is immutable' USING ERRCODE='23514'; END $$;
CREATE FUNCTION pos_business_shift_close() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'OPEN' OR NEW.status<>'CLOSED' OR
 (to_jsonb(OLD)-ARRAY['status','closed_at','actual_cash','expected_cash','difference']) IS DISTINCT FROM
 (to_jsonb(NEW)-ARRAY['status','closed_at','actual_cash','expected_cash','difference']) THEN
 RAISE EXCEPTION 'Shift closure is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_business_shift_history BEFORE UPDATE ON pos_business_shifts FOR EACH ROW EXECUTE FUNCTION pos_business_shift_close();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pos_business_operations','pos_business_lines','pos_inventory_movements',
 'pos_inventory_layers','pos_inventory_allocations','pos_money_movements','pos_debt_movements','pos_business_payments'] LOOP
 EXECUTE format('CREATE TRIGGER pos_business_history BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION pos_business_immutable()',t);
 END LOOP;
END $$;
-- Commit-time protection catches missing ledger legs and contradictory stock.
CREATE FUNCTION pos_business_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_business_operations%ROWTYPE; oid uuid; money bigint; debt bigint; lines bigint;
BEGIN
 IF TG_TABLE_NAME='pos_business_operations' THEN oid:=NEW.id;
 ELSIF TG_TABLE_NAME='pos_inventory_layers' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSIF TG_TABLE_NAME='pos_inventory_allocations' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSE oid:=NEW.operation_id; END IF;
 SELECT * INTO o FROM pos_business_operations WHERE id=oid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum(amount),0) INTO money FROM pos_money_movements WHERE operation_id=oid;
 SELECT coalesce(sum(amount),0) INTO debt FROM pos_debt_movements WHERE operation_id=oid;
 SELECT coalesce(sum(total),0) INTO lines FROM pos_business_lines WHERE operation_id=oid;
 IF (o.kind='PURCHASE' AND (money<>-o.paid OR debt<>o.total-o.paid OR lines<>o.total))
 OR (o.kind='SALE' AND (money<>o.paid OR debt<>o.total-o.paid OR lines<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid)<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid AND method='CREDIT')<>debt))
 OR (o.kind IN ('AP_PAYMENT','AR_COLLECTION') AND (debt<>-o.total OR money<>CASE WHEN o.kind='AP_PAYMENT' THEN -o.total ELSE o.total END))
 OR (o.kind IN ('OPENING','CAPITAL','OTHER_INCOME') AND (money<>o.total OR debt<>0))
 OR (o.kind IN ('EXPENSE','WITHDRAWAL') AND (money<>-o.total OR debt<>0))
 OR (o.kind='TRANSFER' AND (money<>0 OR (SELECT count(*) FROM pos_money_movements WHERE operation_id=oid)<>2))
 OR (o.kind='STOCK_ADJUSTMENT' AND (money<>0 OR debt<>0)) THEN
  RAISE EXCEPTION 'Merchant money/debt/item reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='SALE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='SALE_OUT' AND -m.quantity=l.quantity AND m.cost=l.cogs)) THEN
  RAISE EXCEPTION 'Sale stock/COGS reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='PURCHASE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='PURCHASE_IN' AND m.quantity=l.quantity AND m.cost=l.total)) THEN
  RAISE EXCEPTION 'Purchase stock reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_layers l WHERE l.business_id=o.business_id AND
    l.received_quantity<(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE layer_id=l.id)) THEN
  RAISE EXCEPTION 'Inventory oversold' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND (
   (m.quantity>0 AND (m.quantity<>(SELECT coalesce(sum(received_quantity),0) FROM pos_inventory_layers WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(received_quantity*unit_cost),0) FROM pos_inventory_layers WHERE movement_id=m.id)))
   OR (m.quantity<0 AND (-m.quantity<>(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(a.quantity*l.unit_cost),0) FROM pos_inventory_allocations a JOIN pos_inventory_layers l ON l.id=a.layer_id WHERE a.movement_id=m.id))))) THEN
  RAISE EXCEPTION 'Inventory quantity/cost reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_debt_movements WHERE business_id=o.business_id GROUP BY source_id HAVING sum(amount)<0) THEN
  RAISE EXCEPTION 'Debt overpayment' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pos_business_operations','pos_business_lines','pos_inventory_movements',
 'pos_inventory_layers','pos_inventory_allocations','pos_money_movements','pos_debt_movements','pos_business_payments'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER pos_business_reconciliation AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_business_reconciles()',t);
 END LOOP;
END $$;
COMMIT;
