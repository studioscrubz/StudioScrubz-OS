-- Fix a production PostgREST 400 on create_completed_job_invoice:
-- the operator expression 'Add-On: ' || addon->>'label' implicitly coerced
-- literal text to jsonb, raising "invalid input syntax for type json".
-- Parenthesize every JSON text extraction before concatenating.
-- Preserve all RPC authentication, role checks, financial restrictions,
-- idempotency and deposit/payment logic verbatim.
CREATE OR REPLACE FUNCTION public.create_completed_job_invoice(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller_role text; job_row public.jobs; client_row public.clients; proposal_row public.proposals; settings_row public.business_settings;
  amount numeric; issue_date date:=current_date; invoice_id uuid; invoice_number text; line_items jsonb; snapshot_addon jsonb; attempt integer;
  violated_constraint_name text; requirement_row public.proposal_deposit_requirements; payment_row public.payments; new_status text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  caller_role:=public.current_user_role(); if caller_role is null or caller_role not in ('Master Admin','Administrator','Manager','Crew Lead') then raise exception 'Job completion invoicing is not permitted.'; end if;
  select * into job_row from public.jobs where id=p_job_id for update; if not found then raise exception 'Job not found.'; end if;
  if job_row.archived_at is not null or job_row.status='Archived' then raise exception 'Archived Jobs cannot be invoiced.'; end if;
  if caller_role='Crew Lead' and (job_row.assigned_crew_id is null or not public.is_assigned_to_crew(job_row.assigned_crew_id)) then raise exception 'Job is not assigned to your crew.'; end if;
  if job_row.status is distinct from 'Completed' then raise exception 'Only completed Jobs can be invoiced.'; end if;
  select i.id,i.invoice_number into invoice_id,invoice_number from public.invoices i where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' order by i.created_at limit 1;
  if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false,'financially_resolved',true); end if;
  if public.is_job_financially_handed_off(job_row.id) then
    select i.id,i.invoice_number into invoice_id,invoice_number
    from public.invoices i where i.job_id=job_row.id and (
      (coalesce(i.amount_paid,0)>0 and coalesce(i.balance_due,i.total)<=0 and coalesce(i.amount_paid,0)>=coalesce(i.total,0))
      or (coalesce(i.total,0)>0 and coalesce((select sum(p.amount) from public.payments p where p.invoice_id=i.id and p.voided_at is null),0)>=i.total)
    ) order by i.created_at desc limit 1;
    return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',true,'financially_resolved',true);
  end if;
  if job_row.service_occurrence_id is not null and exists(select 1 from public.service_occurrences o join public.service_agreements a on a.id=o.agreement_id where o.id=job_row.service_occurrence_id and a.billing_type in ('Weekly','Biweekly','Monthly','Flat Contract')) then
    return jsonb_build_object('invoice_id',null,'invoice_number',null,'created',false,'skipped',true,'financially_resolved',false); end if;
  select * into client_row from public.clients where id=job_row.client_id; select * into proposal_row from public.proposals where id=job_row.proposal_id; select * into settings_row from public.business_settings limit 1;
  if job_row.price is null or job_row.price='NaN'::numeric or job_row.price<0 then raise exception 'The completed Job does not contain a valid authoritative price.'; end if;
  amount:=job_row.price;
  if job_row.pricing_snapshot is null then line_items:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description',coalesce(nullif(job_row.service_name,''),'StudioScrubz service'),'quantity',1,'rate',amount,'amount',amount));
  else
    if not public.is_valid_job_pricing_snapshot(job_row.pricing_snapshot,amount) then raise exception 'The completed Job pricing snapshot is invalid or does not reconcile to the authoritative Job price.'; end if;
    line_items:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description',coalesce(nullif(job_row.service_name,''),'StudioScrubz service'),'quantity',1,'rate',round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric,2),'amount',round((job_row.pricing_snapshot->>'baseServiceAmount')::numeric,2)));
    for snapshot_addon in select value from jsonb_array_elements(job_row.pricing_snapshot->'addons') loop
      line_items:=line_items||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'description','Add-On: '||(snapshot_addon->>'label')||case when snapshot_addon->>'pricingType'='Per Unit' then ' ('||(snapshot_addon->>'unitName')||')' else '' end,'quantity',case when snapshot_addon->>'pricingType'='Per Unit' then (snapshot_addon->>'quantity')::numeric else 1 end,'rate',case when snapshot_addon->>'pricingType'='Per Unit' then (snapshot_addon->>'unitPrice')::numeric else (snapshot_addon->>'lineTotal')::numeric end,'amount',(snapshot_addon->>'lineTotal')::numeric));
    end loop;
  end if;
  if job_row.proposal_id is not null then
    select * into requirement_row from public.proposal_deposit_requirements where proposal_id=job_row.proposal_id for update;
    if found then select * into payment_row from public.payments where deposit_requirement_id=requirement_row.id and voided_at is null for update; end if;
  end if;
  for attempt in 1..5 loop
    invoice_number:='INV-'||to_char(issue_date,'YYYYMMDD')||'-'||lpad(floor(random()*10000)::text,4,'0');
    begin
      new_status:=case when payment_row.id is not null and payment_row.amount>=amount and amount>0 then 'Paid' when payment_row.id is not null and payment_row.amount>0 then 'Partially Paid' else 'Open' end;
      insert into public.invoices(invoice_number,job_id,service_agreement_id,contract_billing_type,billing_period_start,proposal_id,client_id,property_id,client_name,property_name,customer_phone,customer_email,service_name,status,issue_date,due_date,line_items,subtotal,discount,tax,total,amount_paid,balance_due,paid_at,notes,terms)
      values(invoice_number,job_row.id,null,null,null,job_row.proposal_id,job_row.client_id,job_row.property_id,job_row.client_name,job_row.property_name,
        coalesce(nullif(btrim(client_row.phone),''),nullif(btrim(proposal_row.customer_phone),'')),coalesce(nullif(btrim(client_row.email),''),nullif(btrim(proposal_row.customer_email),'')),
        job_row.service_name,new_status,issue_date,issue_date+coalesce(settings_row.default_invoice_due_days,15),line_items,amount,0,0,amount,
        coalesce(payment_row.amount,0),greatest(round(amount-coalesce(payment_row.amount,0),2),0),case when new_status='Paid' then now() end,job_row.internal_notes,coalesce(settings_row.default_invoice_terms,settings_row.default_payment_terms)) returning id into invoice_id;
      if payment_row.id is not null then
        update public.payments set invoice_id=invoice_id,job_id=job_row.id where id=payment_row.id and invoice_id is null;
        if not found then raise exception 'The deposit payment was already applied to another Invoice.'; end if;
        update public.proposal_deposit_requirements set status='Applied To Invoice',applied_invoice_id=invoice_id,applied_at=now(),updated_at=now() where id=requirement_row.id;
        insert into public.proposal_deposit_events(requirement_id,event_type,actor_user_id,metadata) values(requirement_row.id,'Applied To Invoice',auth.uid(),jsonb_build_object('invoice_id',invoice_id,'payment_id',payment_row.id,'amount',payment_row.amount));
      end if;
      return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',true,'skipped',false,'financially_resolved',true);
    exception when unique_violation then
      get stacked diagnostics violated_constraint_name=constraint_name;
      if violated_constraint_name='invoices_one_active_per_job_idx' then
        select i.id,i.invoice_number into invoice_id,invoice_number from public.invoices i where i.job_id=job_row.id and i.archived_at is null and i.status<>'Cancelled' order by i.created_at limit 1;
        if found then return jsonb_build_object('invoice_id',invoice_id,'invoice_number',invoice_number,'created',false,'skipped',false,'financially_resolved',true); end if;
        raise;
      elsif violated_constraint_name is distinct from 'invoices_invoice_number_key' then raise; end if;
    end;
  end loop;
  raise exception 'A unique Invoice number could not be generated.';
end $function$
;


-- Repair only the verified missing invoice for the completed Rose Company /
-- Emily Daura job. Replays the authoritative invoicing shape with no session
-- impersonation, no updates to job/payroll, and no customer delivery.
-- Skips safely if the job does not exist (e.g. an isolated CI database), or
-- an invoice was already created by a signed-in employee.
DO $recovery$
DECLARE
  j public.jobs;
  c public.clients;
  s public.business_settings;
  item jsonb;
  items jsonb;
  issue_on date;
  generated_no text;
  new_invoice_id uuid;
  attempt integer;
  duplicate_constraint text;
BEGIN
  SELECT * INTO j FROM public.jobs
    WHERE id='bb33159b-0bb6-4082-bdb8-f0e2942365cc'::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.job_id=j.id)
     OR EXISTS(SELECT 1 FROM public.invoice_job_lines l WHERE l.job_id=j.id)
  THEN RETURN; END IF;
  IF j.status IS DISTINCT FROM 'Completed' OR j.archived_at IS NOT NULL
     OR j.service_occurrence_id IS NOT NULL OR j.proposal_id IS NOT NULL
     OR j.price IS DISTINCT FROM 110.00::numeric
     OR j.pricing_snapshot IS NULL
     OR NOT public.is_valid_job_pricing_snapshot(j.pricing_snapshot,j.price)
     OR public.is_job_financially_handed_off(j.id)
     OR EXISTS(SELECT 1 FROM public.payments p WHERE p.job_id=j.id AND p.voided_at IS NULL)
  THEN RAISE EXCEPTION 'Verified missing job invoice repair preconditions have changed.'; END IF;
  SELECT * INTO c FROM public.clients WHERE id=j.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client missing for invoice repair.'; END IF;
  SELECT * INTO s FROM public.business_settings LIMIT 1;

  items:=jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),
    'description',coalesce(nullif(j.service_name,''),'StudioScrubz service'),
    'quantity',1,
    'rate',round((j.pricing_snapshot->>'baseServiceAmount')::numeric,2),
    'amount',round((j.pricing_snapshot->>'baseServiceAmount')::numeric,2)
  ));
  FOR item IN SELECT value FROM jsonb_array_elements(j.pricing_snapshot->'addons') LOOP
    items:=items||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),
      'description','Add-On: '||(item->>'label')||
        CASE WHEN item->>'pricingType'='Per Unit' THEN ' ('||(item->>'unitName')||')' ELSE '' END,
      'quantity',CASE WHEN item->>'pricingType'='Per Unit' THEN (item->>'quantity')::numeric ELSE 1 END,
      'rate',CASE WHEN item->>'pricingType'='Per Unit' THEN (item->>'unitPrice')::numeric ELSE (item->>'lineTotal')::numeric END,
      'amount',(item->>'lineTotal')::numeric
    ));
  END LOOP;
  IF (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(items) x) IS DISTINCT FROM j.price
  THEN RAISE EXCEPTION 'Invoice line items do not reconcile with completed job price.'; END IF;
  issue_on:=(j.completed_at AT TIME ZONE 'America/Los_Angeles')::date;
  IF issue_on IS NULL THEN RAISE EXCEPTION 'Missing completed date for invoice repair.'; END IF;
  FOR attempt IN 1..5 LOOP
    generated_no:='INV-'||to_char(issue_on,'YYYYMMDD')||'-'||
      lpad((floor(random()*10000))::integer::text,4,'0');
    BEGIN
      INSERT INTO public.invoices(
        invoice_number,job_id,service_agreement_id,contract_billing_type,billing_period_start,
        proposal_id,client_id,property_id,client_name,property_name,
        customer_phone,customer_email,service_name,status,issue_date,due_date,line_items,
        subtotal,discount,tax,total,amount_paid,balance_due,notes,terms
      ) VALUES (
        generated_no,j.id,NULL,NULL,NULL,NULL,j.client_id,j.property_id,
        j.client_name,j.property_name,
        nullif(btrim(c.phone),''),nullif(btrim(c.email),''),
        j.service_name,'Open',issue_on,issue_on+coalesce(s.default_invoice_due_days,15),items,
        j.price,0,0,j.price,0,j.price,j.internal_notes,
        coalesce(s.default_invoice_terms,s.default_payment_terms)
      ) RETURNING id INTO new_invoice_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS duplicate_constraint=CONSTRAINT_NAME;
      IF duplicate_constraint <> 'invoices_invoice_number_key' THEN RAISE; END IF;
    END;
  END LOOP;
  IF new_invoice_id IS NULL THEN RAISE EXCEPTION 'Could not allocate a unique invoice number for repair.'; END IF;
END;
$recovery$;
