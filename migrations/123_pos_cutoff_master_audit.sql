BEGIN;
-- Reconciliation snapshot, never a second money/stock/debt ledger.
CREATE TABLE public.pos_business_cutoffs (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL UNIQUE,
 tenant_id integer NOT NULL,
 finalized_by uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160),
 request_hash char(64) NOT NULL,
 snapshot_hash char(64) NOT NULL,
 cutoff_date date NOT NULL,
 snapshot jsonb NOT NULL,
 reason text NOT NULL,
 evidence_reference text NOT NULL,
 finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(business_id,tenant_id) REFERENCES public.pos_businesses(id,tenant_id),
 FOREIGN KEY(business_id,finalized_by) REFERENCES public.pos_merchant_memberships(business_id,user_id)
);
CREATE TRIGGER pos_cutoff_immutable BEFORE UPDATE OR DELETE ON public.pos_business_cutoffs FOR EACH ROW EXECUTE FUNCTION public.pos_policy_immutable();
ALTER TABLE public.pos_business_policy_events DROP CONSTRAINT pos_business_policy_events_kind_check;
ALTER TABLE public.pos_business_policy_events ADD CONSTRAINT pos_business_policy_events_kind_check CHECK(kind IN
 ('SHIFT_HANDOVER','IDENTITY_CHANGE','OPNAME_DRAFT','OPNAME_APPROVAL','CREDENTIAL_ISSUE','CREDENTIAL_REPLACE','CREDENTIAL_REVOKE','CUTOFF_FINALIZED','CUTOFF_CORRECTION','MASTER_CHANGED'));
CREATE FUNCTION public.pos_master_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_data jsonb; new_data jsonb; row_data jsonb; actor uuid; scope uuid; tid integer;
BEGIN
 old_data:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 new_data:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 row_data:=COALESCE(new_data,old_data);
 IF old_data IS NOT DISTINCT FROM new_data THEN RETURN COALESCE(NEW,OLD); END IF;
 actor:=NULLIF(current_setting('app.pos_actor',true),'')::uuid;
 scope:=NULLIF(current_setting('app.pos_business',true),'')::uuid;
 -- Maintenance/fixture owner SQL has no merchant context. Normal application
 -- mutations set verified actor/business transaction-locally in access().
 IF actor IS NOT NULL AND scope=(row_data->>'business_id')::uuid THEN
  SELECT tenant_id INTO tid FROM public.pos_businesses WHERE id=scope;
  INSERT INTO public.pos_business_policy_events(id,business_id,tenant_id,actor_id,kind,request_id,request_hash,subject_id,payload)
  VALUES(gen_random_uuid(),scope,tid,actor,'MASTER_CHANGED',gen_random_uuid()::text,md5(COALESCE(old_data::text,'')||COALESCE(new_data::text,''))||md5(TG_TABLE_NAME),
    scope,jsonb_build_object('table',TG_TABLE_NAME,'action',TG_OP,'before',old_data,'after',new_data));
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['pos_business_products','pos_price_levels','pos_product_level_prices','pos_price_promotions','pos_price_bundle_components'] LOOP
  EXECUTE format('CREATE TRIGGER pos_master_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pos_master_audit()',tbl);
 END LOOP;
END $$;

ALTER TABLE public.pos_business_cutoffs ADD CONSTRAINT pos_cutoff_id_business UNIQUE(id,business_id);
CREATE TABLE public.pos_business_cutoff_corrections (
 id uuid PRIMARY KEY,cutoff_id uuid NOT NULL,business_id uuid NOT NULL,
 operation_id uuid NOT NULL UNIQUE, audit_event_id uuid NOT NULL UNIQUE REFERENCES public.pos_business_policy_events(id),
 kind text NOT NULL CHECK(kind IN('ACCOUNT','INVENTORY','AR','AP')),
 account_id uuid,product_id uuid,debt_source_id uuid,
 amount_delta bigint NOT NULL,quantity_delta bigint,unit_cost bigint,
 actor_id uuid NOT NULL,reason text NOT NULL,evidence_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(cutoff_id,business_id) REFERENCES public.pos_business_cutoffs(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES public.pos_business_operations(id,business_id),
 FOREIGN KEY(account_id,business_id) REFERENCES public.pos_business_accounts(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES public.pos_business_products(id,business_id),
 FOREIGN KEY(debt_source_id,business_id) REFERENCES public.pos_business_operations(id,business_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES public.pos_merchant_memberships(business_id,user_id),
 CHECK((kind='ACCOUNT' AND account_id IS NOT NULL AND product_id IS NULL AND debt_source_id IS NULL AND amount_delta<>0 AND quantity_delta IS NULL AND unit_cost IS NULL)
 OR(kind IN('AR','AP') AND account_id IS NULL AND product_id IS NULL AND debt_source_id IS NOT NULL AND amount_delta<>0 AND quantity_delta IS NULL AND unit_cost IS NULL)
 OR(kind='INVENTORY' AND account_id IS NULL AND product_id IS NOT NULL AND debt_source_id IS NULL AND quantity_delta<>0 AND ((quantity_delta>0 AND unit_cost>=0 AND amount_delta=quantity_delta*unit_cost) OR(quantity_delta<0 AND amount_delta<=0 AND unit_cost IS NULL))))
);
CREATE TRIGGER pos_cutoff_correction_immutable BEFORE UPDATE OR DELETE ON public.pos_business_cutoff_corrections FOR EACH ROW EXECUTE FUNCTION public.pos_policy_immutable();

-- Preserve all original reconciliation branches; add the typed cutoff journal alternative only.
CREATE OR REPLACE FUNCTION pos_business_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_business_operations%ROWTYPE; oid uuid; money bigint; debt bigint; lines bigint;
BEGIN
 IF TG_TABLE_NAME='pos_business_operations' THEN oid:=NEW.id;
 ELSIF TG_TABLE_NAME='pos_inventory_layers' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSIF TG_TABLE_NAME='pos_inventory_allocations' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSE oid:=NEW.operation_id; END IF;
 SELECT * INTO o FROM pos_business_operations WHERE id=oid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum(amount),0) INTO money FROM pos_money_movements WHERE operation_id=oid;
 SELECT coalesce(sum(amount),0) INTO debt FROM pos_debt_movements WHERE operation_id=oid;
 SELECT coalesce(sum(total),0) INTO lines FROM pos_business_lines WHERE operation_id=oid;
 IF (o.kind='PURCHASE' AND (money<>-o.paid OR debt<>o.total-o.paid OR lines<>o.total))
 OR (o.kind='SALE' AND (money<>o.paid OR debt<>o.total-o.paid OR lines<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid)<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid AND method='CREDIT')<>debt))
 OR (o.kind IN ('AP_PAYMENT','AR_COLLECTION') AND (debt<>-o.total OR money<>CASE WHEN o.kind='AP_PAYMENT' THEN -o.total ELSE o.total END))
 OR (o.kind='OPENING_AR' AND (money<>0 OR debt<>o.total OR NOT EXISTS(SELECT 1 FROM pos_debt_movements WHERE operation_id=oid AND kind='AR')))
 OR (o.kind='OPENING_AP' AND (money<>0 OR debt<>o.total OR NOT EXISTS(SELECT 1 FROM pos_debt_movements WHERE operation_id=oid AND kind='AP')))
 OR (o.kind IN ('OPENING','CAPITAL','OTHER_INCOME') AND (money<>o.total OR debt<>0))
 OR (o.kind IN ('EXPENSE','WITHDRAWAL') AND (money<>-o.total OR debt<>0))
 OR (o.kind='TRANSFER' AND (money<>0 OR (SELECT count(*) FROM pos_money_movements WHERE operation_id=oid)<>2))
 OR (o.kind='STOCK_ADJUSTMENT' AND (money<>0 OR debt<>0)) THEN
  RAISE EXCEPTION 'Merchant money/debt/item reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='OPENING_ADJUSTMENT' AND NOT EXISTS(
   SELECT 1 FROM pos_business_initialization_corrections c WHERE c.operation_id=oid AND c.business_id=o.business_id
   AND o.total=abs(c.amount_delta)
   AND ((c.kind='ACCOUNT' AND money=c.amount_delta AND debt=0)
     OR (c.kind='RECEIVABLE' AND money=0 AND debt=c.amount_delta AND EXISTS(SELECT 1 FROM pos_debt_movements d WHERE d.operation_id=oid AND d.kind='AR'))
     OR (c.kind='PAYABLE' AND money=0 AND debt=c.amount_delta AND EXISTS(SELECT 1 FROM pos_debt_movements d WHERE d.operation_id=oid AND d.kind='AP'))
     OR (c.kind='INVENTORY' AND money=0 AND debt=0 AND EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.quantity=c.quantity_delta AND m.cost=abs(c.amount_delta)))))
 AND NOT EXISTS(SELECT 1 FROM public.pos_business_cutoff_corrections c
 JOIN public.pos_business_policy_events e ON e.id=c.audit_event_id AND e.business_id=c.business_id AND e.kind='CUTOFF_CORRECTION' AND e.actor_id=c.actor_id AND e.subject_id=c.cutoff_id
 WHERE c.operation_id=oid AND c.business_id=o.business_id AND o.total=abs(c.amount_delta)
 AND (SELECT count(*) FROM pos_business_lines WHERE operation_id=oid)=0
 AND (SELECT count(*) FROM pos_business_payments WHERE operation_id=oid)=0
 AND ((c.kind='ACCOUNT' AND money=c.amount_delta AND debt=0 AND (SELECT count(*) FROM pos_money_movements WHERE operation_id=oid)=1
  AND EXISTS(SELECT 1 FROM pos_money_movements m WHERE m.operation_id=oid AND m.account_id=c.account_id AND m.amount=c.amount_delta) AND NOT EXISTS(SELECT 1 FROM pos_inventory_movements WHERE operation_id=oid))
 OR(c.kind IN('AR','AP') AND money=0 AND debt=c.amount_delta AND (SELECT count(*) FROM pos_debt_movements WHERE operation_id=oid)=1
  AND EXISTS(SELECT 1 FROM pos_debt_movements d WHERE d.operation_id=oid AND d.source_id=c.debt_source_id AND d.kind=c.kind AND d.amount=c.amount_delta) AND NOT EXISTS(SELECT 1 FROM pos_inventory_movements WHERE operation_id=oid))
 OR(c.kind='INVENTORY' AND money=0 AND debt=0 AND (SELECT count(*) FROM pos_inventory_movements WHERE operation_id=oid)=1
  AND EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=c.product_id AND m.quantity=c.quantity_delta AND m.cost=abs(c.amount_delta)))))

 THEN RAISE EXCEPTION 'Opening correction reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='SALE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='SALE_OUT' AND -m.quantity=l.quantity AND m.cost=l.cogs)) THEN
  RAISE EXCEPTION 'Sale stock/COGS reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='PURCHASE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='PURCHASE_IN' AND m.quantity=l.quantity AND m.cost=l.total)) THEN
  RAISE EXCEPTION 'Purchase stock reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_layers l WHERE l.business_id=o.business_id AND
    l.received_quantity<(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE layer_id=l.id)) THEN
  RAISE EXCEPTION 'Inventory oversold' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND (
   (m.quantity>0 AND (m.quantity<>(SELECT coalesce(sum(received_quantity),0) FROM pos_inventory_layers WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(received_quantity*unit_cost),0) FROM pos_inventory_layers WHERE movement_id=m.id)))
   OR (m.quantity<0 AND (-m.quantity<>(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(a.quantity*l.unit_cost),0) FROM pos_inventory_allocations a JOIN pos_inventory_layers l ON l.id=a.layer_id WHERE a.movement_id=m.id))))) THEN
  RAISE EXCEPTION 'Inventory quantity/cost reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_debt_movements WHERE business_id=o.business_id GROUP BY source_id HAVING sum(amount)<0) THEN
  RAISE EXCEPTION 'Debt overpayment' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;

COMMIT;
