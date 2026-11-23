-- Read-only reference descriptions for direct StudioScrubz customer jobs.
-- This does not change immutable accepted job scope or contractor-specific agreements.
create or replace function public.get_direct_customer_service_description(p_job_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare result_text text;
begin
 if not public.can_access_job(p_job_id) then
  raise exception 'Job access denied' using errcode='42501';
 end if;
 select nullif(btrim(s.description),'') into result_text
 from public.jobs j
 join public.clients c on c.id=j.client_id
 join public.services s on
  lower(btrim(s.service_name))=lower(btrim(j.service_name))
  and (s.division=j.division or s.division='Both')
  and s.is_active=true and s.archived_at is null
 where j.id=p_job_id and c.client_type is distinct from 'Contractor'
 order by case when s.division=j.division then 0 else 1 end,s.display_order
 limit 1;
 return result_text;
end;
$$;
revoke all on function public.get_direct_customer_service_description(uuid) from public,anon;
grant execute on function public.get_direct_customer_service_description(uuid) to authenticated;
notify pgrst,'reload schema';