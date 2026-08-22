-- StudioScrubz OS V2-005B: preserve Payment -> Invoice history.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.
-- Existing detached Payments remain untouched; invoice_id intentionally stays nullable.

alter table public.square_checkout_attempts
  add column if not exists square_environment text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'square_checkout_attempts_environment_check'
      and conrelid = 'public.square_checkout_attempts'::regclass
  ) then
    alter table public.square_checkout_attempts
      add constraint square_checkout_attempts_environment_check
      check (square_environment in ('sandbox','production'));
  end if;
end $$;

-- Existing attempts are deliberately left NULL until their environment can be
-- established from authoritative deployment/provider evidence. NULL is treated
-- as protected. New checkout creation always supplies the server-side value.

drop index if exists public.square_checkout_attempts_one_active_invoice_idx;
create unique index square_checkout_attempts_one_active_invoice_idx
  on public.square_checkout_attempts (invoice_id, square_environment)
  where status in ('Created','Pending');

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

  if exists (
    select 1
    from public.square_checkout_attempts
    where invoice_id = old.id
      and (
        square_environment is distinct from 'sandbox'
        or status in ('Completed','Conflict')
      )
  ) then
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

-- The canonical permanent-delete RPC removes only explicitly classified,
-- nonfinancial Sandbox attempts before deleting an archived Invoice. This
-- trigger never deletes attempts; it supplies database-wide defense in depth.

notify pgrst, 'reload schema';
