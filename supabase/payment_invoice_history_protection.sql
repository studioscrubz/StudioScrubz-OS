-- StudioScrubz OS V2-005B: preserve Payment -> Invoice history.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.
-- Existing detached Payments remain untouched; invoice_id intentionally stays nullable.

alter table public.payments
  drop constraint if exists payments_invoice_id_fkey;

alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id)
  references public.invoices(id)
  on delete restrict;

create or replace function public.prevent_invoice_financial_history_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.payments where invoice_id = old.id) then
    raise exception 'This Invoice has payment history and must be retained for financial records. Archive it instead.';
  end if;

  if exists (select 1 from public.square_checkout_attempts where invoice_id = old.id) then
    raise exception 'This Invoice has Square checkout history and must be retained for financial records. Archive it instead.';
  end if;

  return old;
end;
$$;

revoke all on function public.prevent_invoice_financial_history_delete()
from public, anon, authenticated;

drop trigger if exists invoices_preserve_financial_history on public.invoices;
create trigger invoices_preserve_financial_history
before delete on public.invoices
for each row
execute function public.prevent_invoice_financial_history_delete();

-- The canonical permanent-delete RPC contains the same explicit Payment and
-- Square-history checks. This trigger supplies database-wide defense in depth
-- for every Invoice DELETE path, including the live RPC.

notify pgrst, 'reload schema';
