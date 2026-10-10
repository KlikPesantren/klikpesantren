BEGIN;
CREATE TABLE pos_merchant_activation_tokens (
 business_id uuid NOT NULL, user_id uuid NOT NULL, token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,user_id),
 FOREIGN KEY(business_id,user_id) REFERENCES pos_merchant_memberships(business_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(business_id,created_by) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK(expires_at>created_at)
);
CREATE INDEX pos_merchant_activation_expiry ON pos_merchant_activation_tokens(expires_at);
COMMIT;
