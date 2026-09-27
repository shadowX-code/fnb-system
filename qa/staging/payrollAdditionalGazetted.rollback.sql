-- No persisted fixture or optional company choice: all tests roll back.
-- Uses the actual captured March 2026 source to test its authority contract.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e
 join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login
 and e.access_state='active' limit 1),true);
do $$
declare a uuid:=public.payroll_admin_actor(); le uuid; oa uuid; ob uuid; cal uuid; before_policy uuid; after_policy uuid;
 candidate uuid; confirmation uuid; request uuid:=gen_random_uuid(); ids uuid[]; reference text;
 old_calendar text; old_policy jsonb; f jsonb;
begin
 select id into candidate from public.payroll_holiday_import_candidates
 where year=2026 and source_sha256='3ed630f9574fce4cbf0e4ba6303a3f071505fc99e886c59b36a1dac12cfeda07' and not is_qa and status<>'retired';
 if candidate is null then raise exception 'Verified captured source missing'; end if;
 select id,md5(to_jsonb(c)::text) into cal,old_calendar from public.payroll_holiday_calendar_versions c
 where year=2026 and status='published' order by revision desc limit 1;
 select array_agg((value->>'holiday_id')::uuid) into ids from (select value from jsonb_array_elements((select entries from public.payroll_holiday_calendar_versions where id=cal)) order by (value->>'kind'='required') desc,value->>'holiday_id' limit 11) t;
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA rollback additional entitlement','QA-'||gen_random_uuid(),'Rollback only',a,a) returning id into le;
 insert into public.outlets(name,code,state_code) values('QA rollback Perak','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into oa;
 insert into public.outlets(name,code,state_code) values('QA rollback other state','QA-'||substr(gen_random_uuid()::text,1,8),'MY-09') returning id into ob;
 -- Historical source setup for disposable outlets; current state is not a
 -- substitute for work-date-effective geography evidence.
 insert into public.payroll_outlet_state_versions(outlet_id,state_code,effective_from,actor_employee_id)
 values(oa,'MY-08','2026-01-01',a),(ob,'MY-09','2026-01-01',a);
 before_policy:=public.payroll_paid_holiday_policy_save('QA rollback paid selection',cal,ids,array[le],'{}',null,true,null,gen_random_uuid());
 select to_jsonb(p) into old_policy from public.payroll_paid_holiday_policy_versions p where id=before_policy;
 reference:='P.U.(B)111/2026 p2(a), Holidays Act s8; JTKSM Cuti Kelepasan Am Bergaji, Employment Act s60D(1)(b). Raya 21 March confirms 20 March branch.';
 confirmation:=public.payroll_additional_holiday_confirm(candidate,'1',reference,request);
 if confirmation<>public.payroll_additional_holiday_confirm(candidate,'1',reference,request) then raise exception 'Retry identity changed'; end if;
 if (select count(*) from public.payroll_holiday_import_events where candidate_id=candidate and event_type='additional_mandatory_confirmed')<>1 then raise exception 'Retry duplicated audit'; end if;
 select policy_version_id into after_policy from public.payroll_paid_holiday_assignments where legal_entity_id=le and year=2026;
 if after_policy=before_policy or (select selected_holiday_ids<>ids or calendar_version_id<>cal or jsonb_array_length(additional_entries)<>1 from public.payroll_paid_holiday_policy_versions where id=after_policy) then raise exception 'Additional entitlement lost or changed base selection'; end if;
 if old_policy<>(select to_jsonb(p) from public.payroll_paid_holiday_policy_versions p where id=before_policy) or old_calendar<>(select md5(to_jsonb(c)::text) from public.payroll_holiday_calendar_versions c where id=cal) then raise exception 'Original publication changed'; end if;
 f:=public.payroll_paid_holiday_resolve(le,oa,'2026-03-20');
 if f->>'status'<>'paid_holiday' or jsonb_array_length(f->'holidays')<>1 or f->'holidays'->0->>'kind'<>'additional_mandatory' then raise exception 'Additional paid holiday not resolved: %',f; end if;
 if public.payroll_paid_holiday_resolve(le,ob,'2026-03-20')->>'status'<>'not_selected' then raise exception 'Perak projection leaked to another state'; end if;
 begin
  update public.payroll_additional_holiday_confirmations set entitlement_reference='changed' where id=confirmation;
  raise exception 'Immutable evidence edited';
 exception when object_not_in_prerequisite_state then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.payroll_additional_holiday_confirm(candidate,'1',reference,gen_random_uuid());
  raise exception 'Unauthenticated mutation allowed';
 exception when insufficient_privilege then null; end;
end $$;
select 'ADDITIONAL GAZETTED ROLLBACK CONTRACTS PASS' as result;
rollback;
