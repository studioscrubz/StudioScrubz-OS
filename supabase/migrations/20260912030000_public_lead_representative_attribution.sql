-- Trusted public submission uses the server's service-role client.
-- No anonymous read/write grants or public mutation RPCs are added.
begin;
create or replace function public.validate_estimate_lead_representative()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.lead_representative_id is not distinct from old.lead_representative_id then
    return new;
  end if;
  if new.lead_representative_id is null then return new; end if;
  if auth.role() is distinct from 'service_role' and (
    auth.uid() is null or not public.has_any_role(array['Master Admin', 'Administrator', 'Sales'])
  ) then
    raise exception 'Lead Representative selection access denied.' using errcode = '42501';
  end if;
  perform 1 from public.employees e
  where e.id = new.lead_representative_id and e.department = 'Lead Representative'
    and e.employment_status = 'Active' and e.archived_at is null
  for share;
  if not found then
    raise exception 'Select an active Lead Representative or None / Direct Lead.';
  end if;
  return new;
end $$;
revoke all on function public.validate_estimate_lead_representative() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
