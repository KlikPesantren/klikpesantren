BEGIN;
DROP TABLE IF EXISTS pos_business_admin_audit;
DROP TABLE IF EXISTS pos_business_provision_requests;
ALTER TABLE pos_businesses
  DROP COLUMN IF EXISTS onboarding_completed_at,
  DROP COLUMN IF EXISTS accounting_start_date;
COMMIT;
