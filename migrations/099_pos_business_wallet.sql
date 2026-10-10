BEGIN;
-- No backfill, UID mutation, settlement or changes to checkpointed migrations.
CREATE UNIQUE INDEX pos_business_wallet_clearing_unique ON pos_business_accounts(business_id) WHERE kind='WALLET_CLEARING';
CREATE UNIQUE INDEX pos_business_wallet_transaction_scope_unique ON wallet_transactions(id,tenant_id);
ALTER TABLE pos_business_payments ADD CONSTRAINT pos_business_payment_business_unique UNIQUE(id,business_id);
ALTER TABLE pos_business_payments DROP CONSTRAINT pos_business_payments_method_check;
ALTER TABLE pos_business_payments DROP CONSTRAINT pos_business_payments_check;
ALTER TABLE pos_business_payments ADD CONSTRAINT pos_business_payments_method_check CHECK(method IN('CASH','BANK','QRIS','CREDIT','DOMPET_SANTRI'));
ALTER TABLE pos_business_payments ADD COLUMN credential_method text CHECK(credential_method IN('RFID','BARCODE','QR'));
ALTER TABLE pos_business_payments ADD CONSTRAINT pos_business_payments_check CHECK(
 (method='CASH' AND account_id IS NOT NULL AND tendered>=amount AND change=tendered-amount)
 OR (method IN('BANK','QRIS') AND account_id IS NOT NULL AND reference IS NOT NULL AND tendered IS NULL AND change IS NULL)
 OR (method='CREDIT' AND account_id IS NULL AND tendered IS NULL AND change IS NULL)
 OR (method='DOMPET_SANTRI' AND account_id IS NOT NULL AND tendered IS NULL AND change IS NULL AND reference IS NULL AND credential_method IS NOT NULL));
CREATE TABLE pos_wallet_credentials(
 id uuid PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),santri_id integer NOT NULL,
 created_business_id uuid NOT NULL,created_by uuid NOT NULL,token_hash char(64) NOT NULL,
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz,
 UNIQUE(tenant_id,token_hash),FOREIGN KEY(santri_id,tenant_id) REFERENCES santri(id,tenant_id),
 FOREIGN KEY(created_business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id),
 FOREIGN KEY(created_business_id,created_by) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK(active=(revoked_at IS NULL))
);
CREATE TABLE pos_wallet_credential_audits(
 id uuid PRIMARY KEY,credential_id uuid NOT NULL REFERENCES pos_wallet_credentials(id),business_id uuid NOT NULL,
 actor_id uuid NOT NULL,action text NOT NULL CHECK(action IN('PROVISION','REVOKE')),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,actor_id) REFERENCES pos_merchant_memberships(business_id,user_id)
);
CREATE TABLE pos_business_wallet_links(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,operation_id uuid NOT NULL,payment_id uuid NOT NULL,
 tenant_id integer NOT NULL,unit_id integer NOT NULL,wallet_account_id bigint NOT NULL,wallet_transaction_id bigint NOT NULL UNIQUE,
 direction text NOT NULL CHECK(direction IN('debit','credit')),amount bigint NOT NULL CHECK(amount>0),
 FOREIGN KEY(business_id,tenant_id) REFERENCES pos_businesses(id,tenant_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id),
 FOREIGN KEY(payment_id,business_id) REFERENCES pos_business_payments(id,business_id),
 FOREIGN KEY(wallet_account_id,tenant_id,unit_id) REFERENCES wallet_accounts(id,tenant_id,unit_id),
 FOREIGN KEY(wallet_transaction_id,tenant_id) REFERENCES wallet_transactions(id,tenant_id),
 UNIQUE(operation_id,payment_id)
);
CREATE INDEX pos_business_wallet_original_payment ON pos_business_wallet_links(payment_id,direction);
CREATE FUNCTION pos_business_wallet_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p pos_business_payments%ROWTYPE;l pos_business_wallet_links%ROWTYPE;wt wallet_transactions%ROWTYPE;o pos_business_operations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='pos_money_movements' THEN
  IF EXISTS(SELECT 1 FROM pos_business_accounts WHERE id=NEW.account_id AND kind='WALLET_CLEARING') AND NEW.amount<>
   (SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) FROM pos_business_wallet_links WHERE operation_id=NEW.operation_id) THEN
   RAISE EXCEPTION 'Wallet clearing requires canonical Wallet effects' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='pos_business_payments' THEN
  IF NEW.method<>'DOMPET_SANTRI' THEN RETURN NULL;END IF;
  IF (SELECT count(*) FROM pos_business_wallet_links WHERE payment_id=NEW.id AND direction='debit')<>1 THEN
   RAISE EXCEPTION 'Wallet payment requires one canonical debit' USING ERRCODE='23514';END IF;
  RETURN NULL;
 END IF;
 l:=NEW;SELECT * INTO p FROM pos_business_payments WHERE id=l.payment_id;
 SELECT * INTO o FROM pos_business_operations WHERE id=l.operation_id;
 SELECT * INTO wt FROM wallet_transactions WHERE id=l.wallet_transaction_id;
 IF p.method<>'DOMPET_SANTRI' OR NOT EXISTS(SELECT 1 FROM pos_business_accounts WHERE id=p.account_id AND kind='WALLET_CLEARING')
 OR wt.wallet_account_id<>l.wallet_account_id OR wt.unit_id<>l.unit_id OR wt.direction<>l.direction OR wt.amount<>l.amount
 OR wt.santri_id<>(SELECT santri_id FROM wallet_accounts WHERE id=l.wallet_account_id)
 OR wt.reference_type<>'pos_business_wallet' OR wt.reference_id<>l.id::text OR wt.source<>'pos_business_v2'
 OR wt.type<>(CASE WHEN l.direction='debit' THEN 'payment' ELSE 'refund' END)
 OR (SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) FROM pos_business_wallet_links WHERE operation_id=l.operation_id)<>
  (SELECT coalesce(sum(m.amount),0) FROM pos_money_movements m JOIN pos_business_accounts ac ON ac.id=m.account_id WHERE m.operation_id=l.operation_id AND ac.kind='WALLET_CLEARING')
 OR (l.direction='debit' AND (o.kind<>'SALE' OR p.operation_id<>o.id OR l.amount<>p.amount))
 OR (l.direction='credit' AND (o.kind<>'SALE_RETURN' OR o.source_id<>p.operation_id))
 OR (l.direction='credit' AND NOT EXISTS(SELECT 1 FROM pos_business_wallet_links d WHERE d.payment_id=l.payment_id AND d.direction='debit'
  AND d.wallet_account_id=l.wallet_account_id AND d.tenant_id=l.tenant_id AND d.unit_id=l.unit_id))
 OR (SELECT coalesce(sum(amount),0) FROM pos_business_wallet_links WHERE payment_id=l.payment_id AND direction='credit')>p.amount
 OR (SELECT current_balance FROM wallet_accounts WHERE id=l.wallet_account_id)<>
  (SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) FROM wallet_transactions WHERE wallet_account_id=l.wallet_account_id)
 THEN RAISE EXCEPTION 'Canonical Wallet/V2 reconciliation mismatch' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_business_wallet_reconciliation AFTER INSERT ON pos_business_wallet_links
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_business_wallet_reconciles();
CREATE CONSTRAINT TRIGGER pos_business_wallet_payment_reconciliation AFTER INSERT ON pos_business_payments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_business_wallet_reconciles();
CREATE CONSTRAINT TRIGGER pos_business_wallet_clearing_reconciliation AFTER INSERT ON pos_money_movements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_business_wallet_reconciles();
CREATE TRIGGER pos_business_wallet_history BEFORE UPDATE ON pos_business_wallet_links FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE TRIGGER pos_wallet_credential_audit_history BEFORE UPDATE ON pos_wallet_credential_audits FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
COMMIT;
