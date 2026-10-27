-- Repair a production failure saving draft proposals as authenticated users.
-- The approval-integrity trigger runs SECURITY INVOKER and previously called
-- private snapshot functions whose EXECUTE privileges are intentionally revoked.
-- Inline their exact pure JSON projections, preserving approval checks,
-- reviewed immutability, sent-offer safeguards and the invoker security context.
-- Do NOT grant browser roles access to private helper functions.

CREATE OR REPLACE FUNCTION private.proposal_approval_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  valid_review boolean;
  source_id uuid;
  e public.estimates;
  new_snapshot jsonb;
  old_snapshot jsonb;
BEGIN
 valid_review := current_setting('studioscrubz.proposal_review_rpc',true)='on'
   AND current_user=(SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc
     WHERE oid='public.review_proposal_approval(uuid,text,text)'::pg_catalog.regprocedure);
 IF tg_op='INSERT' THEN
   IF new.status <> 'Draft' OR new.approval_status <> 'Not Submitted'
      OR new.approved_at IS NOT NULL OR new.approved_by IS NOT NULL
      OR new.sent_at IS NOT NULL OR new.client_access_token IS NOT NULL THEN
     RAISE EXCEPTION 'New proposals must begin unapproved and unsent' USING ERRCODE='42501';
   END IF;
   IF new.approved_pricing_snapshot IS NOT NULL THEN
     RAISE EXCEPTION 'Cannot forge a proposal approval snapshot' USING ERRCODE='42501';
   END IF;
   RETURN new;
 END IF;
 -- Compute approved pricing snapshots inline because this SECURITY INVOKER
 -- trigger cannot EXECUTE private snapshot helpers revoked from authenticated users.
 new_snapshot := pg_catalog.jsonb_build_object(
    'result',new.result,'notes',new.notes,'frequency',new.frequency,
    'expiration_date',new.expiration_date,'estimate_id',new.estimate_id,
    'walkthrough_id',new.walkthrough_id);
 old_snapshot := pg_catalog.jsonb_build_object(
    'result',old.result,'notes',old.notes,'frequency',old.frequency,
    'expiration_date',old.expiration_date,'estimate_id',old.estimate_id,
    'walkthrough_id',old.walkthrough_id);
 IF NOT valid_review AND (new.approved_pricing_snapshot IS DISTINCT FROM old.approved_pricing_snapshot
    OR (new.approval_status='Approved' AND old.approval_status IS DISTINCT FROM new.approval_status)
    OR new.approved_at IS DISTINCT FROM old.approved_at) THEN
   RAISE EXCEPTION 'Proposal approval must be recorded by an authorized reviewer' USING ERRCODE='42501';
 END IF;
 IF old.approval_status='Pending Approval'
    AND new_snapshot IS DISTINCT FROM old_snapshot THEN
   RAISE EXCEPTION 'Pending approval cannot be edited. Request changes first.';
 END IF;
 IF old.approval_status='Approved'
    AND new_snapshot IS DISTINCT FROM old_snapshot
    AND new.status NOT IN ('Accepted','Declined','Archived') THEN
   RAISE EXCEPTION 'Approved proposal pricing is immutable. Create a new draft revision and request approval.';
 END IF;
 IF (new.client_delivery_snapshot IS DISTINCT FROM old.client_delivery_snapshot
       OR (new.status='Sent' AND old.status IS DISTINCT FROM 'Sent')) THEN
   IF new.approval_status<>'Approved' OR new.approved_pricing_snapshot IS NULL
     OR new.approved_pricing_snapshot IS DISTINCT FROM new_snapshot THEN
     RAISE EXCEPTION 'Proposal pricing version has not been approved' USING ERRCODE='42501';
   END IF;
   source_id:=new.estimate_id;
   IF new.walkthrough_id IS NOT NULL THEN
     SELECT estimate_id INTO source_id FROM public.walkthroughs WHERE id=new.walkthrough_id;
     IF new.estimate_id IS NOT NULL AND source_id IS NOT NULL AND new.estimate_id<>source_id THEN
       RAISE EXCEPTION 'Proposal linked estimate references disagree';
     END IF;
     source_id:=coalesce(new.estimate_id,source_id);
   END IF;
   IF source_id IS NOT NULL THEN
     SELECT * INTO e FROM public.estimates WHERE id=source_id FOR SHARE;
     IF NOT FOUND OR e.approval_status<>'Approved' OR e.approved_pricing_snapshot IS NULL
       OR e.approved_pricing_snapshot IS DISTINCT FROM pg_catalog.jsonb_build_object(
           'client_id',e.client_id,'property_id',e.property_id,
           'customer_first_name',e.customer_first_name,'customer_last_name',e.customer_last_name,
           'customer_address',e.customer_address,'customer_email',e.customer_email,
           'frequency',e.frequency,'service_name',e.service_name,
           'result',e.result,'notes',e.notes,'terms',e.terms
       ) THEN
       RAISE EXCEPTION 'Source estimate requires approval of its current pricing' USING ERRCODE='42501';
     END IF;
   END IF;
 END IF;
 RETURN new;
END $function$;

-- The same invoker/private-EXECUTE mismatch affects ordinary estimate editing
-- and approved estimate delivery. Preserve state-change audit and delivery checks.
CREATE OR REPLACE FUNCTION private.guard_estimate_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  controlled boolean;
  changed boolean;
  previous_status text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF new.approval_created_by IS NOT NULL
      AND NOT (current_setting('studioscrubz.sales_estimate_write_rpc',true)='on'
        AND new.approval_created_by::text=current_setting('studioscrubz.sales_estimate_actor',true))
      OR new.approval_submitted_at IS NOT NULL
      OR new.approval_reviewed_at IS NOT NULL
      OR new.approval_notes IS NOT NULL THEN
      RAISE EXCEPTION 'Estimate approval audit fields are server-generated' USING ERRCODE='42501';
    END IF;
    IF new.approval_status <> 'Draft'
      OR new.approval_version <> 1
      OR new.approval_reviewed_by IS NOT NULL OR new.approval_submitted_by IS NOT NULL
      OR new.approved_pricing_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Estimate approval fields cannot be supplied by the client' USING ERRCODE='42501';
    END IF;
    new.approval_created_by := coalesce(auth.uid(),new.approval_created_by);
    RETURN new;
  END IF;
  controlled := current_setting('studioscrubz.estimate_review_rpc',true)='on'
    AND current_user = (
      SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
      WHERE p.oid='public.review_estimate_approval(uuid,text,text)'::pg_catalog.regprocedure
    );
  IF NOT controlled AND (
      new.approval_status IS DISTINCT FROM old.approval_status
      OR new.approval_version IS DISTINCT FROM old.approval_version
      OR new.approval_submitted_by IS DISTINCT FROM old.approval_submitted_by
      OR new.approval_submitted_at IS DISTINCT FROM old.approval_submitted_at
      OR new.approval_reviewed_by IS DISTINCT FROM old.approval_reviewed_by
      OR new.approval_reviewed_at IS DISTINCT FROM old.approval_reviewed_at
      OR new.approval_notes IS DISTINCT FROM old.approval_notes
      OR new.approved_pricing_snapshot IS DISTINCT FROM old.approved_pricing_snapshot
      OR new.approval_created_by IS DISTINCT FROM old.approval_created_by
    ) THEN
    -- Submit RPC is an equally authenticated and audited controlled transition.
    IF NOT (current_setting('studioscrubz.estimate_submit_rpc',true)='on'
      AND current_user = (
        SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p
        WHERE p.oid='public.submit_estimate_for_approval(uuid)'::pg_catalog.regprocedure
      )) THEN
      RAISE EXCEPTION 'Use the estimate approval workflow to change approval fields' USING ERRCODE='42501';
    END IF;
  END IF;
  changed := pg_catalog.jsonb_build_object(
      'client_id',new.client_id,'property_id',new.property_id,
      'customer_first_name',new.customer_first_name,'customer_last_name',new.customer_last_name,
      'customer_address',new.customer_address,'customer_email',new.customer_email,
      'frequency',new.frequency,'service_name',new.service_name,
      'result',new.result,'notes',new.notes,'terms',new.terms
    ) IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'client_id',old.client_id,'property_id',old.property_id,
      'customer_first_name',old.customer_first_name,'customer_last_name',old.customer_last_name,
      'customer_address',old.customer_address,'customer_email',old.customer_email,
      'frequency',old.frequency,'service_name',old.service_name,
      'result',old.result,'notes',old.notes,'terms',old.terms
    );
  IF changed AND old.approval_status IN ('Pending Approval','Approved','Changes Requested') THEN
    IF controlled OR current_setting('studioscrubz.estimate_submit_rpc',true)='on' THEN
      RAISE EXCEPTION 'Pricing and scope cannot change during an approval decision';
    END IF;
    new.approval_status := 'Draft';
    new.approval_version := old.approval_version+1;
    new.approval_submitted_by := NULL;
    new.approval_submitted_at := NULL;
    new.approval_reviewed_by := NULL;
    new.approval_reviewed_at := NULL;
    new.approval_notes := NULL;
    new.approved_pricing_snapshot := NULL;
  END IF;
  RETURN new;
END $function$;

CREATE OR REPLACE FUNCTION private.require_approved_estimate_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (new.sent_at IS DISTINCT FROM old.sent_at
    OR new.client_access_token IS DISTINCT FROM old.client_access_token
    OR new.client_delivery_snapshot IS DISTINCT FROM old.client_delivery_snapshot)
    AND (new.approval_status <> 'Approved' OR new.approved_pricing_snapshot IS NULL
      OR new.approved_pricing_snapshot IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'client_id',new.client_id,'property_id',new.property_id,
      'customer_first_name',new.customer_first_name,'customer_last_name',new.customer_last_name,
      'customer_address',new.customer_address,'customer_email',new.customer_email,
      'frequency',new.frequency,'service_name',new.service_name,
      'result',new.result,'notes',new.notes,'terms',new.terms
    )) THEN
    RAISE EXCEPTION 'Estimate requires approval of its current pricing before customer delivery' USING ERRCODE='42501';
  END IF;
  RETURN new;
END $function$;
