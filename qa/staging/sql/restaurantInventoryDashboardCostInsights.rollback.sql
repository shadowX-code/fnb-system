-- Run only against the verified Staging database. All fixtures roll back.
begin;

do $$
declare
  v_actor uuid;
  v_reader uuid := gen_random_uuid();
  v_role uuid := gen_random_uuid();
  v_outlet uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_up uuid := gen_random_uuid();
  v_down uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_configured uuid := gen_random_uuid();
  v_baseline uuid := gen_random_uuid();
  v_previous uuid;
  v_latest uuid;
  v_today date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_summary jsonb;
begin
  for v_actor in select e.auth_user_id from public.employees e join public.roles r on r.id = e.role_id
    where lower(r.name) in ('owner', 'admin') and e.auth_user_id is not null
  loop
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    exit when public.current_user_has_all_outlet_access()
      and public.current_user_has_permission('inventory_dashboard.view')
      and public.current_user_has_permission('inventory_master.edit');
  end loop;

  insert into public.outlets(id, name, code) values
    (v_outlet, 'QA Dashboard Scope', 'QAD' || left(v_outlet::text, 6)),
    (v_other, 'QA Dashboard Other', 'QAD' || left(v_other::text, 6));
  insert into public.inventory_items(id, item_name, unit) values
    (v_up, 'QA Up', 'kg'), (v_down, 'QA Down', 'kg'),
    (v_missing, 'QA Missing', 'kg'), (v_configured, 'QA First Configured', 'kg');
  insert into public.inventory_item_outlets(outlet_id, inventory_item_id, par_level) values
    (v_outlet, v_up, 10), (v_other, v_up, 10), (v_outlet, v_down, 10),
    (v_outlet, v_missing, 10), (v_outlet, v_configured, 10);

  insert into inventory_authority.item_cost_revisions(id, item_id, revision_number, unit_cost, unit, reason, recorded_at)
    values (v_baseline, v_up, 1, 0, 'kg', 'Existing configured cost', now() - interval '90 days');
  update public.inventory_items set cost_revision_id = v_baseline, cost_updated_at = now() - interval '90 days' where id = v_up;
  v_previous := (public.inventory_master_revise_cost(v_up, 2, 'kg', v_today - 30, 'Opening cost', gen_random_uuid(), v_baseline)->>'current_revision_id')::uuid;
  v_latest := (public.inventory_master_revise_cost(v_up, 8, 'kg', v_today - 5, 'First quote', gen_random_uuid(), v_previous)->>'current_revision_id')::uuid;
  perform public.inventory_master_revise_cost(v_up, 5, 'kg', v_today - 5, 'Corrected quote', gen_random_uuid(), v_latest, v_latest);
  v_previous := (public.inventory_master_revise_cost(v_down, 4, 'kg', v_today - 28, 'First quote', gen_random_uuid(), null)->>'current_revision_id')::uuid;
  perform public.inventory_master_revise_cost(v_down, 0, 'kg', v_today - 3, 'Valid zero', gen_random_uuid(), v_previous);
  perform public.inventory_master_revise_cost(v_configured, 10, 'kg', v_today - 1, 'First cost', gen_random_uuid(), null);

  v_summary := public.inventory_dashboard_cost_insights(array[v_outlet, v_other, v_outlet]);
  if (v_summary->>'start_date')::date is distinct from v_today - 29
    or (v_summary->>'increases')::int is distinct from 1
    or (v_summary->>'decreases')::int is distinct from 1
    or (v_summary->>'missing_costs')::int is distinct from 1
    or (v_summary->'largest_increase'->>'delta')::numeric is distinct from 3
    or jsonb_array_length(v_summary->'top_changes') is distinct from 2
    or (v_summary->'top_changes'->0->>'item_id')::uuid is distinct from v_down
    or (v_summary->'top_changes'->0->>'unit_cost')::numeric is distinct from 0 then
    raise exception 'Date window, zero, ranking, correction, first price or deduplication failed: %', v_summary;
  end if;

  insert into auth.users(id, email, aud, role)
    values(v_reader, 'inventory-dashboard-' || v_reader || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.roles(id, name, is_active, outlet_access_type) values(v_role, 'QA dashboard ' || v_role, true, 'selected');
  insert into public.role_permissions(role_id, permission_id)
    select v_role, id from public.permissions where code in ('inventory_dashboard.view', 'inventory_master.view');
  insert into public.role_outlets(role_id, outlet_id) values(v_role, v_other);
  insert into public.employees(id, auth_user_id, full_name, email, role_id, enable_system_login, access_state, is_active, workplace)
    values(gen_random_uuid(), v_reader, 'QA Dashboard Reader', 'inventory-dashboard-' || v_reader || '@example.invalid',
      v_role, true, 'active', true, 'Management');
  perform set_config('request.jwt.claim.sub', v_reader::text, true);
  perform set_config('dashboard_qa.allowed', v_other::text, true);
  perform set_config('dashboard_qa.denied', v_outlet::text, true);
end;
$$;

set local role authenticated;
do $$
declare v_allowed uuid := current_setting('dashboard_qa.allowed')::uuid;
  v_denied uuid := current_setting('dashboard_qa.denied')::uuid;
  v_summary jsonb;
begin
  v_summary := public.inventory_dashboard_cost_insights(array[v_allowed]);
  if (v_summary->>'increases')::int is distinct from 1
    or (v_summary->>'decreases')::int is distinct from 0
    or (v_summary->>'missing_costs')::int is distinct from 0 then
    raise exception 'Scoped reader received the other outlet''s cost data.';
  end if;
  begin
    perform public.inventory_dashboard_cost_insights(array[v_allowed,v_denied]);
    raise exception 'Mixed unauthorized scope was accepted.';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.inventory_dashboard_cost_insights(array[v_allowed]);
    raise exception 'Unprivileged reader obtained cost data.';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.inventory_dashboard_cost_insights(uuid[])','EXECUTE') then
    raise exception 'Anonymous role can execute Dashboard cost read.';
  end if;
end;
$$;

rollback;
select 'PASS: 30-day costs, corrections, zero, configuration, deduplication and access' as result;
