-- Extend the verified People timeline only when an Admin submits a complete
-- dated assignment. The cutover row and all earlier evidence stay immutable.
-- Roster and other consumers continue using the existing as-of resolver.

create or replace function public.employee_employment_assignment_read(p_employee_id uuid,p_on date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_row public.employee_employment_assignment_revisions%rowtype; v_start date; v_revisions jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('employees.view')
    or not exists (select 1 from public.employees e where e.id=p_employee_id
      and (public.current_user_has_all_outlet_access()
        or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
          and lower(coalesce(o.name,''))=lower(coalesce(e.workplace,''))
          or public.current_user_can_access_outlet(o.id)
          and lower(coalesce(o.code,''))=lower(coalesce(e.workplace,''))))) then
    raise exception using errcode='42501',message='Employee assignment is outside your scope.';
  end if;
  select min(r.effective_from) into v_start from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id);
  v_row:=public.employee_employment_assignment_at(p_employee_id,coalesce(p_on,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.effective_from desc,r.recorded_at desc),'[]'::jsonb)
    into v_revisions from public.employee_employment_assignment_revisions r where r.employee_id=p_employee_id;
  return jsonb_build_object('state',case when v_row.id is null then 'unresolved' else 'resolved' end,
    'as_of',coalesce(p_on,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date),
    'verified_from',v_start,'assignment',case when v_row.id is null then null else to_jsonb(v_row) end,
    'revisions',v_revisions);
end $$;
revoke all on function public.employee_employment_assignment_read(uuid,date) from public,anon,authenticated;
grant execute on function public.employee_employment_assignment_read(uuid,date) to authenticated;


create or replace function public.employee_employment_assignment_save(
  p_employee_id uuid,p_effective_from date,p_assignment jsonb,p_reason text,
  p_expected_revision_id uuid,p_evidence_reference text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_prior public.employee_employment_assignment_revisions%rowtype;
  v_same_date public.employee_employment_assignment_revisions%rowtype; v_next public.employee_employment_assignment_revisions%rowtype;
  v_new public.employee_employment_assignment_revisions%rowtype;
  v_actor uuid; v_type text; v_status text; v_position text; v_workplace text;
  v_entity uuid; v_end date; v_cutover date; v_verified_from date; v_historical_baseline boolean;
begin
  if auth.uid() is null or not public.current_user_has_permission('employees.edit') then
    raise exception using errcode='42501',message='Employment assignment permission denied.';
  end if;
  if p_effective_from is null or p_assignment is null or jsonb_typeof(p_assignment)<>'object'
    or not p_assignment ?& array['employment_type','employment_status','position','legal_entity_id','workplace']
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))<3
    or length(btrim(p_reason))>500 then
    raise exception using errcode='22023',message='Complete assignment, effective date and reason are required.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if v_employee.id is null then raise exception using errcode='P0002',message='Employee is unavailable.'; end if;
  if not (public.current_user_has_all_outlet_access()
    or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
      and lower(v_employee.workplace) in (lower(o.name),lower(coalesce(o.code,''))))) then
    raise exception using errcode='42501',message='Current Employee workplace is outside your scope.';
  end if;
  v_type:=nullif(btrim(p_assignment->>'employment_type'),'');
  v_status:=nullif(btrim(p_assignment->>'employment_status'),'');
  v_position:=nullif(btrim(p_assignment->>'position'),'');
  v_workplace:=nullif(btrim(p_assignment->>'workplace'),'');
  v_entity:=nullif(p_assignment->>'legal_entity_id','')::uuid;
  if v_type is null then raise exception using errcode='22023',message='Employment Type is required.'; end if;
  if v_status is null then raise exception using errcode='22023',message='Employment Status is required.'; end if;
  if v_position is null then raise exception using errcode='22023',message='Position is required.'; end if;
  if v_workplace is null then raise exception using errcode='22023',message='Workplace is required.'; end if;
  if v_type not in ('probation','full_time','part_time','intern','contract')
    or v_status not in ('active','resigned','terminated') then
    raise exception using errcode='22023',message='Employment assignment is invalid.';
  end if;
  if not (public.current_user_has_all_outlet_access()
    or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
      and lower(v_workplace) in (lower(o.name),lower(coalesce(o.code,''))))) then
    raise exception using errcode='42501',message='New workplace is outside your scope.';
  end if;
  if v_entity is not null and not exists
    (select 1 from public.legal_entities le where le.id=v_entity and le.is_active) then
    raise exception using errcode='22023',message='Choose an active legal employer.';
  end if;
  select min(effective_from) into v_cutover from public.employee_employment_assignment_revisions
    where employee_id=p_employee_id and source_kind in ('cutover_current','new_employee');
  if v_cutover is null then
    raise exception using errcode='22023',message='No verified employment baseline exists for this employee.';
  end if;
  select min(r.effective_from) into v_verified_from
    from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id);
  v_historical_baseline:=p_effective_from<v_verified_from;
  if v_historical_baseline and v_employee.joined_date is not null
    and p_effective_from<v_employee.joined_date then
    raise exception using errcode='22023',message='Effective date cannot precede this employee''s Joined Date.';
  end if;
  v_prior:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);
  if v_historical_baseline then
    select * into v_next from public.employee_employment_assignment_revisions r
      where r.employee_id=p_employee_id and r.effective_from>p_effective_from
        and not exists (select 1 from public.employee_employment_assignment_revisions newer
          where newer.supersedes_revision_id=r.id)
      order by r.effective_from,r.recorded_at desc,r.id desc limit 1;
  end if;
  if v_prior.id is distinct from p_expected_revision_id then
    raise exception using errcode='40001',message='Employment assignment changed. Review the latest timeline.';
  end if;
  if v_status='active' then v_end:=null;
  elsif v_prior.employment_status=v_status then v_end:=v_prior.employment_end_date;
  else v_end:=p_effective_from; end if;
  if (v_type,v_status,v_position,v_entity,v_workplace,v_end) is not distinct from
     (v_prior.employment_type,v_prior.employment_status,v_prior.position,
      v_prior.legal_entity_id,v_prior.workplace,v_prior.employment_end_date) then
    raise exception using errcode='22023',message='No Employment assignment change was made.';
  end if;
  select * into v_same_date from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id and r.effective_from=p_effective_from
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id)
    order by r.recorded_at desc limit 1;
  select e.id into v_actor from public.employees e where e.auth_user_id=auth.uid() limit 1;
  if v_actor is null then
    raise exception using errcode='42501',message='Employment change requires an Employee-linked Admin.';
  end if;
  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,
     workplace,employment_end_date,source_kind,reason,evidence_reference,
     corrects_revision_id,supersedes_revision_id,recorded_by_employee_id)
  values (p_employee_id,p_effective_from,v_type,v_status,v_position,v_entity,
    v_workplace,v_end,'admin_change',btrim(p_reason),nullif(btrim(p_evidence_reference),''),
    case when v_historical_baseline then v_next.id
      when p_effective_from<timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
        or v_same_date.id is not null then v_prior.id else null end,
    v_same_date.id,v_actor)
  returning * into v_new;
  if p_effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then
    perform public.employee_employment_apply_projection(p_employee_id);
  end if;
  if v_historical_baseline then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values ('employee_employment_historical_baseline_corrected','people',auth.uid(),
      'Admin established an earlier verified employment assignment.',
      jsonb_build_object('employee_id',p_employee_id,'actor_employee_id',v_actor,
        'revision_id',v_new.id,'corrects_revision_id',v_new.corrects_revision_id,
        'previous_verified_from',v_verified_from,'verified_from',p_effective_from,
        'reason',v_new.reason,'evidence_reference',v_new.evidence_reference));
  end if;
  return jsonb_build_object('revision',to_jsonb(v_new),
    'projection_state',case when p_effective_from>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      then 'scheduled' else 'current' end);
end $$;
revoke all on function public.employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)
  to authenticated;

