-- Explicit, scoped source reconciliation. Does not approve time or calculate Payroll.
create or replace function public.payroll_time_source_state(p_time_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t payroll_payable_time_versions%rowtype; source jsonb; changes jsonb;
begin
 select * into t from payroll_payable_time_versions where id=p_time_version_id;
 source:=payroll_time_evidence(t.employee_id,t.work_date);
 select coalesce(jsonb_agg(jsonb_build_object('field',k,'before',t.evidence->k,'after',source->k) order by k),'[]') into changes
 from (select jsonb_object_keys(t.evidence||coalesce(source,'{}')) k) keys
 where k<>'source_fingerprint' and t.evidence->k is distinct from source->k;
 return jsonb_build_object('updated',source->>'source_fingerprint' is distinct from t.source_fingerprint,
  'fingerprint',source->>'source_fingerprint','changes',changes);
end $$;
revoke all on function public.payroll_time_source_state(uuid) from public,anon,authenticated;

create or replace function public.payroll_time_source_read(p_time_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t payroll_payable_time_versions%rowtype; actor uuid:=payroll_admin_actor();
begin
 select * into t from payroll_payable_time_versions where id=p_time_version_id;
 if t.id is null or not payroll_can_access_employee(t.employee_id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll source view authority required.';end if;
 return payroll_time_source_state(t.id);
end $$;
revoke all on function public.payroll_time_source_read(uuid) from public,anon;
grant execute on function public.payroll_time_source_read(uuid) to authenticated;

create or replace function public.payroll_time_source_reconcile(p_run_id uuid,p_time_version_id uuid,p_source_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r payroll_runs%rowtype; period payroll_periods%rowtype; old payroll_payable_time_versions%rowtype;
 latest payroll_payable_time_versions%rowtype; source jsonb; issues text[]; saved uuid;
 actor uuid:=payroll_admin_actor(); state jsonb;
begin
 select * into r from payroll_runs where id=p_run_id for update;
 select * into period from payroll_periods where id=r.period_id;
 select * into old from payroll_payable_time_versions where id=p_time_version_id for update;
 if r.id is null or old.id is null or old.work_date not between period.period_start and period.period_end
  or old.evidence->>'legal_entity_id' is distinct from period.legal_entity_id::text
  or not payroll_can_access_run_employee(r.id,old.employee_id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll source reconciliation scope denied.';end if;
 if r.status not in ('draft','review_required') or not payroll_time_correction_allowed(period.legal_entity_id,old.work_date) then
  raise exception 'Only an open Payroll review can reconcile source evidence.';end if;
 select * into latest from payroll_payable_time_versions where profile_id=old.profile_id and work_date=old.work_date order by revision desc limit 1 for update;
 source:=payroll_time_evidence(old.employee_id,old.work_date);
 if source is null or source->>'source_fingerprint' is distinct from p_source_fingerprint then
  raise serialization_failure using message='Source updated again. Review the latest changes.';end if;
 if source->>'legal_entity_id' is distinct from period.legal_entity_id::text
  or source->>'employee_id' is distinct from old.employee_id::text
  or source->>'profile_id' is distinct from old.profile_id::text
  or not payroll_can_access_employee(old.employee_id,'payroll.manage') then
  raise exception using errcode='42501',message='Changed employment scope requires separate Payroll review.';end if;
 -- A lost response or concurrent identical reconciliation returns committed evidence.
 -- No new revision/audit is created, and a later decision is never overwritten.
 if latest.source_fingerprint=p_source_fingerprint then
  return jsonb_build_object('row',payroll_time_decision_result(latest.id)||jsonb_build_object('source_state',payroll_time_source_state(latest.id)),'calculation_stale',true,'retried',true);end if;
 if latest.id<>old.id then raise serialization_failure using message='A newer time revision exists. Reopen the review.';end if;
 state:=payroll_time_source_state(old.id);
 select coalesce(array_agg(value),'{}') into issues from jsonb_array_elements_text(source->'issue_codes');
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_payable_time_versions(profile_id,employee_id,work_date,revision,supersedes_id,
  source_fingerprint,evidence,issue_codes,classification,scheduled_minutes,actual_minutes,proposed_minutes,
  approved_minutes,approved_extra_minutes,status,actor_employee_id,decision_reason)
 values(old.profile_id,old.employee_id,old.work_date,old.revision+1,old.id,p_source_fingerprint,source,
  issues,source->>'classification',(source->>'scheduled_minutes')::integer,(source->>'actual_minutes')::integer,
  (source->>'proposed_minutes')::integer,null,0,'review_required',actor,'Source updated; explicit decision required')
 returning id into saved;
 insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details)
 values('time_reconciled',old.profile_id,actor,'Explicit source reconciliation; no time approved',
  jsonb_build_object('run_id',r.id,'time_version_id',saved,'previous_version_id',old.id,'work_date',old.work_date,
   'source_fingerprint',p_source_fingerprint,'previous_source_fingerprint',old.source_fingerprint,'changes',state->'changes','status','review_required'));
 return jsonb_build_object('row',payroll_time_decision_result(saved)||jsonb_build_object('source_state',payroll_time_source_state(saved)),'calculation_stale',true);
end $$;
revoke all on function public.payroll_time_source_reconcile(uuid,uuid,text) from public,anon;
grant execute on function public.payroll_time_source_reconcile(uuid,uuid,text) to authenticated;

-- Enrich the existing scoped read; preserve its filter/history authority.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.payroll_time_read(uuid,date,date)'::regprocedure);
 if position('''history'',coalesce' in definition)=0 then raise exception 'Unexpected Payroll time read definition';end if;
 definition:=replace(definition,'''history'',coalesce','''source_state'',public.payroll_time_source_state(t.id),''history'',coalesce');
 execute definition;
end $migration$;
