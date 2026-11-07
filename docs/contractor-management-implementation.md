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
- Uploaded files: private bucket, explicit MIME and magic bytes, max 4 MB, path generated on server, and company scope checked on every download. Completion photos also use authenticated downloads.
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
5. Auth provider redirect allowlist must include `https://partners.studioscrubz.com/contractor/activate` and `https://partners.studioscrubz.com/contractor/reset-password`. Invitation and recovery links use the partner host. Signup email verification carries the invitation in a URL fragment so the callback matches Supabase’s exact allowed path.
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

## Incremental implementation and protection updates (November 7)
- Internal opportunities now derive current visible states from the existing operational Job and linked invoice records. Completion requires an explicit contractor quality-review approval before partner-facing invoices and finished photos appear. This preserves existing automatic invoice creation rather than changing its behavior.
- Company administration now supports territories, service types, payment terms, rate-card JSON, assigned operational manager, authorized members, and secure documents. Tax documents are restricted to StudioScrubz or the external Company's Admin.
- A unique per-form request ID prevents duplicate opportunities on browser retries. Accepted-to-Job conversion remains SQL-atomic and idempotent.
- Profitability assessments persist the **exact scope and amount evaluated**, and acceptance/conversion rejects stale terms even if a prior Master Admin override was granted.
- Subcontracted Jobs can be staffed through the existing `assignJobWorker` service; crew and technician conflicts are checked, and the existing time-off, crew, GPS, equipment, and completion controls remain active.
- Internal dashboard adds partner-by-partner revenue, outstanding invoice balances, projected gross profit, and filters. External partners see only their own company's job, invoice and authorized completion information.
- Operations can approve quality, reconcile/create the existing duplicate-protected job invoice, send provider-receipted payment reminders, and record disputes, cancellations and rescheduling. Individual portal memberships may be deactivated and restored.

## Remaining pre-release validation / limitations
- The exact production database cannot be used as an integration test without changing production. PostgreSQL fixture tests and current application contracts are insufficient to prove all real operational trigger interactions end-to-end. This is a release blocker until a disposable production-equivalent database can be tested.
- Supabase Auth redirect allowlist for contractor activation and password reset must be confirmed; a real invitation delivery and redemption test is needed after production deployment is explicitly authorized.
- Scheduled overdue-payment reminder and internal daily attention digest code now exists behind \`CRON_SECRET\`, and records idempotent provider receipts. **It is not active** until an approved Vercel production deployment; notification coverage for every status transition still needs live integration testing. The implementation supports manual provider-confirmed reminders, persistent unread message counts/read receipts, auditable communications, contact-attempt records, assigned follow-up reminders, and linked Job/invoice status readouts.
- Existing completion logic can create invoices at job completion before the contractor quality review. The portal withholds those invoices until quality approval, but the internal invoicing timeline is unchanged to preserve existing business behavior.

2026-11-07 Communications schema additions: `contractor_message_reads`, `contractor_contact_attempts`, and `contractor_followups` (unapplied) provide durable read receipts, contact outcomes, and follow-up actions in the operations dashboard and portal. Tax documents require Company Admin membership or internal staff authorization.

Automated notifications added: `/api/contractors/reminders` and `contractor_notification_deliveries`, with a second daily Vercel cron entry; this configuration must be approved, credential-verified and tested before activation. The processor sends weekly overdue contractor invoice reminders and daily aggregate internal alerts for unassigned Jobs / due follow-ups. It does not create invoices or modify financial ledgers.

## Partner hostname cutover (pending approval)
- Vercel project domain `partners.studioscrubz.com` is registered and ownership-verified on `studio-scrubz-os`.
- Source `proxy.ts` serves sign-in or the portal at the partner root, supports activation and recovery aliases, and rejects employee routes with 404. Contractor handlers also reject staff credentials on the partner hostname and recheck current company membership on every protected request.
- Porkbun manages DNS. Its existing partner record is **not** pointed at Vercel yet. Vercel returned `c8a9ba22b868a37a.vercel-dns-017.com` as the preferred CNAME on November 7, 2026. Replace the existing `partners` CNAME to `uixie.porkbun.com` after release approval and acceptance testing. Keep the other DNS records intact.
- Supabase authentication redirect allowlist needs the two partner callback URLs above; existing employee redirect rules remain in place.
- No PR merge, production database migration, or production deployment is authorized by domain registration or this code change alone. Do not use production clients for test invitations.


## Controlled release and rollback

1. Recheck the production commit and required environment settings, and verify both partner callback URLs in Supabase Auth. Complete the synthetic acceptance flow on a disposable production-equivalent stack, including real Auth email callbacks and the handoff through technician completion and billing. Retain the previous READY production deployment ID and confirm a database recovery point.
2. With explicit migration approval, apply the foundation migration first and the invitation and handoff migration second, each as a transaction through the standard production migration runner. Check migration history, RLS, RPC grants, and the private bucket before deploying. If the second migration fails, its transaction rolls back; correct it and apply it before advancing.
3. With explicit merge and production deployment approval, merge and release the reviewed revision. Treat merging into Vercel's tracked production branch as a deployment trigger. This PR branch disables automatic Vercel Git deployments. Verify existing employee routes and test the partner host against the released app before admitting contractors.
4. With DNS approval, replace only the Porkbun `partners` CNAME. Wait for DNS and Vercel TLS, then check the public hostname, internal-route rejection, and the invited test account's activation, recovery, and sign-out. Restore the former CNAME and previous Vercel deployment if cutover fails. Keep the additive tables and recorded contractor data during an application rollback.
