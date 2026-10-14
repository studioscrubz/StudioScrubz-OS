\set ON_ERROR_STOP on

begin;

insert into auth.users(id, email, role, aud) values
  ('76000000-0000-4000-8000-000000000001', 'physical-admin@example.test', 'authenticated', 'authenticated'),
  ('76000000-0000-4000-8000-000000000002', 'physical-tech@example.test', 'authenticated', 'authenticated');
insert into public.user_profiles(id, email, display_name, role, is_active) values
  ('76000000-0000-4000-8000-000000000001', 'physical-admin@example.test', 'Physical Admin', 'Administrator', true),
  ('76000000-0000-4000-8000-000000000002', 'physical-tech@example.test', 'Physical Tech', 'Scrub Technician', true);

insert into public.clients(id, client_type, company_name, status)
values ('76000000-0000-4000-8000-000000000010', 'Commercial', 'Physical Signing Test Client', 'Active');
insert into public.properties(id, client_id, property_name, property_type, address)
values ('76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000010', 'Physical Signing Test Property', 'Commercial', '1 Test Way');

insert into public.service_agreements (
  id, agreement_number, client_id, property_id, division, agreement_name,
  service_name, frequency, start_date, billing_type, billing_amount,
  pricing_snapshot, scope, status, sent_at
) values
  ('76000000-0000-4000-8000-000000000020', 'AGR-PHYSICAL-1', '76000000-0000-4000-8000-000000000010', '76000000-0000-4000-8000-000000000011', 'Commercial', 'Physical Agreement', 'Commercial Cleaning', 'Weekly', current_date, 'Per Visit', 250, '{"final_per_visit_price":250}'::jsonb, '[{"id":"scope-1","text":"Original scope"}]'::jsonb, 'Sent', now()),
  ('76000000-0000-4000-8000-000000000021', 'AGR-ELECTRONIC-1', '76000000-0000-4000-8000-000000000010', '76000000-0000-4000-8000-000000000011', 'Commercial', 'Electronic Agreement', 'Commercial Cleaning', 'Weekly', current_date, 'Per Visit', 300, '{"final_per_visit_price":300}'::jsonb, '[]'::jsonb, 'Accepted', now());
update public.service_agreements set client_signed_at = now(), client_signature = '/s/ Existing Client', client_signed_name = 'Existing Client'
where id = '76000000-0000-4000-8000-000000000021';

insert into storage.objects(bucket_id, name, owner_id, metadata) values
  ('signed-agreements', 'agreements/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000030/76000000-0000-4000-8000-000000000031/signed.pdf', '76000000-0000-4000-8000-000000000001', '{"mimetype":"application/pdf","size":1024}');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.finalize_physical_service_agreement(
      '76000000-0000-4000-8000-000000000020', '76000000-0000-4000-8000-000000000030', current_date, true, true,
      '[{"id":"76000000-0000-4000-8000-000000000031","original_filename":"signed.pdf","storage_path":"agreements/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000030/76000000-0000-4000-8000-000000000031/signed.pdf","mime_type":"application/pdf","size_bytes":1024,"page_order":1}]'::jsonb, false
    );
    raise exception 'Unauthorized physical signing unexpectedly succeeded.';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '76000000-0000-4000-8000-000000000001', true);
select public.finalize_physical_service_agreement(
  '76000000-0000-4000-8000-000000000020', '76000000-0000-4000-8000-000000000030', current_date, true, true,
  '[{"id":"76000000-0000-4000-8000-000000000031","original_filename":"signed.pdf","storage_path":"agreements/76000000-0000-4000-8000-000000000020/76000000-0000-4000-8000-000000000030/76000000-0000-4000-8000-000000000031/signed.pdf","mime_type":"application/pdf","size_bytes":1024,"page_order":1}]'::jsonb, false
);

do $$ begin
  if not exists (
    select 1 from public.service_agreements
    where id = '76000000-0000-4000-8000-000000000020'
      and status = 'Accepted' and accepted_at is not null
      and signing_method = 'physical' and physically_signed_on = current_date
      and client_signed_at is null and client_signature is null and client_consent_at is null
      and billing_amount = 250 and pricing_snapshot = '{"final_per_visit_price":250}'::jsonb
      and scope = '[{"id":"scope-1","text":"Original scope"}]'::jsonb
  ) then raise exception 'Physical signing failed or changed protected Agreement content.'; end if;
  if (select count(*) from public.service_agreement_physical_signing_events where agreement_id = '76000000-0000-4000-8000-000000000020') <> 1 then raise exception 'Physical signing audit event missing.'; end if;
  if (select count(*) from public.service_agreement_physical_files where agreement_id = '76000000-0000-4000-8000-000000000020' and archived_at is null) <> 1 then raise exception 'Physical signed file metadata missing.'; end if;
  begin
    perform public.finalize_physical_service_agreement(
      '76000000-0000-4000-8000-000000000021', gen_random_uuid(), current_date, true, true,
      '[{"id":"76000000-0000-4000-8000-000000000099","original_filename":"signed.pdf","storage_path":"missing","mime_type":"application/pdf","size_bytes":1024,"page_order":1}]'::jsonb, false
    );
    raise exception 'Electronic signature conflict unexpectedly succeeded.';
  exception when others then
    if sqlerrm not like '%electronically signed Agreement%' then raise; end if;
  end;
end $$;

reset role;
update public.service_agreements set status = 'Archived', archived_at = now()
where id = '76000000-0000-4000-8000-000000000020';
do $$ begin
  if not exists (select 1 from public.service_agreement_physical_files where agreement_id = '76000000-0000-4000-8000-000000000020') then raise exception 'Archival lost the signed document.'; end if;
end $$;

rollback;
