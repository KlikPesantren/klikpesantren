BEGIN;

ALTER TABLE public.pos_business_products
  DROP CONSTRAINT pos_business_products_reference_purchase_price_check;

ALTER TABLE public.pos_business_products
  DROP COLUMN reference_purchase_price;

COMMIT;
