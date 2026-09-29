-- Reuse the established transition and receipt authorities with wording that
-- applies to every enabled letter or notice type.
create or replace function public.employee_disciplinary_admin_transition(p_warning_id uuid,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_record public.employee_disciplinary_warnings%rowtype; v_actor uuid:=public.employee_disciplinary_current_admin_employee(); v_now timestamptz:=clock_timestamp();
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to manage letters and notices.'; end if;
  select * into v_record from public.employee_disciplinary_warnings where id=p_warning_id for update;
  if v_record.id is null or not public.employee_disciplinary_admin_can_access_employee(v_record.employee_id) then
    raise exception using errcode='42501',message='Letter or notice is outside your outlet scope.';
  end if;
  if p_action='withdraw' then
    if v_record.status in ('draft','withdrawn','superseded') or nullif(btrim(p_reason),'') is null then
      raise exception using errcode='22023',message='A withdrawal reason is required for an issued letter or notice.';
    end if;
    update public.employee_disciplinary_warnings set status='withdrawn',withdrawn_at=v_now,
      withdrawn_by_employee_id=v_actor,withdrawal_reason=btrim(p_reason),updated_at=v_now
      where id=p_warning_id returning * into v_record;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at,details)
      values(v_record.id,'withdrawn','admin',v_actor,v_now,jsonb_build_object('reason',btrim(p_reason)));
  elsif p_action='not_acknowledged' then
    if v_record.status not in ('delivered','viewed') then raise exception using errcode='55000',
      message='Only a delivered or viewed letter or notice can be marked Not Acknowledged.'; end if;
    update public.employee_disciplinary_warnings set status='not_acknowledged',not_acknowledged_at=v_now,updated_at=v_now
      where id=p_warning_id returning * into v_record;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
      values(v_record.id,'not_acknowledged','admin',v_actor,v_now);
  else raise exception using errcode='22023',message='Unsupported letter or notice action.';
  end if;
  return to_jsonb(v_record);
end; $$;

create or replace function public.crew_employee_disciplinary_acknowledge(p_token text,p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_record public.employee_disciplinary_warnings%rowtype; v_now timestamptz:=clock_timestamp();
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_record from public.employee_disciplinary_warnings where id=p_warning_id and employee_id=v_employee for update;
  if v_record.id is null or v_record.status not in ('delivered','viewed') then raise exception using errcode='55000',
    message='This letter or notice cannot be acknowledged.'; end if;
  update public.employee_disciplinary_warnings set status='acknowledged',first_viewed_at=coalesce(first_viewed_at,v_now),
    acknowledged_at=v_now,updated_at=v_now where id=v_record.id returning * into v_record;
  if not exists(select 1 from public.employee_disciplinary_events where warning_id=v_record.id and event_type='viewed') then
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
      values(v_record.id,'viewed','crew',v_employee,v_now);
  end if;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
    values(v_record.id,'acknowledged','crew',v_employee,v_now);
  return jsonb_build_object('warning_id',v_record.id,'status',v_record.status,'acknowledged_at',v_record.acknowledged_at);
end; $$;

revoke all on function public.employee_disciplinary_admin_transition(uuid,text,text),
  public.crew_employee_disciplinary_acknowledge(text,uuid) from public,anon,authenticated;
grant execute on function public.employee_disciplinary_admin_transition(uuid,text,text) to authenticated;
grant execute on function public.crew_employee_disciplinary_acknowledge(text,uuid) to anon,authenticated;
