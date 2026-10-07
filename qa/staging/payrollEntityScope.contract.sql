-- Staging-only, rollback-only contract. Run with the approved labelled QA role
-- temporarily holding payroll.view/payroll.finalize and All Outlets scope.
begin;
do $$
declare
  qa_auth uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  owner_auth uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  entity uuid := 'f5e7dade-80ce-44fe-8110-80cb1f045b29';
  run uuid := '305a804a-404f-4b33-858f-8417fab6c473';
  qa_role jsonb; codes text[]; owner_history jsonb; finance_history jsonb;
  frozen_before text; frozen_after text; denied boolean;
begin
  select to_jsonb(r) into qa_role from roles r where name='crew_admin_qa';
  assert qa_role is not null, 'Labelled Staging QA role missing';
  select array_agg(p.code order by p.code) into codes from permissions p
    join role_permissions rp on rp.permission_id=p.id where rp.role_id=(qa_role->>'id')::uuid;
  assert 'payroll.view'=any(codes) and not ('payroll.manage'=any(codes)), 'Unexpected QA permissions';
  select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by s.run_id,s.employee_id),''))
    into frozen_before from payroll_run_calculation_snapshots s;
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  owner_history:=payroll_run_history_read(entity);
  assert jsonb_array_length(owner_history)>0, 'Existing QA Run missing';
  perform set_config('request.jwt.claim.sub',qa_auth::text,true);
  assert payroll_can_manage_entity(entity,'payroll.view'), 'Permission + All Outlets rejected';
  assert payroll_can_manage_entity(entity,'payroll.finalize'), 'Explicit finalize permission rejected';
  assert not payroll_can_manage_entity(entity,'payroll.manage'), 'Finalize implied manage';
  assert not payroll_can_manage_entity(gen_random_uuid(),'payroll.view'), 'Unknown entity accepted';
  finance_history:=payroll_run_history_read(entity);
  assert finance_history=owner_history, 'Finance history differs from Owner';
  perform payroll_run_evidence_read(run);
  assert exists(select 1 from jsonb_array_elements(payroll_foundation_read()->'periods') p
    where p->>'legal_entity_id'=entity::text), 'Foundation period hidden';
  assert not has_function_privilege('authenticated','payroll_can_manage_entity(uuid,text)','execute'), 'Private helper exposed';
  assert not has_function_privilege('anon','payroll_run_history_read(uuid)','execute'), 'Anonymous history grant';

  -- Scope-negative control through the canonical Role save; transaction rolls back.
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform save_role_configuration(gen_random_uuid(),qa_role||jsonb_build_object('outlet_access_type','selected'),
    codes,array['49fe2aa7-fc6e-41f1-85cf-3bb8d34a87ba'::uuid]);
  perform set_config('request.jwt.claim.sub',qa_auth::text,true);
  assert not payroll_can_manage_entity(entity,'payroll.view'), 'Partial-outlet entity aggregate exposed';
  denied:=false;
  begin perform payroll_run_history_read(entity); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Scoped history did not deny';

  -- Permission-negative control, retaining All Outlets scope.
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform save_role_configuration(gen_random_uuid(),qa_role||jsonb_build_object('outlet_access_type','all'),
    array_remove(array_remove(codes,'payroll.view'),'payroll.finalize'),array[]::uuid[]);
  perform set_config('request.jwt.claim.sub',qa_auth::text,true);
  assert not payroll_can_manage_entity(entity,'payroll.view'), 'All Outlets implied Payroll permission';
  denied:=false;
  begin perform payroll_run_history_read(entity); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Unprivileged history did not deny';
  perform set_config('request.jwt.claim.sub','',true);
  denied:=false;
  begin perform payroll_run_history_read(entity); exception when insufficient_privilege then denied:=true; end;
  assert denied, 'Unsigned history accepted';
  select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by s.run_id,s.employee_id),''))
    into frozen_after from payroll_run_calculation_snapshots s;
  assert frozen_before=frozen_after, 'Frozen evidence changed';
end $$;
rollback;
