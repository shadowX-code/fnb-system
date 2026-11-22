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
  v_legacy uuid := gen_random_uuid();
  v_historical jsonb;
begin
  insert into public.outlets(id, name, code) values
    (v_outlet, 'QA Closing Stock', 'QAC' || left(v_outlet::text, 6)),
    (v_other, 'QA Closing Stock Zero', 'QAC' || left(v_other::text, 6));
  insert into public.inventory_items(id, item_name, unit) values
    (v_item, 'QA Closing Item', 'kg'),
    (v_item2, 'QA Closing Item Two', 'kg');
  insert into public.inventory_item_outlets(outlet_id, inventory_item_id, par_level) values
    (v_outlet, v_item, 10), (v_outlet, v_item2, 10), (v_other, v_item, 10);

  -- Simulate a draft already recorded by the previous lifecycle.
  insert into public.inventory_stock_checks(id, outlet_id, stock_check_type, audit_type, audit_name,
    check_date, accounting_month, physical_count_cutoff, status, created_at)
  values (v_legacy, v_other, 'audit', 'Month-End Closing', 'QA historical cutoff',
    '2001-08-31', '2001-08-01', '2001-09-01T00:00:00+08:00', 'draft', '2001-09-01T00:00:30+08:00');
  perform set_config('closing_qa.legacy', v_legacy::text, true);

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
  -- A pre-release submitted audit has no publication or recorded actual count date.
  v_historical := feedx_integrations.ra_save_stock_check(null::uuid,gen_random_uuid(),
    jsonb_build_object('outlet_id',v_other,'stock_check_type','audit','audit_type','Month-End Closing',
      'status','submitted','accounting_month','2001-09-01'),
    jsonb_build_array(jsonb_build_object('item_id',v_item,'unit','kg','actual_count_quantity',4)),
    v_other,v_actor,null,'admin');
  perform set_config('closing_qa.historical',v_historical->'check'->>'id',true);
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
    'status', 'submitted', 'accounting_month', '2001-08-01',
    'publish_closing', true, 'actual_count_date', '2001-09-02'
  );
  v_item_line jsonb := jsonb_build_object('item_id', v_item, 'unit', 'kg', 'par_level_quantity', 10, 'actual_count_quantity', 0);
  v_second_line jsonb := jsonb_build_object('item_id', v_item2, 'unit', 'kg', 'actual_count_quantity', 3);
  v_lines jsonb := jsonb_build_array(v_item_line, v_second_line);
  v_before jsonb;
  v_saved jsonb;
  v_id uuid;
  v_close jsonb;
  v_after jsonb;
  v_revision jsonb;
  v_historical_request uuid := gen_random_uuid();
  v_other_id uuid;
  v_unvalued_id uuid;
  v_partial_id uuid;
  v_saved_evidence jsonb;
  v_invalid jsonb;
  v_draft jsonb;
  v_draft_lines jsonb := jsonb_build_array(
    v_item_line || '{"actual_count_quantity":null,"skipped":true,"status":"skipped","skip_reason":"Awaiting storage access"}', v_second_line
  );
  v_submit jsonb;
  v_start_request uuid := gen_random_uuid();
  v_submit_request uuid := gen_random_uuid();
  v_started timestamptz;
  v_submitted timestamptz;
  v_exact timestamptz := '2001-09-01T00:00:00+08:00';
  v_late date := '2001-09-02';
begin
  if has_table_privilege(current_user, 'public.inventory_stock_checks', 'TRUNCATE') then
    raise exception 'Authenticated stock check truncate is allowed';
  end if;
  perform public.inventory_master_revise_cost(v_item, 2.5, 'kg', '2001-08-01',
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

  v_draft := v_check || '{"status":"draft","check_date":"1998-01-01","created_at":"1998-01-01T00:00:00Z","physical_count_cutoff":"2001-08-31T22:00:00+08:00"}';
  v_saved := public.inventory_save_stock_check(v_start_request, v_draft, v_draft_lines);
  v_id := (v_saved->'check'->>'id')::uuid;
  if not exists (
    select 1 from public.inventory_stock_check_items
    where stock_check_id = v_id and item_id = v_item and skipped and actual_count_quantity is null
      and skip_reason = 'Awaiting storage access'
  ) then raise exception 'A temporary closing skip lost its reason or became a count'; end if;
  v_started := (v_saved->'check'->>'created_at')::timestamptz;
  if v_started is distinct from now() or (v_saved->'check'->>'check_date')::date is distinct from
      (now() at time zone 'Asia/Kuala_Lumpur')::date
    or v_saved->'check'->>'physical_count_cutoff' is not null
    or v_saved->'check'->>'submitted_at' is not null
    or v_saved->'check'->>'audit_name' not like 'Month-End Closing · Aug 2001 · %'
    or v_saved is distinct from public.inventory_save_stock_check(v_start_request, v_draft, v_draft_lines) then
    raise exception 'Audit start, business date, automatic name, replay or physical evidence boundary is incorrect';
  end if;
  v_saved := public.inventory_save_stock_check(gen_random_uuid(), v_draft || jsonb_build_object('id', v_id), v_lines);
  if (v_saved->'check'->>'created_at')::timestamptz is distinct from v_started
    or v_saved->'check'->>'submitted_at' is not null then
    raise exception 'Resuming and saving rewrote the original start or assigned a submission time';
  end if;
  v_submit := v_check || jsonb_build_object('id', v_id, 'submitted_at', '1999-01-01T00:00:00Z',
    'physical_count_cutoff', v_exact);
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(), v_submit - 'publish_closing', v_lines);
    raise exception 'An old client activated automatic publication.';
  exception when raise_exception then
    if sqlerrm not like 'Reload FeedX%' then raise; end if;
  end;
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(), v_submit || jsonb_build_object(
      'actual_count_date',(now() at time zone 'Asia/Kuala_Lumpur')::date + 1), v_lines);
    raise exception 'A count date after submission was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'The actual count date must be on or before%' then raise; end if;
  end;
  if (select status from public.inventory_stock_checks where id=v_id) <> 'draft'
    or public.reporting_monthly_scope_financials(v_outlet,2001,8)->>'closing_stock_evidence' is not null then
    raise exception 'Rejected publication did not roll back submission.';
  end if;
  v_saved := public.inventory_save_stock_check(v_submit_request, v_submit, v_lines);
  v_submitted := (v_saved->'check'->>'submitted_at')::timestamptz;
  if v_submitted is distinct from now() or (v_saved->'check'->>'created_at')::timestamptz is distinct from v_started
    or v_saved->'check'->>'physical_count_cutoff' is not null
    or (public.inventory_closing_context(v_id)->>'prior_actual_count_date')::date is distinct from v_late
    or v_saved is distinct from public.inventory_save_stock_check(v_submit_request, v_submit, v_lines) then
    raise exception 'Audit submission or retry did not preserve canonical timestamps and unconfirmed cutoff';
  end if;
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
  v_close := v_saved->'closing';
  if (v_close->>'amount')::numeric is distinct from 0 or (v_close->>'revision')::int is distinct from 1
    or v_close->>'valuation_status' is distinct from 'partial'
    or (v_close->>'valued_item_count')::int is distinct from 1 or (v_close->>'total_item_count')::int is distinct from 2
    or (v_close->>'actual_count_date')::date is distinct from v_late then
    raise exception 'Submission did not publish partial coverage, zero, and the actual date';
  end if;
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(), v_check, v_lines);
    raise exception 'An unrelated duplicate publication was accepted';
  exception when raise_exception then
    if sqlerrm not like 'This outlet already has a Closing Stock publication%' then raise; end if;
  end;

  v_partial_id := (public.inventory_create_audit_correction(v_id,gen_random_uuid())->>'check_id')::uuid;
  v_saved_evidence := public.inventory_save_stock_check(gen_random_uuid(),
    jsonb_build_object('id',v_partial_id,'outlet_id',v_outlet,'stock_check_type','audit','status','submitted',
      'publish_closing',true,'notes','Verified closing notes','correction_reason','Corrected quantity'),
    jsonb_build_array(v_item_line || '{"actual_count_quantity":3.3}', v_second_line));
  v_revision := v_saved_evidence->'closing';
  if (v_revision->>'revision')::int is distinct from 2 or (v_revision->>'amount')::numeric is distinct from 8.25
    or public.inventory_closing_context(v_id)->'published'->>'source_audit_id' is distinct from v_partial_id::text
    or v_saved_evidence->'check' is distinct from (select to_jsonb(c) from public.inventory_stock_checks c where id = v_partial_id)
    or exists (select 1 from jsonb_array_elements(v_saved_evidence->'items') j
      where j is distinct from (select to_jsonb(i) from public.inventory_stock_check_items i where i.id = (j->>'id')::uuid)) then
    raise exception 'Partial revision, publication source, or submitted evidence is incorrect';
  end if;

  v_after := public.reporting_monthly_scope_financials(v_outlet, 2001, 8);
  if v_after->>'closing_stock' is not null
    or v_after->'closing_stock_evidence' is distinct from '{"amount":8.25,"valuation_status":"partial","valued_item_count":1,"total_item_count":2,"actual_count_date":"2001-09-02"}'::jsonb
    or v_after - array['closing_stock', 'closing_stock_evidence'] <> v_before - array['closing_stock', 'closing_stock_evidence']
    or public.reporting_yearly_scope_financials(v_outlet, 2001)->'months'->7 is distinct from v_after
    or public.reporting_monthly_scope_financials(v_outlet, 2001, 9)->>'closing_stock_evidence' is not null then
    raise exception 'Reporting did not preserve the selected month, metadata, or financial inputs';
  end if;
  perform public.inventory_master_revise_cost(v_item, 7, 'kg', '2001-09-01', 'QA revised unit cost',
    gen_random_uuid(), (public.inventory_master_cost_history(v_item)->>'current_revision_id')::uuid);
  perform public.inventory_master_revise_cost(v_item2, 5, 'kg', '2001-09-01',
    'QA cost added after original count', gen_random_uuid(), null);
  if (select unit_cost_snapshot from public.inventory_stock_check_items where stock_check_id = v_id and item_id = v_item)
      is distinct from 2.5::numeric
    or (select unit_cost_snapshot from public.inventory_stock_check_items where stock_check_id = v_partial_id and item_id = v_item2) is not null
    or public.reporting_monthly_scope_financials(v_outlet, 2001, 8) is distinct from v_after then
    raise exception 'Changing Master Inventory cost changed historical pins or approved valuation';
  end if;
  if public.reporting_monthly_scope_financials(null, 2001, 8)->>'closing_stock_evidence' is not null then
    raise exception 'All Outlets showed a total before every outlet had a publication';
  end if;

  v_other_id := (public.inventory_save_stock_check(gen_random_uuid(), v_check || jsonb_build_object(
    'outlet_id', v_other, 'id', current_setting('closing_qa.legacy')::uuid, 'actual_count_date', '2001-09-01'
  ), jsonb_build_array(v_item_line))->'check'->>'id')::uuid;
  if (select unit_cost_snapshot from public.inventory_stock_check_items where stock_check_id = v_other_id and item_id = v_item)
      is distinct from 7::numeric then
    raise exception 'New Audit did not pin the current revised cost at submission';
  end if;
  if not exists (select 1 from public.inventory_stock_checks where id = v_other_id and check_date = '2001-08-31'
    and physical_count_cutoff = v_exact and created_at = '2001-09-01T00:00:30+08:00') then
    raise exception 'The new workflow rewrote an existing audit timestamp';
  end if;
  v_close := public.inventory_closing_context(v_other_id)->'published';
  if (v_close->>'amount')::numeric is distinct from 0 or v_close->>'valuation_status' <> 'complete'
    or (public.reporting_monthly_scope_financials(v_other, 2001, 8)->>'closing_stock')::numeric is distinct from 0 then
    raise exception 'A legitimate complete zero was lost';
  end if;

  v_unvalued_id := current_setting('closing_qa.historical')::uuid;
  if public.inventory_closing_context(v_unvalued_id)->>'published' is not null then
    raise exception 'Historical evidence was published without an explicit action.';
  end if;
  v_close := public.inventory_publish_existing_closing(v_unvalued_id, v_historical_request);
  if v_close is distinct from public.inventory_publish_existing_closing(v_unvalued_id, v_historical_request)
    or v_close->>'actual_count_date' is not null then
    raise exception 'Historical publication fabricated a date or failed to replay.';
  end if;
  if v_close->>'amount' is not null or v_close->>'valuation_status' <> 'partial'
    or (v_close->>'valued_item_count')::int is distinct from 0
    or public.reporting_monthly_scope_financials(v_other, 2001, 9)->'closing_stock_evidence'->>'valuation_status' is distinct from 'partial' then
    raise exception 'An entirely unvalued close was interpreted as zero or unpublished';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.inventory_publish_existing_closing(v_id, gen_random_uuid());
    raise exception 'Approval bypassed permission enforcement';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
declare
  v_outlet uuid := current_setting('closing_qa.outlet')::uuid;
  v_employee uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
begin
  perform set_config('request.jwt.claim.sub', current_setting('closing_qa.actor'), true);
  insert into public.employees(id, full_name, workplace)
  values (v_employee, 'QA rollback Crew Inventory', (select code from public.outlets where id = v_outlet));
  insert into public.crew_access(employee_id, mobile_number, passcode_hash, primary_outlet_id, can_create_audit_stock_check)
  values (v_employee, '60' || translate(left(v_employee::text, 8), 'abcdef', '012345'), 'rollback-only', v_outlet, true);
  insert into public.crew_sessions(employee_id, token_hash, expires_at)
  values (v_employee, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '1 minute');
  perform set_config('closing_qa.crew_token', v_token, true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

set local role anon;
do $$
declare
  v_token text := current_setting('closing_qa.crew_token');
  v_outlet uuid := current_setting('closing_qa.outlet')::uuid;
  v_input jsonb := jsonb_build_object('outlet_id', v_outlet, 'stock_check_type', 'audit', 'audit_type', 'Spot Check');
  v_items jsonb := jsonb_build_array(jsonb_build_object('item_id', current_setting('closing_qa.item')::uuid,
    'unit', 'kg', 'actual_count_quantity', 1));
  v_request uuid := gen_random_uuid();
  v_started jsonb;
  v_detail jsonb;
  v_id uuid;
  v_result jsonb;
begin
  begin
    perform public.crew_inventory_save_stock_check(v_token, v_outlet, gen_random_uuid(),
      v_input || '{"audit_type":"Month-End Closing","status":"submitted","accounting_month":"2001-10-01","publish_closing":true,"actual_count_date":"2001-10-31"}',
      v_items || jsonb_build_array(jsonb_build_object('item_id',current_setting('closing_qa.item2')::uuid,'unit','kg','actual_count_quantity',1)));
    raise exception 'Crew accessed closing publication.';
  exception when insufficient_privilege then null; end;
  v_started := public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_input, v_items);
  v_id := (v_started->'check'->>'id')::uuid;
  if v_started is distinct from public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_input, v_items)
    or (v_started->'check'->>'created_at')::timestamptz is distinct from now() then
    raise exception 'Crew Continue did not create one authoritative draft';
  end if;
  v_detail := public.crew_inventory_stock_checks(v_token, v_outlet, v_id)->'detail';
  if v_detail->>'created_at' is distinct from v_started->'check'->>'created_at'
    or v_detail->>'submitted_at' is not null then raise exception 'Crew resume lost the original start'; end if;

  v_request := gen_random_uuid();
  v_input := v_input || jsonb_build_object('id', v_id, 'status', 'submitted');
  v_result := public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_input, v_items);
  v_detail := public.crew_inventory_stock_checks(v_token, v_outlet, v_id)->'detail';
  if v_result is distinct from public.crew_inventory_save_stock_check(v_token, v_outlet, v_request, v_input, v_items)
    or v_detail->>'created_at' is distinct from v_started->'check'->>'created_at'
    or (v_detail->>'submitted_at')::timestamptz is distinct from now() then
    raise exception 'Crew submission or retry lost lifecycle timestamps';
  end if;

  begin
    perform public.crew_inventory_stock_checks(v_token, current_setting('closing_qa.other')::uuid, v_id);
    raise exception 'The Crew timestamp read crossed outlet scope';
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
        and prior.revision = 1 and prior.amount = 0 and prior.valuation_status = 'partial'
        and successor.approved_by = current_setting('closing_qa.actor')::uuid) then
    raise exception 'Append-only lineage or approval actor was lost';
  end if;
end;
$$;
rollback;
select 'PASS: atomic closing, authorization, partial revisions and explicit historical publication' as result;
