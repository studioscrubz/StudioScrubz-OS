# Database dependency manifest

2026-09-24 recruiting additions: `get_job_applications` and `update_job_application` are defined by `20260924142944_lead_generator_applications.sql`. The same migration adds the application relations `job_applications` and `job_application_events`.

2026-09-23 forward-migration additions: `confirm_post_construction_deposit`, `refresh_post_construction_deposit_instructions`, `reverse_post_construction_deposit`, `reopen_post_construction_deposit`, and `mark_service_agreement_sent_for_delivery` are defined by `20260923200258_post_construction_deposit_workflow.sql`. The same migration adds the application relation `proposal_deposit_requirements`; `proposal_deposit_events` is its immutable database audit relation.

Phase 1 static inventory, generated from the repository on 2026-09-19. This is a repository-provenance document, not evidence of the live database state. No remote or local database was queried.

## Classification

- **Tracked migration**: at least one definition is in `supabase/migrations/` and tracked by Git.
- **Tracked standalone only**: the application dependency is defined only in a tracked top-level `supabase/*.sql` script. A fresh migration-only reset cannot reproduce it.
- **Untracked SQL only**: the only definition is in an untracked SQL file.
- **Missing entirely**: application code references the object but no definition was found.
- **Superseded / override**: more than one definition exists; the later intended definition must be established before Phase 2 creates a forward-only migration.

The scan covers statically named `.rpc(...)`, Data API `.from(...)`, Storage bucket constants, and Realtime table registrations in `app/`, `components/`, and `lib/`. Dynamic SQL object construction was not found.

## RPC inventory (108)

### Tracked migration (77)

`accept_service_agreement_by_token`, `acknowledge_required_announcement`, `add_change_request_item`, `add_field_discovery_media`, `add_job_evidence_media`, `add_porter_visit_photo`, `cancel_job_gps_trip`, `cancel_operational_job`, `complete_in_progress_job`, `correct_completed_job_master_time`, `create_change_request`, `create_completed_job_invoice`, `create_contractor_consolidated_invoice`, `create_direct_operational_job_v2`, `create_field_discovery`, `create_job_evidence`, `create_job_from_accepted_proposal`, `create_job_from_service_occurrence`, `create_porter_route`, `create_porter_visit_v3`, `create_post_construction_draft_agreement`, `decide_change_request_by_token`, `delete_porter_visit`, `delete_property_service_plan`, `delete_unsent_draft_service_agreement`, `finish_job_gps_trip`, `generate_due_porter_notifications`, `get_active_employee_work_sessions`, `get_assigned_field_walkthroughs`, `get_change_request_by_token`, `get_company_mileage_rate`, `get_contractor_invoice_eligible_jobs`, `get_eligible_job_tech_options`, `get_financially_handed_off_job_ids`, `get_invoice_by_token`, `get_job_gps_mileage`, `get_job_gps_trips`, `get_job_performance_rows`, `get_lead_representatives`, `get_my_work_session`, `get_operational_job_ids`, `get_operational_jobs`, `get_or_create_service_label`, `get_porter_assignment_options`, `get_proposal_pricing_photos`, `get_porter_routes`, `get_porter_visits`, `get_sales_job_proposal_ids`, `get_service_agreement_by_token`, `get_upcoming_client_jobs`, `initiate_job_on_my_way`, `mark_messages_read`, `master_admin_permanently_delete_cancelled_job`, `mutate_porter_route`, `mutate_porter_visit`, `remove_proposal_pricing_photo`, `save_mileage_entry_with_stops`, `save_porter_visit_issue`, `save_property_service_plan`, `send_change_request`, `send_company_announcement`, `send_direct_message`, `set_company_mileage_rate`, `set_invoice_job_photo_visibility`, `set_job_worker_assignment`, `set_operational_photos`, `set_proposal_pricing_photo_caption`, `start_direct_conversation`, `start_job_gps_trip`, `start_my_work`, `start_operational_job`, `start_or_clock_in_to_job`, `stop_my_work`, `submit_assigned_field_walkthrough`, `update_change_request_draft`, `update_field_discovery_status`, `update_operational_job`.

Current migration homes are the feature migrations dated `20260827` through `20260918`. Definitions with known later untracked overrides are called out under “Overrides requiring adjudication.”

### Tracked standalone only (31) — Phase 2 migration required

| RPCs | Current source |
| --- | --- |
| `accept_proposal_by_token`, `get_estimate_by_token`, `get_proposal_by_token`, `mark_estimate_sent_for_delivery`, `mark_proposal_sent_for_delivery` | `supabase/estimate_proposal_delivery.sql` |
| `request_estimate_walkthrough_by_token` | `supabase/estimate_walkthrough_request.sql` |
| `add_operational_crew_member`, `admin_create_user_profile`, `admin_operational_create_employee`, `admin_operational_update_employee`, `admin_set_user_active`, `admin_update_user_profile`, `manage_operational_crew`, `remove_operational_crew_member`, `review_operational_time_entry`, `save_operational_time_entry` | `supabase/role_permissions.sql` |
| `archive_operational_job`, `get_archived_operational_jobs`, `restore_archived_operational_job` | `supabase/job_lifecycle_operational_rpcs.sql` |
| `get_business_settings_workflow`, `get_crew_directory`, `get_crew_members_directory`, `get_employee_directory`, `get_operational_time_entries` | `supabase/security_definer_hardening_phase_a.sql` |
| `create_contract_agreement_invoice` | `supabase/weekly_biweekly_contract_billing_and_recurring_operations.sql` |
| `get_invoice_payment_confirmation_by_token` | `supabase/public_invoice_links.sql` |
| `get_operational_photos` | `supabase/operational_photo_storage.sql` |
| `master_admin_permanently_delete_archived_record` | `supabase/archive_permanent_delete_rpc.sql` / `supabase/phase22_v1_hardening.sql` |
| `record_invoice_payment` | `supabase/atomic_invoice_payments.sql` |
| `record_square_invoice_payment_v2` | `supabase/square_invoice_tipping.sql` |
| `add_proposal_owned_photo` | `supabase/invoice_operational_photo_snapshot_handoff.sql`; newer untracked override noted below |

### Untracked SQL only (0)

No statically referenced application RPC remains sourced only from untracked SQL.

### Missing RPCs

None of the 106 statically referenced RPC names is missing from all repository SQL. This does not mean the migration chain can create all 106.

## Data API relation inventory (73)

This includes tables and views used through `.from(...)` plus Realtime-only tables.

### Tracked migration (44)

`announcement_acknowledgments`, `assessment_photo_access`, `attention_push_checkpoints`, `attention_push_deliveries`, `authorized_vehicles_safe`, `browser_push_subscriptions`, `change_request_approvals_operational`, `change_request_items`, `change_requests`, `change_requests_operational`, `conversation_members`, `conversations`, `employee_directory_company_safe`, `employee_work_sessions`, `field_discoveries`, `field_discoveries_operational`, `field_discovery_media`, `google_calendar_connections`, `invoice_job_lines`, `invoice_job_photos`, `job_calendar_syncs`, `job_evidence`, `job_evidence_media`, `job_scope_operational_items`, `jobs_operational_safe`, `message_read_states`, `messages`, `messaging_push_deliveries`, `messaging_user_directory_safe`, `mileage_stops`, `notification_preferences`, `porter_notification_events`, `property_service_plan_areas`, `property_service_plans`, `property_service_route_stops`, `property_service_routes`, `property_service_visit_issues`, `property_service_visit_photos`, `property_service_visits`, `scope_snapshot_items`, `scope_snapshots`, `scope_snapshots_operational`, `service_label_assignments`, `service_labels`.

### Tracked standalone only (29) — baseline/forward migration required

`attention_item_states`, `business_settings`, `client_communications`, `clients`, `crew_members`, `crews`, `employees`, `estimates`, `expenses`, `invoices`, `jobs`, `mileage_entries`, `payments`, `properties`, `proposal_history`, `proposals`, `recurring_pricing_rules`, `service_addon_links`, `service_addons`, `service_agreement_documents`, `service_agreements`, `service_occurrences`, `service_price_tiers`, `services`, `square_checkout_attempts`, `time_entries`, `user_profiles`, `vehicles`, `walkthroughs`.

These are not necessarily absent from production. They are absent as reproducible baseline definitions from the tracked migration chain.

### Untracked SQL dependency (0)

No statically referenced Data API relation remains sourced only from untracked SQL.

### Missing entirely (0)

No statically referenced Data API relation is missing from the forward migration chain. `employee_directory_company_safe` is restored by `20260919161425_restore_employee_directory_company_safe.sql`; the previously applied empty migration remains unchanged.

## Storage dependencies

| Bucket | Provenance | Required controls |
| --- | --- | --- |
| `operational-photos` | Tracked standalone `supabase/operational_photo_storage.sql`; later feature migrations extend its helpers/policies | Private bucket, MIME/size limits, scoped read/upload/delete policies, path-validation helpers |
| `agreement-documents` | Tracked standalone `supabase/service_agreement_documents.sql` | Private bucket and agreement-parent scoped read/upload/delete policies |

Both bucket definitions and their baseline Storage policies still require migration-chain coverage.

## Triggers, policies, grants, and Realtime publication

Application code does not reference trigger names, policy names, or grant statements directly. They are nevertheless required enforcement dependencies of the RPCs, relations, Storage buckets, and Realtime subscriptions above.

- Migration-backed feature objects carry their local trigger/policy/grant definitions in their listed feature migrations.
- Baseline relation grants and RLS policies currently live primarily in `auth_security_hardening.sql`, `role_permissions.sql`, `role_visibility_adjustments.sql`, `security_definer_hardening_phase_a.sql`, and `security_definer_hardening_phase_b.sql`.
- Baseline update/snapshot/history triggers live beside their standalone table scripts, including `clients.sql`, `employees_crews.sql`, `estimates.sql`, `expenses.sql`, `jobs.sql`, `proposals.sql`, `time_entries.sql`, `vehicles_mileage.sql`, `walkthroughs.sql`, and the agreement/invoice scripts.
- Realtime membership is required for every table in `OPERATIONAL_TABLES`. Messaging has tracked publication migrations, while the broad baseline publication review remains a tracked standalone script: `operational_realtime_publication_review_only.sql`.
- Live verification on 2026-09-19 found `invoice_job_photos` absent from every publication even though `OperationalRealtimeProvider` subscribes to all (`*`) changes on the public table without a row filter. Migration `20260919165038_restore_invoice_job_photos_realtime.sql` resolves that mismatch by conditionally adding only `public.invoice_job_photos` to `supabase_realtime`; it leaves the table's default replica identity, RLS, policies, grants, Storage protections, and invoice behavior unchanged.
- Historical standalone files contain explicitly temporary/development policies. `remove_temporary_public_policies.sql` and the later hardening scripts are required in the current manual ordering. Those early permissive policies are **superseded** and must not be copied into Phase 2 migrations.
- Every `SECURITY DEFINER` dependency promoted in Phase 2 must carry an explicit empty `search_path`, internal authorization, `REVOKE ... FROM public, anon, authenticated`, and only the required `GRANT EXECUTE` restoration.

## Overrides requiring adjudication before Phase 2

These files appear to contain current behavior beyond an older tracked definition. Phase 2 must compare signatures and bodies and promote only the intended final definition:

- `job_financial_handoff_alignment.sql` is superseded for the current application contract. Live verification confirmed that `is_job_financially_handed_off`, `create_completed_job_invoice`, `get_operational_job_ids`, and `get_operational_jobs` match later tracked migrations rather than this standalone file. `get_financially_handed_off_job_ids` is promoted by `20260919162436_restore_job_financial_handoff_contract.sql`.
- `proposal_pricing_photo_snapshot.sql` is superseded for the three application-facing read/caption/remove RPCs. Live verification confirmed their signatures, management authorization, Draft-only mutations, JSON response shapes, and Storage cleanup handoff; `20260919163228_restore_proposal_pricing_photo_contract.sql` restores those definitions. The file still contains separate unpromoted upload helpers, triggers, and Storage policies.
- `job_finished_photos_invoice_handoff.sql` is superseded as an executable source. Its visibility RPC matches live, but its Job-`After`-only table and snapshot logic predate the verified live Walkthrough/Proposal/Job contract. `20260919164057_restore_finished_job_invoice_photo_contract.sql` restores the authoritative table, RPC, triggers, RLS, grants, and Storage-reference guards.
- `public_invoice_receipt_snapshot.sql`: `get_invoice_by_token` receipt/payment projection.
- `invoice_financial_invariant.sql` and `normalize_business_timezone.sql` are untracked migration-shaped files and need provenance confirmation; they must not be retroactively inserted into applied history.
- Earlier standalone definitions of Job lifecycle RPCs are superseded by the tracked `20260829`, `20260831`, and `20260918` migrations. The latest migration definitions are authoritative for those functions.

## Phase 2 forward-only migration set

Phase 2 should not edit existing migrations. After a separately authorized read-only live comparison, create forward-only migrations for:

1. The 31 standalone-only RPCs, grouped by authorization domain rather than copied wholesale from historical scripts.
2. No application RPC or Data API relation remains in the untracked-only category.
3. Baseline definitions for the 29 standalone-only relations, or an explicitly adopted tracked baseline schema strategy.
4. The `operational-photos` and `agreement-documents` buckets and their final Storage policies.
5. Final RLS, grants, trigger functions/triggers, and Realtime publication membership for every promoted object.

## Seed contract

The project has no deterministic seed dataset. `supabase/config.toml` therefore sets `[db.seed].enabled = false` and uses an empty `sql_paths` list. Local resets are migration-only until a reviewed seed is intentionally introduced.
