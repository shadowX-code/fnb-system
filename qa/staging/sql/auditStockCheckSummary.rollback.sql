-- Staging only. Synthetic quantities reproduce the 147/9/0 split without copying Production rows.
begin;

do $$
declare
  v_actor uuid;
  v_outlet uuid := gen_random_uuid();
  v_other_outlet uuid := gen_random_uuid();
  v_audit uuid := gen_random_uuid();
  v_edge_audit uuid := gen_random_uuid();
  v_other_audit uuid := gen_random_uuid();
  v_reader uuid := gen_random_uuid();
  v_role uuid := gen_random_uuid();
  v_items uuid[];
begin
  for v_actor in
    select employee.auth_user_id from public.employees employee
    join public.roles role on role.id=employee.role_id
    where lower(role.name) in ('owner','admin') and employee.auth_user_id is not null
  loop
    perform set_config('request.jwt.claim.sub',v_actor::text,true);
    exit when public.current_user_has_all_outlet_access();
  end loop;
  if not public.current_user_has_all_outlet_access() then
    raise exception 'An existing full-scope Staging actor is required for the rollback fixture.';
  end if;

  insert into public.outlets(id,name,code) values
    (v_outlet, 'QA Audit Summary', 'QAS' || left(v_outlet::text,6)),
    (v_other_outlet, 'QA Restricted Audit', 'QAS' || left(v_other_outlet::text,6));

  with fixtures as (
    insert into public.inventory_items(item_name,unit)
    select 'QA audit item ' || n, 'kg' from generate_series(1,242) n
    returning id
  )
  select array_agg(id order by id) into v_items from fixtures;

  insert into public.inventory_stock_checks(id,outlet_id,stock_check_type,audit_type,check_date,status)
  values (v_audit,v_outlet,'audit','Month-End Closing',date '2026-11-02','draft'),
         (v_edge_audit,v_outlet,'audit','Spot Check',date '2026-11-02','draft'),
         (v_other_audit,v_other_outlet,'audit','Spot Check',date '2026-11-02','draft');

  insert into public.inventory_stock_check_items(stock_check_id,item_id,actual_count_quantity,par_level_quantity,variance,unit,status,skipped)
  select v_audit, item_id, case when n <= 147 then 0 when n <= 156 then 2.002 else 1.001 end, 1.001,
    case when n <= 147 then -1.001 when n <= 156 then 1.001 else 0 end, 'kg', 'normal', false
  from unnest(v_items) with ordinality item(item_id,n);

  insert into public.inventory_stock_check_items(stock_check_id,item_id,actual_count_quantity,par_level_quantity,variance,unit,status,skipped)
  select v_edge_audit,v_items[n], actual, par, stored_variance, 'kg', status, skipped
  from (values
    (1, 0::numeric, 0.001::numeric, 1::numeric, 'normal', false),
    (2, 0.002, 0.001, -1, 'normal', false),
    (3, null, 1, 10, 'normal', false),
    (4, 1, null, 10, 'normal', false),
    (5, 0, 1, 10, 'normal', true),
    (6, 0, 1, 10, 'skipped', false),
    (7, 0, 1, 10, 'na', false),
    (8, 0, 1, 10, 'pending', false),
    (9, -1, 1, 10, 'normal', false)
  ) edge(n,actual,par,stored_variance,status,skipped);

  update public.inventory_stock_checks set status='submitted',submitted_at=now() where id in(v_audit,v_edge_audit,v_other_audit);

  insert into auth.users(id,email,aud,role)
    values(v_reader,'inventory-audit-summary-' || v_reader || '@example.invalid','authenticated','authenticated');
  insert into public.roles(id,name,is_active,outlet_access_type) values(v_role,'QA summary ' || v_role,true,'selected');
  insert into public.role_permissions(role_id,permission_id)
    select v_role,id from public.permissions where code='inventory_stock_check.view';
  insert into public.role_outlets(role_id,outlet_id) values(v_role,v_outlet);
  insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
    values(gen_random_uuid(),v_reader,'QA Audit Summary Reader','inventory-audit-summary-' || v_reader || '@example.invalid',
      v_role,true,'active',true,'Management');
  perform set_config('request.jwt.claim.sub',v_reader::text,true);
  perform set_config('audit_summary_qa.audit',v_audit::text,true);
  perform set_config('audit_summary_qa.edge',v_edge_audit::text,true);
  perform set_config('audit_summary_qa.denied',v_other_audit::text,true);
end;
$$;

set local role authenticated;
do $$
declare
  v_audit uuid := current_setting('audit_summary_qa.audit')::uuid;
  v_edge uuid := current_setting('audit_summary_qa.edge')::uuid;
  v_denied uuid := current_setting('audit_summary_qa.denied')::uuid;
  v_result jsonb;
  v_split jsonb;
begin
  v_result := public.inventory_stock_check_row_summaries(array[v_audit,v_edge,v_audit]);
  if (v_result->>'check_count')::integer is distinct from 2 then
    raise exception 'Unexpected scoped result: %',v_result;
  end if;
  select value into v_split from jsonb_array_elements(v_result->'summaries') where value->>'check_id'=v_audit::text;
  if v_split - 'check_id' is distinct from '{"total":242,"shortage":147,"excess":9,"skipped":0}'::jsonb then
    raise exception 'Wrong 242-row split: %',v_split;
  end if;
  select value into v_split from jsonb_array_elements(v_result->'summaries') where value->>'check_id'=v_edge::text;
  if v_split - 'check_id' is distinct from '{"total":9,"shortage":1,"excess":1,"skipped":2}'::jsonb then
    raise exception 'Wrong edge-case split: %',v_split;
  end if;
  begin
    perform public.inventory_stock_check_row_summaries(array[v_audit,v_denied]);
    raise exception 'Unauthorized audit scope was accepted.';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.inventory_stock_check_row_summaries(array[v_audit]);
    raise exception 'Unprivileged reader obtained audit summaries.';
  exception when insufficient_privilege then null; end;
end;
$$;

rollback;
select 'PASS: 242 items / 147 shortage / 9 excess / 0 skipped, edge quantities, role and outlet scope' as result;
