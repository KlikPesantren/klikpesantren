BEGIN;
-- Add metadata to the canonical operations; never rewrite posted financial amounts.
CREATE TABLE pos_finance_categories (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id),
 kind text NOT NULL CHECK(kind IN('EXPENSE','OTHER_INCOME')), code text NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), active boolean NOT NULL DEFAULT true,
 UNIQUE(id,business_id), UNIQUE(business_id,kind,code)
);
INSERT INTO pos_finance_categories(id,business_id,kind,code,name)
SELECT md5(b.id::text||v.code)::uuid,b.id,v.kind,v.code,v.name FROM pos_businesses b CROSS JOIN
(VALUES ('EXPENSE','UTILITIES','Listrik dan utilitas'),('EXPENSE','SALARY','Gaji'),
 ('EXPENSE','TRANSPORT','Transportasi'),('EXPENSE','CLEANING','Kebersihan'),('EXPENSE','MAINTENANCE','Perawatan'),
 ('EXPENSE','OTHER_EXPENSE','Operasional lainnya'),('EXPENSE','BANK_FEE','Biaya administrasi bank'),
 ('OTHER_INCOME','CARDBOARD','Penjualan kardus bekas'),('OTHER_INCOME','SERVICE','Pendapatan jasa'),
 ('OTHER_INCOME','OTHER_INCOME','Pendapatan operasional lain')) v(kind,code,name);
CREATE FUNCTION pos_finance_seed_categories() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
INSERT INTO pos_finance_categories(id,business_id,kind,code,name)
SELECT md5(b.id::text||v.code)::uuid,b.id,v.kind,v.code,v.name FROM (SELECT NEW.id id) b CROSS JOIN
(VALUES ('EXPENSE','UTILITIES','Listrik dan utilitas'),('EXPENSE','SALARY','Gaji'),
 ('EXPENSE','TRANSPORT','Transportasi'),('EXPENSE','CLEANING','Kebersihan'),('EXPENSE','MAINTENANCE','Perawatan'),
 ('EXPENSE','OTHER_EXPENSE','Operasional lainnya'),('EXPENSE','BANK_FEE','Biaya administrasi bank'),
 ('OTHER_INCOME','CARDBOARD','Penjualan kardus bekas'),('OTHER_INCOME','SERVICE','Pendapatan jasa'),
 ('OTHER_INCOME','OTHER_INCOME','Pendapatan operasional lain')) v(kind,code,name);

RETURN NEW; END $$;
CREATE TRIGGER pos_finance_seed_categories AFTER INSERT ON pos_businesses FOR EACH ROW EXECUTE FUNCTION pos_finance_seed_categories();
ALTER TABLE pos_business_operations ADD COLUMN accounting_date date,
 ADD COLUMN accounting_timezone text, ADD COLUMN finance_category_id uuid,
 ADD CONSTRAINT pos_operation_category_scope FOREIGN KEY(finance_category_id,business_id) REFERENCES pos_finance_categories(id,business_id);
-- Legacy dates are derived from recorded initialization dates or the merchant timezone.
-- Lock timezone after activity, including legacy rows, rather than guessing a historic timezone.
CREATE FUNCTION pos_accounting_timezone_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.timezone IS DISTINCT FROM OLD.timezone AND EXISTS(SELECT 1 FROM pos_business_operations WHERE business_id=OLD.id)
 THEN RAISE EXCEPTION 'ACCOUNTING_TIMEZONE_LOCKED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_accounting_timezone_guard BEFORE UPDATE ON pos_businesses FOR EACH ROW EXECUTE FUNCTION pos_accounting_timezone_guard();
CREATE FUNCTION pos_operation_accounting_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE zone text; start_date date; opening_date date;
BEGIN
 SELECT timezone,accounting_start_date INTO zone,start_date FROM pos_businesses WHERE id=NEW.business_id;
 NEW.accounting_timezone:=zone;
 IF NEW.reference LIKE 'INIT:%' THEN
  SELECT accounting_start_date INTO opening_date FROM pos_business_initializations
  WHERE business_id=NEW.business_id AND 'INIT:'||id::text=NEW.reference;
 END IF;
 NEW.accounting_date:=coalesce(opening_date,NEW.accounting_date,(NEW.created_at AT TIME ZONE zone)::date);
 IF NEW.accounting_date>(now() AT TIME ZONE zone)::date OR (start_date IS NOT NULL AND NEW.accounting_date<start_date)
 THEN RAISE EXCEPTION 'INVALID_ACCOUNTING_DATE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_operation_accounting_date BEFORE INSERT ON pos_business_operations FOR EACH ROW EXECUTE FUNCTION pos_operation_accounting_date();
CREATE VIEW pos_business_dated_operations AS
 SELECT o.*,coalesce(o.accounting_date,i.accounting_start_date,(o.created_at AT TIME ZONE b.timezone)::date) effective_date,
 coalesce(o.accounting_timezone,b.timezone) effective_timezone
 FROM pos_business_operations o JOIN pos_businesses b ON b.id=o.business_id
 LEFT JOIN pos_business_initialization_items ii ON ii.operation_id=o.id AND ii.business_id=o.business_id
 LEFT JOIN pos_business_initializations i ON i.id=ii.initialization_id AND i.business_id=ii.business_id;
ALTER TABLE pos_money_movements ADD COLUMN attributed_shift_id uuid,
 ADD CONSTRAINT pos_money_shift_scope FOREIGN KEY(attributed_shift_id,business_id) REFERENCES pos_business_shifts(id,business_id);
-- A movement on an active physical drawer belongs to that drawer's shift only on its actual business date.
-- NOWAIT fails and rolls back a competing posting instead of introducing a lock-order deadlock.
CREATE FUNCTION pos_money_shift_attribute() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s pos_business_shifts%ROWTYPE; d date; z text;
BEGIN
 SELECT effective_date,effective_timezone INTO d,z FROM pos_business_dated_operations WHERE id=NEW.operation_id AND business_id=NEW.business_id;
 SELECT * INTO s FROM pos_business_shifts WHERE business_id=NEW.business_id AND cash_account_id=NEW.account_id AND status='OPEN'
  FOR SHARE NOWAIT;
 IF FOUND AND d=(NEW.created_at AT TIME ZONE z)::date AND NEW.created_at>=s.opened_at THEN NEW.attributed_shift_id:=s.id;
 ELSIF FOUND THEN RAISE EXCEPTION 'ACTIVE_DRAWER_REQUIRES_CURRENT_DATE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_money_shift_attribute BEFORE INSERT ON pos_money_movements FOR EACH ROW EXECUTE FUNCTION pos_money_shift_attribute();
CREATE INDEX pos_operation_accounting_period ON pos_business_operations(business_id,accounting_date,created_at,id);
CREATE INDEX pos_money_shift_attribution ON pos_money_movements(business_id,attributed_shift_id) WHERE attributed_shift_id IS NOT NULL;
CREATE INDEX pos_operation_party_period ON pos_business_operations(business_id,party_id,accounting_date) WHERE party_id IS NOT NULL;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pos_business_v2_fixture_runtime') THEN
  GRANT SELECT ON pos_business_dated_operations TO pos_business_v2_fixture_runtime;
  GRANT SELECT,INSERT ON pos_finance_categories TO pos_business_v2_fixture_runtime;
 END IF;
END $$;
COMMIT;

