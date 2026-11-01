BEGIN;
-- EXPLAIN on 531 movements showed 1.67M repeated initialization lookups from flattened outer joins.
-- Scalar lookup is cardinality-safe and COALESCE never executes it for new dated history.
CREATE OR REPLACE VIEW pos_business_dated_operations AS
 SELECT o.*,coalesce(o.accounting_date,
  (SELECT i.accounting_start_date FROM pos_business_initializations i
   WHERE i.business_id=o.business_id AND EXISTS(
    SELECT 1 FROM pos_business_initialization_items ii WHERE ii.business_id=o.business_id AND ii.operation_id=o.id)),
  (o.created_at AT TIME ZONE b.timezone)::date) effective_date,
 coalesce(o.accounting_timezone,b.timezone) effective_timezone
 FROM pos_business_operations o JOIN pos_businesses b ON b.id=o.business_id;
CREATE INDEX pos_initialization_operation_lookup ON pos_business_initialization_items(business_id,operation_id);
COMMIT;

