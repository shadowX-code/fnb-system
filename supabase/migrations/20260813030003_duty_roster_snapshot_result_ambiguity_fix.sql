-- Runtime correction: disambiguate the PL/pgSQL result variable from the lifecycle table result column.
create or replace function public.save_roster_week_snapshot(p_request_id uuid,p_outlet_id uuid,p_week_start_date date,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor uuid:=auth.uid(); week_end date; rows_json jsonb; fingerprint text;
  request_row public.duty_roster_lifecycle_requests%rowtype; period_row public.roster_periods%rowtype;
  has_inserts boolean; has_updates boolean; has_deletes boolean; period_exists boolean; v_result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null then raise exception 'A request ID, outlet, and week start date are required.'; end if;
  if extract(isodow from p_week_start_date)<>1 then raise exception 'Roster week start must be Monday.'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'Roster week rows must be an array.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='You cannot save this outlet roster.'; end if;
  week_end:=p_week_start_date+6;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',r.employee_id,'roster_date',r.roster_date,'shift_template_id',r.shift_template_id,'remark',coalesce(r.remark,'')) order by r.roster_date,r.employee_id),'[]'::jsonb)
  into rows_json from jsonb_to_recordset(p_rows) r(employee_id uuid,roster_date date,shift_template_id uuid,remark text);
  if exists(select 1 from jsonb_to_recordset(rows_json) r(employee_id uuid,roster_date date,shift_template_id uuid,remark text) group by r.employee_id,r.roster_date having bool_or(r.employee_id is null or r.roster_date is null or r.shift_template_id is null) or count(*)>1)
    then raise exception 'Roster week rows must have one employee and date per row.'; end if;
  if exists(select 1 from jsonb_to_recordset(rows_json) r(employee_id uuid,roster_date date,shift_template_id uuid,remark text) where r.roster_date<p_week_start_date or r.roster_date>week_end)
    then raise exception 'Roster rows must belong to the selected week.'; end if;
  if exists(select 1 from jsonb_to_recordset(rows_json) r(employee_id uuid,roster_date date,shift_template_id uuid,remark text) left join public.employees e on e.id=r.employee_id where e.id is null or not coalesce(e.is_active,true) or coalesce(e.employment_status,'')<>'active' or public.crew_resolve_employee_outlet(e.id) is null or not public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id)))
    then raise exception using errcode='42501',message='Roster snapshot contains an ineligible or out-of-scope employee.'; end if;
  if exists(select 1 from jsonb_to_recordset(rows_json) r(employee_id uuid,roster_date date,shift_template_id uuid,remark text) left join public.shift_templates t on t.id=r.shift_template_id where t.id is null or t.outlet_id<>p_outlet_id)
    then raise exception 'Roster snapshot contains an unavailable shift template.'; end if;
  fingerprint:=md5(jsonb_build_object('operation','roster_week_snapshot','outlet_id',p_outlet_id,'week_start_date',p_week_start_date,'rows',rows_json)::text);
  perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:'||p_outlet_id::text||':'||p_week_start_date::text));
  select * into request_row from public.duty_roster_lifecycle_requests where request_id=p_request_id for update;
  if found then
    if request_row.operation='roster_week_snapshot' and request_row.actor_id=actor and request_row.outlet_id=p_outlet_id and request_row.week_start_date=p_week_start_date and request_row.payload_fingerprint=fingerprint and request_row.result is not null then return request_row.result; end if;
    raise exception 'Request ID was already used for a different roster save intent.';
  end if;
  select exists(select 1 from jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) left join public.duty_rosters d on d.outlet_id=p_outlet_id and d.employee_id=s.employee_id and d.roster_date=s.roster_date where d.id is null),
    exists(select 1 from public.duty_rosters d join jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) on s.employee_id=d.employee_id and s.roster_date=d.roster_date where d.outlet_id=p_outlet_id and d.roster_date between p_week_start_date and week_end),
    exists(select 1 from public.duty_rosters d where d.outlet_id=p_outlet_id and d.roster_date between p_week_start_date and week_end and not exists(select 1 from jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) where s.employee_id=d.employee_id and s.roster_date=d.roster_date))
  into has_inserts,has_updates,has_deletes;
  if has_inserts and not public.current_user_has_permission('duty_roster.create') then raise exception using errcode='42501',message='Missing permission to create roster shifts.'; end if;
  if has_updates and not (public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('duty_roster.manage')) then raise exception using errcode='42501',message='Missing permission to edit roster shifts.'; end if;
  if has_deletes and not public.current_user_has_permission('duty_roster.delete') then raise exception using errcode='42501',message='Missing permission to delete roster shifts.'; end if;
  select * into period_row from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_week_start_date for update; period_exists:=found;
  if period_exists and period_row.status='locked' then raise exception 'Unlock this roster before editing.'; end if;
  if period_exists and period_row.status='published' and not public.current_user_has_permission('duty_roster.manage') then raise exception using errcode='42501',message='Missing permission to reset a published roster to draft.'; end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,'roster_week_snapshot',actor,p_outlet_id,p_week_start_date,fingerprint);
  if not period_exists then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status) values(p_outlet_id,p_week_start_date,week_end,'draft') returning * into period_row;
  elsif period_row.status='published' then update public.roster_periods set status='draft',locked_at=null,updated_at=now() where id=period_row.id returning * into period_row; end if;
  update public.duty_rosters d set shift_template_id=s.shift_template_id,start_time=t.start_time,end_time=t.end_time,break_minutes=coalesce(t.break_minutes,0),status='draft',remark=s.remark,updated_by=actor,updated_at=now()
  from jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) join public.shift_templates t on t.id=s.shift_template_id
  where d.outlet_id=p_outlet_id and d.employee_id=s.employee_id and d.roster_date=s.roster_date;
  insert into public.duty_rosters(outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,break_minutes,status,remark,created_by,updated_by)
  select p_outlet_id,s.employee_id,s.roster_date,s.shift_template_id,t.start_time,t.end_time,coalesce(t.break_minutes,0),'draft',s.remark,actor,actor
  from jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) join public.shift_templates t on t.id=s.shift_template_id
  where not exists(select 1 from public.duty_rosters d where d.outlet_id=p_outlet_id and d.employee_id=s.employee_id and d.roster_date=s.roster_date);
  delete from public.duty_rosters d where d.outlet_id=p_outlet_id and d.roster_date between p_week_start_date and week_end and not exists(select 1 from jsonb_to_recordset(rows_json) s(employee_id uuid,roster_date date,shift_template_id uuid,remark text) where s.employee_id=d.employee_id and s.roster_date=d.roster_date);
  update public.duty_rosters set status='draft',updated_by=actor,updated_at=now() where period_row.status='draft' and outlet_id=p_outlet_id and roster_date between p_week_start_date and week_end;
  select jsonb_build_object('period',to_jsonb(period_row),'rows',coalesce(jsonb_agg(to_jsonb(d) order by d.roster_date,d.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters d where d.outlet_id=p_outlet_id and d.roster_date between p_week_start_date and week_end;
  update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id;
  return v_result;
end $$;
revoke all on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) to authenticated;
