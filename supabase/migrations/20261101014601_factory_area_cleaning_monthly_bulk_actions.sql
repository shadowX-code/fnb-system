-- A guarded Task/date batch delegates every transition to the existing Area authorities.
create or replace function public.factory_mesti_cleaning_task_action(
  p_requirement_id uuid, p_due_date date, p_action text default 'preview', p_expected jsonb default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor public.employees%rowtype := public.factory_mesti_current_employee();
  v_row public.factory_mesti_cleaning_occurrences%rowtype;
  v_complete boolean; v_verify boolean; v_future boolean;
  v_token text; v_reason text; v_outcome text; v_after jsonb;
  v_rows jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_affected integer := 0; v_skipped integer := 0; v_failed integer := 0;
  v_complete_count integer := 0; v_verify_count integer := 0; v_key text;
begin
  if auth.uid() is null or not (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode='42501', message='Missing Cleaning of Area view permission.';
  end if;
  if p_requirement_id is null or p_due_date is null or p_action is null or p_action not in ('preview','complete','verify') then
    raise exception using errcode='22023', message='Select a Cleaning Task, date and supported action.';
  end if;
  v_complete := public.current_user_has_permission('factory_mesti_cleaning.complete') or public.current_user_has_permission('factory_mesti_cleaning.manage');
  v_verify := public.current_user_has_permission('factory_mesti_cleaning.review') or public.current_user_has_permission('factory_mesti_cleaning.manage');
  v_future := p_due_date > (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if p_action <> 'preview' then
    if v_future then raise exception using errcode='22023', message='Future cleaning dates cannot use bulk actions.'; end if;
    if (p_action='complete' and not v_complete) or (p_action='verify' and not v_verify) then
      raise exception using errcode='42501', message='Missing permission for this Cleaning action.';
    end if;
    if p_expected is null or jsonb_typeof(p_expected)<>'object' then
      raise exception using errcode='22023', message='Preview and confirm the affected Location records first.';
    end if;
    if (select count(*) from jsonb_object_keys(p_expected)) > 500 then raise exception 'Too many Location records.'; end if;
  end if;
  if (select count(*) from public.factory_mesti_cleaning_occurrences where requirement_id=p_requirement_id and due_date=p_due_date)>500 then
    raise exception 'Too many Location records. Use individual actions.';
  end if;
  -- Stable lock ordering prevents overlapping batches from deadlocking. Preview never materializes work.
  for v_row in select * from public.factory_mesti_cleaning_occurrences
    where requirement_id=p_requirement_id and due_date=p_due_date order by id for update
  loop
    v_token := md5(to_jsonb(v_row)::text);
    v_seen := v_seen || jsonb_build_object(v_row.id::text,true);
    v_reason := null; v_outcome := 'skipped';
    if not v_future and v_complete and v_row.status in ('pending','missed') then v_complete_count := v_complete_count+1; end if;
    if not v_future and v_verify and v_row.status='completed' and v_row.completed_by is not null and v_row.completed_by<>v_actor.id then v_verify_count := v_verify_count+1; end if;
    if p_action <> 'preview' then
      if not (p_expected ? v_row.id::text) then v_reason := 'Not in confirmed selection';
      elsif p_expected->>v_row.id::text is distinct from v_token then v_reason := 'Changed since confirmation';
      elsif p_action='complete' and v_row.status not in ('pending','missed') then v_reason := 'Not Pending or Missed';
      elsif p_action='verify' and v_row.status<>'completed' then v_reason := 'Not Completed';
      elsif p_action='verify' and (v_row.completed_by is null or v_row.completed_by=v_actor.id) then v_reason := 'Independent verifier required';
      else
        begin
          if p_action='complete' then v_after := public.factory_mesti_complete_cleaning_occurrence(v_row.id,null);
          else v_after := public.factory_mesti_verify_cleaning_occurrence(v_row.id,'verified',null); end if;
          insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
          values(case when p_action='complete' then 'factory_mesti_cleaning_completed' else 'factory_mesti_cleaning_verified' end,
            'factory',auth.uid(),public.factory_current_active_employee_name(),'Factory MeSTI Cleaning occurrence updated from Monthly task action.',
            jsonb_build_object('target',v_row.id,'before',to_jsonb(v_row),'after',v_after,'bulk_task_action',true));
          v_outcome := 'affected'; v_affected := v_affected+1;
        exception when others then
          -- The per-record transition and audit roll back together; no partial success is hidden.
          v_outcome := 'failed'; v_reason := 'Update rejected; refresh before retrying'; v_failed := v_failed+1;
        end;
      end if;
      if v_outcome='skipped' then v_skipped := v_skipped+1; end if;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('id',v_row.id,'location_name',v_row.requirement_snapshot->>'location_name',
      'status',v_row.status,'token',v_token,
      'can_complete',not v_future and v_complete and v_row.status in ('pending','missed'),
      'can_verify',not v_future and v_verify and v_row.status='completed' and v_row.completed_by is not null and v_row.completed_by<>v_actor.id,
      'self_completed',v_row.completed_by=v_actor.id,'outcome',v_outcome,'reason',v_reason));
  end loop;
  if p_action <> 'preview' then
    for v_key in select jsonb_object_keys(p_expected) loop
      if not (v_seen ? v_key) then
        v_skipped := v_skipped+1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('id',v_key,'outcome','skipped','reason','No longer in this task/date'));
      end if;
    end loop;
  end if;
  return jsonb_build_object('requirement_id',p_requirement_id,'due_date',p_due_date,'action',p_action,'records',v_rows,
    'total_count',jsonb_array_length(v_rows),'complete_count',v_complete_count,'verify_count',v_verify_count,
    'affected_count',v_affected,'skipped_count',v_skipped,'failed_count',v_failed);
end $$;
revoke all on function public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb) from public,anon;
grant execute on function public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb) to authenticated;
