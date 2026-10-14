-- Informational merchant master value only. FIFO layers and historical COGS remain canonical.
BEGIN;

ALTER TABLE public.pos_business_products
  ADD COLUMN reference_purchase_price bigint;

ALTER TABLE public.pos_business_products
  ADD CONSTRAINT pos_business_products_reference_purchase_price_check
  CHECK (reference_purchase_price IS NULL OR reference_purchase_price >= 0);

COMMIT;
