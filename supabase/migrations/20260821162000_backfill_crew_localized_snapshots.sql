-- Localized Content Layer legacy snapshot backfill.
--
-- Versions and execution records that existed before 20260821123000 have no
-- localization snapshot. Without an explicit empty/frozen snapshot, the Crew
-- safe-read resolver can fall back to mutable live localized units. Freeze the
-- current version state exactly once for historical published/active records.
-- This preserves existing source content and never rewrites learning, Task or
-- execution evidence payloads beyond the additive localized_content key.

-- Freeze version-local content first so the existing assignment/instance
-- triggers copy a stable value instead of resolving live rows during backfill.
-- The three guards protect business-content rewrites. Temporarily disabling
-- only those guards inside this transactional migration permits the additive
-- snapshot column initialization; all content, lifecycle and child triggers
-- remain active. PostgreSQL rolls this DDL back if any statement fails.
alter table public.crew_sop_versions disable trigger crew_guard_published_sop_versions;
alter table public.crew_journeys disable trigger crew_guard_published_journeys;
alter table public.crew_operation_templates disable trigger crew_operation_template_immutable;

update public.crew_sop_versions v
set localized_content_snapshot = public.crew_localization_snapshot('sop', v.id)
where v.status = 'published'
  and v.localized_content_snapshot is null;

update public.crew_journeys j
set localized_content_snapshot = public.crew_localization_snapshot('onboarding', j.id)
where j.status = 'published'
  and j.localized_content_snapshot is null;

update public.crew_operation_templates t
set localized_content_snapshot = public.crew_localization_snapshot('task', t.id)
where t.status = 'active'
  and t.localized_content_snapshot is null;

alter table public.crew_sop_versions enable trigger crew_guard_published_sop_versions;
alter table public.crew_journeys enable trigger crew_guard_published_journeys;
alter table public.crew_operation_templates enable trigger crew_operation_template_immutable;

-- The existing BEFORE UPDATE triggers attach the corresponding immutable
-- version snapshot. Restrict this to historical rows that do not yet have the
-- key; explicit empty snapshots are already intentional and are left intact.
update public.crew_journey_assignments a
set journey_snapshot = a.journey_snapshot
where not (coalesce(a.journey_snapshot, '{}'::jsonb) ? 'localized_content');

update public.crew_operation_instances i
set template_snapshot = i.template_snapshot
where not (coalesce(i.template_snapshot, '{}'::jsonb) ? 'localized_content');
