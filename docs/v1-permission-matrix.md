# StudioScrubz OS v1 permission matrix

Database RLS and scoped RPCs are authoritative. Sidebar visibility and route guards mirror these boundaries but are not the security boundary.

| Area | Master Admin | Administrator | Manager | Sales | Crew Lead | Scrub Technician |
| --- | --- | --- | --- | --- | --- | --- |
| Clients / Properties | Full operational management | Manage | Manage | Manage | Assigned-job context only | Assigned-job context only |
| Estimates / Walkthroughs | Manage | Manage | Manage | Manage | None | None |
| Proposals | Create, send, approve | Create/send | Create | Create/send | None | None |
| Jobs / Schedule | Full | Operational management | Operational management | No Job management | Assigned-crew start/complete and limited notes | Assigned work read-only |
| Agreements | Full | Manage | Manage | Sales workflow management | None | None |
| Invoices | Full | Create/edit | Read | None | None | None |
| Payments / Revenue / Expenses | Full | No payment/finance access | None | None | None | None |
| Employees | Full including pay | Non-pay management | Safe directory | Safe sales workflow only | Crew context | Own operational context |
| Crews | Full | Manage | Manage | None | Own crew context | Assigned crew context |
| Time Clock | Full and final review | Operational correction/review without pay response | Operational management, no final payroll approval | Own punches | Own/crew punches | Own punches |
| Payroll Preparation | Full | None | None | None | None | None |
| Service Catalog | Manage | Read for workflows | Read for workflows | Read for workflows | None | None |
| Business Settings | Manage | Safe workflow defaults | Safe workflow defaults | Safe workflow defaults | Public identity only | Public identity only |
| Communications | Full | Operational | Operational | Sales types only | None | None |
| Attention Center | All authorized sources | Operational | Operational | Sales sources | Scoped Job/Time items | Own scoped Job/Time items |
| Archives | View/restore/permanent delete | View/restore | None | None | None | None |
| Users / Settings | Full | None | None | None | None | None |

Sensitive invariants:

- Finances and Payroll Preparation remain Master Admin only.
- Non-Master Time Clock RPCs return projections without rates or calculated pay.
- Administrator employee RPCs return non-pay directory projections.
- Crew roles receive Jobs through assigned-crew predicates and non-financial views.
- Permanent deletion is available only through the Master Admin RPC and only for archived records.

