-- Sales estimate approval lifecycle; forward-only. Avoid modifying historic sent offer snapshots.
ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS approval_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approval_submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approval_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS approval_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_notes text,
  ADD COLUMN IF NOT EXISTS approved_pricing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS approval_created_by uuid;
ALTER TABLE public.estimates ADD CONSTRAINT estimates_approval_status_check
  CHECK (approval_status IN ('Draft','Pending Approval','Approved','Changes Requested'));
ALTER TABLE public.estimates ADD CONSTRAINT estimates_approval_version_check CHECK (approval_version >= 1);

-- Existing sent estimates are grandfathered solely for continuity, not falsely attributed to a reviewer.
UPDATE public.estimates SET approval_status='Approved',
  approved_pricing_snapshot=jsonb_build_object(
    'client_id',client_id,'property_id',property_id,'customer_first_name',customer_first_name,
    'customer_last_name',customer_last_name,'customer_address',customer_address,
    'customer_email',customer_email,'frequency',frequency,'service_name',service_name,
    'result',result,'notes',notes,'terms',terms
  ),
  approval_reviewed_at=sent_at
WHERE sent_at IS NOT NULL OR status IN ('Converted','Superseded');

CREATE TABLE IF NOT EXISTS public.estimate_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('Submitted','Approved','Changes Requested','Revision Required')),
  actor_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimate_approval_history_lookup ON public.estimate_approval_history(estimate_id,created_at DESC);
ALTER TABLE public.estimate_approval_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Estimate approval history view" ON public.estimate_approval_history;
CREATE POLICY "Estimate approval history view" ON public.estimate_approval_history
 FOR SELECT TO authenticated USING (
  public.has_any_role(ARRAY['Master Admin','Manager','Administrator'])
  OR EXISTS (SELECT 1 FROM public.estimates e
    WHERE e.id=estimate_id AND e.approval_submitted_by=auth.uid())
 );
REVOKE ALL ON public.estimate_approval_history FROM anon,authenticated;
GRANT SELECT ON public.estimate_approval_history TO authenticated;

CREATE OR REPLACE FUNCTION private.estimate_approval_snapshot(p_row public.estimates)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'client_id',p_row.client_id,'property_id',p_row.property_id,
    'customer_first_name',p_row.customer_first_name,'customer_last_name',p_row.customer_last_name,
    'customer_address',p_row.customer_address,'customer_email',p_row.customer_email,
    'frequency',p_row.frequency,'service_name',p_row.service_name,
    'result',p_row.result,'notes',p_row.notes,'terms',p_row.terms
  )
$$;
REVOKE ALL ON FUNCTION private.estimate_approval_snapshot(public.estimates) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_estimate_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  controlled boolean;
  changed boolean;
  previous_status text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF new.approval_status <> 'Draft'
      OR new.approval_version <> 1
      OR new.approval_reviewed_by IS NOT NULL OR new.approval_submitted_by IS NOT NULL
      OR new.approved_pricing_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Estimate approval fields cannot be supplied by the client' USING ERRCODE='42501';
    END IF;
    new.approval_created_by := auth.uid();
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
  changed := private.estimate_approval_snapshot(new) IS DISTINCT FROM private.estimate_approval_snapshot(old);
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
END $$;
DROP TRIGGER IF EXISTS estimates_approval_guard ON public.estimates;
CREATE TRIGGER estimates_approval_guard BEFORE INSERT OR UPDATE ON public.estimates
  FOR EACH ROW EXECUTE FUNCTION private.guard_estimate_approval();

CREATE OR REPLACE FUNCTION public.submit_estimate_for_approval(p_estimate_id uuid)
RETURNS public.estimates LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.estimates; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR NOT public.has_any_role(ARRAY['Sales','Manager','Master Admin','Administrator']) THEN
   RAISE EXCEPTION 'Not permitted to submit estimates for review' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.estimates WHERE id=p_estimate_id FOR UPDATE;
 IF NOT FOUND OR e.archived_at IS NOT NULL OR e.status<>'Open'
   OR e.approval_status NOT IN ('Draft','Changes Requested') THEN
   RAISE EXCEPTION 'Only an active draft or changes-requested estimate may be submitted';
 END IF;
 PERFORM pg_catalog.set_config('studioscrubz.estimate_submit_rpc','on',true);
 UPDATE public.estimates SET approval_status='Pending Approval',
   approval_submitted_by=actor, approval_submitted_at=now(), approval_notes=NULL
 WHERE id=e.id RETURNING * INTO e;
 PERFORM pg_catalog.set_config('studioscrubz.estimate_submit_rpc','',true);
 INSERT INTO public.estimate_approval_history(estimate_id,version,action,actor_id,from_status,to_status)
 VALUES(e.id,e.approval_version,'Submitted',actor,'Draft','Pending Approval');
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.submit_estimate_for_approval(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_estimate_for_approval(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_estimate_approval(p_estimate_id uuid,p_decision text,p_notes text DEFAULT NULL)
RETURNS public.estimates LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.estimates; actor uuid:=auth.uid(); previous text; actor_role text;
BEGIN
 SELECT role INTO actor_role FROM public.user_profiles WHERE id=actor AND is_active=true;
 IF actor IS NULL OR actor_role NOT IN ('Manager','Master Admin') THEN
   RAISE EXCEPTION 'Only Managers and Master Admin may review estimates' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('Approved','Changes Requested') THEN RAISE EXCEPTION 'Invalid approval decision'; END IF;
 IF p_decision='Changes Requested' AND length(btrim(coalesce(p_notes,'')))=0 THEN
   RAISE EXCEPTION 'A reason is required when requesting changes';
 END IF;
 SELECT * INTO e FROM public.estimates WHERE id=p_estimate_id FOR UPDATE;
 IF NOT FOUND OR e.archived_at IS NOT NULL OR e.status<>'Open'
   OR e.approval_status<>'Pending Approval' THEN
   RAISE EXCEPTION 'This estimate is not pending approval';
 END IF;
 previous:=e.approval_status;
 PERFORM pg_catalog.set_config('studioscrubz.estimate_review_rpc','on',true);
 UPDATE public.estimates SET approval_status=p_decision,approval_reviewed_by=actor,
   approval_reviewed_at=now(),approval_notes=nullif(btrim(coalesce(p_notes,'')),''),
   approved_pricing_snapshot=CASE WHEN p_decision='Approved' THEN private.estimate_approval_snapshot(e) ELSE NULL END
 WHERE id=e.id RETURNING * INTO e;
 PERFORM pg_catalog.set_config('studioscrubz.estimate_review_rpc','',true);
 INSERT INTO public.estimate_approval_history(estimate_id,version,action,actor_id,from_status,to_status,notes)
 VALUES(e.id,e.approval_version,p_decision,actor,previous,p_decision,e.approval_notes);
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.review_estimate_approval(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_estimate_approval(uuid,text,text) TO authenticated;

-- Protect delivery even when called directly via RPC, bypassing React button visibility.
CREATE OR REPLACE FUNCTION private.require_approved_estimate_delivery()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (new.sent_at IS DISTINCT FROM old.sent_at
    OR new.client_access_token IS DISTINCT FROM old.client_access_token
    OR new.client_delivery_snapshot IS DISTINCT FROM old.client_delivery_snapshot)
    AND (new.approval_status <> 'Approved' OR new.approved_pricing_snapshot IS NULL
      OR new.approved_pricing_snapshot IS DISTINCT FROM private.estimate_approval_snapshot(new)) THEN
    RAISE EXCEPTION 'Estimate requires approval of its current pricing before customer delivery' USING ERRCODE='42501';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS estimates_approval_delivery_guard ON public.estimates;
CREATE TRIGGER estimates_approval_delivery_guard BEFORE UPDATE ON public.estimates
 FOR EACH ROW EXECUTE FUNCTION private.require_approved_estimate_delivery();

-- A proposal approval is an immutable pricing and terms authorization, not a mutable status label.
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS approved_pricing_snapshot jsonb;
UPDATE public.proposals SET approved_pricing_snapshot=jsonb_build_object(
  'result',result,'notes',notes,'frequency',frequency,'expiration_date',expiration_date,
  'estimate_id',estimate_id,'walkthrough_id',walkthrough_id
) WHERE approval_status='Approved' AND approved_pricing_snapshot IS NULL;
CREATE OR REPLACE FUNCTION private.proposal_approved_snapshot(p_row public.proposals)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('result',p_row.result,'notes',p_row.notes,'frequency',p_row.frequency,
 'expiration_date',p_row.expiration_date,'estimate_id',p_row.estimate_id,'walkthrough_id',p_row.walkthrough_id)
$$;
REVOKE ALL ON FUNCTION private.proposal_approved_snapshot(public.proposals) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.proposal_approval_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE valid_review boolean;
DECLARE source_id uuid;
DECLARE e public.estimates;
BEGIN
 valid_review := current_setting('studioscrubz.proposal_review_rpc',true)='on'
   AND current_user=(SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc
     WHERE oid='public.review_proposal_approval(uuid,text,text)'::pg_catalog.regprocedure);
 IF tg_op='INSERT' THEN
   IF new.approved_pricing_snapshot IS NOT NULL THEN
     RAISE EXCEPTION 'Cannot forge a proposal approval snapshot' USING ERRCODE='42501';
   END IF;
   RETURN new;
 END IF;
 IF NOT valid_review AND (new.approved_pricing_snapshot IS DISTINCT FROM old.approved_pricing_snapshot
    OR (new.approval_status='Approved' AND old.approval_status IS DISTINCT FROM new.approval_status)
    OR new.approved_at IS DISTINCT FROM old.approved_at) THEN
   RAISE EXCEPTION 'Proposal approval must be recorded by an authorized reviewer' USING ERRCODE='42501';
 END IF;
 IF old.approval_status='Approved'
    AND private.proposal_approved_snapshot(new) IS DISTINCT FROM private.proposal_approved_snapshot(old)
    AND new.status NOT IN ('Accepted','Declined','Archived') THEN
   RAISE EXCEPTION 'Approved proposal pricing is immutable. Create a new draft revision and request approval.';
 END IF;
 IF (new.client_delivery_snapshot IS DISTINCT FROM old.client_delivery_snapshot
       OR (new.status='Sent' AND old.status IS DISTINCT FROM 'Sent')) THEN
   IF new.approval_status<>'Approved' OR new.approved_pricing_snapshot IS NULL
     OR new.approved_pricing_snapshot IS DISTINCT FROM private.proposal_approved_snapshot(new) THEN
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
       OR e.approved_pricing_snapshot IS DISTINCT FROM private.estimate_approval_snapshot(e) THEN
       RAISE EXCEPTION 'Source estimate requires approval of its current pricing' USING ERRCODE='42501';
     END IF;
   END IF;
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS proposals_approval_integrity ON public.proposals;
CREATE TRIGGER proposals_approval_integrity BEFORE INSERT OR UPDATE ON public.proposals
 FOR EACH ROW EXECUTE FUNCTION private.proposal_approval_integrity();

CREATE OR REPLACE FUNCTION public.review_proposal_approval(p_proposal_id uuid,p_decision text,p_notes text DEFAULT NULL)
RETURNS public.proposals LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.proposals; actor uuid:=auth.uid(); role_name text;
BEGIN
 SELECT role INTO role_name FROM public.user_profiles WHERE id=actor AND is_active=true;
 IF role_name NOT IN ('Manager','Master Admin') THEN
   RAISE EXCEPTION 'Only Manager or Master Admin can approve proposals' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('Approved','Changes Requested') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 IF p_decision='Changes Requested' AND length(btrim(coalesce(p_notes,'')))=0 THEN
   RAISE EXCEPTION 'Reason required when requesting changes';
 END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id FOR UPDATE;
 IF NOT FOUND OR p.archived_at IS NOT NULL OR p.status<>'Ready for Approval'
   OR p.approval_status<>'Pending Approval' THEN
   RAISE EXCEPTION 'Proposal is not pending review';
 END IF;
 PERFORM pg_catalog.set_config('studioscrubz.proposal_review_rpc','on',true);
 UPDATE public.proposals SET
   status=CASE WHEN p_decision='Approved' THEN 'Approved' ELSE 'Draft' END,
   approval_status=p_decision,
   approved_at=CASE WHEN p_decision='Approved' THEN now() ELSE NULL END,
   approved_by=CASE WHEN p_decision='Approved' THEN actor::text ELSE NULL END,
   approval_notes=nullif(btrim(coalesce(p_notes,'')),''),
   approved_pricing_snapshot=CASE WHEN p_decision='Approved' THEN private.proposal_approved_snapshot(p) ELSE NULL END
 WHERE id=p.id RETURNING * INTO p;
 PERFORM pg_catalog.set_config('studioscrubz.proposal_review_rpc','',true);
 INSERT INTO public.proposal_history(proposal_id,event_type,previous_status,new_status,description,performed_by,metadata)
 VALUES(p.id,p_decision,'Ready for Approval',p.status,p.approval_notes,coalesce((SELECT display_name FROM public.user_profiles WHERE id=actor),actor::text),
   jsonb_build_object('reviewer_id',actor,'revision_number',p.revision_number));
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.review_proposal_approval(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_proposal_approval(uuid,text,text) TO authenticated;
