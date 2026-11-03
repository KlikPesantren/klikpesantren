BEGIN;
-- Additive, no backfill or change to historical balances/credentials.
ALTER TABLE public.pos_wallet_credentials ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.pos_wallet_credentials ADD COLUMN admin_created_by integer REFERENCES public.users(id);
ALTER TABLE public.pos_wallet_credentials ADD CONSTRAINT pos_wallet_credential_actor CHECK
 ((created_by IS NOT NULL)::integer + (admin_created_by IS NOT NULL)::integer = 1);
CREATE TABLE public.pos_business_policy_events (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 tenant_id integer NOT NULL,
 actor_id uuid,
 admin_actor_id integer REFERENCES public.users(id),
 kind text NOT NULL CHECK(kind IN ('SHIFT_HANDOVER','IDENTITY_CHANGE','OPNAME_DRAFT','OPNAME_APPROVAL','CREDENTIAL_ISSUE','CREDENTIAL_REPLACE','CREDENTIAL_REVOKE')),
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160),
 request_hash char(64) NOT NULL,
 subject_id uuid NOT NULL,
 source_event_id uuid REFERENCES public.pos_business_policy_events(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,kind,request_id),
 FOREIGN KEY(business_id,tenant_id) REFERENCES public.pos_businesses(id,tenant_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES public.pos_merchant_memberships(business_id,user_id),
 CHECK((actor_id IS NOT NULL)::integer+(admin_actor_id IS NOT NULL)::integer=1)
);
CREATE UNIQUE INDEX pos_policy_opname_once ON public.pos_business_policy_events(source_event_id) WHERE kind='OPNAME_APPROVAL';
CREATE INDEX pos_policy_business_subject ON public.pos_business_policy_events(business_id,kind,subject_id,created_at);
CREATE FUNCTION public.pos_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'POLICY_AUDIT_IMMUTABLE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER pos_policy_immutable BEFORE UPDATE OR DELETE ON public.pos_business_policy_events FOR EACH ROW EXECUTE FUNCTION public.pos_policy_immutable();
COMMIT;
