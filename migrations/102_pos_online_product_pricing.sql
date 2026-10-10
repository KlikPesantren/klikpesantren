BEGIN;
ALTER TABLE pos_business_products
  ADD COLUMN online_price bigint CHECK (online_price IS NULL OR online_price > 0);

-- Preserve the effective public price of products that were already published
-- before online pricing became independently configurable.
UPDATE pos_business_products
SET online_price = selling_price
WHERE online_visible AND online_price IS NULL;
COMMIT;
