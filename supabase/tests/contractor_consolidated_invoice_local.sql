-- LOCAL ONLY: Contractor client and consolidated Invoice regression.
begin;

insert into public.clients (id,client_type,company_name,status)
values
  ('c7100000-0000-0000-0000-000000000001','Contractor','Test Contractor Company','Active'),
  ('c7100000-0000-0000-0000-000000000002','Commercial','Other Synthetic Client','Active'),
  ('c7100000-0000-0000-0000-000000000003','Residential','Synthetic Residential','Active');

insert into public.properties (id,client_id,property_name,property_type,address,city,state,zip)
values
  ('c7100000-0000-0000-0000-000000000011','c7100000-0000-0000-0000-000000000001','Location A','Commercial','123 Main St','Testville','CA','90001'),
  ('c7100000-0000-0000-0000-000000000012','c7100000-0000-0000-0000-000000000001','Location B','Residential','456 Oak Ave','Testville','CA','90002'),
  ('c7100000-0000-0000-0000-000000000013','c7100000-0000-0000-0000-000000000001','Location C','Commercial','789 Pine St','Testville','CA','90003'),
  ('c7100000-0000-0000-0000-000000000014','c7100000-0000-0000-0000-000000000002','Other Location','Commercial','999 Other Rd','Testville','CA','90004'),
  ('c7100000-0000-0000-0000-000000000015','c7100000-0000-0000-0000-000000000003','Residential Location','Residential','100 Test Home','Testville','CA','90005');

insert into public.jobs (
  id,job_number,client_id,property_id,division,client_name,property_name,
  service_name,frequency,status,scheduled_date,price,deposit,balance,
  labor_hours,recommended_crew_size,scope,checklist,photos,assigned_team,completed_at
)
values
  ('c7100000-0000-0000-0000-000000000021','JOB-C710-A','c7100000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000011','Commercial','Test Contractor Company','Location A','Turnover Clean','One-Time','Completed',current_date,225,0,225,0,1,'[]','[]','[]','[]',now()),
  ('c7100000-0000-0000-0000-000000000022','JOB-C710-B','c7100000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000012','Residential','Test Contractor Company','Location B','Deep Clean','One-Time','Completed',current_date,300,0,300,0,1,'[]','[]','[]','[]',now()),
  ('c7100000-0000-0000-0000-000000000023','JOB-C710-C','c7100000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000013','Commercial','Test Contractor Company','Location C','Standard Clean','One-Time','Completed',current_date,185,0,185,0,1,'[]','[]','[]','[]',now()),
  ('c7100000-0000-0000-0000-000000000024','JOB-C710-OTHER','c7100000-0000-0000-0000-000000000002','c7100000-0000-0000-0000-000000000014','Commercial','Other Synthetic Client','Other Location','Office Clean','One-Time','Completed',current_date,50,0,50,0,1,'[]','[]','[]','[]',now()),
  ('c7100000-0000-0000-0000-000000000027','JOB-C710-RES','c7100000-0000-0000-0000-000000000003','c7100000-0000-0000-0000-000000000015','Residential','Synthetic Residential','Residential Location','Home Clean','One-Time','Completed',current_date,60,0,60,0,1,'[]','[]','[]','[]',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','7badd39b-e64d-42b5-9e3c-872f528184ce',true);

do $$
declare
  result jsonb;
  v_invoice_id uuid;
  single_result jsonb;
  one_job_result jsonb;
begin
  if (select count(*) from public.get_contractor_invoice_eligible_jobs('c7100000-0000-0000-0000-000000000001')) <> 3 then
    raise exception 'Expected three eligible Contractor Jobs.';
  end if;

  result := public.create_contractor_consolidated_invoice(
    'c7100000-0000-0000-0000-000000000001',
    array['c7100000-0000-0000-0000-000000000021','c7100000-0000-0000-0000-000000000022','c7100000-0000-0000-0000-000000000023']::uuid[],
    current_date,
    current_date + 15
  );
  v_invoice_id := (result->>'invoice_id')::uuid;

  if (select total from public.invoices where id=v_invoice_id) <> 710 then raise exception 'Expected $710 Invoice.'; end if;
  if (select count(*) from public.invoice_job_lines where invoice_job_lines.invoice_id=v_invoice_id) <> 3 then raise exception 'Expected three Job lines.'; end if;
  if (select count(distinct property_id) from public.invoice_job_lines where invoice_job_lines.invoice_id=v_invoice_id) <> 3 then raise exception 'Expected three retained locations.'; end if;
  if (select count(*) from public.get_contractor_invoice_eligible_jobs('c7100000-0000-0000-0000-000000000001')) <> 0 then raise exception 'Invoiced Jobs remained eligible.'; end if;

  begin
    perform public.create_contractor_consolidated_invoice(
      'c7100000-0000-0000-0000-000000000001',
      array['c7100000-0000-0000-0000-000000000024']::uuid[],current_date,null
    );
    raise exception 'Cross-client Job was accepted.';
  exception when others then
    if sqlerrm='Cross-client Job was accepted.' then raise; end if;
  end;

  begin
    perform public.create_contractor_consolidated_invoice(
      'c7100000-0000-0000-0000-000000000001',
      array['c7100000-0000-0000-0000-000000000021']::uuid[],current_date,null
    );
    raise exception 'Duplicate Job billing was accepted.';
  exception when others then
    if sqlerrm='Duplicate Job billing was accepted.' then raise; end if;
  end;

  perform public.record_invoice_payment(v_invoice_id,200,current_date,'ACH','SYNTH-PARTIAL',null);
  if not exists(select 1 from public.invoices where id=v_invoice_id and amount_paid=200 and balance_due=510 and status='Partially Paid') then raise exception 'Partial payment state failed.'; end if;
  perform public.record_invoice_payment(v_invoice_id,510,current_date,'ACH','SYNTH-FULL',null);
  if not exists(select 1 from public.invoices where id=v_invoice_id and amount_paid=710 and balance_due=0 and status='Paid') then raise exception 'Full payment state failed.'; end if;

  insert into public.jobs (id,job_number,client_id,property_id,division,client_name,property_name,service_name,frequency,status,scheduled_date,price,deposit,balance,labor_hours,recommended_crew_size,scope,checklist,photos,assigned_team,completed_at)
  values ('c7100000-0000-0000-0000-000000000026','JOB-C710-ONE','c7100000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000012','Residential','Test Contractor Company','Location B','One Job Consolidated','One-Time','Completed',current_date,80,0,80,0,1,'[]','[]','[]','[]',now());
  one_job_result := public.create_contractor_consolidated_invoice('c7100000-0000-0000-0000-000000000001',array['c7100000-0000-0000-0000-000000000026']::uuid[],current_date,null);
  if (select count(*) from public.invoice_job_lines where invoice_id=(one_job_result->>'invoice_id')::uuid) <> 1 then raise exception 'One-Job consolidated Invoice failed.'; end if;

  -- Existing single-Job invoicing remains valid for a Contractor Job.
  insert into public.jobs (id,job_number,client_id,property_id,division,client_name,property_name,service_name,frequency,status,scheduled_date,price,deposit,balance,labor_hours,recommended_crew_size,scope,checklist,photos,assigned_team,completed_at)
  values ('c7100000-0000-0000-0000-000000000025','JOB-C710-SINGLE','c7100000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000011','Commercial','Test Contractor Company','Location A','Single Job Regression','One-Time','Completed',current_date,75,0,75,0,1,'[]','[]','[]','[]',now());
  single_result := public.create_completed_job_invoice('c7100000-0000-0000-0000-000000000025');
  if coalesce((single_result->>'created')::boolean,false) is not true then raise exception 'Single-Job invoice regression failed.'; end if;
  if coalesce((public.create_completed_job_invoice('c7100000-0000-0000-0000-000000000024')->>'created')::boolean,false) is not true then raise exception 'Commercial client invoice regression failed.'; end if;
  if coalesce((public.create_completed_job_invoice('c7100000-0000-0000-0000-000000000027')->>'created')::boolean,false) is not true then raise exception 'Residential client invoice regression failed.'; end if;
end;
$$;

set constraints all immediate;

rollback;
