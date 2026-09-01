-- Before the working-state lifecycle existed, saving a published week changed
-- roster_periods.status to draft even though its immutable Crew publication
-- remained active. Reclassify only those legacy rows; publication history and
-- Crew-facing entries remain append-only and untouched.
update public.roster_periods p
set status = 'published',
    has_unpublished_changes = true,
    updated_at = now()
where p.status = 'draft'
  and p.published_at is not null
  and exists (
    select 1
    from public.duty_roster_publications publication
    where publication.outlet_id = p.outlet_id
      and publication.week_start_date = p.week_start_date
  );
