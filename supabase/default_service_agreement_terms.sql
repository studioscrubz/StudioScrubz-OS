-- StudioScrubz OS: configurable default terms for new Service Agreements.
-- REVIEW ONLY. Do not execute automatically.
-- Run after service_catalog_settings.sql.

alter table public.business_settings
  add column if not exists default_service_agreement_terms text;

alter table public.business_settings
  alter column default_service_agreement_terms set default $terms$
StudioScrubz agrees to provide the cleaning and/or property maintenance services described in this Service Agreement according to the listed scope of work, service frequency, and scheduled service days. Services outside the agreed scope may require additional authorization and may result in additional charges.

The Client agrees to provide StudioScrubz personnel with safe and reasonable access to the property during scheduled service times, including access to any areas included in the scope of work. The Client is responsible for providing any required keys, gate codes, parking instructions, security procedures, or other access information.

StudioScrubz will perform services using reasonable professional care and industry-standard cleaning practices. While every effort will be made to complete the agreed scope during each visit, conditions outside StudioScrubz's reasonable control—including restricted access, excessive or unexpected conditions, utility interruptions, safety hazards, construction activity, or unavailable areas—may affect completion of services.

The Client agrees to notify StudioScrubz promptly of any concerns regarding completed services. StudioScrubz must be given a reasonable opportunity to inspect and, when appropriate, correct a reported service issue before outside corrective services or reimbursement are requested.

StudioScrubz personnel will not be required to perform work that presents an unreasonable health or safety risk. This may include exposure to hazardous materials, bodily fluids, active infestations, dangerous animals, unsafe structures, illegal substances, or other conditions requiring specialized remediation unless such services were specifically disclosed and agreed to in advance.

The Client is responsible for securing cash, jewelry, confidential documents, firearms, medications, fragile valuables, and other sensitive or unusually valuable property before service. StudioScrubz should be notified in advance of particularly delicate surfaces, furnishings, equipment, or materials requiring special cleaning procedures.

Service schedules may occasionally require reasonable adjustment due to holidays, emergencies, staffing conditions, severe weather, property access issues, or circumstances outside StudioScrubz's control. StudioScrubz will make reasonable efforts to communicate scheduling changes and provide an alternative service time when necessary.

Pricing contained in this Agreement is based on the service scope, frequency, property conditions, and other information agreed upon at the time of execution. Material changes to the property, requested services, service frequency, workload, or scope may require a revised quote or written modification to this Agreement.

Neither party may materially modify the scope, pricing, frequency, or other substantive terms of this Agreement without mutual agreement. Any approved modifications should be documented in writing.

By signing this Service Agreement, the Client acknowledges that they have reviewed and accepted the service scope, pricing, frequency, and terms contained in the Agreement and authorize StudioScrubz to perform the described services.
$terms$;

update public.business_settings
set default_service_agreement_terms = $terms$
StudioScrubz agrees to provide the cleaning and/or property maintenance services described in this Service Agreement according to the listed scope of work, service frequency, and scheduled service days. Services outside the agreed scope may require additional authorization and may result in additional charges.

The Client agrees to provide StudioScrubz personnel with safe and reasonable access to the property during scheduled service times, including access to any areas included in the scope of work. The Client is responsible for providing any required keys, gate codes, parking instructions, security procedures, or other access information.

StudioScrubz will perform services using reasonable professional care and industry-standard cleaning practices. While every effort will be made to complete the agreed scope during each visit, conditions outside StudioScrubz's reasonable control—including restricted access, excessive or unexpected conditions, utility interruptions, safety hazards, construction activity, or unavailable areas—may affect completion of services.

The Client agrees to notify StudioScrubz promptly of any concerns regarding completed services. StudioScrubz must be given a reasonable opportunity to inspect and, when appropriate, correct a reported service issue before outside corrective services or reimbursement are requested.

StudioScrubz personnel will not be required to perform work that presents an unreasonable health or safety risk. This may include exposure to hazardous materials, bodily fluids, active infestations, dangerous animals, unsafe structures, illegal substances, or other conditions requiring specialized remediation unless such services were specifically disclosed and agreed to in advance.

The Client is responsible for securing cash, jewelry, confidential documents, firearms, medications, fragile valuables, and other sensitive or unusually valuable property before service. StudioScrubz should be notified in advance of particularly delicate surfaces, furnishings, equipment, or materials requiring special cleaning procedures.

Service schedules may occasionally require reasonable adjustment due to holidays, emergencies, staffing conditions, severe weather, property access issues, or circumstances outside StudioScrubz's control. StudioScrubz will make reasonable efforts to communicate scheduling changes and provide an alternative service time when necessary.

Pricing contained in this Agreement is based on the service scope, frequency, property conditions, and other information agreed upon at the time of execution. Material changes to the property, requested services, service frequency, workload, or scope may require a revised quote or written modification to this Agreement.

Neither party may materially modify the scope, pricing, frequency, or other substantive terms of this Agreement without mutual agreement. Any approved modifications should be documented in writing.

By signing this Service Agreement, the Client acknowledges that they have reviewed and accepted the service scope, pricing, frequency, and terms contained in the Agreement and authorize StudioScrubz to perform the described services.
$terms$
where default_service_agreement_terms is null;

create or replace view public.business_settings_workflow
with (security_barrier = true) as
select
  id,
  business_name,
  tagline,
  business_email,
  business_phone,
  website,
  address,
  city,
  state,
  zip,
  default_tax_rate,
  default_estimate_expiration_days,
  default_proposal_expiration_days,
  default_invoice_due_days,
  default_payment_terms,
  default_invoice_terms,
  default_proposal_terms,
  default_estimate_notes,
  currency,
  timezone,
  created_at,
  updated_at,
  default_service_agreement_terms
from public.business_settings
where (select auth.uid()) is not null
  and public.has_any_role(array['Master Admin','Administrator','Manager','Sales']);

revoke all on public.business_settings_workflow from public, anon, authenticated;
grant select on public.business_settings_workflow to authenticated;
