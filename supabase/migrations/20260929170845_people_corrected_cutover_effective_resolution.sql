-- An earlier explicit historical correction can correct a later cutover
-- observation. Keep that observation in the immutable timeline, but do not
-- let it become a second effective assignment on the cutover date. The
-- correction link remains durable if the correction is later superseded by
-- a same-date revision; ordinary later admin changes still take effect.
create or replace function public.employee_employment_assignment_at(p_employee_id uuid,p_on date)
returns public.employee_employment_assignment_revisions
language sql stable security definer set search_path=public as $$
  select r from public.employee_employment_assignment_revisions r
  where r.employee_id=p_employee_id and r.effective_from<=p_on
    and not exists (select 1 from public.employee_employment_assignment_revisions newer
      where newer.supersedes_revision_id=r.id)
    and not (r.source_kind='cutover_current' and exists (
      select 1 from public.employee_employment_assignment_revisions correction
      where correction.employee_id=r.employee_id
        and correction.source_kind='admin_change'
        and correction.corrects_revision_id=r.id
        and correction.effective_from<r.effective_from))
  order by r.effective_from desc,r.recorded_at desc,r.id desc limit 1;
$$;
revoke all on function public.employee_employment_assignment_at(uuid,date) from public,anon,authenticated;

-- Leave's entitlement scan must use the same effective revisions as People.
-- It must not split an entitlement at an audit-only cutover observation.
do $$
declare v_definition text; v_old text; v_new text;
begin
  v_definition:=pg_get_functiondef(
    'public.crew_leave_entitlement_preview(uuid,text,date,date)'::regprocedure);
  v_old:=$old$and not exists (select 1 from public.employee_employment_assignment_revisions newer
            where newer.supersedes_revision_id=r.id)$old$;
  v_new:=$new$and (public.employee_employment_assignment_at(p_employee_id,r.effective_from)).id=r.id$new$;
  if position(v_old in v_definition)=0 then
    raise exception 'Leave entitlement employment boundary changed; manual reconciliation required.';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
revoke all on function public.crew_leave_entitlement_preview(uuid,text,date,date)
  from public,anon,authenticated;
