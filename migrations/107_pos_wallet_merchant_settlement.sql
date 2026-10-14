BEGIN;

ALTER TABLE pos_business_wallet_links
  ADD CONSTRAINT pos_business_wallet_links_id_business_unique UNIQUE (id, business_id);

CREATE TABLE pos_wallet_settlement_payouts (
  id uuid PRIMARY KEY,
  tenant_id integer NOT NULL,
  business_id uuid NOT NULL,
  cash_account_id uuid NOT NULL,
  cash_transaction_id bigint NOT NULL,
  actor_user_id integer NOT NULL,
  payout_date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 160),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 8 AND 160),
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id),
  UNIQUE (id, business_id),
  UNIQUE (cash_transaction_id),
  FOREIGN KEY (business_id, tenant_id) REFERENCES pos_businesses(id, tenant_id),
  FOREIGN KEY (tenant_id, cash_account_id) REFERENCES cash_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, cash_transaction_id) REFERENCES cash_account_transactions(tenant_id, id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE pos_wallet_settlement_allocations (
  payout_id uuid NOT NULL,
  business_id uuid NOT NULL,
  obligation_link_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payout_id, obligation_link_id),
  FOREIGN KEY (payout_id, business_id) REFERENCES pos_wallet_settlement_payouts(id, business_id),
  FOREIGN KEY (obligation_link_id, business_id) REFERENCES pos_business_wallet_links(id, business_id)
);

CREATE INDEX pos_wallet_settlement_business_date
  ON pos_wallet_settlement_payouts (business_id, payout_date, id);
CREATE INDEX pos_wallet_settlement_obligation
  ON pos_wallet_settlement_allocations (obligation_link_id);

CREATE FUNCTION pos_wallet_settlement_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p pos_wallet_settlement_payouts%ROWTYPE; tx cash_account_transactions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='pos_wallet_settlement_payouts' THEN
    SELECT * INTO p FROM pos_wallet_settlement_payouts WHERE id=NEW.id;
  ELSE
    SELECT * INTO p FROM pos_wallet_settlement_payouts WHERE id=NEW.payout_id;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO tx FROM cash_account_transactions WHERE id=p.cash_transaction_id AND tenant_id=p.tenant_id;
  IF NOT FOUND OR tx.cash_account_id<>p.cash_account_id OR tx.jenis<>'Keluar' OR tx.nominal<>p.amount
    OR tx.source<>'pos_wallet_settlement' OR tx.idempotency_key<>('pos-wallet-settlement:'||p.request_id)
    OR (SELECT coalesce(sum(amount),0) FROM pos_wallet_settlement_allocations WHERE payout_id=p.id)<>p.amount
    OR EXISTS (
      SELECT 1 FROM pos_wallet_settlement_allocations a
      JOIN pos_business_wallet_links l ON l.id=a.obligation_link_id AND l.business_id=a.business_id
      WHERE a.payout_id=p.id AND (l.direction<>'debit' OR l.tenant_id<>p.tenant_id OR l.business_id<>p.business_id)
    ) OR (SELECT coalesce(sum(amount),0) FROM pos_wallet_settlement_payouts
          WHERE business_id=p.business_id AND tenant_id=p.tenant_id)>
         (SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)
          FROM pos_business_wallet_links WHERE business_id=p.business_id AND tenant_id=p.tenant_id)
    OR EXISTS (
      SELECT 1 FROM pos_wallet_settlement_allocations a
      JOIN pos_business_wallet_links d ON d.id=a.obligation_link_id AND d.direction='debit'
      WHERE a.payout_id=p.id GROUP BY d.id,d.amount,d.payment_id
      HAVING (SELECT coalesce(sum(x.amount),0) FROM pos_wallet_settlement_allocations x WHERE x.obligation_link_id=d.id)>
             d.amount-(SELECT coalesce(sum(r.amount),0) FROM pos_business_wallet_links r WHERE r.payment_id=d.payment_id AND r.direction='credit')
    ) THEN
    RAISE EXCEPTION 'Wallet merchant settlement mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER pos_wallet_settlement_payout_reconciliation
  AFTER INSERT ON pos_wallet_settlement_payouts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pos_wallet_settlement_reconciles();
CREATE CONSTRAINT TRIGGER pos_wallet_settlement_allocation_reconciliation
  AFTER INSERT ON pos_wallet_settlement_allocations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pos_wallet_settlement_reconciles();

CREATE TRIGGER pos_wallet_settlement_payout_history
  BEFORE UPDATE ON pos_wallet_settlement_payouts FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE TRIGGER pos_wallet_settlement_allocation_history
  BEFORE UPDATE ON pos_wallet_settlement_allocations FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();

COMMIT;
