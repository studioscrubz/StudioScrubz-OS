# StudioScrubz OS database migration order

All SQL files in `supabase/` are review-only scripts. Confirm the target environment, take a backup, run each file manually in the listed order, and record the applied revision outside the repository. Do not assume a file is applied merely because it exists on disk.

## Fresh database order

1. `supabase/clients.sql`
2. `supabase/properties.sql`
3. `supabase/estimates.sql`
4. `supabase/walkthroughs.sql`
5. `supabase/proposals.sql`
6. `supabase/jobs.sql`
7. `supabase/employees_crews.sql`
8. `supabase/employees_overtime_rate.sql`
9. `supabase/jobs_assigned_crew.sql`
10. `supabase/invoices_payments.sql`
11. `supabase/invoices_active_unique_index.sql`
12. `supabase/expenses.sql`
13. `supabase/vehicles_mileage.sql`
14. `supabase/time_entries.sql`
15. `supabase/service_agreements.sql`
16. `supabase/jobs_service_occurrence.sql`
17. `supabase/user_profiles.sql` — Phase 17 profile bootstrap; create the initial Auth user and trusted Master Admin profile as instructed in the file.
18. `supabase/auth_security_hardening.sql` — Phase 17 final RLS and Master Admin security.
19. `supabase/role_permissions.sql` — Phase 18 role helpers, safe views, scoped policies, and RPCs.
20. `supabase/jobs_visibility_fix.sql`
21. `supabase/service_catalog_settings.sql` — Phase 19 catalog, verified pricing seed, and business settings.
22. `supabase/global_archive_delete_relationships.sql`
23. `supabase/archive_permanent_delete_rpc.sql`
24. `supabase/service_agreement_delivery.sql`
25. `supabase/service_agreement_esign.sql`
26. `supabase/client_communications.sql`
27. `supabase/client_communications_event_keys.sql`
28. `supabase/attention_item_states.sql`
29. `supabase/phase22_v1_hardening.sql` — final anonymous-access and permanent-delete privilege closure.

After the final migration, run `notify pgrst, 'reload schema';` manually and execute the security and role tests in `docs/v1-production-checklist.md`.

## Inventory notes

- The early feature files intentionally contain temporary authenticated/anonymous development policies. `auth_security_hardening.sql`, `role_permissions.sql`, and the final Phase 22 hardening script replace or revoke those privileges. Never stop a production installation before the hardening files are applied.
- `jobs_visibility_fix.sql` supersedes the earlier `get_operational_jobs` definition in `role_permissions.sql`.
- `client_communications_event_keys.sql` extends `client_communications.sql`; it does not replace it.
- `service_agreement_esign.sql` extends `service_agreement_delivery.sql`.
- SQL application status cannot be determined from repository files. Compare this inventory with the target database migration log before applying anything.

