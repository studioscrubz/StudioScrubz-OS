-- StudioScrubz OS Cleanup Batch 2: additive workflow defaults and Estimate terms.
-- REVIEW ONLY. Run in the Supabase SQL editor; this project does not execute it automatically.

alter table public.business_settings
  add column if not exists default_estimate_terms text,
  add column if not exists default_cancellation_terms text;

alter table public.estimates
  add column if not exists terms text;

create or replace view public.business_settings_workflow
with (security_barrier = true) as
select
  id, business_name, tagline, business_email, business_phone, website,
  address, city, state, zip, default_tax_rate,
  default_estimate_expiration_days, default_proposal_expiration_days,
  default_invoice_due_days, default_payment_terms, default_invoice_terms,
  default_proposal_terms, default_estimate_notes, currency, timezone,
  created_at, updated_at, default_service_agreement_terms,
  default_estimate_terms, default_cancellation_terms
from public.business_settings
where (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin','Administrator','Manager','Sales']);

revoke all on public.business_settings_workflow from public, anon, authenticated;
grant select on public.business_settings_workflow to authenticated;

notify pgrst, 'reload schema';
