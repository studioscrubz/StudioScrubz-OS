-- StudioScrubz OS Backlog #30 follow-up: signed Agreement operational edits.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.
--
-- Keeps signed acceptance, contractual identity, service/scope, and financial
-- terms immutable while allowing authorized updates to future operations.

create or replace function public.prevent_signed_agreement_material_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.client_signed_at is not null then
    if new.client_signed_snapshot is distinct from old.client_signed_snapshot
      or new.client_signed_name is distinct from old.client_signed_name
      or new.client_signature is distinct from old.client_signature
      or new.client_signed_at is distinct from old.client_signed_at
      or new.client_consent_text is distinct from old.client_consent_text
      or new.client_consent_at is distinct from old.client_consent_at then
      raise exception 'Signed acceptance data is immutable.';
    end if;

    if new.agreement_number is distinct from old.agreement_number
      or new.client_id is distinct from old.client_id
      or new.property_id is distinct from old.property_id
      or new.proposal_id is distinct from old.proposal_id
      or new.division is distinct from old.division
      or new.service_name is distinct from old.service_name
      or new.scope is distinct from old.scope
      or new.billing_type is distinct from old.billing_type
      or new.billing_amount is distinct from old.billing_amount
      or new.pricing_snapshot is distinct from old.pricing_snapshot
      or new.payment_terms is distinct from old.payment_terms
      or new.agreement_terms is distinct from old.agreement_terms
      or new.cancellation_terms is distinct from old.cancellation_terms
      or new.accepted_at is distinct from old.accepted_at then
      raise exception 'A signed Service Agreement cannot be materially changed. Cancel it and create a new agreement for revised terms.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_signed_agreement_material_changes() from public, anon, authenticated;

