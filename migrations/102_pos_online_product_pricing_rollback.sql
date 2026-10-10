BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pos_business_products
    WHERE online_price IS NOT NULL AND online_price <> selling_price
  ) THEN
    RAISE EXCEPTION 'Cannot remove independent online prices while configured values exist'
      USING ERRCODE = '23514';
  END IF;
END $$;
ALTER TABLE pos_business_products DROP COLUMN online_price;
COMMIT;
