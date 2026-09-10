-- Executed after the migration within a transaction and always rolled back.
do $$
declare
  recorder public.employees%rowtype; verifier public.employees%rowtype; inside_location public.factory_storage_locations%rowtype; outside_location public.factory_storage_locations%rowtype;
  qa_date date := current_date + 149; daily jsonb; monthly jsonb; self_blocked boolean := false; immutable_blocked boolean := false; requirement jsonb;
begin
  select * into recorder from public.employees where auth_user_id is not null and is_active and coalesce(employment_status,'active')='active' order by created_at limit 1;
  select * into verifier from public.employees where auth_user_id is not null and is_active and coalesce(employment_status,'active')='active' and id<>recorder.id order by created_at desc limit 1;
  select * into inside_location from public.factory_storage_locations where status='active' order by location_name limit 1;
  select * into outside_location from public.factory_storage_locations where status='active' and id<>inside_location.id order by location_name limit 1;
  if recorder.id is null or verifier.id is null or inside_location.id is null or outside_location.id is null then raise exception 'FAIL staging needs two authenticated employees and two active Factory Locations.'; end if;
  insert into public.role_permissions(role_id,permission_id) select role_id,permission.id from (values(recorder.role_id),(verifier.role_id)) roles(role_id) cross join public.permissions permission where permission.code like 'factory_mesti_waste_disposal.%' on conflict do nothing;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',recorder.auth_user_id,'role','authenticated')::text,true); execute 'set local role authenticated';
  requirement := public.factory_save_mesti_waste_disposal_requirement(jsonb_build_object('location_id',inside_location.id,'required_count',2,'effective_from',qa_date,'status','active'));
  if coalesce((public.factory_save_mesti_waste_disposal_requirement(requirement))->>'version_created','true') <> 'false' then raise exception 'FAIL unchanged requirement created a version.'; end if;
  perform public.factory_save_mesti_waste_disposal_requirement(jsonb_build_object('location_id',outside_location.id,'required_count',1,'effective_from',qa_date,'status','active'));
  perform public.factory_mesti_waste_disposal_record(qa_date,jsonb_build_object('location_id',inside_location.id,'disposed_at',qa_date::text||'T10:20:00+08:00','remarks','Rollback QA one'));
  perform public.factory_mesti_waste_disposal_record(qa_date,jsonb_build_object('location_id',inside_location.id,'disposed_at',qa_date::text||'T16:35:00+08:00'));
  perform public.factory_mesti_waste_disposal_record(qa_date,jsonb_build_object('location_id',inside_location.id,'disposed_at',qa_date::text||'T18:00:00+08:00'));
  daily := public.factory_mesti_waste_disposal_daily(qa_date);
  if not exists (select 1 from jsonb_array_elements(daily->'locations') location where location->>'location_id'=inside_location.id::text and location->>'completed_count'='3' and location->>'required_count'='2') then raise exception 'FAIL expected 3/2 completed events.'; end if;
  perform public.factory_mesti_waste_disposal_submit(qa_date);
  begin perform public.factory_mesti_waste_disposal_record(qa_date,jsonb_build_object('location_id',inside_location.id)); exception when others then if sqlerrm like '%immutable%' then immutable_blocked:=true; else raise; end if; end;
  if not immutable_blocked then raise exception 'FAIL submitted disposal session remained editable.'; end if;
  begin perform public.factory_mesti_waste_disposal_verify(qa_date); exception when others then if sqlerrm like '%Self-verification%' then self_blocked:=true; else raise; end if; end;
  if not self_blocked then raise exception 'FAIL self-verification was not blocked.'; end if;
  execute 'reset role'; perform set_config('request.jwt.claims',jsonb_build_object('sub',verifier.auth_user_id,'role','authenticated')::text,true); execute 'set local role authenticated';
  perform public.factory_mesti_waste_disposal_verify(qa_date);
  select row into monthly from public.factory_mesti_waste_disposal_monthly(date_trunc('month',qa_date)::date) row where row->>'location_id'=inside_location.id::text;
  if monthly->'days'->qa_date::text->>'state' <> 'verified_compliant' or monthly->'days'->qa_date::text->>'completed_count' <> '3' then raise exception 'FAIL Location monthly evidence is missing 3/2 verified compliance.'; end if;
  execute 'reset role';
end $$;
select 'PASS factory_mesti_waste_disposal_lifecycle_staging' as result;
