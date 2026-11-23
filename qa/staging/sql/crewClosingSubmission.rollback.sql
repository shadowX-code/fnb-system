-- Staging-only reproduction of the 243-item September closing. All fixtures roll back.
begin;

do $$
declare
  v_hliph uuid := (select id from public.outlets where code = 'HLIPH');
  v_outlet uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
  v_actor uuid;
  v_candidate uuid;
  v_item uuid;
  v_lines jsonb;
  v_line jsonb;
  v_draft jsonb;
  v_saved jsonb;
  v_retry jsonb;
  v_context jsonb;
  v_summary jsonb;
  v_check_id uuid;
  v_request uuid := gen_random_uuid();
  v_payload jsonb := jsonb_build_object('outlet_id', v_outlet, 'stock_check_type', 'audit', 'audit_type', 'Month-End Closing',
    'accounting_month', '2026-09-01', 'status', 'draft');
begin
  if v_hliph is null then raise exception 'Expected the Staging HLIPH outlet'; end if;
  insert into public.outlets(id, name, code)
  values(v_outlet, 'QA HLIPH September closing', 'QAH' || left(v_outlet::text, 6));

  with items as (
    insert into public.inventory_items(item_name, unit)
    select 'QA Crew Closing Item ' || n, 'kg' from generate_series(1, 243) n returning id
  )
  insert into public.inventory_item_outlets(outlet_id, inventory_item_id, par_level)
  select v_outlet, id, 10 from items;

  select jsonb_agg(jsonb_build_object('item_id', inventory_item_id, 'unit', 'kg', 'actual_count_quantity', 0,
    'par_level_quantity', 10) order by inventory_item_id)
  into v_lines from public.inventory_item_outlets where outlet_id = v_outlet;
  v_item := (v_lines->0->>'item_id')::uuid;

  for v_candidate in
    select e.auth_user_id from public.employees e join public.roles r on r.id = e.role_id
    where lower(r.name) in ('owner', 'admin') and e.auth_user_id is not null and e.is_active
  loop
    perform set_config('request.jwt.claim.sub', v_candidate::text, true);
    if public.current_user_has_permission('inventory_stock_check.approve')
      and public.current_user_can_access_outlet(v_outlet) then
      v_actor := v_candidate;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'Expected a scoped Staging Admin'; end if;
  perform public.inventory_master_revise_cost(v_item, 2.5, 'kg', '2026-09-01',
    'QA standard cost', gen_random_uuid(), null);

  insert into public.employees(id, full_name, workplace)
  values(v_employee, 'QA rollback Crew Closing', (select code from public.outlets where id = v_outlet));
  insert into public.crew_access(employee_id, mobile_number, passcode_hash, primary_outlet_id, can_create_audit_stock_check)
  values(v_employee, '60' || translate(left(v_employee::text, 8), 'abcdef', '012345'), 'rollback-only', v_outlet, true);
  insert into public.crew_sessions(employee_id, token_hash, expires_at)
  values(v_employee, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '5 minutes');

  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  v_draft := public.crew_inventory_save_stock_check(v_token, v_outlet, gen_random_uuid(), v_payload, v_lines);
  v_check_id := (v_draft->'check'->>'id')::uuid;
  if v_draft->'check'->>'status' is distinct from 'draft' or jsonb_array_length(v_draft->'items') <> 243 then
    raise exception 'Crew draft or row count was incorrect';
  end if;
  v_payload := v_payload || jsonb_build_object('id', v_check_id, 'status', 'submitted');
  foreach v_line in array array[v_lines - 0, jsonb_set(v_lines, '{0,skipped}', 'true')] loop
    begin
      perform public.crew_inventory_save_stock_check(v_token, v_outlet, gen_random_uuid(), v_payload, v_line);
      raise exception 'Invalid roster or skip accepted';
    exception when raise_exception then
      if sqlerrm not like 'Closing counts must%' and sqlerrm not like 'Enter an explicit%' then raise; end if;
    end;
  end loop;
  begin
    perform public.crew_inventory_save_stock_check(v_token, v_outlet, gen_random_uuid(),
      v_payload || '{"publish_closing":true}', v_lines);
    raise exception 'Crew publication intent was accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'Only an authorized Admin can publish Closing Stock.' then raise; end if;
  end;
  if (public.crew_inventory_stock_checks(v_token, v_outlet, v_check_id)#>>'{detail,status}') is distinct from 'draft' then
    raise exception 'Failed submissions changed the draft state';
  end if;
  v_saved := public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_payload, v_lines);
  v_retry := public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_payload, v_lines);
  if v_retry is distinct from v_saved or v_saved#>>'{check,status}' is distinct from 'submitted'
    or v_saved#>>'{check,submitted_at}' is null or v_saved#>>'{check,submitted_by}' is distinct from v_employee::text
    or jsonb_array_length(v_saved#>'{check,closing_item_ids}') <> 243 or v_saved ? 'closing' then
    raise exception 'Crew did not persist immutable submitted evidence without a publication';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_saved->'items') line
    where line->>'item_id' = v_item::text and line->>'unit' = 'kg'
      and (line->>'actual_count_quantity')::numeric = 0 and (line->>'unit_cost_snapshot')::numeric = 2.5) then
    raise exception 'Crew submission did not pin the expected quantity, cost and unit';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.crew_inventory_stock_check_history(
    v_token, v_outlet, null, 'completed', 0, 20)->'rows') row where row->>'id' = v_check_id::text) then
    raise exception 'Submitted count is absent from Crew History';
  end if;
  execute 'reset role';
  if exists (select 1 from inventory_authority.closing_stock_revisions where outlet_id = v_outlet) then
    raise exception 'Crew submission created a Closing Stock revision';
  end if;
  if (select status from public.inventory_stock_checks where id = v_check_id) is distinct from 'submitted' then
    raise exception 'Persisted status is not submitted';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  v_summary := public.inventory_stock_check_row_summaries(array[v_check_id]);
  v_context := public.inventory_closing_context(v_check_id);
  if (v_summary#>>'{summaries,0,total}')::int is distinct from 243
    or v_context->'published' is distinct from 'null'::jsonb then
    raise exception 'Admin could not read the submitted unpublished audit';
  end if;
  v_context := public.inventory_publish_existing_closing(v_check_id, gen_random_uuid());
  if v_context->>'valuation_status' is distinct from 'partial'
    or (v_context->>'total_item_count')::int is distinct from 243
    or (v_context->>'valued_item_count')::int is distinct from 1
    or (v_context->>'amount')::numeric is distinct from 0 then
    raise exception 'Admin did not retain the authorized publication workflow';
  end if;
  execute 'reset role';
end;
$$;

rollback;
select 'PASS: 243-item Crew draft, validation, submission, history, pinned evidence and Admin-only publication' as result;
