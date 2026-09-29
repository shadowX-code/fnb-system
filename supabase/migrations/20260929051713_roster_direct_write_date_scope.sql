-- Legacy direct table writers must not bypass the same date-specific Roster
-- eligibility enforced by the trusted week snapshot/copy commands.
create function public.roster_direct_write_eligible(p_employee_id uuid,p_outlet_id uuid,p_on date)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null
    and public.current_user_can_access_outlet(p_outlet_id)
    and public.roster_employment_on_date(p_employee_id,p_outlet_id,p_on)->>'state'='eligible';
$$;
revoke all on function public.roster_direct_write_eligible(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.roster_direct_write_eligible(uuid,uuid,date) to authenticated;

create policy duty_roster_dated_employment_insert on public.duty_rosters
  as restrictive for insert to authenticated
  with check (public.roster_direct_write_eligible(employee_id,outlet_id,roster_date));
create policy duty_roster_dated_employment_update on public.duty_rosters
  as restrictive for update to authenticated
  using (public.roster_direct_write_eligible(employee_id,outlet_id,roster_date))
  with check (public.roster_direct_write_eligible(employee_id,outlet_id,roster_date));
create policy duty_roster_dated_employment_delete on public.duty_rosters
  as restrictive for delete to authenticated
  using (public.roster_direct_write_eligible(employee_id,outlet_id,roster_date));
