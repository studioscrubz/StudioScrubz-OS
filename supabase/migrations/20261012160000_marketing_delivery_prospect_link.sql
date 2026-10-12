-- Forward-only: associate a marketing delivery with an existing prospect.
-- Does not send emails, alter existing deliveries, or reclassify prospects.
begin;

alter table public.marketing_material_deliveries
  add column if not exists prospect_id uuid references public.prospects(id) on delete set null;

create index if not exists marketing_material_deliveries_prospect_idx
  on public.marketing_material_deliveries(prospect_id)
  where prospect_id is not null;

create or replace function public.link_marketing_delivery_prospect(
  p_delivery_id uuid,
  p_prospect_id uuid
)
returns public.marketing_material_deliveries
language plpgsql
security definer
set search_path = ''
as $function$
declare
  delivery public.marketing_material_deliveries;
  prospect public.prospects;
  management boolean := public.has_any_role(array['Master Admin','Administrator','Manager']);
begin
  if auth.uid() is null or not (management or public.has_role('Sales')) then
    raise exception 'Marketing Materials access denied.' using errcode = '42501';
  end if;

  select * into delivery
  from public.marketing_material_deliveries
  where id = p_delivery_id
  for update;

  if not found or (not management and delivery.sent_by_user_id <> auth.uid()) then
    raise exception 'Delivery not found or access denied.' using errcode = '42501';
  end if;

  if delivery.recipient_kind <> 'New Prospect'
    or delivery.status <> 'Prepared'
    or delivery.client_id is not null
  then
    raise exception 'Only prepared prospect deliveries can be linked.';
  end if;

  -- RLS-aware lookup: staff may link only prospects they can read.
  select * into prospect
  from public.prospects
  where id = p_prospect_id
    and merged_into_prospect_id is null;

  if not found then
    raise exception 'Prospect unavailable or access denied.' using errcode = '42501';
  end if;

  if lower(btrim(coalesce(prospect.business_email,''))) <> delivery.recipient_email
    or btrim(prospect.company_name) <> delivery.recipient_company
  then
    raise exception 'Prospect recipient details do not match the delivery.';
  end if;

  if delivery.prospect_id is not null and delivery.prospect_id <> p_prospect_id then
    raise exception 'Delivery already belongs to another prospect.';
  end if;

  update public.marketing_material_deliveries
  set prospect_id = p_prospect_id, updated_at = now()
  where id = p_delivery_id
  returning * into delivery;

  return delivery;
end;
$function$;

revoke all on function public.link_marketing_delivery_prospect(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.link_marketing_delivery_prospect(uuid,uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
