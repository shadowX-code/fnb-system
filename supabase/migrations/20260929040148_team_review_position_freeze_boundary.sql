-- Roster overlap can establish eligibility without completed clock overlap.
alter table public.crew_team_review_eligible_pairs
  drop constraint crew_team_review_eligible_pairs_attendance_overlap_count_check;
alter table public.crew_team_review_eligible_pairs
  add constraint crew_team_review_eligible_pairs_attendance_overlap_count_check
  check (attendance_overlap_count >= 0);

-- Freeze closed months under the old Position policy before changing that policy.
-- Open months continue to read the current flag from job_positions.
create function public.crew_team_review_freeze_before_position_change()
returns trigger language plpgsql volatile security definer set search_path=public as $$
begin
  perform public.crew_team_review_freeze_due();
  return new;
end; $$;
revoke all on function public.crew_team_review_freeze_before_position_change()
  from public, anon, authenticated;

create trigger crew_team_review_position_policy_freeze
before update of participates_in_team_review on public.job_positions
for each row
when (old.participates_in_team_review is distinct from new.participates_in_team_review)
execute function public.crew_team_review_freeze_before_position_change();
