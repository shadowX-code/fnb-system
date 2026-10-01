# Closing Duties duplicate run investigation — 1 October 2026

Read-only Production catalog and evidence investigation. No Task code, schema, occurrence or response mutation was performed. Times below are Asia/Kuala_Lumpur (UTC+8).

## Exact run

Outlet: JYMT Kopitiam (`efdcf357-eb83-4993-a294-bc7f148fb867`).

Logical series: `8504245c-3adc-48ec-9647-9c452e869c25`.

Both occurrences have business date `2026-10-01`, daily recurrence, 20:30–22:30 window, `one_for_team`, frozen `all_crew` assignment, and allow late completion. Both assign Austin Hew Kin Yet, Lee Weng Seng and Terrac Phang Yew Fong. There is no separate persisted schedule/run ID: current uniqueness is revision-specific `(template_id, business_date)`.

| Property | v1 | v2 |
| --- | --- | --- |
| Occurrence | `6ba6e5ae-fc6a-4e28-8093-b67c084bf6c0` | `b82ca8c9-101e-44f1-b7aa-abbe6d025fbe` |
| Template/revision | `3b4b1c26-7cdf-4da8-9230-5308535a78b5` | `ae7ac749-8db6-4331-8bdc-fd06c1998129` |
| Revision | 1 | 2 |
| Template created | 26 Sep 14:44:58.217 | 29 Sep 23:09:13.027 |
| Effective date | 26 Sep | 1 Oct |
| Activated | 29 Sep 17:31:51.379 | 1 Oct 14:02:41.134 |
| Occurrence created | 29 Sep 17:32:11.106 | 1 Oct 14:02:41.235 |
| Current template state | Archived at 1 Oct 14:02:41.134 | Active |
| Shared response count | 3/11 | 1/12 |

v1 was precreated before the run day. v2 activation archived v1's definition, and a subsequent ensure created v2's occurrence approximately 101ms later. The exact HTTP caller of that ensure is not recoverable from these catalog timestamps alone. Both occurrence rows remain unsuperseded and addressable by assigned Crew, including after v1's template archive.

## Preserved evidence

All four completed response rows were submitted by Terrac Phang Yew Fong (`03baf260-87d9-4a30-bc93-56eb6d3bc024`), with true checklist values:

| Occurrence | Requirement | Response ID | Submitted 1 Oct MYT |
| --- | --- | --- | --- |
| v1 | Floor Swept & Mopped | `bf0c06f8-311b-431f-987f-41b68b50623d` | 21:57:39.993 |
| v1 | Roller Shutter Lowered & Locked | `8c445df6-a147-499c-ba99-d9bf7fd9e3e4` | 21:57:54.544 |
| v1 | Lights, Air Cooler, Fans & Sound System Turned Off | `e09a60d6-a20e-430b-8233-1a6068e6455c` | 21:57:56.512 |
| v2 | Floor Swept & Mopped | `f4e8af55-cddb-4bdc-b354-d2bc80d0afba` | 21:58:04.531 |

The 11 v1 frozen requirements match corresponding v2 requirements exactly across title, description, required flag, evidence requirement, block type/config and SOP reference. v2 adds the unanswered required item **Counter Closing & Cash Reconciliation**. Evidence therefore covers three distinct equivalent requirements, not four.

## Root cause and owning authority

Actual Production function definitions and constraints were inspected:

- `crew_operations_activate_template(uuid)` archives the prior series definition and activates the new revision, but does not reconcile or supersede precreated occurrences.
- `crew_operations_ensure_instances(uuid,date)` inserts each active revision's frozen occurrence using `ON CONFLICT(template_id,business_date) DO NOTHING`.
- `crew_operation_instances_template_id_business_date_key` is `UNIQUE(template_id,business_date)`. Different revision IDs evade deduplication for the same logical daily run.
- `crew_tasks_today(text,date)` and `crew_tasks_for_crew(text,date,date)` return assigned occurrences without a canonical-run/supersession predicate. Their shared `one_for_team` counts correctly reflect the separate response evidence.
- Detail and response mutation authorities likewise lack a superseded-run guard. Archiving a template does not stop its existing occurrence being answered.
- Lifecycle refresh handles schedule expiry, not revision replacement of runs.

The defect belongs to the server's revision/occurrence lifecycle, not viewer scoping, checklist counting or `one_for_team` completion semantics. Admin's single active definition is consistent with its definition lifecycle; Crew still sees two executions of that definition series.

## Minimal canonical fix — proposal only

For the current one-run-per-day schedule model, use stable logical run identity `(series_id, outlet_id, business_date)` across revisions. Serialize activation and occurrence creation for that identity and enforce one canonical actionable occurrence, while retaining superseded historical rows.

At revision activation, an unopened, evidence-free precreated run may be audibly superseded by the effective revision. Started/completed executions stay pinned to their frozen requirements; do not silently replace them. Apply the same canonical/superseded authority to Home/List, detail, writes and notifications. Filtering out every archived template is insufficient because legitimate historical executions must remain available. Keep execution status separate from supersession state.

## Reconciliation of this existing duplicate — proposal only

v2 was effective/activated before the run opened and before any recorded response, so v2 is the appropriate canonical execution for this date, including its additional requirement.

A controlled reconciliation should lock both occurrences and record an auditable v1-to-v2 supersession link, actor, reason, time and explicit equivalent-item evidence mapping. Preserve both frozen snapshots and all original response rows, actors and timestamps. Do not copy or rewrite responses, delete v1, or mark v2 completed merely to hide the duplicate.

The canonical read/completion authority can consume explicit references to the original responses for demonstrably equivalent requirements. Deduplicate the overlapping Floor response for completeness while keeping both answers audit-visible. This yields **3/12**, with nine requirements still outstanding. Non-equivalent requirements in other duplicates must remain unresolved; do not generalize title-only matching.

Implementation and Production reconciliation require a separately authorized task. No reconciliation was performed in this investigation.
