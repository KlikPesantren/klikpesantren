BEGIN;

ALTER TABLE pos_businesses
  ADD COLUMN accounting_start_date date,
  ADD COLUMN onboarding_completed_at timestamptz;

CREATE TABLE pos_business_provision_requests (
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160),
  request_hash char(64) NOT NULL,
  business_id uuid NOT NULL,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id) ON DELETE CASCADE
);

CREATE TABLE pos_business_admin_audit (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  tenant_id integer NOT NULL,
  actor_user_id integer NOT NULL,
  action text NOT NULL CHECK(action IN
    ('MERCHANT_CREATED','MERCHANT_STATUS_CHANGED','INTEGRATION_CHANGED','OWNER_ACTIVATION_REISSUED')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id) ON DELETE CASCADE
);

CREATE INDEX pos_business_admin_audit_history
  ON pos_business_admin_audit(business_id,created_at DESC,id);

COMMIT;
