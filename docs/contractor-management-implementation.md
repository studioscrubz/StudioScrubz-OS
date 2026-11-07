# Contractor Management & Partner Portal — Implementation Branch

**Source base:** production main `5385ea6e497c2e82c418e87e9985b2853e7b43c9` (verified November 7, 2026).
**Deployment:** BLOCKED pending explicit Master Admin approval. No production migration, no production/preview deployment.

## Existing systems reused
- Auth: existing Supabase SSR cookie session and password recovery.
- Roles: existing `Master Admin` and `Manager` permission checks; no new StudioScrubz employee role is added.
- Jobs: accepted opportunities convert to `public.jobs`, with `public.clients` and `public.properties` populated, preserving job start, GPS, checklists and completion triggers.
- Scheduling: linked Job remains unassigned until staffed in the existing Jobs/Schedule UI. No direct external assignment.
- Profitability: existing `calculateProfitability`, validated settings and travel projection; internal-only assessment and Master override.
- Invoicing: existing job-based invoice creation and payments; internal and partner dashboards read only linked invoices. Duplicate invoice creation is not introduced.
- Communications: authenticated company-scoped durable messages; Resend only marked sent with provider receipt.

## Security decisions
- Contractor accounts use Supabase Auth without an employee `user_profiles` row. `contractor_members` binds them to exactly one active company.
- All new tables have RLS and browser mutation grants revoked; only allowlisted server routes and guarded transaction RPCs mutate records.
- External portal API selects an explicit safe field list for each resource. It never returns labor costs, wage information, assessments, audit notes, payroll, or other company data.
- Invitation: 256-bit random secret stored only as SHA-256 hash, seven-day database-generated expiration, atomic company+verified-email redemption, single use. Expired/revoked invites cannot create membership.
- Uploaded files: private bucket, explicit MIME and magic bytes, max 15MB, path generated on server, per-company scope verification, 60-second signed download URLs.
- Financial overrides are restricted by the server to Master Admin with a reason. The job conversion RPC independently requires a completed assessment, signed-off scope/price, or a documented override.
- Two independent schema-only native PostgreSQL migration files have a dedicated security regression workflow.
- No historical jobs, employees, invoices, payments or financial settings are altered by migrations.

## Scope implemented on this branch
- Operations navigation with six Contractor Management views
- Partner company directory and Master Admin status controls
- Secure invite, resend, revoke, account activation and password recovery
- Contractor company portal, submission, document uploads, messaging and company admin staff requests
- Durable opportunity/offer history, partner confirmation, internal profitability and decisions
- Atomic and idempotent conversion to an unassigned operational Job for scheduling and technicians
- Internal dashboard and linked status/invoice/payment readouts
- Emails for selected events with provider receipts and failure audit events
- Source contracts and native PostgreSQL isolation tests

## Pre-production validation checklist
1. CI: typecheck, regression contracts, production build.
2. Native PG: both exact migration files, replay, expiry, cross-company isolation, manager restrictions, job handoff.
3. Supabase production migration and storage bucket state **read-only review** immediately before approval.
4. Vercel team/project/domain/env read-only review, then production-only release after approval.
5. Auth provider redirect allowlist must include `https://app.studioscrubz.com/contractor/activate` and `https://app.studioscrubz.com/contractor/reset-password`.
6. Send real invitation to an explicitly designated test contractor after approval, and verify activation email and first job submission.
7. Validate real technician GPS, equipment and photo flow on a controlled test Job.
8. Verify invoice creation and payment reconciliation with a controlled contractor job.

## Intentionally preserved boundaries
- The portal does not embed existing internal communication threads or employee records, which contain non-partner information.
- Invoices are created by the existing completion/invoicing workflow, not duplicated in the contractor portal.
- Contractor completion photos are restricted to approved company documents and existing customer-visible photo outputs; unreviewed internal Job photos are never exposed.
- Company access, permission changes and financial overrides require internal authorization.

## Known pre-approval issues to validate
- Supabase Auth redirect allowlist and email provider configuration; no real external emails sent from this branch.
- Exact interaction between new accepted-job rows and all production operational triggers must be verified in a staging-equivalent environment before live release.
- Native PG fixtures prove the new SQL contracts but do not reproduce every production trigger, queue and notification process.
- Existing job completion-to-invoice workflow must be verified specifically for `client_type='Contractor'` billing; no invoice auto-generation bypass introduced.
