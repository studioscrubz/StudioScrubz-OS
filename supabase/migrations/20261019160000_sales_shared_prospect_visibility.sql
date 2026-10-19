-- Allow active Sales users to browse the shared prospect pipeline.
-- Assignment continues to control Sales UPDATE access; management retains full access.
begin;

drop policy if exists "Sales read assigned prospects" on public.prospects;
create policy "Sales read shared prospects"
on public.prospects for select to authenticated
using (public.has_any_role(array['Sales']));

drop policy if exists "Authorized prospect events read" on public.prospect_events;
create policy "Authorized prospect events read"
on public.prospect_events for select to authenticated
using (
  public.has_any_role(array['Master Admin','Administrator','Manager'])
  or (
    public.has_any_role(array['Sales'])
    and exists (
      select 1 from public.prospects p
      where p.id = prospect_id
    )
  )
);

commit;
