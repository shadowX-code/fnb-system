-- Waste Disposal adopts the canonical MeSTI recurrence/version boundary. Its
-- daily session remains the evidence authority; schedules decide when a
-- Location is due, never when evidence is rewritten.
alter table public.factory_mesti_waste_disposal_requirements
  drop constraint if exists factory_mesti_waste_disposal_requirements_frequency_check;
alter table public.factory_mesti_waste_disposal_requirements
  add column if not exists recurrence_weekdays integer[] not null default '{}'::integer[];
alter table public.factory_mesti_waste_disposal_requirements
  add constraint factory_mesti_waste_disposal_requirements_frequency_check
  check (frequency in ('daily', 'weekly'));
alter table public.factory_mesti_waste_disposal_requirements
  add constraint factory_mesti_waste_disposal_requirements_weekday_check
  check ((frequency = 'daily' and cardinality(recurrence_weekdays) = 0) or (frequency = 'weekly' and cardinality(recurrence_weekdays) > 0 and recurrence_weekdays <@ array[1,2,3,4,5,6,7]));

create or replace function public.factory_save_mesti_waste_disposal_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_id uuid := nullif(p_requirement->>'id', '')::uuid;
  v_location uuid := nullif(p_requirement->>'location_id', '')::uuid;
  v_count integer := nullif(p_requirement->>'required_count', '')::integer;
  v_frequency text := lower(coalesce(nullif(p_requirement->>'frequency', ''), 'daily'));
  v_days integer[] := array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays','[]'::jsonb)) value order by 1);
  v_requested date := coalesce(nullif(p_requirement->>'effective_from','')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_effective date;
  v_status text := coalesce(nullif(p_requirement->>'status',''), 'active');
  v_current public.factory_mesti_waste_disposal_requirements%rowtype;
  v_saved public.factory_mesti_waste_disposal_requirements%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_waste_disposal.manage') then raise exception using errcode='42501', message='Missing waste disposal manage permission.'; end if;
  if v_location is null or v_count is null or v_count < 1 or v_status not in ('active','inactive') or v_frequency not in ('daily','weekly') or (v_frequency='weekly' and cardinality(v_days)=0) then raise exception using errcode='22023', message='Location, schedule, required count and status are required.'; end if;
  if not exists (select 1 from public.factory_storage_locations where id=v_location and status='active') then raise exception using errcode='22023', message='Selected Location is not active.'; end if;
  if v_id is null then
    insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id,location_id,frequency,recurrence_weekdays,required_count,effective_from,status,created_by)
    values(gen_random_uuid(),v_location,v_frequency,case when v_frequency='daily' then '{}'::integer[] else v_days end,v_count,greatest(v_requested,v_today),v_status,v_actor) returning * into v_saved;
    return to_jsonb(v_saved) || jsonb_build_object('version_created',true);
  end if;
  select * into v_current from public.factory_mesti_waste_disposal_requirements where id=v_id;
  if v_current.id is null then raise exception using errcode='22023', message='Waste disposal requirement not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_current.logical_requirement_id::text,0));
  select * into v_current from public.factory_mesti_waste_disposal_requirements where logical_requirement_id=v_current.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
  if v_current.location_id=v_location and v_current.frequency=v_frequency and v_current.recurrence_weekdays=(case when v_frequency='daily' then '{}'::integer[] else v_days end) and v_current.required_count=v_count and v_current.status=v_status and v_current.effective_from=v_requested then return to_jsonb(v_current)||jsonb_build_object('version_created',false); end if;
  if v_current.effective_from > v_today then
    update public.factory_mesti_waste_disposal_requirements set location_id=v_location,frequency=v_frequency,recurrence_weekdays=case when v_frequency='daily' then '{}'::integer[] else v_days end,required_count=v_count,status=v_status,effective_from=greatest(v_requested,v_today),updated_at=now() where id=v_current.id returning * into v_saved;
    return to_jsonb(v_saved)||jsonb_build_object('version_created',false);
  end if;
  v_effective := greatest(v_requested,v_today,v_current.effective_from+1);
  update public.factory_mesti_waste_disposal_requirements set effective_until=v_effective,updated_at=now() where id=v_current.id;
  insert into public.factory_mesti_waste_disposal_requirements(logical_requirement_id,location_id,frequency,recurrence_weekdays,required_count,effective_from,status,version_no,created_by)
  values(v_current.logical_requirement_id,v_location,v_frequency,case when v_frequency='daily' then '{}'::integer[] else v_days end,v_count,v_effective,v_status,v_current.version_no+1,v_actor) returning * into v_saved;
  update public.factory_mesti_waste_disposal_requirements set superseded_by=v_saved.id,updated_at=now() where id=v_current.id;
  return to_jsonb(v_saved)||jsonb_build_object('version_created',true);
end $$;

create or replace function public.factory_mesti_waste_disposal_daily(p_date date)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return jsonb_build_object('session',(select to_jsonb(s)||jsonb_build_object('submitted_by_name',coalesce(sb.nickname,sb.full_name),'verified_by_name',coalesce(vb.nickname,vb.full_name)) from public.factory_mesti_waste_disposal_sessions s left join public.employees sb on sb.id=s.submitted_by left join public.employees vb on vb.id=s.verified_by where s.disposal_date=p_date),'locations',coalesce((select jsonb_agg(row.value order by row.location_name) from (select l.location_name,jsonb_build_object('requirement_id',r.id,'location_id',l.id,'location_name',l.location_name,'required_count',r.required_count,'completed_count',count(e.id),'events',coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('completed_by_name',coalesce(c.nickname,c.full_name)) order by e.disposed_at) filter(where e.id is not null),'[]'::jsonb)) value from public.factory_mesti_waste_disposal_requirements r join public.factory_storage_locations l on l.id=r.location_id left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=p_date left join public.factory_mesti_waste_disposal_events e on e.session_id=s.id and e.location_id=l.id left join public.employees c on c.id=e.completed_by where r.status='active' and r.effective_from<=p_date and (r.effective_until is null or r.effective_until>p_date) and public.factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,p_date) group by r.id,l.id,l.location_name) row),'[]'::jsonb));
end $$;

-- Health declarations retain their original identity and actor evidence. A
-- deletion is an authorized void, never a physical erase.
alter table public.factory_mesti_health_declarations add column if not exists voided_at timestamptz;
alter table public.factory_mesti_health_declarations add column if not exists voided_by uuid references public.employees(id);
alter table public.factory_mesti_health_declarations add column if not exists void_reason text;

create or replace function public.factory_mesti_update_health_declaration(p_declaration_id uuid, p_declaration jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_row public.factory_mesti_health_declarations%rowtype; v_symptoms text[] := coalesce(array(select lower(btrim(value)) from jsonb_array_elements_text(coalesce(p_declaration->'symptoms','[]'::jsonb)) value where btrim(value)<>'' order by 1),'{}'::text[]);
begin
  if not public.current_user_has_permission('factory_mesti_health_declaration.manage') then raise exception using errcode='42501',message='Missing Health Declaration manage permission.'; end if;
  select * into v_row from public.factory_mesti_health_declarations where id=p_declaration_id for update;
  if v_row.id is null or v_row.voided_at is not null then raise exception using errcode='22023',message='Health Declaration is not editable.'; end if;
  if v_symptoms is not null and not (v_symptoms <@ array['diarrhea','vomiting','fever','jaundice','sore_throat','skin_infection_open_wound','eye_infection_discharge','ear_infection_discharge','nose_infection_discharge','ear_nose_eye_infection','other']) then raise exception using errcode='22023',message='One or more symptoms are invalid.'; end if;
  update public.factory_mesti_health_declarations set symptoms=v_symptoms,notes=nullif(left(btrim(p_declaration->>'notes'),2000),''),visitor_name=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'visitor_name'),200),'') else visitor_name end,visitor_company=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'company'),200),'') else visitor_company end,visitor_purpose=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'purpose'),300),'') else visitor_purpose end,visitor_host=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'host'),200),'') else visitor_host end,visitor_contact=case when v_row.declaration_type='visitor' then nullif(left(btrim(p_declaration->>'contact'),200),'') else visitor_contact end,entry_decision=case when v_row.declaration_type='visitor' then case when lower(p_declaration->>'entry_decision')='entry_restricted' then 'entry_restricted' else 'allowed' end else entry_decision end,health_status=case when v_row.declaration_type='employee' then case when cardinality(v_symptoms)=0 then 'fit_for_work' else 'health_issue_declared' end else case when cardinality(v_symptoms)=0 then 'cleared' else 'health_issue_declared' end end,updated_at=now() where id=v_row.id returning * into v_row;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('factory_mesti_health_declaration_updated','factory',auth.uid(),public.factory_current_active_employee_name(),'Factory MeSTI Health Declaration corrected.',jsonb_build_object('declaration_id',v_row.id,'actor_id',v_actor));
  return to_jsonb(v_row);
end $$;
create or replace function public.factory_mesti_void_health_declaration(p_declaration_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_current_active_employee_id(); v_row public.factory_mesti_health_declarations%rowtype;
begin
  if not public.current_user_has_permission('factory_mesti_health_declaration.manage') then raise exception using errcode='42501',message='Missing Health Declaration manage permission.'; end if;
  select * into v_row from public.factory_mesti_health_declarations where id=p_declaration_id for update;
  if v_row.id is null or v_row.voided_at is not null then raise exception using errcode='22023',message='Health Declaration is not available to delete.'; end if;
  update public.factory_mesti_health_declarations set voided_at=now(),voided_by=v_actor,void_reason=nullif(left(btrim(coalesce(p_reason,'')),2000),''),updated_at=now() where id=v_row.id returning * into v_row;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('factory_mesti_health_declaration_voided','factory',auth.uid(),public.factory_current_active_employee_name(),'Factory MeSTI Health Declaration voided.',jsonb_build_object('declaration_id',v_row.id,'actor_id',v_actor));
  return to_jsonb(v_row);
end $$;

create or replace function public.factory_mesti_health_declaration_records(p_date_from date default null, p_date_to date default null, p_type text default null, p_health_status text default null, p_symptom text default null, p_search text default null)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_health_declaration.view') or public.current_user_has_permission('factory_mesti_health_declaration.manage')) then raise exception using errcode='42501',message='Missing Health Declaration view permission.'; end if;
  return query select jsonb_build_object('id',d.id,'declaration_type',d.declaration_type,'declared_at',d.declared_at,'health_status',d.health_status,'symptoms',d.symptoms,'notes',d.notes,'employee_id',d.employee_id,'employee_snapshot',d.employee_snapshot,'visitor_name',d.visitor_name,'visitor_company',d.visitor_company,'visitor_purpose',d.visitor_purpose,'visitor_host',d.visitor_host,'visitor_contact',d.visitor_contact,'work_action',d.work_action,'action_notes',d.action_notes,'entry_decision',d.entry_decision,'recorded_by_name',coalesce(recorder.nickname,recorder.full_name),'reviewed_by_name',coalesce(reviewer.nickname,reviewer.full_name),'reviewed_at',d.reviewed_at,'created_at',d.created_at) from public.factory_mesti_health_declarations d left join public.employees recorder on recorder.id=d.created_by left join public.employees reviewer on reviewer.id=d.reviewed_by where d.voided_at is null and (p_date_from is null or d.declared_at::date>=p_date_from) and (p_date_to is null or d.declared_at::date<=p_date_to) and (p_type is null or d.declaration_type=p_type) and (p_health_status is null or d.health_status=p_health_status) and (p_symptom is null or p_symptom=any(d.symptoms)) and (p_search is null or lower(concat_ws(' ',d.employee_snapshot->>'employee_name',d.visitor_name,d.visitor_company)) like '%'||lower(p_search)||'%') order by d.declared_at desc,d.created_at desc;
end $$;

revoke all on function public.factory_save_mesti_waste_disposal_requirement(jsonb),public.factory_mesti_waste_disposal_daily(date),public.factory_mesti_update_health_declaration(uuid,jsonb),public.factory_mesti_void_health_declaration(uuid,text),public.factory_mesti_health_declaration_records(date,date,text,text,text,text) from public,anon;
grant execute on function public.factory_save_mesti_waste_disposal_requirement(jsonb),public.factory_mesti_waste_disposal_daily(date),public.factory_mesti_update_health_declaration(uuid,jsonb),public.factory_mesti_void_health_declaration(uuid,text),public.factory_mesti_health_declaration_records(date,date,text,text,text,text) to authenticated;
