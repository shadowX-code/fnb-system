-- Run Prepare shares the existing reconciliation writer and preserves existing decisions.
CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_time_reconcile(p_machine uuid, p_legal_entity_id uuid, p_from date, p_to date, p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end;
  v_profile record;
  v_members uuid[];
  v_day date;
  v_evidence jsonb;
  v_latest public.payroll_payable_time_versions%rowtype;
  v_issues text[];
  v_status text;
  v_id uuid;
  v_created integer:=0;
  v_unchanged integer:=0;
  v_no_source integer:=0;
  v_outside_entity integer:=0;
  v_automatic integer:=0;
  v_changed integer:=0;
  v_conflict integer:=0;
  v_conflict_changed integer:=0;
  v_changed_review integer:=0;
  v_review integer:=0;
  v_requirement jsonb;
begin
  if not (feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.prepare') or feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.review_time')) then
    raise exception using errcode='42501',message='Payroll time reconciliation authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31
    or p_to>timezone('Asia/Kuala_Lumpur',now())::date then
    raise exception using errcode='22023',message='Select a valid elapsed range of at most 32 days.';
  end if;
  if p_run is not null or p_machine is not null then
    if not exists(select 1 from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id
      where r.id=p_run and period.legal_entity_id=p_legal_entity_id and period.period_start=p_from and p_to<=period.period_end
        and not r.foundation_only and r.status in ('draft','review_required')) then
      raise exception using errcode='42501',message='An exact open Payroll Run is required for preparation.';
    end if;
    -- Resolve canonical membership once before reading any daily evidence.
    select array_agg(employee_id) into v_members from public.payroll_run_employee_ids(p_run);
  end if;
  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where (p_run is null or p.employee_id=any(v_members))
      and (p_machine is not null
        or (p_run is not null and (public.payroll_can_access_run_employee(p_run,p.employee_id,'payroll.prepare')
          or public.payroll_can_access_run_employee(p_run,p.employee_id,'payroll.review_time')))
        or (p_run is null and (public.payroll_can_access_employee(p.employee_id,'payroll.prepare')
          or public.payroll_can_access_employee(p.employee_id,'payroll.review_time'))))
    order by p.id
  loop
    for v_day in select generate_series(p_from,p_to,interval '1 day')::date loop
      v_evidence:=public.payroll_time_evidence(v_profile.employee_id,v_day);
      if v_evidence is null then v_no_source:=v_no_source+1; continue; end if;
      if v_evidence->>'legal_entity_id' is distinct from p_legal_entity_id::text then v_outside_entity:=v_outside_entity+1; continue; end if;
      select * into v_latest from public.payroll_payable_time_versions t
        where t.profile_id=v_profile.profile_id and t.work_date=v_day
        order by revision desc limit 1 for update;
      v_requirement:=public.payroll_time_requirement(v_evidence,to_jsonb(v_latest));
      if v_latest.id is not null and v_latest.source_fingerprint=v_evidence->>'source_fingerprint' then
        v_unchanged:=v_unchanged+1;
        if v_requirement->>'state'='review_required' then v_review:=v_review+1; end if;
        continue;
      end if;
      if p_run is not null and v_latest.id is not null then
        v_changed:=v_changed+1;
        if v_requirement->>'state'='source_updated' then v_changed_review:=v_changed_review+1; end if;
        continue;
      end if;
      if p_run is not null and coalesce((v_requirement->>'automatic')::boolean,false) then
        v_automatic:=v_automatic+1;
        continue;
      end if;
      if not public.payroll_time_correction_allowed(p_legal_entity_id,v_day) then
        raise exception using errcode='55000',message='Finalized period requires an open correction run before time evidence changes.';
      end if;
      select coalesce(array_agg(issue.code),'{}'::text[]) into v_issues
        from jsonb_array_elements_text(v_evidence->'issue_codes') as issue(code);
      v_status:=case when cardinality(v_issues)=0 and (v_evidence->>'proposed_minutes') is not null
        then 'approved_auto' else 'review_required' end;
      perform set_config('feedx.payroll_command','yes',true);
      insert into public.payroll_payable_time_versions(
        profile_id,employee_id,work_date,revision,supersedes_id,source_fingerprint,evidence,
        issue_codes,classification,scheduled_minutes,actual_minutes,proposed_minutes,
        approved_minutes,status,actor_employee_id,actor_machine_id)
      values(v_profile.profile_id,v_profile.employee_id,v_day,coalesce(v_latest.revision,0)+1,
        v_latest.id,v_evidence->>'source_fingerprint',v_evidence,v_issues,
        v_evidence->>'classification',(v_evidence->>'scheduled_minutes')::integer,
        (v_evidence->>'actual_minutes')::integer,(v_evidence->>'proposed_minutes')::integer,
        case when v_status='approved_auto' then (v_evidence->>'proposed_minutes')::integer end,
        v_status,v_actor,p_machine)
      on conflict (profile_id,work_date,revision) do nothing returning id into v_id;
      if v_id is null then
        v_conflict:=v_conflict+1;
        select * into v_latest from public.payroll_payable_time_versions t
          where t.profile_id=v_profile.profile_id and t.work_date=v_day order by revision desc limit 1;
        v_requirement:=public.payroll_time_requirement(v_evidence,to_jsonb(v_latest));
        if v_requirement->>'state'='review_required' then v_review:=v_review+1;
        elsif v_requirement->>'state'='source_updated' then v_conflict_changed:=v_conflict_changed+1;
        end if;
        continue;
      end if;
      if v_status='review_required' and v_requirement->>'state'<>'ph_review' then
        v_review:=v_review+1;
      end if;
      insert into public.payroll_events(event_type,profile_id,actor_employee_id,actor_machine_id,details)
        values('time_reconciled',v_profile.profile_id,v_actor,p_machine,
          jsonb_build_object('time_version_id',v_id,'work_date',v_day,'status',v_status,
            'source_fingerprint',v_evidence->>'source_fingerprint'));
      v_created:=v_created+1;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'synchronized',v_created,'unchanged',v_unchanged,
    'skipped',v_unchanged+v_no_source+v_outside_entity+v_automatic+v_changed+v_conflict,
    'skipped_reasons',jsonb_build_object('unchanged',v_unchanged,'no_applicable_source',v_no_source,
      'outside_entity',v_outside_entity,'automatic_monthly',v_automatic,'existing_source_changed',v_changed,
      'concurrent_version',v_conflict),
    'unresolved',v_review+v_changed_review+v_conflict_changed,
    'unresolved_reasons',jsonb_build_object('review_required',v_review,
      'source_updated',v_changed_review+v_conflict_changed));
end; $function$;
revoke all on function feedx_integrations.hr_payroll_time_reconcile(uuid,uuid,date,date,uuid) from public,anon,authenticated;
create or replace function public.payroll_time_reconcile(p_legal_entity_id uuid,p_from date,p_to date)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select feedx_integrations.hr_payroll_time_reconcile(null,p_legal_entity_id,p_from,p_to,null);
$$;
create or replace function feedx_integrations.hr_payroll_prepare(p_machine uuid,p_run uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r payroll_runs%rowtype;p payroll_periods%rowtype;until_date date;
begin
 select * into r from payroll_runs where id=p_run for update;
 select * into p from payroll_periods where id=r.period_id;
 if not (feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,'payroll.prepare')
   or (p_machine is null and feedx_integrations.hr_actor_entity(null,p.legal_entity_id,'payroll.review_time'))) then raise exception using errcode='42501',message='Payroll preparation authority required';end if;
 if r.foundation_only or r.status not in ('draft','review_required') then raise exception using errcode='55000',message='Prepare requires an open calculation Draft';end if;
 until_date:=least(p.period_end,timezone('Asia/Kuala_Lumpur',now())::date);
 if until_date<p.period_start then return jsonb_build_object('created',0,'synchronized',0,'skipped',0,'unresolved',0,'skipped_reasons','{}'::jsonb,'unresolved_reasons','{}'::jsonb,'period_in_progress',true);end if;
 return feedx_integrations.hr_payroll_time_reconcile(p_machine,p.legal_entity_id,p.period_start,until_date,p_run);
end $$;

-- Human Prepare uses the same scoped command as the Agent.
create function public.payroll_run_prepare_time(p_run_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select feedx_integrations.hr_payroll_prepare(null,p_run_id);
$$;
revoke all on function public.payroll_run_prepare_time(uuid) from public,anon;
grant execute on function public.payroll_run_prepare_time(uuid) to authenticated;

-- Retain the scoped Prepare result in the existing retry-safe Agent receipt.
do $migration$
declare
  definition text:=pg_get_functiondef('public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure);
  original text:=definition;
begin
  if position('when ''hr_payroll.prepare'',''hr_payroll.calculate''' in definition)=0
    or position('-- Commit the audited operation' in definition)=0
    or position('after_value:=' in definition)=0 then
    raise exception 'Unexpected Agent execution receipt definition';
  end if;
  definition:=replace(definition,'when ''hr_payroll.prepare'',''hr_payroll.calculate''',
    'when ''hr_payroll.prepare'' then
      perform feedx_integrations.hr_target_scope(m,p_action,p_target_id,p_input);
      sync_summary:=feedx_integrations.hr_payroll_prepare(m,p_target_id);v_id:=p_target_id;
     when ''hr_payroll.calculate''');
  definition:=replace(definition,E'\ndeclare ',E'\ndeclare sync_summary jsonb; ');
  definition:=replace(definition,' -- Commit the audited operation',
    ' if sync_summary is not null then result:=result||jsonb_build_object(''evidence_sync'',sync_summary);end if;
 -- Commit the audited operation');
  if definition=original or position('declare sync_summary jsonb;' in definition)=0
    or position('result||jsonb_build_object(''evidence_sync'',sync_summary)' in definition)=0 then
    raise exception 'Agent Prepare receipt was not patched';
  end if;
  execute definition;
end $migration$;
notify pgrst,'reload schema';
