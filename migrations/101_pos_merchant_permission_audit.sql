BEGIN;
CREATE TABLE pos_merchant_permission_audit (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, target_user_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('MEMBER_CREATED','MEMBER_UPDATED','CREDENTIAL_RESET')),
 before_state jsonb, after_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id),
 FOREIGN KEY(business_id,target_user_id) REFERENCES pos_merchant_memberships(business_id,user_id)
);
CREATE INDEX pos_merchant_permission_audit_business_time ON pos_merchant_permission_audit(business_id,created_at DESC);
COMMIT;
