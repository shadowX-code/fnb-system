-- FeedX Crew Availability + Shift Swap v1 was intentionally withdrawn before
-- Production. This forward-only migration removes only the feature-specific
-- authorities, schema, grants and planning metadata introduced by
-- 20260813061304. Existing immutable roster publications and published entries
-- are deliberately retained; their historical scheduling outcome is not
-- rewritten or deleted.

-- Disable public entry points before removing their underlying data.
revoke all on function public.crew_availability_save(text,jsonb) from public,anon,authenticated;
revoke all on function public.crew_availability_mobile(text) from public,anon,authenticated;
revoke all on function public.crew_shift_candidates(text,uuid) from public,anon,authenticated;
revoke all on function public.crew_shift_request_submit(text,jsonb) from public,anon,authenticated;
revoke all on function public.crew_shift_request_respond(text,uuid,text) from public,anon,authenticated;
revoke all on function public.crew_shift_request_cancel(text,uuid) from public,anon,authenticated;
revoke all on function public.crew_shift_requests_mobile(text) from public,anon,authenticated;
revoke all on function public.crew_shift_requests_admin(uuid,date,date) from public,anon,authenticated;
revoke all on function public.crew_shift_request_review(uuid,text,text) from public,anon,authenticated;
revoke all on function public.crew_roster_availability_check(uuid,uuid,date,time,time) from public,anon,authenticated;

drop function if exists public.crew_shift_request_review(uuid,text,text);
drop function if exists public.crew_shift_requests_admin(uuid,date,date);
drop function if exists public.crew_shift_requests_mobile(text);
drop function if exists public.crew_shift_request_cancel(text,uuid);
drop function if exists public.crew_shift_request_respond(text,uuid,text);
drop function if exists public.crew_shift_request_submit(text,jsonb);
drop function if exists public.crew_shift_candidates(text,uuid);
drop function if exists public.crew_availability_save(text,jsonb);
drop function if exists public.crew_availability_mobile(text);
drop function if exists public.crew_roster_availability_check(uuid,uuid,date,time,time);

drop trigger if exists crew_roster_capture_availability_conflict on public.duty_rosters;
drop trigger if exists crew_published_roster_capture_availability_conflict on public.duty_roster_published_entries;
drop function if exists public.crew_roster_capture_availability_conflict();
drop function if exists public.crew_shift_candidate_eligible(uuid,uuid);
drop function if exists public.crew_employee_availability(uuid,date,time,time);

-- Remove the dedicated QA draft rows without touching approved-leave
-- projections or immutable publication history.
delete from public.duty_rosters
where source = 'manual_roster'
  and remark in (
    'QA specific swap',
    'QA open cover',
    'QA rejected swap',
    'QA approved swap',
    'QA leave candidate conflict',
    'QA availability warning'
  );

-- Remove feature-only references before dropping the request tables. The
-- roster publications/entries themselves remain intact.
alter table public.duty_roster_published_entries drop column if exists shift_request_id;
alter table public.duty_roster_publications drop column if exists shift_request_id;
alter table public.duty_roster_publications drop column if exists source;
alter table public.duty_rosters drop column if exists availability_conflict;
alter table public.duty_rosters drop column if exists availability_override_reason;
alter table public.duty_roster_published_entries drop column if exists availability_conflict;
alter table public.duty_roster_published_entries drop column if exists availability_override_reason;

drop table if exists public.crew_shift_request_audit;
drop table if exists public.crew_shift_requests;
drop table if exists public.crew_availability_exceptions;
drop table if exists public.crew_availability_windows;

delete from public.role_permissions
where permission_id in (
  select id from public.permissions
  where code in (
    'crew_availability.view',
    'crew_availability.manage',
    'crew_shift_requests.view',
    'crew_shift_requests.review'
  )
);

delete from public.permissions
where code in (
  'crew_availability.view',
  'crew_availability.manage',
  'crew_shift_requests.view',
  'crew_shift_requests.review'
);
