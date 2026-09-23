-- Management Crew uses the existing role outlet set as read context. It does
-- not acquire an outlet workplace, roster assignment, or domain capability.
create or replace function public.crew_authorized_outlet_ids(p_employee_id uuid)
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_role public.roles%rowtype; v_fixed uuid;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null or not coalesce(v_employee.is_active,true)
    or coalesce(v_employee.employment_status,'active') in ('resigned','terminated') then return '{}'::uuid[]; end if;
  if lower(btrim(coalesce(v_employee.workplace,''))) <> 'management' then
    v_fixed:=public.crew_resolve_employee_outlet(p_employee_id);
    return case when v_fixed is null then '{}'::uuid[] else array[v_fixed] end;
  end if;
  select * into v_role from public.roles where id=v_employee.role_id and is_active;
  if v_role.id is null or v_role.outlet_access_type='none' then return '{}'::uuid[]; end if;
  if v_role.outlet_access_type='all' then
    return array(select o.id from public.outlets o where o.is_active order by o.name,o.id);
  end if;
  return array(select o.id from public.role_outlets ro join public.outlets o on o.id=ro.outlet_id
    where ro.role_id=v_role.id and o.is_active order by o.name,o.id);
end; $$;
revoke all on function public.crew_authorized_outlet_ids(uuid) from public,anon,authenticated;

create or replace function public.crew_session_employee(p_token text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid;
begin
  update public.crew_sessions s set last_seen_at=now()
  from public.crew_access ca join public.employees e on e.id=ca.employee_id
  where s.employee_id=ca.employee_id
    and s.token_hash=encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
    and s.revoked_at is null and s.expires_at>now()
    and ca.access_state='active' and (ca.locked_until is null or ca.locked_until<=now())
    and coalesce(e.is_active,true) and coalesce(e.employment_status,'active') not in ('resigned','terminated')
    and (
      (lower(btrim(coalesce(e.workplace,'')))='management' and ca.primary_outlet_id is null
        and cardinality(public.crew_authorized_outlet_ids(e.id))>0)
      or (lower(btrim(coalesce(e.workplace,'')))<>'management' and ca.primary_outlet_id is not null
        and ca.primary_outlet_id=public.crew_resolve_employee_outlet(e.id))
    )
  returning s.employee_id into v_employee_id;
  if v_employee_id is null then
    raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.';
  end if;
  return v_employee_id;
end; $$;

create or replace function public.crew_outlet_scope(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_employee public.employees%rowtype;
  v_ids uuid[]; v_outlets jsonb; v_default uuid; v_management boolean;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
  v_ids:=public.crew_authorized_outlet_ids(v_employee_id);
  if cardinality(v_ids)=0 then raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $$;
revoke all on function public.crew_outlet_scope(text) from public,anon,authenticated;
grant execute on function public.crew_outlet_scope(text) to anon,authenticated;

create or replace function public.crew_selected_outlet(p_token text,p_outlet_id uuid)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
begin
  if p_outlet_id is null or not(p_outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id))) then
    raise exception using errcode='42501',message='Outlet is unavailable for this Crew session.';
  end if;
  return p_outlet_id;
end; $$;
revoke all on function public.crew_selected_outlet(text,uuid) from public,anon,authenticated;

create or replace function public.crew_authenticate(p_mobile text,p_passcode text,p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_mobile text; v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
  v_access_found boolean:=false; v_failures integer:=0; v_token text; v_last_success timestamptz;
  v_outlet_id uuid; v_ids uuid[]; v_management boolean;
begin
  v_mobile:=public.crew_normalize_mobile(p_mobile);
  select * into v_access from public.crew_access where mobile_number=v_mobile for update;
  v_access_found:=found;
  if v_access_found then
    select * into v_employee from public.employees where id=v_access.employee_id;
    v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
    v_outlet_id:=public.crew_resolve_employee_outlet(v_access.employee_id);
    v_ids:=public.crew_authorized_outlet_ids(v_access.employee_id);
    if v_access.access_state='locked' and v_access.locked_until is not null and v_access.locked_until<=now()
      and coalesce(v_employee.is_active,true)
      and coalesce(v_employee.employment_status,'active') not in ('resigned','terminated')
      and cardinality(v_ids)>0
      and ((v_management and v_access.primary_outlet_id is null)
        or (not v_management and v_access.primary_outlet_id=v_outlet_id)) then
      update public.crew_access set access_state='active',locked_until=null,updated_at=now()
      where employee_id=v_access.employee_id;
      select * into v_access from public.crew_access where employee_id=v_access.employee_id for update;
      v_access_found:=found;
    end if;
    if v_access.access_state='locked' and v_access.locked_until is not null and v_access.locked_until>now() then
      insert into public.crew_login_attempts(mobile_number,succeeded,ip_hash) values(v_mobile,false,p_ip_hash);
      raise exception using errcode='42501',message='Mobile number or passcode is incorrect.';
    end if;
  end if;
  select max(attempted_at) into v_last_success from public.crew_login_attempts where mobile_number=v_mobile and succeeded;
  select count(*) into v_failures from public.crew_login_attempts
  where mobile_number=v_mobile and not succeeded and attempted_at>now()-interval '15 minutes'
    and (v_last_success is null or attempted_at>v_last_success);
  if v_failures>=5 then
    if v_access_found and v_access.access_state='active' then
      update public.crew_access set access_state='locked',locked_until=now()+interval '15 minutes',updated_at=now()
      where employee_id=v_access.employee_id;
    end if;
    raise exception using errcode='42501',message='Mobile number or passcode is incorrect.';
  end if;
  if not v_access_found or v_access.access_state<>'active'
    or (v_access.locked_until is not null and v_access.locked_until>now())
    or extensions.crypt(coalesce(p_passcode,''),v_access.passcode_hash)<>v_access.passcode_hash then
    insert into public.crew_login_attempts(mobile_number,succeeded,ip_hash) values(v_mobile,false,p_ip_hash);
    if v_access_found and v_access.access_state='active' and v_failures+1>=5 then
      update public.crew_access set access_state='locked',locked_until=now()+interval '15 minutes',updated_at=now()
      where employee_id=v_access.employee_id;
    end if;
    raise exception using errcode='42501',message='Mobile number or passcode is incorrect.';
  end if;
  if not coalesce(v_employee.is_active,true)
    or coalesce(v_employee.employment_status,'active') in ('resigned','terminated')
    or cardinality(v_ids)=0
    or (v_management and v_access.primary_outlet_id is not null)
    or (not v_management and (v_outlet_id is null or v_access.primary_outlet_id is distinct from v_outlet_id)) then
    insert into public.crew_login_attempts(mobile_number,succeeded,ip_hash) values(v_mobile,false,p_ip_hash);
    raise exception using errcode='42501',message='Mobile number or passcode is incorrect.';
  end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  values(v_access.employee_id,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '14 days');
  insert into public.crew_login_attempts(mobile_number,succeeded,ip_hash) values(v_mobile,true,p_ip_hash);
  update public.crew_access set access_state='active',locked_until=null,last_login_at=now(),updated_at=now()
  where employee_id=v_access.employee_id;
  if v_management then select o.id into v_outlet_id from public.outlets o where o.id=any(v_ids) order by o.name,o.id limit 1; end if;
  return jsonb_build_object('token',v_token,'expires_at',now()+interval '14 days',
    'employee',jsonb_build_object('id',v_employee.id,'full_name',v_employee.full_name,
      'nickname',v_employee.nickname,'position',v_employee.position,'workplace',v_employee.workplace,
      'contact',v_employee.contact,'employee_code',v_employee.employee_code),
    'access',jsonb_build_object('state','active','outlet_id',v_outlet_id,'management',v_management));
end; $$;

-- Preserve the established fixed-workplace administration byte-for-byte.
alter function public.manage_crew_access(uuid,text,text) rename to crew_manage_fixed_access;
revoke all on function public.crew_manage_fixed_access(uuid,text,text) from public,anon,authenticated;

create function public.manage_crew_access(p_employee_id uuid,p_action text,p_passcode text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
  v_ids uuid[]; v_mobile text; v_passcode text; v_revoked integer:=0;
  v_action text:=lower(btrim(p_action)); v_existing text;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null then raise exception using errcode='P0002',message='Employee was not found.'; end if;
  if lower(btrim(coalesce(v_employee.workplace,'')))<>'management' then
    return public.crew_manage_fixed_access(p_employee_id,p_action,p_passcode);
  end if;
  if not public.current_user_has_permission('crew_employees.manage') then
    raise exception using errcode='42501',message='Missing permission to manage Crew Access.';
  end if;
  v_ids:=public.crew_authorized_outlet_ids(p_employee_id);
  if cardinality(v_ids)=0 or exists(
    select 1 from unnest(v_ids) outlet_id where not public.current_user_can_access_outlet(outlet_id)
  ) then raise exception using errcode='42501',message='You cannot manage Crew Access for this employee.'; end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if v_action='disable' then
    update public.crew_access set access_state='disabled',disabled_at=now(),locked_until=null,updated_at=now()
    where employee_id=p_employee_id;
    update public.crew_sessions set revoked_at=now() where employee_id=p_employee_id and revoked_at is null;
    get diagnostics v_revoked=row_count;
    insert into public.audit_logs(action,module,description,metadata)
    values('crew_access_disabled','crew','Management Crew Access disabled and active sessions revoked.',
      jsonb_build_object('employee_id',p_employee_id,'actor_id',auth.uid(),'authorized_outlet_ids',v_ids,'revoked_session_count',v_revoked));
    return jsonb_build_object('employee_id',p_employee_id,'access_state','disabled','revoked_session_count',v_revoked);
  end if;
  if v_action not in ('enable','reset_passcode') then raise exception using errcode='22023',message='Unsupported Crew Access action.'; end if;
  if not coalesce(v_employee.is_active,true) or coalesce(v_employee.employment_status,'active') in ('resigned','terminated') then
    raise exception using errcode='22023',message='Crew Access can be activated only for an active employee.';
  end if;
  select access_state into v_existing from public.crew_access where employee_id=p_employee_id for update;
  if v_action='reset_passcode' and v_existing is distinct from 'active' then
    raise exception using errcode='22023',message='Activate Crew Access before resetting its passcode.';
  end if;
  v_mobile:=public.crew_normalize_mobile(v_employee.contact);
  v_passcode:=coalesce(nullif(btrim(p_passcode),''),lpad((1000+floor(random()*9000))::text,4,'0'));
  if not public.crew_valid_passcode(v_passcode) then
    raise exception using errcode='22023',message='Passcode must be four digits and cannot be a common sequence or repeated number.';
  end if;
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,access_state,activated_at,disabled_at,locked_until,primary_outlet_id)
  values(p_employee_id,v_mobile,extensions.crypt(v_passcode,extensions.gen_salt('bf')),'active',now(),null,null,null)
  on conflict(employee_id) do update set mobile_number=excluded.mobile_number,passcode_hash=excluded.passcode_hash,
    access_state='active',activated_at=now(),disabled_at=null,locked_until=null,primary_outlet_id=null,updated_at=now();
  update public.crew_sessions set revoked_at=now() where employee_id=p_employee_id and revoked_at is null;
  get diagnostics v_revoked=row_count;
  insert into public.audit_logs(action,module,description,metadata)
  values(case when v_action='enable' then 'crew_access_enabled' else 'crew_access_passcode_reset' end,
    'crew','Management Crew Access credentials changed.',jsonb_build_object('employee_id',p_employee_id,
      'actor_id',auth.uid(),'authorized_outlet_ids',v_ids,'revoked_session_count',v_revoked));
  return jsonb_build_object('employee_id',p_employee_id,'access_state','active','mobile_number',v_mobile,
    'temporary_passcode',v_passcode,'activated_at',now());
end; $$;
revoke all on function public.manage_crew_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.manage_crew_access(uuid,text,text) to authenticated;

create or replace function public.crew_access_admin_page(
  p_outlet_id uuid,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_query text:=btrim(coalesce(p_filters->>'query',''));
  v_employment_status text:=nullif(btrim(coalesce(p_filters->>'employment_status','')),'');
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_total integer; v_rows jsonb; v_summary jsonb;
begin
  if p_outlet_id is null or not(public.current_user_has_permission('crew_employees.view')
    or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501',message='Missing permission to view Crew Access.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='You cannot view Crew Access outside your outlet scope.';
  end if;
  with source as (
    select e.*,ca.employee_id as access_employee_id,ca.mobile_number as crew_mobile_number,
      ca.access_state as crew_access_state,ca.activated_at as crew_activated_at,
      ca.disabled_at as crew_disabled_at,ca.locked_until as crew_locked_until,
      ca.last_login_at as crew_last_login_at,ca.primary_outlet_id as crew_primary_outlet_id,
      ca.can_initiate_handover as crew_can_initiate_handover,ca.can_add_assets as crew_can_add_assets,
      ca.can_manage_asset_details as crew_can_manage_asset_details,
      ca.can_adjust_assets as crew_can_adjust_assets,
      ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ',full_name,employee_code,position,workplace) ilike '%'||v_query||'%')
      and (v_employment_status is null or v_employment_status='all' or coalesce(employment_status,'active')=v_employment_status)
  ) select count(*) into v_total from filtered;

  with source as (
    select e.*,ca.employee_id as access_employee_id,ca.mobile_number as crew_mobile_number,
      ca.access_state as crew_access_state,ca.activated_at as crew_activated_at,
      ca.disabled_at as crew_disabled_at,ca.locked_until as crew_locked_until,
      ca.last_login_at as crew_last_login_at,ca.primary_outlet_id as crew_primary_outlet_id,
      ca.can_initiate_handover as crew_can_initiate_handover,ca.can_add_assets as crew_can_add_assets,
      ca.can_manage_asset_details as crew_can_manage_asset_details,
      ca.can_adjust_assets as crew_can_adjust_assets,
      ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ',full_name,employee_code,position,workplace) ilike '%'||v_query||'%')
      and (v_employment_status is null or v_employment_status='all' or coalesce(employment_status,'active')=v_employment_status)
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'full_name',full_name,'employee_code',employee_code,'position',position,
      'workplace',workplace,'contact',contact,'employment_type',employment_type,
      'employment_status',employment_status,'is_active',is_active,
      'crew_access',case when access_employee_id is null then null else jsonb_build_object(
        'employee_id',access_employee_id,'mobile_number',crew_mobile_number,
        'access_state',crew_access_state,'activated_at',crew_activated_at,'disabled_at',crew_disabled_at,
        'locked_until',crew_locked_until,'last_login_at',crew_last_login_at,
        'primary_outlet_id',crew_primary_outlet_id,'can_initiate_handover',crew_can_initiate_handover,
        'can_add_assets',crew_can_add_assets,'can_manage_asset_details',crew_can_manage_asset_details,
        'can_adjust_assets',crew_can_adjust_assets,
        'can_perform_asset_inspections',crew_can_perform_asset_inspections) end)
      order by full_name,id),'[]'::jsonb) into v_rows
    from (select * from filtered order by full_name,id offset (v_page-1)*v_size limit v_size) page_rows;

  with source as (
    select coalesce(ca.access_state,'not_enabled') as crew_access_state
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      or (lower(btrim(coalesce(e.workplace,'')))='management'
        and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id)))
  ) select jsonb_build_object(
    'active',count(*) filter(where crew_access_state='active'),
    'locked',count(*) filter(where crew_access_state='locked'),
    'not_enabled',count(*) filter(where crew_access_state='not_enabled')) into v_summary from source;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,
    'page_size',v_size,'summary',coalesce(v_summary,'{}'::jsonb));
end; $$;

create function public.crew_management_tasks(p_token text,p_outlet_id uuid,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_tasks jsonb;
begin
  if not exists(select 1 from public.employees where id=v_employee_id and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management task view is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  if p_business_date is null then raise exception using errcode='22023',message='Business date is required.'; end if;
  select coalesce(jsonb_agg(task order by task->>'due_at',task->>'name'),'[]'::jsonb) into v_tasks from (
    select jsonb_build_object('id',i.id,'source','instance','name',i.name,'task_type',i.task_type,
      'business_date',i.business_date,'due_at',i.available_until,'status',i.status,
      'block_count',(select count(*) from public.crew_operation_instance_items item where item.instance_id=i.id),
      'completed_count',(select count(*) from public.crew_operation_instance_items item where item.instance_id=i.id and item.status in ('completed','good')),
      'read_only',true) task
    from public.crew_operation_instances i where i.outlet_id=p_outlet_id and i.business_date=p_business_date
    union all
    select jsonb_build_object('id',t.id,'source','legacy_daily','name',t.title,'description',t.description,
      'business_date',t.task_date,'due_at',t.due_at,'status',t.status,'read_only',true) task
    from public.crew_daily_tasks t where t.outlet_id=p_outlet_id and t.task_date=p_business_date
  ) visible;
  return jsonb_build_object('outlet',jsonb_build_object('id',p_outlet_id,
    'name',(select name from public.outlets where id=p_outlet_id)),
    'business_date',p_business_date,'read_only',true,'tasks',v_tasks);
end; $$;
revoke all on function public.crew_management_tasks(text,uuid,date) from public,anon,authenticated;
grant execute on function public.crew_management_tasks(text,uuid,date) to anon,authenticated;

-- Existing mutation authorities must never infer eligibility from a null
-- primary outlet, even when historical Special Access flags are present.
create or replace function public.crew_operations_employee_context(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid; v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
begin
 v_employee_id:=public.crew_session_employee(p_token);
 select e.* into v_employee from public.employees e
 where e.id=v_employee_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 select ca.* into v_access from public.crew_access ca
 where ca.employee_id=v_employee.id and ca.access_state='active';
 if v_employee.id is null or v_access.employee_id is null or v_access.primary_outlet_id is null
    or lower(btrim(coalesce(v_employee.workplace,'')))='management' then
   raise exception using errcode='42501',message='Crew Operations access is unavailable.';
 end if;
 return jsonb_build_object('employee_id',v_employee.id,'employee_name',v_employee.full_name,'position',v_employee.position,'role_id',v_employee.role_id,'outlet_id',v_access.primary_outlet_id);
end; $$;

create or replace function public.crew_asset_context(p_token text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_access public.crew_access%rowtype; v_employee public.employees%rowtype;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  select * into v_access from public.crew_access where employee_id=v_employee_id and access_state='active' for share;
  if v_access.employee_id is null or v_access.primary_outlet_id is null
    or lower(btrim(coalesce(v_employee.workplace,'')))='management'
    or v_access.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(v_employee_id)
    or not(v_access.can_add_assets or v_access.can_adjust_assets or v_access.can_perform_asset_inspections or v_access.can_manage_asset_details) then
    raise exception using errcode='42501',message='Crew Asset access is unavailable.';
  end if;
  return jsonb_build_object('employee_id',v_employee_id,'employee_name',coalesce(nullif(v_employee.nickname,''),v_employee.full_name),'outlet_id',v_access.primary_outlet_id,'can_add_assets',v_access.can_add_assets,'can_adjust_assets',v_access.can_adjust_assets,'can_perform_asset_inspections',v_access.can_perform_asset_inspections,'can_manage_asset_details',v_access.can_manage_asset_details);
end;$$;

-- Attendance always reflects the employee's real published assignment. A
-- Management employee without one gets a non-actionable personal context.
create or replace function public.crew_attendance_context(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee_id uuid; v_outlet public.outlets%rowtype; v_schedule jsonb; v_outlet_id uuid; v_management boolean;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(workplace,'')))='management' into v_management from public.employees where id=v_employee_id;
  v_schedule:=public.crew_roster_employee_day(v_employee_id,timezone('Asia/Kuala_Lumpur',now())::date);
  v_outlet_id:=case when v_schedule is not null and coalesce(v_schedule->>'entry_type','working')='working' then (v_schedule->>'outlet_id')::uuid else null end;
  if v_outlet_id is null and not v_management then
    select a.primary_outlet_id into v_outlet_id from public.crew_access a where a.employee_id=v_employee_id;
  end if;
  if v_outlet_id is null and v_management then
    return jsonb_build_object('outlet_id',null,'outlet_name',null,'location_enabled',false,
      'schedule',v_schedule,'shift_start',null,'shift_end',null,'scheduled_position',null,
      'scheduled_entry_type',v_schedule->>'entry_type','clock_eligible',false);
  end if;
  select o.* into v_outlet from public.outlets o where o.id=v_outlet_id;
  if v_outlet.id is null then raise exception using errcode='22023',message='Your Crew Access has no assigned outlet. Ask your manager to confirm your workplace.'; end if;
  if v_outlet.attendance_location_enabled and (v_outlet.attendance_latitude is null or v_outlet.attendance_longitude is null) then
    raise exception using errcode='22023',message='This outlet has location verification enabled but is not configured. Ask your manager to update Outlet settings.';
  end if;
  return jsonb_build_object('outlet_id',v_outlet.id,'outlet_name',v_outlet.name,'location_enabled',v_outlet.attendance_location_enabled,
    'latitude',v_outlet.attendance_latitude,'longitude',v_outlet.attendance_longitude,'radius_meters',v_outlet.attendance_radius_meters,
    'schedule',v_schedule,'shift_start',v_schedule->>'start_time','shift_end',v_schedule->>'end_time',
    'scheduled_position',v_schedule->>'position','scheduled_entry_type',v_schedule->>'entry_type',
    'clock_eligible',not v_management or v_schedule->>'entry_type'='working');
end; $$;

create function public.crew_management_asset_mobile(p_token text,p_outlet_id uuid,p_asset_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
begin
  if not exists(select 1 from public.employees where id=v_employee_id and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management Asset view is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  if p_asset_id is not null and not exists(select 1 from public.asset_items a
    where a.id=p_asset_id and a.outlet_id=p_outlet_id and a.status<>'archived') then
    raise exception using errcode='42501',message='Asset is unavailable for this outlet.';
  end if;
  return jsonb_build_object(
    'employee_id',v_employee_id,'outlet_id',p_outlet_id,'outlet',jsonb_build_object('id',p_outlet_id,
      'name',(select name from public.outlets where id=p_outlet_id)),
    'can_add_assets',false,'can_adjust_assets',false,'can_perform_asset_inspections',false,
    'can_manage_asset_details',false,'read_only',true,
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name)
      from public.asset_categories c where c.is_active),'[]'::jsonb),
    'condition_templates','[]'::jsonb,
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'asset_code',a.asset_code,'name',a.name,
      'description',a.description,'category_id',a.category_id,'category_name',c.name,'location',a.location,
      'unit',a.unit,'current_quantity',a.current_quantity,'minimum_quantity',a.minimum_quantity,
      'condition',a.condition,'status',a.status,'image_url',a.image_url,'thumbnail_url',a.thumbnail_url,
      'last_inspection_at',a.last_inspection_at,'maintenance','[]'::jsonb) order by a.name)
      from public.asset_items a join public.asset_categories c on c.id=a.category_id
      where a.outlet_id=p_outlet_id and a.status<>'archived' and (p_asset_id is null or a.id=p_asset_id)),'[]'::jsonb),
    'inspection_drafts','[]'::jsonb,'movement_history','[]'::jsonb,'inspection_history','[]'::jsonb
  );
end; $$;
revoke all on function public.crew_management_asset_mobile(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_management_asset_mobile(text,uuid,uuid) to anon,authenticated;

create function public.crew_management_sop_library(p_token text,p_outlet_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
begin
  if not exists(select 1 from public.employees where id=v_employee_id and lower(btrim(workplace))='management') then
    raise exception using errcode='42501',message='Management SOP view is unavailable.';
  end if;
  perform public.crew_selected_outlet(p_token,p_outlet_id);
  return jsonb_build_object('outlet_id',p_outlet_id,'reference_only',true,
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'sort_order',c.sort_order,
      'sop_count',(select count(*) from public.crew_sops s where s.category_id=c.id and s.status='published'))
      order by c.sort_order,c.name) from public.crew_sop_categories c where c.outlet_id=p_outlet_id
      and exists(select 1 from public.crew_sops s where s.category_id=c.id and s.status='published')),'[]'::jsonb),
    'sops',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',v.title,'summary',v.summary,
      'category',v.category,'category_id',v.category_id,'version_id',v.id,'version',v.version,
      'updated_at',v.published_at,'acknowledgement_required',false,'acknowledged',false)
      order by v.category,v.title)
      from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id
        and v.version=s.current_version and v.status='published'
      where s.outlet_id=p_outlet_id and s.status='published'),'[]'::jsonb));
end; $$;
revoke all on function public.crew_management_sop_library(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_management_sop_library(text,uuid) to anon,authenticated;

-- Notification snapshots never authorize context. Resolve the live source
-- record, then validate its outlet against the current employee role scope.
create function public.crew_notification_destination_outlet(p_token text,p_notification_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token); v_notification public.crew_notifications%rowtype;
  v_outlet_id uuid;
begin
  select * into v_notification from public.crew_notifications
    where id=p_notification_id and recipient_employee_id=v_employee_id;
  if not found then raise exception using errcode='42501',message='Notification is unavailable.'; end if;
  if v_notification.source_entity_type='task_occurrence' then
    select i.outlet_id into v_outlet_id from public.crew_operation_instances i
      where i.id=v_notification.source_entity_id;
  elsif v_notification.source_entity_type='roster_publication' then
    select p.outlet_id into v_outlet_id from public.duty_roster_publications p
      where p.id=v_notification.source_entity_id;
  else
    return jsonb_build_object('available',true,'outlet_id',null);
  end if;
  if v_outlet_id is null or not(v_outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id))) then
    return jsonb_build_object('available',false,'outlet_id',null);
  end if;
  return jsonb_build_object('available',true,'outlet_id',v_outlet_id);
end; $$;
revoke all on function public.crew_notification_destination_outlet(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_notification_destination_outlet(text,uuid) to anon,authenticated;

-- Version and private-media reads accept Management's role scope, but the
-- acknowledgement mutation still requires its established assignment path.
create or replace function public.crew_sop_version(p_token text,p_sop_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_employee_id uuid; v_outlet_id uuid; v_visible boolean:=false; v_management boolean; v_assigned boolean:=false;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(e.workplace,'')))='management' into v_management
  from public.employees e where e.id=v_employee_id;
  select primary_outlet_id into v_outlet_id from public.crew_access where employee_id=v_employee_id;
  select exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
    where v.id=p_sop_version_id and v.status='published' and s.status='published'
      and ((v_management and s.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
        or (not v_management and s.outlet_id=v_outlet_id))) into v_visible;
  select exists(select 1 from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks','[]'::jsonb)) b
      where a.employee_id=v_employee_id and b->>'block_type'='sop_reference'
        and b->'payload'->>'sop_version_id'=p_sop_version_id::text) into v_assigned;
  v_visible:=v_visible or v_assigned;
  if not v_visible then raise exception using errcode='42501',message='SOP version is unavailable.'; end if;
  return (select jsonb_build_object('id',v.id,'version',v.version,'effective_date',v.effective_date,
    'change_summary',v.change_summary,'title',v.title,'category',v.category,'category_id',v.category_id,
    'summary',v.summary,'acknowledgement_required',case when v_management and not v_assigned then false else v.require_acknowledgement end,
    'reference_only',v_management and not v_assigned,
    'sections',coalesce((select jsonb_agg(jsonb_build_object('id',section.id,'title',section.title,
      'body',section.body,'sort_order',section.sort_order,'key_point',section.key_point,
      'media',case when media.id is null then null else jsonb_build_object('id',media.id,'mime_type',media.mime_type,
        'width',media.width,'height',media.height,'caption',section.media_caption) end) order by section.sort_order)
      from public.crew_sop_sections section left join public.crew_sop_media media on media.id=section.media_id
      where section.sop_version_id=v.id),'[]'::jsonb),
    'acknowledged',case when v_management and not v_assigned then false else exists(select 1 from public.crew_sop_acknowledgements a
      where a.employee_id=v_employee_id and a.sop_version_id=v.id) end,
    'acknowledged_at',case when v_management and not v_assigned then null else (select a.acknowledged_at from public.crew_sop_acknowledgements a
      where a.employee_id=v_employee_id and a.sop_version_id=v.id) end)
    from public.crew_sop_versions v where v.id=p_sop_version_id and v.status='published');
end; $$;
revoke all on function public.crew_sop_version(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_sop_version(text,uuid) to anon,authenticated;

create or replace function public.crew_sop_media_access(p_token text,p_sop_version_id uuid,p_media_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_employee_id uuid; v_outlet_id uuid; v_media public.crew_sop_media%rowtype;
  v_visible boolean:=false; v_management boolean;
begin
  v_employee_id:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(e.workplace,'')))='management' into v_management from public.employees e where e.id=v_employee_id;
  select primary_outlet_id into v_outlet_id from public.crew_access where employee_id=v_employee_id;
  select exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
    where v.id=p_sop_version_id and v.status='published' and s.status='published'
      and ((v_management and s.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
        or (not v_management and s.outlet_id=v_outlet_id))) into v_visible;
  if not v_visible then
    select exists(select 1 from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks','[]'::jsonb)) b
      where a.employee_id=v_employee_id and b->>'block_type'='sop_reference'
        and b->'payload'->>'sop_version_id'=p_sop_version_id::text) into v_visible;
  end if;
  select media.* into v_media from public.crew_sop_media media
  join public.crew_sop_sections section on section.media_id=media.id
  where media.id=p_media_id and media.status='ready' and section.sop_version_id=p_sop_version_id;
  if not v_visible or not found then raise exception using errcode='42501',message='SOP media is unavailable.'; end if;
  return jsonb_build_object('id',v_media.id,'bucket',v_media.bucket_id,'object_path',v_media.object_path,
    'mime_type',v_media.mime_type,'width',v_media.width,'height',v_media.height);
end; $$;
revoke all on function public.crew_sop_media_access(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_sop_media_access(text,uuid,uuid) to anon,authenticated;

create or replace function public.crew_localized_content(p_token text,p_domain text,p_version_ids uuid[],p_language text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_employee_id uuid; v_employee_outlet uuid; v_management boolean; v_version_id uuid;
  allowed boolean; snapshot jsonb; unit_entry record; resolved jsonb; value jsonb; result jsonb:='{}'::jsonb;
begin
  if p_language not in ('en','zh-CN','ms') then p_language:='en'; end if;
  if coalesce(cardinality(p_version_ids),0)>100 then raise exception using errcode='22023',message='Too many localized content versions requested.'; end if;
  v_employee_id:=public.crew_session_employee(p_token);
  select ca.primary_outlet_id,lower(btrim(coalesce(e.workplace,'')))='management'
  into v_employee_outlet,v_management from public.crew_access ca join public.employees e on e.id=ca.employee_id
  where ca.employee_id=v_employee_id and ca.access_state='active';
  if v_employee_outlet is null and not v_management then
    raise exception using errcode='42501',message='Crew access is unavailable.';
  end if;
  foreach v_version_id in array coalesce(p_version_ids,'{}'::uuid[]) loop
    allowed:=false;
    if p_domain='sop' then
      allowed:=exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
        where v.id=v_version_id and v.status='published'
          and ((v_management and s.status='published' and s.outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id)))
            or (not v_management and s.outlet_id=v_employee_outlet)));
    elsif p_domain='onboarding' then
      allowed:=exists(select 1 from public.crew_journey_assignments a where a.employee_id=v_employee_id and a.journey_id=v_version_id);
    elsif p_domain='task' then
      allowed:=exists(select 1 from public.crew_operation_instances i
        join public.crew_task_instance_assignees a on a.instance_id=i.id
        where a.employee_id=v_employee_id and i.template_id=v_version_id);
    else raise exception using errcode='22023',message='Unsupported localized content domain.'; end if;
    if not allowed then raise exception using errcode='42501',message='Localized content is unavailable for this Crew session.'; end if;
    if p_domain='sop' then
      select v.localized_content_snapshot into snapshot from public.crew_sop_versions v where v.id=v_version_id;
    elsif p_domain='onboarding' then
      select a.journey_snapshot->'localized_content' into snapshot from public.crew_journey_assignments a
      where a.employee_id=v_employee_id and a.journey_id=v_version_id order by a.assigned_at desc limit 1;
    else
      select i.template_snapshot->'localized_content' into snapshot from public.crew_operation_instances i
      join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee_id
      where i.template_id=v_version_id order by i.business_date desc,i.created_at desc limit 1;
    end if;
    snapshot:=coalesce(snapshot,public.crew_localization_snapshot(p_domain,v_version_id));
    resolved:='{}'::jsonb;
    for unit_entry in select key,entry.value from jsonb_each(snapshot) entry loop
      value:=coalesce(
        case when unit_entry.value->'translations'->p_language->>'status' in ('ai_translated','reviewed')
          then unit_entry.value->'translations'->p_language->'value' end,
        case when unit_entry.value->>'source_language'=p_language then unit_entry.value->'source_value' end,
        case when unit_entry.value->'translations'->'en'->>'status' in ('ai_translated','reviewed')
          then unit_entry.value->'translations'->'en'->'value' end,
        case when unit_entry.value->>'source_language'='en' then unit_entry.value->'source_value' end,
        unit_entry.value->'source_value',
        (select candidate.value->'value' from jsonb_each(unit_entry.value->'translations') candidate
          where candidate.value->>'status' in ('ai_translated','reviewed') limit 1));
      if value is not null then resolved:=resolved||jsonb_build_object(unit_entry.key,value); end if;
    end loop;
    result:=result||jsonb_build_object(v_version_id::text,resolved);
  end loop;
  return result;
end; $$;
revoke all on function public.crew_localized_content(text,text,uuid[],text) from public;
grant execute on function public.crew_localized_content(text,text,uuid[],text) to anon,authenticated;
