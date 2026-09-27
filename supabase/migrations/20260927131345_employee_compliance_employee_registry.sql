-- Employee-centric presentation only. Requirement evidence/expiry/review remain
-- owned by employee_compliance_current and the existing mutation authorities.
create or replace function public.employee_compliance_admin_employee_page(
  p_outlet_id uuid, p_filters jsonb default '{}'::jsonb,
  p_page integer default 1, p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_query text:=btrim(coalesce(p_filters->>'query',''));
  v_requirement text:=coalesce(p_filters->>'requirement','all');
  v_status text:=coalesce(p_filters->>'status','all');
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_today date:=(statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_result jsonb;
begin
  if not public.current_user_has_permission('employee_compliance.view') then
    raise exception using errcode='42501',message='Missing permission to view compliance.';
  end if;
  if p_outlet_id is not null and not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Outlet is outside your scope.';
  end if;
  with employee_rows as materialized (
    select e.id employee_id,e.full_name,e.employee_code,e.position,
      public.crew_resolve_employee_outlet(e.id) outlet_id,o.name outlet_name,
      requirements.items requirements,requirements.overall_status
    from public.employees e
    left join public.outlets o on o.id=public.crew_resolve_employee_outlet(e.id)
    cross join lateral (
      select jsonb_agg(jsonb_build_object(
        'requirement_id',r.id,'requirement_code',r.code,'requirement_name',r.name,
        'requires_expiry',r.requires_expiry,'state',r.state
      ) order by r.sort_order) items,
      (array_agg(r.state->>'status' order by case r.state->>'status'
        when 'expired' then 0 when 'missing' then 1 when 'rejected' then 2
        when 'pending_verification' then 3 when 'expiring_soon' then 4
        when 'verified' then 5 else 6 end,r.sort_order))[1] overall_status
      from (
        select r.*,public.employee_compliance_current(e.id,r.id,v_today) state
        from public.employee_compliance_requirements r where r.is_active
      ) r
    ) requirements
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active'
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id)
      and public.employee_compliance_admin_can_access_employee(e.id)
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%')
      and requirements.items is not null
  ), filtered as materialized (
    select * from employee_rows e where exists (
      select 1 from jsonb_array_elements(e.requirements) requirement
      where (v_requirement='all' or requirement->>'requirement_code'=v_requirement)
        and (v_status='all' or requirement->'state'->>'status'=v_status)
    )
  ), page_rows as (
    select * from filtered order by full_name,employee_id
    offset (v_page-1)*v_size limit v_size
  )
  select jsonb_build_object(
    'rows',(select coalesce(jsonb_agg(to_jsonb(p) order by full_name,employee_id),'[]'::jsonb) from page_rows p),
    'total_count',count(*),'page',v_page,'page_size',v_size,
    'summary',jsonb_build_object(
      'unit','employees','scope','filtered_employees',
      'compliant',count(*) filter(where overall_status='verified'),
      'needs_verification',count(*) filter(where overall_status='pending_verification'),
      'expiring_soon',count(*) filter(where overall_status='expiring_soon'),
      'missing_or_expired',count(*) filter(where overall_status in ('missing','expired','rejected'))
    )
  ) into v_result from filtered;
  return v_result;
end; $$;
revoke all on function public.employee_compliance_admin_employee_page(uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.employee_compliance_admin_employee_page(uuid,jsonb,integer,integer) to authenticated;
comment on function public.employee_compliance_admin_employee_page(uuid,jsonb,integer,integer) is
  'Employee-level compliance pagination and exclusive worst-actionable-state summary; canonical requirement state and People outlet scope are unchanged.';
