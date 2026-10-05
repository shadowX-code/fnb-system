-- Read-only Staging contracts; no fixture creation or Payroll decisions.
begin read only;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare id uuid; b jsonb; c jsonb; s jsonb; before_hash text; after_hash text; denied boolean;
begin
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.run_id,x.employee_id),'')) into before_hash from payroll_run_calculation_snapshots x;
 foreach id in array array['67af6562-bef5-43e7-80b0-93387c2ceb87'::uuid,
  '9d18c7a7-ef4a-45ff-a723-711b845ddf5c'::uuid,'305a804a-404f-4b33-858f-8417fab6c473'::uuid] loop
  b:=payroll_run_evidence_read(id); c:=payroll_run_calculation_read(id); s:=payroll_run_statutory_read(id);
  assert b->'preparation'=payroll_run_preparation_read(id),'Preparation/membership changed';
  assert b->'calculation'=c,'Calculation evidence changed';
  assert b->'statutory'=s,'Statutory evidence changed';
  assert b->'readiness'->'time'=payroll_run_time_readiness(id),'Time gates changed';
  assert b->'readiness'->'calculation'=payroll_run_calculation_readiness(id),'Calculation gates changed';
  assert b->'readiness'->'statutory'=payroll_run_statutory_readiness(id),'Statutory gates changed';
 end loop;
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.run_id,x.employee_id),'')) into after_hash from payroll_run_calculation_snapshots x;
 assert before_hash=after_hash,'Frozen snapshots changed';
 assert not has_function_privilege('anon','payroll_run_evidence_read(uuid)','execute'),'Anonymous grant';
 perform set_config('request.jwt.claim.sub','',true); denied:=false;
 begin perform payroll_run_evidence_read(id); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Unsigned access accepted';
 perform set_config('request.jwt.claim.sub','df540974-8945-46b2-8186-8699de24c14c',true); denied:=false;
 begin perform payroll_run_evidence_read(id); exception when insufficient_privilege then denied:=true; end;
 assert denied,'Unprivileged access accepted';
end $$;
rollback;
