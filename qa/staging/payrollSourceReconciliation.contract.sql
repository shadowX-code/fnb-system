begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $qa$
declare emp uuid; run uuid; profile uuid; v_source jsonb; before_source jsonb; old_id uuid; state jsonb; result jsonb; first_id uuid; latest uuid; pub uuid; outlet uuid; baseline text; request uuid; counts integer;
begin
 select e.id,p.id,r.id into emp,profile,run from employees e join payroll_profiles p on p.employee_id=e.id join payroll_periods period on period.legal_entity_id=e.legal_entity_id join payroll_runs r on r.period_id=period.id where e.employee_code='QA-PH-hourly-1004' and period.period_start='2026-09-01' and r.status='draft' limit 1;
 if emp is null then raise exception 'Labelled PH fixture required';end if;
 v_source:=payroll_time_evidence(emp,'2026-09-16');
 if v_source#>>'{paid_holiday_policy,holidays,0,holiday,name}'<>'Hari Malaysia' then raise exception 'Expected real published Hari Malaysia fixture';end if;
 -- Synthetic historical snapshot mirrors the exact verified pre-publication shape.
 -- Current Roster/Attendance/Leave remain actual canonical fixture evidence.
 before_source:=(v_source-'paid_holiday_policy'-'source_fingerprint')||jsonb_build_object('holiday_id',null,'classification','regular','issue_codes',jsonb_build_array('missing_punch'));
 before_source:=before_source||jsonb_build_object('source_fingerprint',md5(before_source::text));
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_payable_time_versions(profile_id,employee_id,work_date,revision,supersedes_id,source_fingerprint,evidence,issue_codes,classification,scheduled_minutes,approved_minutes,status,decision_reason,actor_employee_id)
 select profile,emp,'2026-09-16',revision+1,id,before_source->>'source_fingerprint',before_source,array['missing_punch'],'regular',(v_source->>'scheduled_minutes')::integer,300,'approved_manual','QA ONLY pre-publication historical snapshot',payroll_admin_actor() from payroll_payable_time_versions where employee_id=emp and work_date='2026-09-16' order by revision desc limit 1 returning id into old_id;
 baseline:=md5((select to_jsonb(t)::text from payroll_payable_time_versions t where id=old_id));
 state:=payroll_time_source_read(old_id);
 if not (state->>'updated')::boolean or jsonb_array_length(state->'changes')<>4 then raise exception 'Exact holiday transition differs: %',state;end if;
 begin
  perform payroll_time_decision_save(jsonb_build_object('run_id',run,'time_version_id',old_id,'request_id',gen_random_uuid(),'correction',true,'action','adjust','approved_minutes',300,'extra_minutes',0,'classification','public_holiday','reason','QA rejected stale save'));
  raise exception 'Stale guard bypassed';
 exception when sqlstate '55000' then null;end;
 begin
  perform payroll_time_source_reconcile(run,old_id,'wrong-v_source');
  raise exception 'Changed-v_source CAS bypassed';
 exception when serialization_failure then null;end;
 result:=payroll_time_source_reconcile(run,old_id,state->>'fingerprint');first_id:=(result#>>'{row,id}')::uuid;
 if result#>>'{row,status}'<>'review_required' or result#>>'{row,approved_minutes}' is not null or result#>>'{row,classification}'<>'public_holiday' then raise exception 'Reconcile silently approved or misclassified: %',result;end if;
 result:=payroll_time_source_reconcile(run,old_id,state->>'fingerprint');
 if (result#>>'{row,id}')::uuid<>first_id or not (result->>'retried')::boolean then raise exception 'Lost response duplicated reconciliation';end if;
 if (select count(*) from payroll_events where details->>'time_version_id'=first_id::text)<>1 then raise exception 'Reconcile audit count incorrect';end if;
 request:=gen_random_uuid();
 result:=payroll_time_decision_save(jsonb_build_object('run_id',run,'time_version_id',first_id,'request_id',request,'correction',false,'action','adjust','approved_minutes',300,'extra_minutes',0,'classification','public_holiday','reason','QA ONLY explicit attendance verified after reconciliation'));
 latest:=(result->>'id')::uuid;
 if result#>>'{row,status}'<>'approved_manual' then raise exception 'Explicit post-reconcile save failed';end if;
 -- Genuine published Roster replacement, not a mocked fingerprint.
 outlet:=(v_source->>'outlet_id')::uuid;
 select publication_id into pub from duty_roster_published_entries where id=(v_source->>'roster_entry_id')::uuid;
 insert into duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,published_by)
 select outlet_id,week_start_date,week_end_date,(select max(p.revision)+1 from duty_roster_publications p where p.outlet_id=old.outlet_id and p.week_start_date=old.week_start_date),auth.uid() from duty_roster_publications old where id=pub returning id into pub;
 insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,outlet_name_snapshot,published_at)
 values(pub,outlet,emp,'2026-09-16','12:00','22:00',60,'working','QA ONLY roster v_source change',now());
 state:=payroll_time_source_read(latest);
 if not (state->>'updated')::boolean or not exists(select 1 from jsonb_array_elements(state->'changes') c where c->>'field'='scheduled_start_at') then raise exception 'Real roster change not detected: %',state;end if;
 result:=payroll_time_source_reconcile(run,latest,state->>'fingerprint');
 if result#>>'{row,status}'<>'review_required' or result#>>'{row,approved_minutes}' is not null then raise exception 'Roster correction silently approved';end if;
 if baseline<>md5((select to_jsonb(t)::text from payroll_payable_time_versions t where id=old_id)) then raise exception 'Prior evidence rewritten';end if;
 -- Finalized guard is checked in a rollback subtransaction on the QA run only.
 begin
  update payroll_runs set status='finalized' where id=run;
  perform payroll_time_source_reconcile(run,(result#>>'{row,id}')::uuid,state->>'fingerprint');
  raise exception 'Finalized guard bypassed';
 exception when others then
  if sqlerrm not in ('Only an open Payroll review can reconcile source evidence.','Payroll calculation requires review or recalculation.') then raise;end if;
 end;
 if has_function_privilege('anon','public.payroll_time_source_reconcile(uuid,uuid,text)','execute') or has_function_privilege('authenticated','public.payroll_time_source_state(uuid)','execute') then raise exception 'Private/public grants unsafe';end if;
 if pg_get_functiondef('payroll_time_decision_save(jsonb)'::regprocedure) like '%public.payroll_employee_recalculate(%' then raise exception 'Fast transaction boundary changed';end if;
end $qa$;
select 'PASS' exact_holiday_transition_roster_control_idempotency_audit_and_finalized_guards;
rollback;
