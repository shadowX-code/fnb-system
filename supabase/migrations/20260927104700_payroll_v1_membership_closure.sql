-- Canonical period membership, frozen by existing immutable profile snapshots.
create or replace function public.payroll_run_employee_ids(p_run_id uuid)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  -- Frozen membership is authoritative for finalized/history reads, never current Employee data.
  select s.employee_id from public.payroll_run_profile_snapshots s
    join public.payroll_runs r on r.id=s.run_id
    where r.id=p_run_id and r.status in ('finalized','paid')
  union
  select e.id from public.employees e join public.payroll_runs r on r.id=p_run_id
    join public.payroll_periods period on period.id=r.period_id
    where r.status not in ('finalized','paid') and e.legal_entity_id=period.legal_entity_id
      and (e.joined_date is null or e.joined_date<=period.period_end)
      and (e.resigned_date is null or e.resigned_date>=period.period_start)
  union
  select p.employee_id from public.payroll_profiles p join public.employees e on e.id=p.employee_id
    join public.payroll_compensation_versions c on c.profile_id=p.id
    join public.payroll_runs r on r.id=p_run_id join public.payroll_periods period on period.id=r.period_id
    where r.status not in ('finalized','paid') and c.legal_entity_id=period.legal_entity_id
      and c.effective_from<=period.period_end
      and (e.joined_date is null or e.joined_date<=period.period_end)
      and (e.resigned_date is null or e.resigned_date>=period.period_start);
$$;
revoke all on function public.payroll_run_employee_ids(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_transition(p_run_id uuid, p_next_status text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_count integer;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id for update;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.manage' end) then
    raise exception using errcode='42501',message='Payroll Run transition authority denied.';
  end if;
  if nullif(btrim(p_reason),'') is null or not (
    (v_run.status='draft' and p_next_status='review_required')
    or (v_run.status='review_required' and p_next_status='ready')
    or (v_run.status='ready' and p_next_status='finalized')
    or (v_run.status='ready' and p_next_status='review_required')
  ) then
    raise exception using errcode='55000',message='Invalid Payroll Run transition or missing reason.';
  end if;
  if p_next_status='finalized' then
    if v_run.supersedes_run_id is not null and v_period.current_finalized_run_id is distinct from v_run.supersedes_run_id then
      raise exception using errcode='55000',message='Current finalized run changed; recreate this correction.';
    end if;
    if v_run.supersedes_run_id is null and v_period.current_finalized_run_id is not null then
      raise exception using errcode='55000',message='Use a correction run instead.';
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_profile_snapshots(
      run_id,employee_id,profile_id,compensation_versions,statutory_versions,recurring_versions,
      employee_name_snapshot,legal_entity_id_snapshot)
    select v_run.id,e.id,p.id,
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_from), '[]'::jsonb)
        from public.payroll_compensation_versions c where c.profile_id=p.id and c.effective_from<=v_period.period_end
          and c.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_compensation_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_from), '[]'::jsonb)
        from public.payroll_statutory_profile_versions s where s.profile_id=p.id and s.effective_from<=v_period.period_end
          and s.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_statutory_profile_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(rc) order by rc.effective_from), '[]'::jsonb)
        from public.payroll_recurring_component_versions rc where rc.profile_id=p.id and rc.effective_from<=v_period.period_end),
      e.full_name,v_period.legal_entity_id
    from public.payroll_profiles p join public.employees e on e.id=p.employee_id
    join public.payroll_run_employee_ids(p_run_id) member on member.employee_id=e.id;
    get diagnostics v_count=row_count;
    if v_count=0 then raise exception using errcode='22023',message='No effective Payroll Profiles exist for this run.'; end if;
    update public.payroll_runs set status='finalized',finalized_by_employee_id=v_actor,finalized_at=clock_timestamp()
      where id=v_run.id;
    update public.payroll_periods set current_finalized_run_id=v_run.id where id=v_period.id;
  else
    perform set_config('feedx.payroll_command','yes',true);
    update public.payroll_runs set status=p_next_status where id=v_run.id;
  end if;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('run_'||p_next_status,v_run.id,v_actor,btrim(p_reason),
    jsonb_build_object('from_status',v_run.status,'to_status',p_next_status,
      'foundation_only',v_run.foundation_only,'profile_count',v_count));
  return jsonb_build_object('id',v_run.id,'status',p_next_status,
    'foundation_only',v_run.foundation_only,'profile_count',v_count);
end; $function$;

revoke all on function public.payroll_run_transition(uuid,text,text) from public,anon;
grant execute on function public.payroll_run_transition(uuid,text,text) to authenticated;
