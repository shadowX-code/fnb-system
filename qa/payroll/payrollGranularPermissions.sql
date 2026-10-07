-- Staging-only rollback contract. No fixture grants/business evidence are retained.
begin;
do $test$
declare qa public.employees%rowtype; test_role_id uuid:=gen_random_uuid(); entity uuid;
 actions text[]:=array['setup','statutory','prepare','review_time','treat_ph','adjust','configure','configure_holidays','publish_holidays','record_payment'];
 action text; other text; owner_uid uuid; saved jsonb; expected text[]; profile public.payroll_profiles%rowtype;
begin
 select * into qa from public.employees where lower(full_name)='crew admin qa' and auth_user_id is not null;
 if qa.id is null then raise exception 'Labelled Staging QA identity required';end if;
 select id into entity from public.legal_entities where is_active limit 1;
 select * into profile from public.payroll_profiles limit 1;
 insert into public.roles(id,name,description,is_system_role,is_active,outlet_access_type)
 values(test_role_id,'payroll_split_qa_transaction','Rollback-only Payroll authority contract',false,true,'all');
 update public.employees e set role_id=test_role_id where e.id=qa.id;
 perform set_config('request.jwt.claim.sub',qa.auth_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',qa.auth_user_id,'role','authenticated')::text,true);
 insert into public.role_permissions select test_role_id,id from public.permissions where code='payroll.view';
 foreach action in array actions loop
  insert into public.role_permissions select test_role_id,id from public.permissions where code='payroll.'||action;
  foreach other in array actions loop
   if public.current_user_has_permission('payroll.'||other) is distinct from (other=action) then raise exception 'Grant isolation failed: % / %',action,other;end if;
  end loop;
  if not public.payroll_can_access_employee(profile.employee_id,'payroll.'||action) or not public.payroll_can_manage_entity(entity,'payroll.'||action) then raise exception 'Existing scope helper lost grant: %',action;end if;
  delete from public.role_permissions rp using public.permissions p where rp.permission_id=p.id and rp.role_id=test_role_id and p.code='payroll.'||action;
  if public.payroll_can_manage_entity(entity,'payroll.'||action) then raise exception 'Revocation failed: %',action;end if;
 end loop;
 -- Legacy grants alone cannot authorize any split command or automatic calculation.
 insert into public.role_permissions select test_role_id,id from public.permissions where code='payroll.manage';
 foreach action in array actions loop
  if public.current_user_has_permission('payroll.'||action) then raise exception 'Legacy compatibility bypass: %',action;end if;
 end loop;
 if public.payroll_can_recalculate_entity(entity) then raise exception 'Legacy calculation bypass';end if;
 begin
  perform public.payroll_profile_create(profile.employee_id,current_date,'monthly',2000,'MYR','QA denied command');
  raise exception 'Legacy profile command unexpectedly authorized';
 exception when insufficient_privilege then null;end;
 begin
  perform public.payroll_lindung_setup_preview(profile.id,date_trunc('month',current_date)::date,'{}',false);
  raise exception 'Legacy statutory command unexpectedly authorized';
 exception when insufficient_privilege then null;end;
 begin
  perform public.payroll_run_create(entity,null,null,'QA denied command',null);
  raise exception 'Legacy prepare command unexpectedly authorized';
 exception when insufficient_privilege then null;end;
 -- Narrow scope still blocks entity mutations even with the precise grant.
 insert into public.role_permissions select test_role_id,id from public.permissions where code='payroll.prepare';
 update public.roles r set outlet_access_type='none' where r.id=test_role_id;
 if public.payroll_can_manage_entity(entity,'payroll.prepare') then raise exception 'Entity scope broadened';end if;
 delete from public.role_permissions rp where rp.role_id=test_role_id;
 update public.roles r set outlet_access_type='all' where r.id=test_role_id;
 -- Canonical role save/read-back and obsolete-code rejection.
 select e.auth_user_id into owner_uid from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 perform set_config('request.jwt.claim.sub',owner_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true);
 select array_agg('payroll.'||a order by a) into expected from unnest(actions) a;
 expected:=array['payroll.view']||expected;
 saved:=public.save_role_configuration(gen_random_uuid(),jsonb_build_object('id',test_role_id,'name','payroll_split_qa_transaction','description','Rollback-only Payroll authority contract','outlet_access_type','all'),expected,'{}');
 if (select array_agg(p.code order by p.code) from role_permissions rp join permissions p on p.id=rp.permission_id where rp.role_id=test_role_id) is distinct from (select array_agg(x order by x) from unnest(expected) x) then raise exception 'Canonical role save/read-back differs';end if;
 begin
  perform public.save_role_configuration(gen_random_uuid(),jsonb_build_object('id',test_role_id,'name','payroll_split_qa_transaction','outlet_access_type','all'),array['payroll.view','payroll.manage'],'{}');
  raise exception 'Retired Manage accepted';
 exception when invalid_parameter_value then null;end;
end $test$;
select 'PASS: independent grants/revocation, legacy denial, preserved scope, canonical role save/read-back' result;
rollback;
