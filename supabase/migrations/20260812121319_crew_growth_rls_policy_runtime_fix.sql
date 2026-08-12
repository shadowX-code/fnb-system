-- Forward fix: RLS policies must not require callers to EXECUTE the internal
-- crew_growth_can_access_skill helper. Keep the helper private and inline the
-- permission/outlet predicate in each authenticated policy.

drop policy if exists crew_skill_positions_view on public.crew_skill_positions;
create policy crew_skill_positions_view on public.crew_skill_positions for select to authenticated using (
  public.current_user_has_permission('crew_growth.view') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);
drop policy if exists crew_skill_positions_manage on public.crew_skill_positions;
create policy crew_skill_positions_manage on public.crew_skill_positions for all to authenticated using (
  public.current_user_has_permission('crew_growth.manage') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
) with check (
  public.current_user_has_permission('crew_growth.manage') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);

drop policy if exists crew_skill_outlets_view on public.crew_skill_outlets;
create policy crew_skill_outlets_view on public.crew_skill_outlets for select to authenticated using (
  public.current_user_has_permission('crew_growth.view') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);
drop policy if exists crew_skill_outlets_manage on public.crew_skill_outlets;
create policy crew_skill_outlets_manage on public.crew_skill_outlets for all to authenticated using (
  public.current_user_has_permission('crew_growth.manage') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
) with check (
  public.current_user_has_permission('crew_growth.manage') and public.current_user_can_access_outlet(outlet_id)
  and exists (select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id))
);

drop policy if exists crew_skill_requirements_view on public.crew_skill_requirements;
create policy crew_skill_requirements_view on public.crew_skill_requirements for select to authenticated using (
  public.current_user_has_permission('crew_growth.view') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);
drop policy if exists crew_skill_requirements_manage on public.crew_skill_requirements;
create policy crew_skill_requirements_manage on public.crew_skill_requirements for all to authenticated using (
  public.current_user_has_permission('crew_growth.manage') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
) with check (
  public.current_user_has_permission('crew_growth.manage') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);

drop policy if exists crew_practical_assessments_view on public.crew_practical_assessments;
create policy crew_practical_assessments_view on public.crew_practical_assessments for select to authenticated using (
  public.current_user_has_permission('crew_growth.view') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);
drop policy if exists crew_skill_certifications_view on public.crew_skill_certifications;
create policy crew_skill_certifications_view on public.crew_skill_certifications for select to authenticated using (
  public.current_user_has_permission('crew_growth.view') and exists (
    select 1 from public.crew_skills s where s.id=skill_id and public.current_user_can_access_outlet(s.outlet_id)
  )
);

revoke all on function public.crew_growth_can_access_skill(uuid,text) from public,anon,authenticated;
