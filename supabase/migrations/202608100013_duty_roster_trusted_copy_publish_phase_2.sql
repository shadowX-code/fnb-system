-- Trusted Copy Week and Publish/Unlock lifecycle authority. Reuses Phase 1 ledger.

create or replace function public.copy_roster_week(
  p_request_id uuid, p_outlet_id uuid, p_source_week_start_date date, p_target_week_start_date date, p_overwrite boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_operation constant text := 'copy_roster_week'; v_source_end date; v_target_end date;
  v_source jsonb; v_fingerprint text; v_request public.duty_roster_lifecycle_requests%rowtype; v_period public.roster_periods%rowtype; v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_source_week_start_date is null or p_target_week_start_date is null then raise exception 'A request ID, outlet, source week, and target week are required.'; end if;
  if extract(isodow from p_source_week_start_date) <> 1 or extract(isodow from p_target_week_start_date) <> 1 then raise exception 'Roster week start must be Monday.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501', message='You cannot copy this outlet roster.'; end if;
  if not (public.current_user_has_permission('duty_roster.create') or public.current_user_has_permission('duty_roster.edit')) then raise exception using errcode='42501', message='Missing permission to copy roster weeks.'; end if;
  if p_overwrite and not public.current_user_has_permission('duty_roster.delete') then raise exception using errcode='42501', message='Missing permission to overwrite roster weeks.'; end if;
  v_source_end := p_source_week_start_date + 6; v_target_end := p_target_week_start_date + 6;
  -- Phase 1's lock key is deliberately reused. Sorting prevents A→B/B→A deadlocks.
  if p_source_week_start_date <= p_target_week_start_date then
    perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:' || p_outlet_id::text || ':' || p_source_week_start_date::text));
    if p_source_week_start_date <> p_target_week_start_date then perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:' || p_outlet_id::text || ':' || p_target_week_start_date::text)); end if;
  else
    perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:' || p_outlet_id::text || ':' || p_target_week_start_date::text));
    perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:' || p_outlet_id::text || ':' || p_source_week_start_date::text));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',r.employee_id,'roster_date',r.roster_date,'shift_template_id',r.shift_template_id,'remark',coalesce(r.remark,'')) order by r.roster_date,r.employee_id),'[]'::jsonb) into v_source
  from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_source_week_start_date and v_source_end;
  v_fingerprint := md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'source_week_start_date',p_source_week_start_date,'target_week_start_date',p_target_week_start_date,'overwrite',p_overwrite,'source_rows',v_source)::text);
  select * into v_request from public.duty_roster_lifecycle_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.week_start_date=p_target_week_start_date and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different roster copy intent.';
  end if;
  if jsonb_array_length(v_source) = 0 then
    select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_target_week_start_date;
    select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_target_week_start_date and v_target_end;
    insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint,result,completed_at) values(p_request_id,v_operation,v_actor,p_outlet_id,p_target_week_start_date,v_fingerprint,v_result,now());
    return v_result;
  end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_target_week_start_date,v_fingerprint);
  select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_target_week_start_date for update;
  if found and v_period.status='locked' then raise exception 'Unlock this roster before copying.'; end if;
  if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status) values(p_outlet_id,p_target_week_start_date,v_target_end,'draft') returning * into v_period; else update public.roster_periods set status='draft',locked_at=null,updated_at=now() where id=v_period.id returning * into v_period; end if;
  if p_overwrite then delete from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_target_week_start_date and v_target_end and not exists (select 1 from public.duty_rosters source where source.outlet_id=p_outlet_id and source.roster_date between p_source_week_start_date and v_source_end and source.employee_id=r.employee_id and source.roster_date-p_source_week_start_date=r.roster_date-p_target_week_start_date); end if;
  update public.duty_rosters target set shift_template_id=source.shift_template_id,start_time=source.start_time,end_time=source.end_time,break_minutes=source.break_minutes,status='draft',remark=source.remark,updated_by=v_actor,updated_at=now()
  from public.duty_rosters source where source.outlet_id=p_outlet_id and source.roster_date between p_source_week_start_date and v_source_end and target.outlet_id=p_outlet_id and target.employee_id=source.employee_id and target.roster_date=p_target_week_start_date+(source.roster_date-p_source_week_start_date);
  insert into public.duty_rosters(outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,break_minutes,status,remark,created_by,updated_by)
  select p_outlet_id,source.employee_id,p_target_week_start_date+(source.roster_date-p_source_week_start_date),source.shift_template_id,source.start_time,source.end_time,source.break_minutes,'draft',source.remark,v_actor,v_actor from public.duty_rosters source
  where source.outlet_id=p_outlet_id and source.roster_date between p_source_week_start_date and v_source_end and not exists(select 1 from public.duty_rosters target where target.outlet_id=p_outlet_id and target.employee_id=source.employee_id and target.roster_date=p_target_week_start_date+(source.roster_date-p_source_week_start_date));
  select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_target_week_start_date and v_target_end;
  update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id; return v_result;
end; $$;

create or replace function public.publish_roster_week(p_request_id uuid,p_outlet_id uuid,p_week_start_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_operation constant text:='publish_roster_week'; v_end date; v_fingerprint text; v_request public.duty_roster_lifecycle_requests%rowtype; v_period public.roster_periods%rowtype; v_result jsonb; v_now timestamptz:=now();
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null or extract(isodow from p_week_start_date)<>1 then raise exception 'A request ID, outlet, and Monday week start are required.'; end if;
  if not public.current_user_has_permission('duty_roster.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Missing permission to publish this outlet roster.'; end if;
  v_end:=p_week_start_date+6; perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:'||p_outlet_id::text||':'||p_week_start_date::text)); v_fingerprint:=md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'week_start_date',p_week_start_date)::text);
  select * into v_request from public.duty_roster_lifecycle_requests where request_id=p_request_id for update; if found then if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.week_start_date=p_week_start_date and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if; raise exception 'Request ID was already used for a different roster publish intent.'; end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_week_start_date,v_fingerprint);
  select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_week_start_date for update; if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status,published_by,published_at) values(p_outlet_id,p_week_start_date,v_end,'published',v_actor,v_now) returning * into v_period; else update public.roster_periods set status='published',published_by=v_actor,published_at=v_now,locked_at=null,updated_at=v_now where id=v_period.id returning * into v_period; end if;
  update public.duty_rosters r set status='published',updated_by=v_actor,updated_at=v_now,employee_name_snapshot=coalesce(employee.nickname,employee.full_name,r.employee_name_snapshot,''),position_snapshot=coalesce(employee.position,r.position_snapshot,''),department_snapshot=coalesce(employee.department,r.department_snapshot,''),outlet_snapshot=outlet.name,shift_snapshot=(select jsonb_build_object('id',template.id,'name',template.name,'code',template.code,'start_time',r.start_time,'end_time',r.end_time,'break_minutes',r.break_minutes,'shift_type',template.shift_type,'color',template.color) from public.shift_templates template where template.id=r.shift_template_id),publish_timestamp=v_now from public.employees employee, public.outlets outlet where outlet.id=p_outlet_id and r.employee_id=employee.id and r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end;
  select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end; update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id; return v_result;
end; $$;

create or replace function public.unpublish_roster_week(p_request_id uuid,p_outlet_id uuid,p_week_start_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_operation constant text:='unpublish_roster_week'; v_end date; v_fingerprint text; v_request public.duty_roster_lifecycle_requests%rowtype; v_period public.roster_periods%rowtype; v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null or extract(isodow from p_week_start_date)<>1 then raise exception 'A request ID, outlet, and Monday week start are required.'; end if;
  if not public.current_user_has_permission('duty_roster.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Missing permission to unlock this outlet roster.'; end if;
  v_end:=p_week_start_date+6; perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:'||p_outlet_id::text||':'||p_week_start_date::text)); v_fingerprint:=md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'week_start_date',p_week_start_date)::text);
  select * into v_request from public.duty_roster_lifecycle_requests where request_id=p_request_id for update; if found then if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.week_start_date=p_week_start_date and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if; raise exception 'Request ID was already used for a different roster unlock intent.'; end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_week_start_date,v_fingerprint);
  select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_week_start_date for update; if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status) values(p_outlet_id,p_week_start_date,v_end,'draft') returning * into v_period; else update public.roster_periods set status='draft',locked_at=null,updated_at=now() where id=v_period.id returning * into v_period; end if;
  update public.duty_rosters set status='draft',updated_by=v_actor,updated_at=now() where outlet_id=p_outlet_id and roster_date between p_week_start_date and v_end;
  select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end; update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id; return v_result;
end; $$;

revoke all on function public.copy_roster_week(uuid,uuid,date,date,boolean) from public;
revoke all on function public.publish_roster_week(uuid,uuid,date) from public;
revoke all on function public.unpublish_roster_week(uuid,uuid,date) from public;
grant execute on function public.copy_roster_week(uuid,uuid,date,date,boolean) to authenticated;
grant execute on function public.publish_roster_week(uuid,uuid,date) to authenticated;
grant execute on function public.unpublish_roster_week(uuid,uuid,date) to authenticated;
