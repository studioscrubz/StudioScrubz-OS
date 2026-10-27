-- Repair only the draft revision affected by repeated source-addon subtraction.
-- Verified source: walkthrough review EST-20261004-9773 / 2198 sq ft.
-- Source one-time subtotal 639.27 - catalog add-ons 269.00 = 370.27
-- Revised selected add-ons: 80 + 130 + 50 = 260.00.
-- Correct calculated subtotal: 370.27 + 260 = 630.27.
-- Preferred custom final price remains 750; adjustment is 119.73.
-- Older approved/current proposal revision must not be touched.
DO $pricing_repair$
DECLARE
  affected integer;
  walkthrough_source public.walkthroughs;
  source_addon_total numeric;
  source_subtotal numeric;
  quote public.proposals;
BEGIN
  SELECT * INTO quote FROM public.proposals
   WHERE id='eb590b18-7152-4013-9434-e037fa5832e0'::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF quote.result->>'baseEstimateAmount' = '370.27'
     AND quote.result->>'calculatedPerVisitTotal'='630.27'
     AND quote.result->>'finalPriceAdjustmentLabel'='Property Condition & Additional Labor Adjustment'
  THEN RETURN; END IF;
  IF quote.proposal_number <> 'PROP-20261005-8076-R2'
     OR quote.status <> 'Draft'
     OR quote.approval_status <> 'Changes Requested'
     OR quote.approved_pricing_snapshot IS NOT NULL
     OR quote.client_delivery_snapshot IS NOT NULL
     OR quote.sent_at IS NOT NULL
     OR quote.accepted IS DISTINCT FROM false
     OR quote.is_current_revision IS DISTINCT FROM false
     OR quote.superseded_at IS NOT NULL
     OR quote.result->>'baseEstimateAmount' <> '101.27'
     OR quote.result->>'calculatedPerVisitTotal' <> '361.27'
     OR quote.result->>'perVisitTotal' <> '750'
     OR quote.result->>'manualPerVisitTotal' <> '750'
     OR quote.result->>'frequencyDiscount' <> '0'
     OR quote.result->>'inheritedManualDiscount' <> '0'
     OR quote.result->>'manualDiscount' <> '0'
     OR quote.result->'finalPriceAdjustmentLabel' IS NOT NULL
     OR quote.walkthrough_id IS DISTINCT FROM 'c095dbf0-abb8-4044-a806-383c98084c72'::uuid
  THEN RAISE EXCEPTION 'Pricing repair aborted: draft/revision/pricing/approval state changed'; END IF;
  SELECT * INTO walkthrough_source FROM public.walkthroughs
   WHERE id=quote.walkthrough_id;
  source_addon_total := (
    SELECT coalesce(sum((a->>'lineTotal')::numeric),0)
    FROM jsonb_array_elements(walkthrough_source.pricing_review->'estimateResult'->'catalogAddons') a
  );
  source_subtotal := (walkthrough_source.pricing_review->'estimateResult'->>'oneTimePrice')::numeric;
  IF source_subtotal IS DISTINCT FROM 639.27
     OR source_addon_total IS DISTINCT FROM 269
     OR source_subtotal - source_addon_total IS DISTINCT FROM 370.27
     OR (
       SELECT coalesce(sum((a->>'amount')::numeric),0)
       FROM jsonb_array_elements(quote.result->'adjustments') a
     ) IS DISTINCT FROM 260
  THEN RAISE EXCEPTION 'Pricing repair aborted: source or selected add-ons changed'; END IF;

  UPDATE public.proposals
  SET result = jsonb_set(
                 jsonb_set(
                   jsonb_set(result,'{baseEstimateAmount}',to_jsonb(370.27::numeric),true),
                 '{calculatedPerVisitTotal}',to_jsonb(630.27::numeric),true),
              '{finalPriceAdjustmentLabel}',to_jsonb('Property Condition & Additional Labor Adjustment'::text),true)
  WHERE id=quote.id
    AND status='Draft' AND approval_status='Changes Requested'
    AND approved_pricing_snapshot IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Pricing repair aborted: unexpected updated row count %',affected; END IF;

  INSERT INTO public.proposal_history
    (proposal_id,event_type,previous_status,new_status,description,metadata,performed_by)
  VALUES (quote.id,'Proposal Pricing Reconciled',quote.status,quote.status,
    'Corrected repeated source-addon subtraction in draft pricing; restored original service base and custom adjustment label.',
    jsonb_build_object('previous_base',101.27,'corrected_base',370.27,
      'previous_calculated_per_visit',361.27,'corrected_calculated_per_visit',630.27,
      'final_quoted_price_unchanged',750,'source_catalog_addons',269,
      'proposal_selected_addons',260,'previous_approval_status',quote.approval_status),
    'StudioScrubz OS Repair');
END;
$pricing_repair$;
