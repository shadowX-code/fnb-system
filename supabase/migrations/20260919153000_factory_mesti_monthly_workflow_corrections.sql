-- Complete the shared MeSTI workflow without rewriting already-issued evidence.

create or replace function public.factory_mesti_waste_disposal_record(p_date date, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_session public.factory_mesti_waste_disposal_sessions%rowtype;
  v_location uuid := nullif(p_event->>'location_id','')::uuid;
  v_disposed timestamptz := coalesce(nullif(p_event->>'disposed_at','')::timestamptz, now());
  v_result jsonb;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.record') then raise exception using errcode='42501', message='Missing waste disposal record permission.'; end if;
  if v_location is null then raise exception using errcode='22023', message='Location is required.'; end if;
  if not exists (
    select 1 from public.factory_mesti_waste_disposal_requirements r
    where r.location_id=v_location and r.status='active' and r.effective_from<=p_date
      and (r.effective_until is null or r.effective_until>p_date)
      and public.factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,p_date)
  ) then raise exception using errcode='22023', message='No scheduled waste disposal requirement applies to this Location on this date.'; end if;
  insert into public.factory_mesti_waste_disposal_sessions(disposal_date,created_by)
  values(p_date,v_actor) on conflict(disposal_date) do update set updated_at=now() returning * into v_session;
  if v_session.status <> 'draft' then raise exception using errcode='55000', message='Submitted waste disposal sessions are immutable.'; end if;
  insert into public.factory_mesti_waste_disposal_events(session_id,location_id,location_snapshot,disposed_at,completed_by,remarks)
  select v_session.id,location.id,public.factory_mesti_waste_disposal_location_snapshot(location),v_disposed,v_actor,nullif(btrim(p_event->>'remarks'),'')
  from public.factory_storage_locations location where location.id=v_location
  returning to_jsonb(factory_mesti_waste_disposal_events.*) into v_result;
  return v_result;
end $$;

create or replace function public.factory_mesti_waste_disposal_monthly(p_month date)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return query
  with days as (
    select d::date run_date from generate_series(date_trunc('month',p_month),date_trunc('month',p_month)+interval '1 month - 1 day','1 day') d
  ), applicable as (
    select r.logical_requirement_id,r.location_id,l.location_name,r.frequency,r.recurrence_weekdays,d.run_date,r.required_count
    from days d
    join public.factory_mesti_waste_disposal_requirements r on r.status='active' and r.effective_from<=d.run_date
      and (r.effective_until is null or r.effective_until>d.run_date)
      and public.factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,d.run_date)
    join public.factory_storage_locations l on l.id=r.location_id
  ), counts as (
    select a.*,s.id session_id,s.status session_status,s.submitted_at,s.verified_at,
      coalesce(sb.nickname,sb.full_name) submitted_by_name,coalesce(vb.nickname,vb.full_name) verified_by_name,
      count(e.id)::integer completed_count,
      coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('completed_by_name',coalesce(c.nickname,c.full_name)) order by e.disposed_at) filter(where e.id is not null),'[]'::jsonb) events
    from applicable a
    left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=a.run_date
    left join public.factory_mesti_waste_disposal_events e on e.session_id=s.id and e.location_id=a.location_id
    left join public.employees c on c.id=e.completed_by
    left join public.employees sb on sb.id=s.submitted_by
    left join public.employees vb on vb.id=s.verified_by
    group by a.logical_requirement_id,a.location_id,a.location_name,a.frequency,a.recurrence_weekdays,a.run_date,a.required_count,s.id,s.status,s.submitted_at,s.verified_at,sb.nickname,sb.full_name,vb.nickname,vb.full_name
  )
  select jsonb_build_object(
    'logical_requirement_id',logical_requirement_id,'location_id',location_id,'location_name',location_name,
    'frequency',(array_agg(frequency order by run_date desc))[1],
    'recurrence_weekdays',(array_agg(recurrence_weekdays order by run_date desc))[1],
    'days',jsonb_object_agg(run_date::text,jsonb_build_object(
      'disposal_date',run_date,'required_count',required_count,'completed_count',completed_count,'events',events,
      'session_id',session_id,'session_status',session_status,'submitted_by_name',submitted_by_name,'submitted_at',submitted_at,
      'verified_by_name',verified_by_name,'verified_at',verified_at
    ) order by run_date)
  )
  from counts group by logical_requirement_id,location_id,location_name order by location_name;
end $$;

create or replace function public.factory_mesti_update_health_declaration(p_declaration_id uuid, p_declaration jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_row public.factory_mesti_health_declarations%rowtype;
  v_employee public.employees%rowtype;
  v_symptoms text[] := coalesce(array(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p_declaration->'symptoms','[]'::jsonb)) value where btrim(value)<>'' order by 1),'{}'::text[]);
  v_allowed text[] := array['diarrhea','vomiting','fever','jaundice','sore_throat','skin_infection_open_wound','eye_infection_discharge','ear_infection_discharge','nose_infection_discharge','other','ear_nose_eye_infection'];
  v_other_detail text := nullif(left(btrim(p_declaration->>'other_symptom_detail'),2000),'');
begin
  if not public.current_user_has_permission('factory_mesti_health_declaration.manage') then raise exception using errcode='42501',message='Missing Health Declaration manage permission.'; end if;
  select * into v_row from public.factory_mesti_health_declarations where id=p_declaration_id for update;
  if v_row.id is null or v_row.voided_at is not null then raise exception using errcode='P0002',message='Health Declaration was not found.'; end if;
  if not (v_symptoms <@ v_allowed) then raise exception using errcode='22023',message='One or more symptoms are invalid.'; end if;
  if 'other'=any(v_symptoms) and v_other_detail is null then raise exception using errcode='22023',message='Other symptom detail is required.'; end if;
  if v_row.declaration_type='employee' then
    select e.* into v_employee from public.employees e join public.factory_eligible_employees() eligible on eligible.id=e.id where e.id=nullif(p_declaration->>'employee_id','')::uuid;
    if v_employee.id is null then raise exception using errcode='22023',message='Select an eligible Factory Employee.'; end if;
  end if;
  update public.factory_mesti_health_declarations set
    symptoms=v_symptoms,other_symptom_detail=case when 'other'=any(v_symptoms) then v_other_detail else null end,
    notes=nullif(left(btrim(p_declaration->>'notes'),2000),''),
    employee_id=case when v_row.declaration_type='employee' then v_employee.id else employee_id end,
    employee_snapshot=case when v_row.declaration_type='employee' then public.factory_mesti_health_declaration_employee_snapshot(v_employee) else employee_snapshot end,
    visitor_name=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'visitor_name'),200),'') else visitor_name end,
    visitor_company=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'company'),200),'') else visitor_company end,
    visitor_purpose=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'purpose'),300),'') else visitor_purpose end,
    visitor_host=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'host'),200),'') else visitor_host end,
    visitor_contact=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'contact'),200),'') else visitor_contact end,
    entry_decision=case when v_row.declaration_type='visitor' then case when lower(p_declaration->>'entry_decision')='entry_restricted' then 'entry_restricted' else 'allowed' end else entry_decision end,
    health_status=case when v_row.declaration_type='employee' then case when cardinality(v_symptoms)=0 then 'fit_for_work' else 'health_issue_declared' end else case when cardinality(v_symptoms)=0 then 'cleared' else 'health_issue_declared' end end,
    updated_at=now()
  where id=v_row.id returning * into v_row;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
  values('factory_mesti_health_declaration_updated','factory',auth.uid(),public.factory_current_active_employee_name(),'Factory MeSTI Health Declaration corrected.',jsonb_build_object('declaration_id',v_row.id,'actor_id',v_actor));
  return to_jsonb(v_row);
end $$;

create or replace function public.factory_mesti_health_declaration_records(p_date_from date default null, p_date_to date default null, p_type text default null, p_health_status text default null, p_symptom text default null, p_search text default null)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then raise exception using errcode='42501',message='Missing Health Declaration view permission.'; end if;
  return query select jsonb_build_object('id',d.id,'declaration_type',d.declaration_type,'declared_at',d.declared_at,'health_status',d.health_status,'symptoms',d.symptoms,'other_symptom_detail',d.other_symptom_detail,'notes',d.notes,'employee_id',d.employee_id,'employee_snapshot',d.employee_snapshot,'visitor_name',d.visitor_name,'visitor_company',d.visitor_company,'visitor_purpose',d.visitor_purpose,'visitor_host',d.visitor_host,'visitor_contact',d.visitor_contact,'work_action',d.work_action,'action_notes',d.action_notes,'entry_decision',d.entry_decision,'recorded_by_name',coalesce(recorder.nickname,recorder.full_name),'reviewed_by_name',coalesce(reviewer.nickname,reviewer.full_name),'reviewed_at',d.reviewed_at,'created_at',d.created_at)
  from public.factory_mesti_health_declarations d
  left join public.employees recorder on recorder.id=d.created_by left join public.employees reviewer on reviewer.id=d.reviewed_by
  where d.voided_at is null and (p_date_from is null or d.declared_at::date>=p_date_from) and (p_date_to is null or d.declared_at::date<=p_date_to) and (p_type is null or d.declaration_type=p_type) and (p_health_status is null or d.health_status=p_health_status) and (p_symptom is null or p_symptom=any(d.symptoms)) and (p_search is null or lower(concat_ws(' ',d.employee_snapshot->>'employee_name',d.visitor_name,d.visitor_company)) like '%'||lower(p_search)||'%')
  order by d.declared_at desc,d.created_at desc;
end $$;

revoke all on function public.factory_mesti_waste_disposal_record(date,jsonb),public.factory_mesti_waste_disposal_monthly(date),public.factory_mesti_update_health_declaration(uuid,jsonb),public.factory_mesti_health_declaration_records(date,date,text,text,text,text) from public,anon;
grant execute on function public.factory_mesti_waste_disposal_record(date,jsonb),public.factory_mesti_waste_disposal_monthly(date),public.factory_mesti_update_health_declaration(uuid,jsonb),public.factory_mesti_health_declaration_records(date,date,text,text,text,text) to authenticated;
