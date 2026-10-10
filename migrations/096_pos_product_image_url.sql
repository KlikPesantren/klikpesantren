-- Optional public asset URL only. No binary storage, backfill, money or ownership change.
ALTER TABLE public.pos_products ADD COLUMN image_url text;
ALTER TABLE public.pos_products ADD CONSTRAINT pos_product_image_url_check
CHECK (image_url IS NULL OR (length(image_url) <= 2048 AND image_url ~ '^https://[^[:space:]]+$'));
