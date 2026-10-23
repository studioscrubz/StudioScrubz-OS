# Sales estimate approvals — implementation contract (not deployed)

## Scope and guarantees
- Sales may draft customer-facing estimates and proposals, but neither may be delivered or previewed publicly until pricing is approved.
- The existing `estimates.status` describes the operational lifecycle (`Open/Converted/Superseded/Declined/Archived`), so introduce an **independent** estimate `approval_status`: `Draft`, `Pending Approval`, `Approved`, `Changes Requested`. Do not repurpose operational status or auto-archive pending estimates.
- Authorized reviewers: active **Manager** and **Master Admin**. Do not implicitly grant Administrator or Lead Representative approval rights.
- Revisions are immutable for audit: approving version N does not authorize a modified version N+1; the exact price/scope/terms snapshot must match during delivery.
- Historical delivered records and previously accepted proposals must remain readable and their customer tokens must not break.
- Keep `lead_representative_id`, lead-representative commission attribution, and payout rules unchanged.

## Verified current implementation, October 23 2026
- `lib/auth/permissions.ts`: Sales has `estimates.create/edit`, `proposals.create/send`; Manager does not have `proposals.approve` or `proposals.view` today.
- `lib/services/estimates.ts`: standard estimate writes use direct table INSERT/UPDATE. `markEstimateSent` uses `mark_estimate_sent_for_delivery`, which currently authorizes Sales and does not require estimate approval.
- `lib/services/proposals.ts`: proposal approval mutation updates fields directly. `approveProposal` sets `approved_by: "Master Admin"` in client code; not reliable audit evidence.
- Existing public proposal delivery RPCs `prepare_proposal_delivery` and `mark_proposal_sent_for_delivery` enforce proposal `approval_status = 'Approved'`, but not an authoritative approved estimate/snapshot version.
- Database trigger `protect_proposal_approval_fields` rejects approval changes by non-Master Admin. Manager approval needs a reviewed DB-level change; adding a UI button alone will fail.
- Sales can currently SELECT estimates and proposals under a broad pipeline policy. RLS alone cannot hide nested labor/profit fields within `estimates.result` JSON.

## Coordinated database and application work
1. **Schema:** Store estimate approval state, requester/approver user IDs, review timestamps and comments, monotonically increasing approval version, server-computed pricing/scope digest, plus append-only approval history. Backfill existing records conservatively without resetting sent/converted statuses.
2. **Authoritative transitions:** Provide authenticated, explicit, atomic server-side submit/approve/request-changes actions. Lock rows, validate current status and version, verify active reviewer role and source state, reject self-approval if required by final policy. Never trust a client-supplied approver name or snapshot hash.
3. **Write guards:** Protect approved/pending estimate price and scope; any modification must explicitly return the record to review and invalidate prior approval. Protect approved proposal pricing, terms and source linkage as well. Restrict direct writes to approval metadata, status and fingerprints so forged REST/Supabase calls cannot elevate privilege.
4. **Delivery guards:** Gate estimate delivery in `mark_estimate_sent_for_delivery` and gate both proposal delivery RPCs. For Sales, require matching current approved versions of every linked estimate/proposal and server-computed fingerprint; do not assume button visibility is authorization. Handle source estimates referenced via walkthrough.
5. **Role-specific data minimization:** Sales must not receive cost, worker-pay, profit, margin or other internal finances via `select(*)`, nested JSON, RPC, browser network, or public payloads. Create an authorized customer-facing server projection and update Sales consumers before revoking broad reads. A React-only field hide is not a security boundary.
6. **UI:** Show explicit approval state and audit history on Open Estimates; Sales can save/revise drafts and request approval; Managers/Master Admin can approve/request changes with required comments. Prevent unapproved send and flag stale proposals. Do not surface internal financials in Sales view.
7. **Notifications:** Reuse attention/Realtime pipeline for new submission and decision events; managers get actionable requests, Sales originator receives decisions. Deduplicate and avoid granting broad financial data through notification payloads.
8. **Rollout:** Apply backward-compatible forward-only migration and verify with DB queries/RLS tests before switching client behavior; deploy to existing StudioScrubz OS Vercel project after CI. Never create a Supabase project or edit paused equipment PR #12.

## Required acceptance tests
- Sales: create/edit draft; see customer pricing but no internal financial fields (including raw network/RPC responses); submit for approval.
- Sales: cannot self-approve, forge approval columns, bypass via direct REST/table write, prepare or send an unapproved/stale proposal, or alter approved pricing without re-review.
- Manager/Master Admin: can review, approve and request changes; reviewer ID and exact version are persisted; other roles denied.
- Edits after approval invalidate exactly that approval and require another reviewer decision; historical versions and revisions remain immutable.
- Proposal send (email/text, first send/resend, new revision, public links) is authorized only on latest approved immutable source version.
- Existing converted/accepted/sent/archived records retain read-only visibility and accepted terms; normal Manager/Sales and Lead Representative commission workflows remain unaffected.
- GitHub TypeScript, contract/RLS regression tests, production build, and actual authenticated staff/browser smoke tests pass before claiming live.

**Status: design contract only; no code, schema, RLS, production data, or deployment changes have been made.**
