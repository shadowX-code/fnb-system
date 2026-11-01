-- Human review recognizes typed Machine work, never an unknown legacy completer.
create function feedx_integrations.factory_cleaning_independent_verifier(p_occurrence uuid,p_human uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $proof$
select coalesce((select p_human is not null and c.status='completed' and (
 (c.completed_by is not null and c.completed_by<>p_human)
 or (c.completed_by is null and c.completed_at is not null and exists(
  select 1 from feedx_integrations.factory_action_requests r
  where r.action='area_cleaning.complete' and r.target_id=c.id and r.status='completed'
    and r.confirmed_by is not null and r.completed_at>=c.completed_at
    and r.receipt->'actor'->>'type'='machine' and r.receipt->'actor'->>'identity_id'=r.identity_id::text
  )))
 from public.factory_mesti_cleaning_occurrences c where c.id=p_occurrence),false);
$proof$;
revoke all on function feedx_integrations.factory_cleaning_independent_verifier(uuid,uuid) from public,anon,authenticated;
do $guard$ begin
 if md5(pg_get_functiondef('public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb)'::regprocedure))<>'a0105e81fa9f53ae5650482ee6565d9b' then
 raise exception 'Area Cleaning batch authority changed; reconcile before migration.';end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.factory_mesti_cleaning_task_action(p_requirement_id uuid, p_due_date date, p_action text DEFAULT 'preview'::text, p_expected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    if not v_future and v_verify and v_row.status='completed' and feedx_integrations.factory_cleaning_independent_verifier(v_row.id,v_actor.id) then v_verify_count := v_verify_count+1; end if;
    if p_action <> 'preview' then
      if not (p_expected ? v_row.id::text) then v_reason := 'Not in confirmed selection';
      elsif p_expected->>v_row.id::text is distinct from v_token then v_reason := 'Changed since confirmation';
      elsif p_action='complete' and v_row.status not in ('pending','missed') then v_reason := 'Not Pending or Missed';
      elsif p_action='verify' and v_row.status<>'completed' then v_reason := 'Not Completed';
      elsif p_action='verify' and not feedx_integrations.factory_cleaning_independent_verifier(v_row.id,v_actor.id) then v_reason := 'Independent verifier required';
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
      'can_verify',not v_future and v_verify and v_row.status='completed' and feedx_integrations.factory_cleaning_independent_verifier(v_row.id,v_actor.id),
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
end $function$
;
notify pgrst,'reload schema';
