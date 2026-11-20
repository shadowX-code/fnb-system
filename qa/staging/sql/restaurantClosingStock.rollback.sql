-- Run against the verified FeedX Staging database. All fixtures roll back.
begin;

do $$
declare
  v_actor uuid;
  v_candidate uuid;
  v_outlet uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_item2 uuid := gen_random_uuid();
begin
  insert into public.outlets(id, name, code) values
    (v_outlet, 'QA Closing Stock', 'QAC' || left(v_outlet::text, 6)),
    (v_other, 'QA Closing Stock Zero', 'QAC' || left(v_other::text, 6));
  insert into public.inventory_items(id, item_name, unit) values
    (v_item, 'QA Closing Item', 'kg'),
    (v_item2, 'QA Closing Item Two', 'kg');
  insert into public.inventory_item_outlets(outlet_id, inventory_item_id, par_level) values
    (v_outlet, v_item, 10), (v_outlet, v_item2, 10), (v_other, v_item, 10);

  for v_candidate in (
    select e.auth_user_id from public.employees e join public.roles r on r.id = e.role_id
      where lower(r.name) in ('owner','admin') and e.auth_user_id is not null
    union
    select p.id from public.user_profiles p join public.roles r on r.id = p.role_id
      where lower(r.name) in ('owner','admin')
  ) loop
    perform set_config('request.jwt.claim.sub', v_candidate::text, true);
    if public.current_user_has_permission('inventory_stock_check.approve')
      and public.current_user_has_permission('outlet_pnl.view')
      and public.current_user_can_access_outlet(v_outlet) and public.current_user_can_access_outlet(v_other) then
      v_actor := v_candidate;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'No existing Staging approver has access to the isolated fixture outlets'; end if;
  perform set_config('closing_qa.actor', v_actor::text, true);
  perform set_config('closing_qa.outlet', v_outlet::text, true);
  perform set_config('closing_qa.other', v_other::text, true);
  perform set_config('closing_qa.item', v_item::text, true);
  perform set_config('closing_qa.item2', v_item2::text, true);
end;
$$;

set local role authenticated;

do $$
declare
  v_outlet uuid := current_setting('closing_qa.outlet')::uuid;
  v_other uuid := current_setting('closing_qa.other')::uuid;
  v_item uuid := current_setting('closing_qa.item')::uuid;
  v_item2 uuid := current_setting('closing_qa.item2')::uuid;
  v_check jsonb := jsonb_build_object(
    'outlet_id', v_outlet, 'stock_check_type', 'audit', 'audit_type', 'Month-End Closing',
    'audit_name', 'QA Closing Audit', 'status', 'submitted', 'check_date', '2001-08-31',
    'accounting_month', '2001-08-01', 'physical_count_cutoff', '2001-08-31T23:00:00+08:00'
  );
  v_item_line jsonb := jsonb_build_object('item_id', v_item, 'unit', 'kg', 'par_level_quantity', 10, 'actual_count_quantity', 0);
  v_second_line jsonb := jsonb_build_object('item_id', v_item2, 'unit', 'kg', 'actual_count_quantity', 3);
  v_lines jsonb := jsonb_build_array(v_item_line, v_second_line);
  v_reconciliation jsonb := jsonb_build_array(
    jsonb_build_object('item_id', v_item, 'month_end_quantity', 4, 'evidence', 'QA item cutoff worksheet'),
    jsonb_build_object('item_id', v_item2, 'month_end_quantity', 0, 'evidence', 'QA item cutoff worksheet')
  );
  v_before jsonb;
  v_saved jsonb;
  v_id uuid;
  v_close jsonb;
  v_after jsonb;
  v_revision jsonb;
  v_request uuid := gen_random_uuid();
  v_other_id uuid;
  v_late_id uuid;
  v_invalid jsonb;
begin
  if has_table_privilege(current_user, 'public.inventory_stock_checks', 'TRUNCATE') then
    raise exception 'Authenticated stock check truncate is allowed';
  end if;
  perform public.inventory_master_revise_cost(v_item, 2.5, 'kg', '2001-08-01',
    'QA opening unit cost', gen_random_uuid(), null);
  perform public.inventory_master_revise_cost(v_item2, 1, 'kg', '2001-08-01',
    'QA opening unit cost', gen_random_uuid(), null);
  v_before := public.reporting_monthly_scope_financials(v_outlet, 2001, 8);
  if v_before->>'closing_stock' is not null then raise exception 'Fixture starts with a published close'; end if;

  foreach v_invalid in array array[
    jsonb_build_array(v_item_line),
    jsonb_build_array(v_item_line, v_item_line),
    jsonb_build_array(v_item_line || '{"skipped":true}', v_second_line),
    jsonb_build_array(v_item_line || '{"actual_count_quantity":null}', v_second_line)
  ] loop
    begin
      perform public.inventory_save_stock_check(gen_random_uuid(), v_check, v_invalid);
      raise exception 'Invalid count accepted';
    exception when raise_exception then
      if sqlerrm not like 'Closing counts must%' and sqlerrm not like 'Enter an explicit%' then raise; end if;
    end;
  end loop;

  v_saved := public.inventory_save_stock_check(gen_random_uuid(), v_check || '{"status":"draft"}',
    jsonb_build_array(v_item_line || '{"actual_count_quantity":null}', v_second_line));
  v_id := (v_saved->'check'->>'id')::uuid;
  v_saved := public.inventory_save_stock_check(gen_random_uuid(), v_check || jsonb_build_object('id', v_id), v_lines);
  if not exists (select 1 from jsonb_array_elements(v_saved->'items') line
    where (line->>'item_id')::uuid = v_item and (line->>'unit_cost_snapshot')::numeric = 2.5
      and (line->>'actual_count_quantity')::numeric = 0) then
    raise exception 'Explicit zero or cost was lost';
  end if;
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(), v_check || jsonb_build_object('id', v_id), v_lines);
    raise exception 'Submitted audit was rewritten';
  exception when raise_exception then
    if sqlerrm <> 'Completed stock checks are immutable.' then raise; end if;
  end;
  begin
    perform public.inventory_approve_closing_stock(v_id, gen_random_uuid());
    raise exception 'Early count published without reconciliation';
  exception when raise_exception then
    if sqlerrm not like 'Enter a verified month-end quantity%' then raise; end if;
  end;
  v_close := public.inventory_approve_closing_stock(v_id, v_request, v_reconciliation);
  if (v_close->>'amount')::numeric is distinct from 10 or (v_close->>'revision')::int is distinct from 1
    or v_close is distinct from public.inventory_approve_closing_stock(v_id, v_request, v_reconciliation) then
    raise exception 'Incorrect published calculation or retry changed the revision';
  end if;
  begin
    perform public.inventory_approve_closing_stock(v_id, gen_random_uuid(), v_reconciliation);
    raise exception 'Duplicate initial publication accepted';
  exception when raise_exception then
    if sqlerrm not like 'The published close changed.%' then raise; end if;
  end;

  v_late_id := (public.inventory_save_stock_check(gen_random_uuid(),
    v_check || '{"physical_count_cutoff":"2001-09-02T12:00:00+08:00"}', v_lines)->'check'->>'id')::uuid;
  begin
    perform public.inventory_approve_closing_stock(v_late_id, gen_random_uuid(), '[]',
      (v_close->>'id')::uuid, 'QA cutoff correction');
    raise exception 'Late count published without reconciliation';
  exception when raise_exception then
    if sqlerrm not like 'Enter a verified month-end quantity%' then raise; end if;
  end;
  v_reconciliation := jsonb_set(v_reconciliation, '{0,month_end_quantity}', '2');
  v_revision := public.inventory_approve_closing_stock(v_late_id, gen_random_uuid(), v_reconciliation,
    (v_close->>'id')::uuid, 'QA cutoff correction');
  if (v_revision->>'revision')::int is distinct from 2 or (v_revision->>'amount')::numeric is distinct from 5 then
    raise exception 'Closing revision is incorrect';
  end if;
  if public.inventory_closing_context(v_id)->'published'->>'source_audit_id' is distinct from v_late_id::text then
    raise exception 'Stock Check context still shows the superseded publication';
  end if;

  v_after := public.reporting_monthly_scope_financials(v_outlet, 2001, 8);
  if (v_after->>'closing_stock')::numeric is distinct from 5 or v_after - 'closing_stock' <> v_before - 'closing_stock'
    or (public.reporting_yearly_scope_financials(v_outlet, 2001)->'months'->7->>'closing_stock')::numeric is distinct from 5 then
    raise exception 'Reporting did not surface the latest close independently of financial inputs';
  end if;
  perform public.inventory_master_revise_cost(v_item, 7, 'kg', '2001-09-01', 'QA revised unit cost',
    gen_random_uuid(), (public.inventory_master_cost_history(v_item)->>'current_revision_id')::uuid);
  if (select unit_cost_snapshot from public.inventory_stock_check_items where stock_check_id = v_id and item_id = v_item)
      is distinct from 2.5::numeric
    or (public.reporting_monthly_scope_financials(v_outlet, 2001, 8)->>'closing_stock')::numeric is distinct from 5 then
    raise exception 'Changing Master Inventory cost changed historical audit evidence or approved valuation';
  end if;
  if public.reporting_monthly_scope_financials(null, 2001, 8)->>'closing_stock' is not null then
    raise exception 'Partial All Outlets close was published';
  end if;

  v_other_id := (public.inventory_save_stock_check(gen_random_uuid(), v_check || jsonb_build_object(
    'outlet_id', v_other, 'physical_count_cutoff', '2001-09-01T00:00:00+08:00'
  ), jsonb_build_array(v_item_line))->'check'->>'id')::uuid;
  if (select unit_cost_snapshot from public.inventory_stock_check_items where stock_check_id = v_other_id and item_id = v_item)
      is distinct from 7::numeric then
    raise exception 'New Audit did not pin the current revised cost at submission';
  end if;
  v_close := public.inventory_approve_closing_stock(v_other_id, gen_random_uuid());
  if (v_close->>'amount')::numeric is distinct from 0
    or (public.reporting_monthly_scope_financials(v_other, 2001, 8)->>'closing_stock')::numeric is distinct from 0 then
    raise exception 'A legitimate zero was lost';
  end if;

  v_other_id := (public.inventory_save_stock_check(gen_random_uuid(), v_check || jsonb_build_object(
    'outlet_id', v_other, 'accounting_month', '2001-09-01', 'physical_count_cutoff', '2001-10-01T00:00:00+08:00'
  ), jsonb_build_array(v_item_line || '{"unit":"unmatched"}'))->'check'->>'id')::uuid;
  begin
    perform public.inventory_approve_closing_stock(v_other_id, gen_random_uuid());
    raise exception 'Closing audit with missing pinned cost was approved';
  exception when raise_exception then
    if sqlerrm not like 'Approval requires a complete count and a valid pinned unit cost%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.inventory_approve_closing_stock(v_id, gen_random_uuid());
    raise exception 'Approval bypassed permission enforcement';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
begin
  if (select count(*) from inventory_authority.closing_stock_revisions
    where outlet_id = current_setting('closing_qa.outlet')::uuid and accounting_month = '2001-08-01') <> 2
    or not exists (select 1 from inventory_authority.closing_stock_revisions successor
      join inventory_authority.closing_stock_revisions prior on prior.id = successor.supersedes_id
      where successor.outlet_id = current_setting('closing_qa.outlet')::uuid and successor.revision = 2
        and prior.revision = 1 and prior.amount = 10 and successor.approved_by = current_setting('closing_qa.actor')::uuid) then
    raise exception 'Append-only lineage or approval actor was lost';
  end if;
end;
$$;
rollback;
select 'PASS: authenticated approval, coverage, immutable counts, pinning, early/late reconciliation, revision, scoped reporting and zero' as result;
