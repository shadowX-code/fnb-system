-- Final trusted Duty Roster status transition: period and rows lock together.

create or replace function public.lock_roster_week(
  p_request_id uuid, p_outlet_id uuid, p_week_start_date date
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=auth.uid(); v_operation constant text:='lock_roster_week'; v_end date; v_fingerprint text;
  v_request public.duty_roster_lifecycle_requests%rowtype; v_period public.roster_periods%rowtype; v_result jsonb; v_now timestamptz:=now();
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null or extract(isodow from p_week_start_date)<>1 then raise exception 'A request ID, outlet, and Monday week start are required.'; end if;
  if not public.current_user_has_permission('duty_roster.manage') then raise exception using errcode='42501',message='Missing permission to lock this roster.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='You cannot lock this outlet roster.'; end if;
  v_end:=p_week_start_date+6;
  perform pg_advisory_xact_lock(hashtext('roster_week_snapshot:'||p_outlet_id::text||':'||p_week_start_date::text));
  v_fingerprint:=md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'week_start_date',p_week_start_date)::text);
  select * into v_request from public.duty_roster_lifecycle_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.week_start_date=p_week_start_date and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different roster lock intent.';
  end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_week_start_date,v_fingerprint);
  select * into v_period from public.roster_periods where outlet_id=p_outlet_id and week_start_date=p_week_start_date for update;
  if not found then
    insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status,locked_at) values(p_outlet_id,p_week_start_date,v_end,'locked',v_now) returning * into v_period;
  elsif v_period.status='locked' then
    null;
  else
    update public.roster_periods set status='locked',locked_at=v_now,updated_at=v_now where id=v_period.id returning * into v_period;
  end if;
  update public.duty_rosters set status='locked',updated_by=v_actor,updated_at=v_now where outlet_id=p_outlet_id and roster_date between p_week_start_date and v_end;
  select jsonb_build_object('period',to_jsonb(v_period),'rows',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),'[]'::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end;
  update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id;
  return v_result;
end; $$;

revoke all on function public.lock_roster_week(uuid,uuid,date) from public;
grant execute on function public.lock_roster_week(uuid,uuid,date) to authenticated;
