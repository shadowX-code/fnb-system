-- Executed after the migration inside a transaction and always rolled back.
do $$
declare
  recorder public.employees%rowtype; verifier public.employees%rowtype; supplier public.factory_suppliers%rowtype; location public.factory_storage_locations%rowtype;
  material_id uuid; batch jsonb; verified jsonb; report jsonb; self_blocked boolean := false;
begin
  select * into recorder from public.employees where auth_user_id is not null and is_active and coalesce(employment_status,'active')='active' order by created_at limit 1;
  select * into verifier from public.employees where auth_user_id is not null and is_active and coalesce(employment_status,'active')='active' and id<>recorder.id order by created_at desc limit 1;
  select * into supplier from public.factory_suppliers where status='active' order by created_at limit 1;
  select * into location from public.factory_storage_locations where status='active' and is_storage_location is not false order by created_at limit 1;
  if recorder.id is null or verifier.id is null or supplier.id is null or location.id is null then raise exception 'FAIL staging needs two authenticated employees, an active Supplier and storage Location.'; end if;
  insert into public.role_permissions(role_id,permission_id)
  select roles.role_id, permission.id from (values(recorder.role_id),(verifier.role_id)) roles(role_id) cross join public.permissions permission
  where permission.code in ('factory_raw_receiving.create','factory_raw_receiving.edit','factory_raw_receiving.view','factory_raw_receiving.verify') on conflict do nothing;
  insert into public.factory_raw_materials(material_code,name,name_en,category_id,category,uom,acceptance_procedure,control_methods,status,current_balance,created_by)
  select 'QA-RMC-' || substr(replace(gen_random_uuid()::text,'-',''),1,8),'QA Raw Material Control','QA Raw Material Control',category.id,category.name,'pack','QA acceptance snapshot','QA control snapshot','active',0,recorder.id
  from public.factory_raw_material_categories category order by category.created_at limit 1 returning id into material_id;
  if material_id is null then raise exception 'FAIL staging needs a Raw Material category.'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',recorder.auth_user_id,'role','authenticated')::text,true); execute 'set local role authenticated';
  batch := public.factory_save_raw_material_receiving(null,gen_random_uuid(),supplier.id,'QA-RMC',current_date + 151,'Rollback QA',jsonb_build_array(jsonb_build_object('raw_material_id',material_id,'received_qty',2,'uom','pack','storage_location_id',location.id,'expiry_source','not_applicable','expiry_confirmed',true)),true);
  if batch->>'verification_status' <> 'awaiting_verification' or batch->'items'->0->>'acceptance_procedure_snapshot' <> 'QA acceptance snapshot' then raise exception 'FAIL receiving completion did not snapshot standards or await verification.'; end if;
  begin perform public.factory_verify_raw_material_receiving((batch->>'id')::uuid); exception when others then if sqlerrm like '%cannot verify%' then self_blocked := true; else raise; end if; end;
  if not self_blocked then raise exception 'FAIL receiving actor self-verification was not blocked.'; end if;
  execute 'reset role'; update public.factory_raw_materials set acceptance_procedure='Changed later',control_methods='Changed later' where id=material_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',verifier.auth_user_id,'role','authenticated')::text,true); execute 'set local role authenticated';
  verified := public.factory_verify_raw_material_receiving((batch->>'id')::uuid);
  if verified->>'verification_status' <> 'verified' or nullif(verified->>'verified_by','') is null then raise exception 'FAIL cross-user verification evidence missing.'; end if;
  if (public.factory_verify_raw_material_receiving((batch->>'id')::uuid))->>'verified_by' <> verified->>'verified_by' then raise exception 'FAIL verify retry was not idempotent.'; end if;
  select value into report from jsonb_array_elements(public.factory_mesti_raw_material_control_receiving_report(current_date + 151,current_date + 151,material_id,null,location.id,'verified','QA-RMC')) value limit 1;
  if report->>'acceptance_procedure_snapshot' <> 'QA acceptance snapshot' or report->>'control_methods_snapshot' <> 'QA control snapshot' or report->>'verified_by_name' = '' then raise exception 'FAIL read-only receiving report did not retain snapshot or verifier.'; end if;
  execute 'reset role';
end $$;
select 'PASS factory_mesti_raw_material_control_lifecycle_staging' as result;
