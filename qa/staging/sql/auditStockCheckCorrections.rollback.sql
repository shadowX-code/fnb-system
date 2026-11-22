-- Run with the FeedX Staging linkage. Audit, outlet, cost and Crew fixtures roll back.
begin;

do $$
declare
  v_actor uuid;
  v_outlet uuid := gen_random_uuid();
  v_unpublished uuid := gen_random_uuid();
  v_normal uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_normal_audit uuid := gen_random_uuid();
begin
  for v_actor in
    select employee.auth_user_id from public.employees employee
    join public.roles role on role.id = employee.role_id
    where lower(role.name) in ('owner','admin') and employee.auth_user_id is not null
  loop
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    exit when public.current_user_has_all_outlet_access()
      and public.current_user_has_permission('inventory_stock_check.approve');
  end loop;
  if not public.current_user_has_permission('inventory_stock_check.approve') then
    raise exception 'A Staging approver is required for the rollback fixture.';
  end if;

  insert into public.outlets(id, name, code) values
    (v_outlet, 'QA published correction', 'QAE' || left(v_outlet::text, 6)),
    (v_unpublished, 'QA unpublished correction', 'QAE' || left(v_unpublished::text, 6)),
    (v_normal, 'QA ordinary correction', 'QAE' || left(v_normal::text, 6));
  insert into public.inventory_items(id, item_name, unit) values (v_item, 'QA correction item', 'kg');
  insert into public.inventory_item_outlets(outlet_id, inventory_item_id, par_level) values
    (v_outlet, v_item, 10), (v_unpublished, v_item, 10), (v_normal, v_item, 10);

  insert into public.inventory_stock_checks(id,outlet_id,stock_check_type,status,check_date,audit_type,audit_name,created_at)
  values(v_normal_audit,v_normal,'audit','draft',(now()-interval '2 days')::date,'Spot Check','QA historical audit',now()-interval '2 days');
  insert into public.inventory_stock_check_items(stock_check_id,item_id,unit,status,notes,skipped,skip_reason)
  values(v_normal_audit,v_item,'kg','skipped','Historical note',true,'Inaccessible');
  update public.inventory_stock_checks set status='submitted',submitted_at=now()-interval '2 days' where id=v_normal_audit;
  insert into public.inventory_movements(outlet_id,inventory_item_id,movement_type,quantity,unit,created_at)
  values(v_normal,v_item,'adjustment',1,'kg',now()-interval '1 day');

  perform set_config('audit_qa.actor', v_actor::text, true);
  perform set_config('audit_qa.outlet', v_outlet::text, true);
  perform set_config('audit_qa.unpublished', v_unpublished::text, true);
  perform set_config('audit_qa.normal', v_normal::text, true);
  perform set_config('audit_qa.item', v_item::text, true);
  perform set_config('audit_qa.historical', v_normal_audit::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  v_outlet uuid := current_setting('audit_qa.outlet')::uuid;
  v_unpublished uuid := current_setting('audit_qa.unpublished')::uuid;
  v_normal uuid := current_setting('audit_qa.normal')::uuid;
  v_item uuid := current_setting('audit_qa.item')::uuid;
  v_normal_audit uuid := current_setting('audit_qa.historical')::uuid;
  v_count jsonb := jsonb_build_object('item_id',v_item,'actual_count_quantity',4,'unit','kg',
      'par_level_quantity',10,'notes','Original shelf');
  v_check jsonb := jsonb_build_object('outlet_id',v_outlet,'stock_check_type','audit',
      'status','submitted','audit_type','Month-End Closing','accounting_month','2001-08-01','notes','Frozen audit notes');
  v_correction_check jsonb;
  v_zero jsonb := jsonb_build_array(v_count || '{"actual_count_quantity":0,"notes":"Verified shelf"}');
  v_reason text := 'Duplicate shelf count corrected';
  v_source uuid;
  v_draft uuid;
  v_start_request uuid := gen_random_uuid();
  v_approve_request uuid := gen_random_uuid();
  v_submit_request uuid := gen_random_uuid();
  v_source_evidence jsonb;
  v_close jsonb;
  v_new jsonb;
  v_result jsonb;
  v_history jsonb;
  v_before jsonb;
  v_after jsonb;
  v_invalid jsonb;
begin
  perform public.inventory_master_revise_cost(v_item, 2.5, 'kg', '2001-08-01', 'QA opening cost', gen_random_uuid(), null);
  v_source_evidence := public.inventory_save_stock_check(gen_random_uuid(),v_check,jsonb_build_array(v_count));
  v_source := (v_source_evidence->'check'->>'id')::uuid;
  v_close := public.inventory_approve_closing_stock(v_source,v_approve_request,'2001-08-01'::date,'2001-09-01',null,null);
  if (v_close->>'amount')::numeric is distinct from 10 then raise exception 'Original closing is incorrect'; end if;
  v_before := public.reporting_monthly_scope_financials(v_outlet,2001,8);

  v_draft := (public.inventory_create_audit_correction(v_source,v_start_request)->>'check_id')::uuid;
  if v_draft is distinct from (public.inventory_create_audit_correction(v_source,v_start_request)->>'check_id')::uuid
    or v_draft is distinct from (public.inventory_create_audit_correction(v_source,gen_random_uuid())->>'check_id')::uuid then
    raise exception 'Duplicate correction draft created';
  end if;
  if not exists (select 1 from public.inventory_stock_checks where id=v_draft and correction_of_id=v_source
    and notes='Frozen audit notes' and accounting_month='2001-08-01' and status='draft')
    or not exists (select 1 from public.inventory_stock_check_items where stock_check_id=v_draft
      and actual_count_quantity=4 and par_level_quantity=10 and unit='kg'
      and unit_cost_snapshot=2.5 and notes='Original shelf') then raise exception 'Draft did not copy original evidence'; end if;
  if (public.inventory_closing_context(v_source)->>'approval_blocked')::boolean is distinct from true
    or public.reporting_monthly_scope_financials(v_outlet,2001,8) is distinct from v_before
    or public.inventory_approve_closing_stock(v_source,v_approve_request,'2001-08-01'::date,'2001-09-01',null,null) is distinct from v_close then
    raise exception 'Pending correction changed existing publication or its replay';
  end if;
  begin
    perform public.inventory_approve_closing_stock(v_source,gen_random_uuid(),'2001-08-01'::date,'2001-09-01',(v_close->>'id')::uuid,'Should block');
    raise exception 'Approval of a source with a pending correction succeeded';
  exception when raise_exception then
    if sqlerrm not like 'This audit has a correction.%' then raise; end if;
  end;

  v_correction_check := jsonb_build_object('id',v_draft,'outlet_id',v_outlet,'stock_check_type','audit','status','submitted');
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(),v_correction_check,v_zero);
    raise exception 'Correction submitted without a reason';
  exception when raise_exception then
    if sqlerrm not like 'Enter a correction reason%' then raise; end if;
  end;
  v_correction_check := v_correction_check || jsonb_build_object('correction_reason',v_reason);
  foreach v_invalid in array array['[]'::jsonb,v_zero || v_zero,
    jsonb_build_array(v_count || '{"actual_count_quantity":null}'),
    jsonb_build_array(v_count || '{"actual_count_quantity":0,"unit":"bag"}'),
    jsonb_build_array(v_count)] loop
    begin
      perform public.inventory_save_stock_check(gen_random_uuid(),v_correction_check,v_invalid);
      raise exception 'Invalid correction evidence was accepted';
    exception when raise_exception then
      if sqlerrm not like 'The correction must include%' and sqlerrm not like 'Use the original count units%'
        and sqlerrm not like 'Change at least one item%' then raise; end if;
    end;
  end loop;

  v_result := public.inventory_save_stock_check(gen_random_uuid(),
    v_correction_check || '{"status":"draft","accounting_month":"2003-04-01","physical_count_cutoff":"2003-05-01T00:00:00Z"}',v_zero);
  if v_result->'check'->>'status' <> 'draft' or v_result->'check'->>'accounting_month' <> '2001-08-01'
    or v_result->'check'->>'physical_count_cutoff' is not null then raise exception 'Draft save rewrote source closing metadata'; end if;

  perform public.inventory_master_revise_cost(v_item, 50, 'kg', '2002-08-01', 'Later cost',
    gen_random_uuid(), (public.inventory_master_cost_history(v_item)->>'current_revision_id')::uuid);
  v_result := public.inventory_save_stock_check(v_submit_request,v_correction_check,v_zero);
  if v_result is distinct from public.inventory_save_stock_check(v_submit_request,v_correction_check,v_zero)
    or v_result->'check'->>'correction_reason' <> v_reason
    or (v_result->'items'->0->>'unit_cost_snapshot')::numeric is distinct from 2.5
    or (v_result->'items'->0->>'actual_count_quantity')::numeric is distinct from 0
    or public.reporting_monthly_scope_financials(v_outlet,2001,8) is distinct from v_before then
    raise exception 'Correction submission repriced evidence, failed replay, or changed P&L';
  end if;
  begin
    perform public.inventory_save_stock_check(gen_random_uuid(),v_correction_check,v_zero);
    raise exception 'Submitted correction was rewritten';
  exception when raise_exception then
    if sqlerrm <> 'Submitted audit evidence is immutable.' then raise; end if;
  end;
  begin
    perform public.inventory_create_audit_correction(v_source,gen_random_uuid());
    raise exception 'Superseded evidence acquired a second successor';
  exception when raise_exception then
    if sqlerrm not like 'This audit has been superseded.%' then raise; end if;
  end;
  if v_source_evidence->'check' is distinct from (select to_jsonb(row) from public.inventory_stock_checks row where id=v_source)
    or v_source_evidence->'items'->0 is distinct from (select to_jsonb(row) from public.inventory_stock_check_items row where stock_check_id=v_source) then
    raise exception 'Original submitted evidence was changed';
  end if;
  v_history := public.inventory_audit_correction_history(v_draft);
  if jsonb_array_length(v_history->'entries') <> 2 or v_history->'entries'->1->>'correction_of_id' <> v_source::text
    or (public.inventory_closing_context(v_draft)->>'prior_actual_count_date')::date is distinct from '2001-09-01'::date then
    raise exception 'Correction lineage or previous confirmation was lost';
  end if;
  v_new := public.inventory_approve_closing_stock(v_draft,gen_random_uuid(),'2001-08-01'::date,'2001-09-01',
    (v_close->>'id')::uuid,'Approve corrected evidence');
  v_after := public.reporting_monthly_scope_financials(v_outlet,2001,8);
  if (v_new->>'revision')::int is distinct from 2 or (v_new->>'amount')::numeric is distinct from 0
    or (v_after->>'closing_stock')::numeric is distinct from 0 or v_after - array['closing_stock', 'closing_stock_evidence'] <> v_before - array['closing_stock', 'closing_stock_evidence'] then
    raise exception 'Existing approval did not publish the corrected amount independently';
  end if;

  v_source := (public.inventory_save_stock_check(gen_random_uuid(),v_check || jsonb_build_object('outlet_id',v_unpublished),
    jsonb_build_array(v_count))->'check'->>'id')::uuid;
  v_draft := (public.inventory_create_audit_correction(v_source,gen_random_uuid())->>'check_id')::uuid;
  perform public.inventory_delete_stock_check_draft(v_draft,gen_random_uuid());
  if (public.inventory_closing_context(v_source)->>'approval_blocked')::boolean is distinct from false then
    raise exception 'Discarding the correction did not restore approval eligibility';
  end if;
  v_draft := (public.inventory_create_audit_correction(v_source,gen_random_uuid())->>'check_id')::uuid;
  perform public.inventory_save_stock_check(gen_random_uuid(),v_correction_check || jsonb_build_object('id',v_draft,'outlet_id',v_unpublished),
    jsonb_build_array(v_count || '{"actual_count_quantity":2}'));
  v_new := public.inventory_approve_closing_stock(v_draft,gen_random_uuid(),'2001-08-01'::date,'2001-09-01',null,null);
  if (v_new->>'amount')::numeric is distinct from 100 or (v_new->>'revision')::int is distinct from 1 then
    raise exception 'A corrected unapproved count did not publish as revision one';
  end if;

  v_draft := (public.inventory_create_audit_correction(v_normal_audit,gen_random_uuid())->>'check_id')::uuid;
  perform public.inventory_save_stock_check(gen_random_uuid(),v_correction_check || jsonb_build_object('id',v_draft,'outlet_id',v_normal),v_zero);
  v_result := public.inventory_dashboard_stock_evidence(array[v_normal])->'positions'->0;
  if v_result->>'check_id' is distinct from v_draft::text or v_result->>'movement_relation' is distinct from 'after'
    or (v_result->>'submitted_at')::timestamptz is distinct from now()-interval '2 days' then
    raise exception 'A correction incorrectly established a new physical count time';
  end if;
  v_draft := (public.inventory_create_audit_correction(v_draft,gen_random_uuid())->>'check_id')::uuid;
  perform set_config('audit_qa.crew_draft',v_draft::text,true);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.inventory_create_audit_correction(v_normal_audit,gen_random_uuid());
    raise exception 'Unauthenticated identity bypassed correction permissions';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
declare
  v_outlet uuid := current_setting('audit_qa.normal')::uuid;
  v_employee uuid := gen_random_uuid();
  v_token text := gen_random_uuid()::text;
begin
  perform set_config('request.jwt.claim.sub',current_setting('audit_qa.actor'),true);
  insert into public.employees(id,full_name,workplace)
  values(v_employee,'QA rollback Crew Correction',(select code from public.outlets where id=v_outlet));
  insert into public.crew_access(employee_id,mobile_number,passcode_hash,primary_outlet_id,can_create_audit_stock_check)
  values(v_employee,'60'||translate(left(v_employee::text,8),'abcdef','012345'),'rollback-only',v_outlet,true);
  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  values(v_employee,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '1 minute');
  perform set_config('audit_qa.crew_token',v_token,true);
  perform set_config('request.jwt.claim.sub','',true);
end;
$$;

set local role anon;
do $$
declare
  v_outlet uuid := current_setting('audit_qa.normal')::uuid;
  v_draft uuid := current_setting('audit_qa.crew_draft')::uuid;
  v_token text := current_setting('audit_qa.crew_token');
begin
  if exists (select 1 from jsonb_array_elements(public.crew_inventory_stock_checks(v_token,v_outlet)->'checks') row
    where row->>'id'=v_draft::text) then raise exception 'Crew listed an Admin correction draft'; end if;
  begin
    perform public.crew_inventory_stock_checks(v_token,v_outlet,v_draft);
    raise exception 'Crew opened an Admin correction draft';
  exception when insufficient_privilege then null; end;
  begin
    perform public.crew_inventory_save_stock_check(v_token,v_outlet,gen_random_uuid(),
      jsonb_build_object('id',v_draft,'outlet_id',v_outlet,'stock_check_type','audit'),'[]');
    raise exception 'Crew changed an Admin correction draft';
  exception when insufficient_privilege then null; end;
  begin
    perform public.crew_inventory_delete_audit_draft(v_token,v_outlet,v_draft,gen_random_uuid());
    raise exception 'Crew discarded an Admin correction draft';
  exception when insufficient_privilege then null; end;
end;
$$;

rollback;
select 'PASS: correction lineage, roster, frozen costs, replay, dashboard movement timing, scoped Crew, and closing publication' as result;
