-- Preserve Human reconciliation, but bound Agent work before daily reads.
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
begin
  if not (feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.prepare') or feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.review_time')) then
    raise exception using errcode='42501',message='Payroll time reconciliation authority required.';
  end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+31
    or p_to>timezone('Asia/Kuala_Lumpur',now())::date then
    raise exception using errcode='22023',message='Select a valid elapsed range of at most 32 days.';
  end if;
  if p_machine is not null then
    if not exists(select 1 from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id
      where r.id=p_run and period.legal_entity_id=p_legal_entity_id and period.period_start=p_from and p_to<=period.period_end
        and not r.foundation_only and r.status in ('draft','review_required')) then
      raise exception using errcode='42501',message='An exact open Payroll Run is required for Agent preparation.';
    end if;
    -- Resolve canonical membership once before reading any daily evidence.
    select array_agg(employee_id) into v_members from public.payroll_run_employee_ids(p_run);
  end if;
  for v_profile in select p.id profile_id,p.employee_id from public.payroll_profiles p
    where case when p_machine is null then (public.payroll_can_access_employee(p.employee_id,'payroll.prepare') or public.payroll_can_access_employee(p.employee_id,'payroll.review_time')) else p.employee_id=any(v_members) end
  loop
    for v_day in select generate_series(p_from,p_to,interval '1 day')::date loop
      v_evidence:=public.payroll_time_evidence(v_profile.employee_id,v_day);
      if v_evidence is null then continue; end if;
      if v_evidence->>'legal_entity_id' is distinct from p_legal_entity_id::text then continue; end if;
      select * into v_latest from public.payroll_payable_time_versions t
        where t.profile_id=v_profile.profile_id and t.work_date=v_day
        order by revision desc limit 1 for update;
      if v_latest.id is not null and v_latest.source_fingerprint=v_evidence->>'source_fingerprint' then
        v_unchanged:=v_unchanged+1;
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
        v_status,v_actor,p_machine) returning id into v_id;
      insert into public.payroll_events(event_type,profile_id,actor_employee_id,actor_machine_id,details)
        values('time_reconciled',v_profile.profile_id,v_actor,p_machine,
          jsonb_build_object('time_version_id',v_id,'work_date',v_day,'status',v_status,
            'source_fingerprint',v_evidence->>'source_fingerprint'));
      v_created:=v_created+1;
    end loop;
  end loop;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
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
 if not feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,'payroll.prepare') then raise exception using errcode='42501',message='Payroll preparation authority required';end if;
 if r.foundation_only or r.status not in ('draft','review_required') then raise exception using errcode='55000',message='Prepare requires an open calculation Draft';end if;
 until_date:=least(p.period_end,timezone('Asia/Kuala_Lumpur',now())::date);
 if until_date<p.period_start then return jsonb_build_object('created',0,'period_in_progress',true);end if;
 return feedx_integrations.hr_payroll_time_reconcile(p_machine,p.legal_entity_id,p.period_start,until_date,p_run);
end $$;
drop function feedx_integrations.hr_payroll_time_reconcile(uuid,uuid,date,date);
notify pgrst,'reload schema';
