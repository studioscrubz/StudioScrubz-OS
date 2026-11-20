create function private.add_brava_invoice_zelle_instructions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_name text;
  recipient_phone text;
  instructions text;
begin
  if new.archived_at is not null
    or new.status in ('Paid', 'Cancelled', 'Archived')
    or not exists (
      select 1
      from public.contractor_companies company
      where company.id = 'a1b0e01c-3990-47e8-9c4f-40c772ce35fd'::uuid
        and company.client_id = new.client_id
    )
    or pg_catalog.strpos(coalesce(new.customer_notes, ''), 'Please pay by Zelle') > 0
  then
    return new;
  end if;

  select nullif(btrim(settings.post_construction_payment_recipient_name), ''),
         nullif(btrim(settings.post_construction_payment_recipient_phone), '')
  into recipient_name, recipient_phone
  from public.business_settings settings
  order by settings.id
  limit 1;

  if recipient_name is null or recipient_phone is null then
    instructions := 'Please pay by Zelle. Contact StudioScrubz for the recipient details.';
  else
    instructions := pg_catalog.format('Please pay by Zelle to %s at %s.', recipient_name, recipient_phone);
  end if;

  new.customer_notes := pg_catalog.concat_ws(E'\n\n',
    nullif(btrim(new.customer_notes), ''),
    pg_catalog.format('%s Include invoice %s in the payment memo.', instructions, new.invoice_number)
  );
  return new;
end;
$$;

revoke all on function private.add_brava_invoice_zelle_instructions() from public, anon, authenticated;

create trigger add_brava_invoice_zelle_instructions
before insert or update of customer_notes, client_id on public.invoices
for each row execute function private.add_brava_invoice_zelle_instructions();
