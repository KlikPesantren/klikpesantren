BEGIN;
CREATE TABLE IF NOT EXISTS pos_price_levels (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80), currency text NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 is_default boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 UNIQUE(id,business_id), CHECK(NOT is_default OR (active AND name='Harga Umum'))
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_price_level_name ON pos_price_levels(business_id,lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS pos_price_level_default ON pos_price_levels(business_id) WHERE is_default;
CREATE TABLE IF NOT EXISTS pos_product_level_prices (
 business_id uuid NOT NULL, level_id uuid NOT NULL, product_id uuid NOT NULL,
 price bigint NOT NULL CHECK(price>=0), PRIMARY KEY(business_id,level_id,product_id),
 FOREIGN KEY(level_id,business_id) REFERENCES pos_price_levels(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id)
);
ALTER TABLE pos_business_parties ADD COLUMN IF NOT EXISTS price_level_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pos_party_price_level_scope') THEN
 ALTER TABLE pos_business_parties ADD CONSTRAINT pos_party_price_level_scope
 FOREIGN KEY(price_level_id,business_id) REFERENCES pos_price_levels(id,business_id); END IF;
END $$;
CREATE TABLE IF NOT EXISTS pos_price_promotions (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 kind text NOT NULL CHECK(kind IN('QUANTITY','BUNDLE')), product_id uuid, threshold bigint,
 group_price bigint NOT NULL CHECK(group_price>=0), mode text NOT NULL DEFAULT 'EVERY' CHECK(mode IN('EVERY','ONCE')),
 priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100000 AND 100000),
 level_id uuid, starts_at timestamptz, ends_at timestamptz, active boolean NOT NULL DEFAULT true,
 UNIQUE(id,business_id), CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at),
 CHECK((kind='QUANTITY' AND product_id IS NOT NULL AND threshold>0) OR (kind='BUNDLE' AND product_id IS NULL AND threshold IS NULL)),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id),
 FOREIGN KEY(level_id,business_id) REFERENCES pos_price_levels(id,business_id)
);
CREATE INDEX IF NOT EXISTS pos_price_promo_lookup ON pos_price_promotions(business_id,active,priority DESC,id);
CREATE TABLE IF NOT EXISTS pos_price_bundle_components (
 business_id uuid NOT NULL,promotion_id uuid NOT NULL,product_id uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),
 PRIMARY KEY(business_id,promotion_id,product_id),
 FOREIGN KEY(promotion_id,business_id) REFERENCES pos_price_promotions(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id)
);
ALTER TABLE pos_business_lines ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;
ALTER TABLE pos_business_lines ADD COLUMN IF NOT EXISTS uom_snapshot text;
INSERT INTO pos_price_levels(id,business_id,name,is_default)
 SELECT gen_random_uuid(),id,'Harga Umum',true FROM pos_businesses
 ON CONFLICT DO NOTHING;
COMMIT;
