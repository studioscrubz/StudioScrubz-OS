# StudioScrubz OS v1 production QA checklist

Run this checklist in a staging project configured like production. Test each role with a separate Auth user and never use production client records for QA.

## Deployment and security

- [ ] Apply reviewed SQL in `docs/database-migration-order.md`; record each applied file.
- [ ] Reload the PostgREST schema after migrations.
- [ ] Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` in Vercel.
- [ ] Confirm no service-role key or other secret is present in browser bundles or `NEXT_PUBLIC_*` variables.
- [ ] Confirm anonymous REST access to every internal table is denied.
- [ ] Confirm `/agreement/<token>` works logged out while workspace routes redirect to Login.
- [ ] Test invalid, expired, completed, cancelled, and archived agreement links.

## Authentication and roles

- [ ] Login, logout, expired-session redirect, and return URL work.
- [ ] Master Admin bootstrap profile loads.
- [ ] The final active Master Admin cannot be deactivated or demoted.
- [ ] User creation/editing respects every role and employee link.
- [ ] Unlinked Crew Lead/Scrub Technician/Sales operational actions fail closed.
- [ ] Verify every row of `docs/v1-permission-matrix.md` with direct URLs as well as sidebar navigation.

## Clients through proposals

- [ ] Create, edit, archive, restore, and view a Client and Property.
- [ ] Verify nullable historical relationships render “Deleted” or “—” after a safe parent deletion test.
- [ ] Create Residential and Commercial Estimates using catalog pricing.
- [ ] Confirm archived catalog services/add-ons are unavailable to new calculations.
- [ ] Create and complete a Walkthrough.
- [ ] Create, approve, send, accept, archive, and restore a Proposal.
- [ ] Confirm Proposal acceptance creates one Job and one communication lifecycle event.

## Jobs, schedule, and agreements

- [ ] Accepted Proposal Job appears immediately in Ready to Schedule.
- [ ] Schedule, assign crew, start, complete, cancel, and archive Jobs.
- [ ] Completed Job without an active Invoice remains visible; with an active Invoice it leaves the active board.
- [ ] Crew Lead sees only assigned work; Technician cannot reschedule, cancel, or reassign.
- [ ] Create an Agreement using catalog Service and customized scope.
- [ ] Send/resend Agreement and verify the production signing URL.
- [ ] Sign with explicit consent; verify snapshot, signed name/date, and Accepted status.
- [ ] Confirm signed material fields cannot be edited and activation remains an internal action.
- [ ] Complete an Agreement with future-occurrence warning and verify no new occurrences are generated.

## Invoices and finance

- [ ] Create/edit/send an Invoice from a completed Job and prevent duplicates.
- [ ] Record Payments and verify Invoice totals/status.
- [ ] Verify deleted parent links do not hide retained Invoice or Payment history.
- [ ] Test Revenue, Expenses, Vehicles, and Mileage as Master Admin.
- [ ] Confirm all non-Master roles are denied Finances and Payroll Preparation.

## Employees, crews, and time

- [ ] Create/edit/archive/restore an Employee and Crew; add/remove crew membership.
- [ ] Confirm non-Master employee views contain no pay rates.
- [ ] Clock in/out as each operational role; verify self-service timestamps use database time.
- [ ] Confirm manual corrections require Master Admin or Administrator.
- [ ] Confirm final Approved/Rejected review remains Master Admin authority.
- [ ] Verify historical Time Entries survive employee/job deletion without exposing pay.

## Settings, communications, and Attention Center

- [ ] Manage Services, tiers, add-ons, recurring rules, and Business Settings as Master Admin.
- [ ] Change catalog pricing and confirm historical Estimates, Proposals, Agreements, Jobs, and Invoices remain unchanged.
- [ ] Log Email, SMS, Phone, and General communication; verify timeline loading, empty, error, filters, and archive states.
- [ ] Test device SMS and device email handoff; confirm records remain Prepared until explicit confirmation.
- [ ] Verify Sent/Failed transitions, retry history, lifecycle idempotency, and absence of signing tokens in communication history.
- [ ] Verify Attention filters, actions, snooze, dismiss, restore, reminder timing, reminder dedupe, and dashboard counts for every role.

## Archives and final deployment

- [ ] Archive, restore, and permanently delete one safe record of every supported type.
- [ ] Confirm retained children survive through `SET NULL`; only subordinate rows are removed.
- [ ] Confirm active records and non-Master users cannot invoke permanent deletion.
- [ ] Verify loading, empty, validation, and user-facing error states on all major pages.
- [ ] Run `npm run build` and `npm run lint` with no errors.
- [ ] Deploy to Vercel, smoke-test production URLs, and review Supabase Auth, PostgREST, and browser console logs.

