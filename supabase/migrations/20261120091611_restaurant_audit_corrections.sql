-- A submitted audit is immutable. A correction is the next audit in its evidence chain.
alter table public.inventory_stock_checks
  add column correction_of_id uuid references public.inventory_stock_checks(id) on delete restrict,
  add column correction_reason text,
  add constraint inventory_audit_correction_metadata check (
    (correction_of_id is null and correction_reason is null)
    or (correction_of_id is not null and correction_of_id <> id and stock_check_type = 'audit'
      and status in ('draft', 'submitted')
      and (correction_reason is null or length(btrim(correction_reason)) between 1 and 2000)
      and (status <> 'submitted' or correction_reason is not null))
  );

create unique index inventory_audit_correction_successor
  on public.inventory_stock_checks(correction_of_id) where correction_of_id is not null;

alter table public.inventory_lifecycle_requests
  drop constraint inventory_lifecycle_requests_operation_check,
  add constraint inventory_lifecycle_requests_operation_check
  check (operation in ('purchase_receipt','waste','transfer','stock_check','purchase_order',
    'manual_movement','recipe','stock_check_draft_delete','purchase_order_transition',
    'stock_check_purchase_orders','stock_check_skip','audit_correction_create','audit_correction_save'));

create function inventory_authority.can_correct_audit()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null and public.current_user_has_permission('inventory_stock_check.view')
    and public.current_user_has_permission('inventory_stock_check.edit')
    and public.current_user_has_permission('inventory_stock_check.create');
$$;

create function inventory_authority.audit_evidence_root(p_audit_id uuid)
returns uuid language sql stable set search_path = '' as $$
  with recursive lineage(id, correction_of_id) as (
    select id, correction_of_id from public.inventory_stock_checks where id = p_audit_id
    union all
    select audit.id, audit.correction_of_id from public.inventory_stock_checks audit
    join lineage on audit.id = lineage.correction_of_id
  ) select id from lineage where correction_of_id is null;
$$;

create function inventory_authority.audit_correction_block(p_source public.inventory_stock_checks)
returns text language sql stable set search_path = '' as $$
  select case
    when (p_source).audit_type = 'Month-End Closing' and (p_source).closing_item_ids is null
      then 'This historical closing has no frozen eligible roster. Start a new closing audit for corrected evidence.'
    when (select count(*) = 0 or count(distinct item_id) <> count(*)
        from public.inventory_stock_check_items where stock_check_id = (p_source).id)
      then 'This historical audit has missing or duplicate item references and cannot be copied.'
    when (p_source).accounting_month is not null and (
      (select array_agg(item_id order by item_id) from public.inventory_stock_check_items
        where stock_check_id = (p_source).id) is distinct from (p_source).closing_item_ids
      or exists (select 1 from public.inventory_stock_check_items item where item.stock_check_id = (p_source).id and
        (nullif(btrim(item.unit), '') is null or item.unit_cost_snapshot is null
          or not (item.unit_cost_snapshot >= 0 and item.unit_cost_snapshot < 'Infinity'::numeric)))
    ) then 'This closing lacks a complete frozen roster, count units or pinned costs.'
  end;
$$;

create function public.inventory_audit_correction_history(p_check_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_history jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_stock_check.view') then
    raise exception using errcode = '42501', message = 'Stock Check view permission is required.';
  end if;
  select * into v_check from public.inventory_stock_checks where id = p_check_id;
  if not found or v_check.stock_check_type <> 'audit'
    or not public.current_user_can_access_outlet(v_check.outlet_id) then
    raise exception using errcode = '42501', message = 'Audit evidence is unavailable.';
  end if;

  with recursive chain as (
    select id, audit_name, check_date, status, correction_of_id, correction_reason, created_at, submitted_at, 0 as version
    from public.inventory_stock_checks where id = inventory_authority.audit_evidence_root(v_check.id)
    union all
    select audit.id, audit.audit_name, audit.check_date, audit.status, audit.correction_of_id,
      audit.correction_reason, audit.created_at, audit.submitted_at, chain.version + 1
    from public.inventory_stock_checks audit join chain on audit.correction_of_id = chain.id
  )
  select jsonb_agg(to_jsonb(chain)
    || case when status = 'draft' and not inventory_authority.can_correct_audit()
      then '{"correction_reason":null}'::jsonb else '{}'::jsonb end order by version)
  into v_history from chain;

  return jsonb_build_object('entries', v_history,
    'blocked_reason', case when v_check.status = 'submitted' then inventory_authority.audit_correction_block(v_check) end);
end;
$$;

create function public.inventory_create_audit_correction(p_check_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_employee uuid;
  v_source public.inventory_stock_checks%rowtype;
  v_draft public.inventory_stock_checks%rowtype;
  v_name text;
  v_block text;
  v_result jsonb;
begin
  if not inventory_authority.can_correct_audit() then
    raise exception using errcode = '42501', message = 'Stock Check view, edit and submit permissions are required for corrections.';
  end if;
  if p_request_id is null then raise exception 'A correction request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select * into v_source from public.inventory_stock_checks where id = p_check_id for update;
  if not found or not public.current_user_can_access_outlet(v_source.outlet_id) then
    raise exception using errcode = '42501', message = 'Audit evidence is unavailable.';
  end if;
  if v_source.stock_check_type <> 'audit' or v_source.status <> 'submitted' then
    raise exception 'Only submitted Audit Stock Checks can be corrected.';
  end if;

  select result into v_result from public.inventory_lifecycle_requests
  where request_id = p_request_id and operation = 'audit_correction_create' and actor_id = v_actor
    and outlet_id = v_source.outlet_id and payload_fingerprint = md5(p_check_id::text);
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id = p_request_id) then
    raise exception 'This request ID was already used for another inventory action.';
  end if;

  select * into v_draft from public.inventory_stock_checks where correction_of_id = p_check_id;
  if found and v_draft.status <> 'draft' then
    raise exception 'This audit has been superseded. Open the current submitted evidence to start a correction.';
  end if;
  select id into v_employee from public.employees where auth_user_id = v_actor order by id limit 1;
  if v_draft.id is null then
    v_block := inventory_authority.audit_correction_block(v_source);
    if v_block is not null then raise exception '%', v_block; end if;
    v_name := coalesce(v_source.audit_name, v_source.check_name, 'Audit Stock Check')
      || case when v_source.correction_of_id is null then ' · Correction' else '' end;

    insert into public.inventory_stock_checks (outlet_id, stock_check_type, check_name, shift, check_date,
      audit_type, audit_name, audit_category_ids, accounting_month, physical_count_cutoff, closing_item_ids,
      notes, status, created_by, created_by_employee_id, correction_of_id)
    values (v_source.outlet_id, 'audit', v_name, v_source.shift, v_source.check_date,
      v_source.audit_type, v_name, v_source.audit_category_ids, v_source.accounting_month,
      v_source.physical_count_cutoff, v_source.closing_item_ids, v_source.notes, 'draft', v_actor, v_employee, p_check_id)
    returning * into v_draft;

    insert into public.inventory_stock_check_items (stock_check_id, item_id, category_id, par_level_quantity,
      actual_count_quantity, variance, unit, status, notes, skipped, skip_reason, unit_cost_snapshot)
    select v_draft.id, item_id, category_id, par_level_quantity, actual_count_quantity,
      variance, unit, status, notes, skipped, skip_reason, unit_cost_snapshot
    from public.inventory_stock_check_items where stock_check_id = p_check_id;

    insert into public.audit_logs(action, module, user_id, description, metadata)
    values ('inventory_audit_correction_created', 'inventory', v_actor, 'Audit correction draft created.',
      jsonb_build_object('check_id', v_draft.id, 'source_audit_id', p_check_id, 'outlet_id', v_source.outlet_id));
  end if;

  v_result := jsonb_build_object('check_id', v_draft.id);
  insert into public.inventory_lifecycle_requests(request_id, operation, actor_id, actor_employee_id, actor_kind,
    outlet_id, result, payload_fingerprint)
  values (p_request_id, 'audit_correction_create', v_actor, v_employee, 'admin',
    v_source.outlet_id, v_result, md5(p_check_id::text));
  return v_result;
end;
$$;

-- Corrections accept quantities and item notes; all valuation evidence comes from the source.
create function inventory_authority.save_audit_correction(
  p_check_id uuid, p_request_id uuid, p_check jsonb, p_items jsonb, p_outlet_id uuid,
  p_actor_user uuid, p_actor_employee uuid, p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_item_ids uuid[];
  v_now timestamptz := now();
  v_status text := coalesce(p_check->>'status', 'draft');
  v_reason text := nullif(btrim(p_check->>'correction_reason', E' \t\r\n'), '');
  v_result jsonb;
  v_fingerprint text := md5(jsonb_build_object('check', p_check, 'items', p_items)::text);
begin
  if p_actor_kind <> 'admin' or p_actor_user is distinct from auth.uid() or not inventory_authority.can_correct_audit() then
    raise exception using errcode = '42501', message = 'Stock Check view, edit and submit permissions are required for corrections.';
  end if;
  if p_request_id is null then raise exception 'A correction request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_' || p_request_id::text));
  select * into v_check from public.inventory_stock_checks where id = p_check_id for update;
  if not found or v_check.correction_of_id is null or v_check.outlet_id is distinct from p_outlet_id
    or not public.current_user_can_access_outlet(v_check.outlet_id) then
    raise exception using errcode = '42501', message = 'Audit correction is unavailable.';
  end if;

  select result into v_result from public.inventory_lifecycle_requests
  where request_id = p_request_id and operation = 'audit_correction_save' and actor_id = p_actor_user
    and outlet_id = p_outlet_id and payload_fingerprint = v_fingerprint;
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id = p_request_id) then
    raise exception 'This request ID was already used for another inventory action.';
  end if;
  if v_check.status <> 'draft' then raise exception 'Submitted audit evidence is immutable.'; end if;
  if p_check->>'stock_check_type' is distinct from 'audit' or v_status not in ('draft','submitted') then
    raise exception 'Invalid audit correction status or type.';
  end if;
  if length(v_reason) > 2000 or (v_status = 'submitted' and v_reason is null) then
    raise exception 'Enter a correction reason of up to 2,000 characters.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Correction items are required.'; end if;

  select array_agg(item_id order by item_id) into v_item_ids
  from public.inventory_stock_check_items where stock_check_id = v_check.correction_of_id;
  if v_item_ids is null
    or v_item_ids is distinct from (select array_agg((line->>'item_id')::uuid order by (line->>'item_id')::uuid)
      from jsonb_array_elements(p_items) line)
    or v_item_ids is distinct from (select array_agg(item_id order by item_id)
      from public.inventory_stock_check_items where stock_check_id = v_check.id)
    or (v_check.accounting_month is not null and v_item_ids is distinct from v_check.closing_item_ids) then
    raise exception 'The correction must include each item from the source roster exactly once.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) line
    join public.inventory_stock_check_items prior on prior.stock_check_id = v_check.correction_of_id
      and prior.item_id = (line->>'item_id')::uuid
    where not (line ? 'actual_count_quantity')
      or jsonb_typeof(line->'actual_count_quantity') not in ('number', 'null')
      or coalesce(jsonb_typeof(line->'notes'), 'null') not in ('string', 'null')
      or ((line->>'actual_count_quantity') is not null and
        (not ((line->>'actual_count_quantity')::numeric between 0 and 99999999999.999)
          or (line->>'actual_count_quantity')::numeric <> trunc((line->>'actual_count_quantity')::numeric, 3)))
      or (line ? 'unit' and line->>'unit' is distinct from prior.unit)
      or (v_status = 'submitted' and line->>'actual_count_quantity' is null
        and (v_check.accounting_month is not null or prior.actual_count_quantity is not null))
  ) then
    raise exception 'Use the original count units and enter valid non-negative actual quantities with up to three decimals.';
  end if;
  if v_status = 'submitted' and v_check.accounting_month is not null and exists (
    select 1 from public.inventory_stock_check_items row
    where row.stock_check_id = v_check.id and
      (nullif(btrim(row.unit), '') is null or row.unit_cost_snapshot is null
        or not (row.unit_cost_snapshot >= 0 and row.unit_cost_snapshot < 'Infinity'::numeric))
  ) then
    raise exception 'Every closing item requires its original count unit and pinned cost.';
  end if;
  if v_status = 'submitted' and not exists (
    select 1 from jsonb_array_elements(p_items) line
    join public.inventory_stock_check_items prior on prior.stock_check_id = v_check.correction_of_id
      and prior.item_id = (line->>'item_id')::uuid
    where (line->>'actual_count_quantity')::numeric is distinct from prior.actual_count_quantity
      or nullif(line->>'notes','') is distinct from nullif(prior.notes,'')
  ) then
    raise exception 'Change at least one item quantity or note before submitting the correction.';
  end if;

  update public.inventory_stock_check_items row
  set actual_count_quantity = input.quantity, notes = input.notes,
    skipped = input.quantity is null and prior.skipped,
    skip_reason = case when input.quantity is null then prior.skip_reason end,
    variance = case when input.quantity is null then prior.variance else prior.par_level_quantity - input.quantity end,
    status = case when input.quantity is null then prior.status
      when input.quantity < prior.par_level_quantity then 'shortage'
      when input.quantity > prior.par_level_quantity then 'excess' else 'normal' end,
    updated_at = v_now
  from (select (line->>'item_id')::uuid as id, (line->>'actual_count_quantity')::numeric as quantity,
    nullif(line->>'notes','') as notes from jsonb_array_elements(p_items) line) input
  join public.inventory_stock_check_items prior on prior.stock_check_id = v_check.correction_of_id and prior.item_id = input.id
  where row.stock_check_id = v_check.id and row.item_id = input.id;

  update public.inventory_stock_checks set correction_reason = v_reason, status = v_status, updated_at = v_now,
    submitted_at = case when v_status = 'submitted' then v_now end,
    submitted_by = case when v_status = 'submitted' then p_actor_employee end
  where id = p_check_id returning * into v_check;

  if v_status = 'submitted' then
    insert into public.audit_logs(action, module, user_id, description, metadata)
    values ('inventory_audit_correction_submitted', 'inventory', p_actor_user, 'Audit correction submitted.',
      jsonb_build_object('check_id', p_check_id, 'source_audit_id', v_check.correction_of_id,
        'outlet_id', p_outlet_id, 'request_id', p_request_id));
  end if;

  v_result := jsonb_build_object('check', to_jsonb(v_check), 'items', (
    select jsonb_agg(to_jsonb(row) order by row.item_id)
    from public.inventory_stock_check_items row where row.stock_check_id = p_check_id));
  insert into public.inventory_lifecycle_requests(request_id, operation, actor_id, actor_employee_id, actor_kind,
    outlet_id, result, payload_fingerprint)
  values (p_request_id, 'audit_correction_save', p_actor_user, p_actor_employee, 'admin',
    p_outlet_id, v_result, v_fingerprint);
  return v_result;
end;
$$;

create or replace function inventory_authority.save_stock_check(
  p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid,
  p_actor_user uuid, p_actor_employee uuid, p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_id uuid := nullif(p_check->>'id','')::uuid;
begin
  if exists (select 1 from public.inventory_stock_checks where id = v_id and correction_of_id is not null) then
    return inventory_authority.save_audit_correction(v_id, p_request_id, p_check, p_items,
      p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
  end if;
  return feedx_integrations.ra_save_stock_check(null::uuid, p_request_id, p_check, p_items,
    p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
end;
$$;

revoke all on function inventory_authority.can_correct_audit(),
  inventory_authority.audit_evidence_root(uuid),
  inventory_authority.audit_correction_block(public.inventory_stock_checks),
  inventory_authority.save_audit_correction(uuid,uuid,jsonb,jsonb,uuid,uuid,uuid,text)
from public, anon, authenticated, service_role;
revoke all on function public.inventory_audit_correction_history(uuid),
  public.inventory_create_audit_correction(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.inventory_audit_correction_history(uuid),
  public.inventory_create_audit_correction(uuid,uuid) to authenticated;

create or replace function inventory_authority.snapshot_submitted_audit_cost()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'draft' and new.status = 'submitted' and new.stock_check_type = 'audit' and new.correction_of_id is null then
    update public.inventory_stock_check_items check_item
    set unit_cost_snapshot = case
      when item.cost_updated_at is not null
        and item.cost is not null
        and item.cost >= 0
        and lower(trim(check_item.unit)) = lower(trim(item.unit))
      then item.cost
      else null
    end
    from public.inventory_items item
    where check_item.stock_check_id = new.id and check_item.item_id = item.id;
  end if;
  return new;
end; $$;

create or replace function inventory_authority.delete_stock_check_draft(
  p_request_id uuid,p_check_id uuid,p_scope_outlet uuid,p_actor_user uuid,p_actor_employee uuid,p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare v_check public.inventory_stock_checks%rowtype; v_result jsonb;
begin
  if p_request_id is null or p_check_id is null then raise exception 'Request and stock check are required.'; end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests where request_id=p_request_id and operation='stock_check_draft_delete';
  if found then
    if v_result->>'stock_check_id' <> p_check_id::text then raise exception 'Request ID was already used for another stock check.'; end if;
    return v_result;
  end if;
  if exists(select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another inventory action.'; end if;
  select * into v_check from public.inventory_stock_checks where id=p_check_id for update;
  if not found then raise exception 'Stock check was not found.'; end if;
  if v_check.outlet_id is distinct from p_scope_outlet then raise exception using errcode='42501',message='Stock check outlet is not authorized.'; end if;
  if v_check.correction_of_id is not null and (
    p_actor_kind <> 'admin' or p_actor_user is distinct from auth.uid() or not inventory_authority.can_correct_audit()
  ) then
    raise exception using errcode='42501', message='Stock Check view, edit and submit permissions are required for corrections.';
  end if;
  if v_check.status <> 'draft' or v_check.stock_check_type <> 'audit' then raise exception 'Only draft audit stock checks can be deleted.'; end if;
  delete from public.inventory_stock_check_items where stock_check_id=p_check_id;
  delete from public.inventory_stock_checks where id=p_check_id;
  v_result:=jsonb_build_object('stock_check_id',p_check_id,'deleted',true);
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint)
    values(p_request_id,'stock_check_draft_delete',p_actor_user,p_actor_employee,p_actor_kind,p_scope_outlet,v_result,md5(p_check_id::text));
  insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_stock_check_draft_deleted','inventory',p_actor_user,'Audit stock check draft deleted.',
      jsonb_build_object('stock_check_id',p_check_id,'outlet_id',p_scope_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id));
  return v_result;
end; $$;

create or replace function public.inventory_closing_context(p_check_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_month_end timestamptz;
  v_root public.inventory_stock_checks%rowtype;
  v_prior_cutoff timestamptz;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_stock_check.view') then
    raise exception using errcode = '42501', message = 'Stock Check view permission is required.';
  end if;
  select * into v_check from public.inventory_stock_checks where id = p_check_id;
  if not found or not public.current_user_can_access_outlet(v_check.outlet_id) then
    raise exception using errcode = '42501', message = 'Stock check is unavailable.';
  end if;
  if v_check.status <> 'submitted' or v_check.accounting_month is null then
    raise exception 'A submitted closing audit is required.';
  end if;
  v_month_end := inventory_authority.month_end_cutoff(v_check.accounting_month);
  select * into v_close from inventory_authority.closing_stock_revisions
  where outlet_id = v_check.outlet_id and accounting_month = v_check.accounting_month
  order by revision desc limit 1;
  select * into v_root from public.inventory_stock_checks where id = inventory_authority.audit_evidence_root(v_check.id);
  if v_close.source_audit_id is not null and inventory_authority.audit_evidence_root(v_close.source_audit_id) = v_root.id then
    v_prior_cutoff := v_close.physical_count_cutoff;
  end if;
  return jsonb_build_object(
    'count_evidence_submitted_at', v_root.submitted_at,
    'prior_confirmed_cutoff', v_prior_cutoff,
    'approval_blocked', exists (select 1 from public.inventory_stock_checks where correction_of_id = v_check.id),
    'month_end_cutoff', v_month_end, 'period_ended', v_month_end <= now(),
    'requires_reconciliation', coalesce(v_check.physical_count_cutoff, v_prior_cutoff) <> v_month_end,
    'published', case when v_close.id is not null then jsonb_build_object(
      'id', v_close.id, 'revision', v_close.revision, 'source_audit_id', v_close.source_audit_id,
      'amount', v_close.amount, 'approved_at', v_close.approved_at,
      'physical_count_cutoff', case when v_close.source_audit_id = v_check.id then v_close.physical_count_cutoff end,
      'reconciliation', case when v_close.source_audit_id = v_check.id then v_close.reconciliation end
    ) end
  );
end;
$$;

create or replace function public.inventory_approve_closing_stock(
  p_check_id uuid, p_request_id uuid, p_reconciliation jsonb default '[]',
  p_supersedes_id uuid default null, p_correction_reason text default null,
  p_physical_count_cutoff timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_check public.inventory_stock_checks%rowtype;
  v_current inventory_authority.closing_stock_revisions%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_cutoff timestamptz;
  v_physical_cutoff timestamptz;
  v_original_submitted_at timestamptz;
  v_items uuid[];
  v_reconciliation jsonb := '[]';
  v_amount numeric;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_payload jsonb := jsonb_build_object(
    'check_id', p_check_id, 'reconciliation', p_reconciliation, 'supersedes_id', p_supersedes_id, 'reason', v_reason
  ) || case when p_physical_count_cutoff is not null then
    jsonb_build_object('physical_count_cutoff', p_physical_count_cutoff) else '{}'::jsonb end;
begin
  if v_actor is null or not public.current_user_has_permission('inventory_stock_check.view')
    or not public.current_user_has_permission('inventory_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Closing approval permission is required.';
  end if;
  select * into v_check from public.inventory_stock_checks where id = p_check_id for update;
  if not found or not public.current_user_can_access_outlet(v_check.outlet_id) then
    raise exception using errcode = '42501', message = 'Stock check is unavailable.';
  end if;
  if v_check.status <> 'submitted' or v_check.accounting_month is null or v_check.closing_item_ids is null then
    raise exception 'Submit a complete Month-End Closing audit before approval.';
  end if;
  if p_request_id is null or jsonb_typeof(p_reconciliation) is distinct from 'array' then
    raise exception 'An approval request and reconciliation lines are required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory_closing_request:' || p_request_id::text, 0));
  select * into v_close from inventory_authority.closing_stock_revisions where request_id = p_request_id;
  if found then
    if v_close.approved_by <> v_actor or v_close.request_payload <> v_payload then
      raise exception 'This request ID was already used for a different approval.';
    end if;
  else
    -- The source row lock also serializes creating a correction against approval.
    if exists (select 1 from public.inventory_stock_checks where correction_of_id = v_check.id) then
      raise exception 'This audit has a correction. Open the current submitted evidence or discard the pending draft before approval.';
    end if;
    v_cutoff := inventory_authority.month_end_cutoff(v_check.accounting_month);
    if v_cutoff > now() then raise exception 'Approval opens after the accounting month ends.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory_closing_period:' || v_check.outlet_id::text || ':' || v_check.accounting_month::text, 0
    ));
    select * into v_current from inventory_authority.closing_stock_revisions
    where outlet_id = v_check.outlet_id and accounting_month = v_check.accounting_month
    order by revision desc limit 1;
    if v_current.id is distinct from p_supersedes_id then
      raise exception 'The published close changed. Reload and confirm the current revision before approval.';
    end if;
    if (p_supersedes_id is not null and (v_reason is null or length(v_reason) > 2000))
      or (p_supersedes_id is null and v_reason is not null) then
      raise exception 'A correction requires a reason of up to 2,000 characters.';
    end if;

    select array_agg(row.item_id order by row.item_id) into v_items
    from public.inventory_stock_check_items row where row.stock_check_id = v_check.id;
    if v_items is distinct from v_check.closing_item_ids or exists (
      select 1 from public.inventory_stock_check_items row
      where row.stock_check_id = v_check.id and (
        row.skipped or row.status in ('skipped', 'na', 'pending')
        or row.actual_count_quantity is null or not (row.actual_count_quantity >= 0 and row.actual_count_quantity < 'Infinity'::numeric)
        or nullif(btrim(row.unit), '') is null
        or row.unit_cost_snapshot is null or not (row.unit_cost_snapshot >= 0 and row.unit_cost_snapshot < 'Infinity'::numeric)
      )
    ) then
      raise exception 'Approval requires a complete count and a valid pinned unit cost for every eligible item.';
    end if;

    if v_check.physical_count_cutoff is not null and p_physical_count_cutoff is not null
      and v_check.physical_count_cutoff <> p_physical_count_cutoff then
      raise exception 'The physical cutoff recorded on this audit is immutable.';
    end if;
    v_physical_cutoff := coalesce(v_check.physical_count_cutoff, p_physical_count_cutoff);
    if v_physical_cutoff is null or not isfinite(v_physical_cutoff) then
      raise exception 'Confirm the actual physical count cutoff for this audit before approval.';
    end if;
    select submitted_at into v_original_submitted_at from public.inventory_stock_checks
    where id = inventory_authority.audit_evidence_root(v_check.id);
    if v_original_submitted_at is null or v_physical_cutoff > v_original_submitted_at then
      raise exception 'The physical count cutoff must be on or before the original count submission time.';
    end if;

    if v_physical_cutoff = v_cutoff then
      if p_reconciliation <> '[]'::jsonb then
        raise exception 'A count taken at month-end uses the submitted actual quantities.';
      end if;
      select round(sum(row.actual_count_quantity * row.unit_cost_snapshot), 2) into v_amount
      from public.inventory_stock_check_items row where row.stock_check_id = v_check.id;
    else
      select array_agg((line->>'item_id')::uuid order by (line->>'item_id')::uuid) into v_items
      from jsonb_array_elements(p_reconciliation) line;
      if v_items is distinct from v_check.closing_item_ids or exists (
        select 1 from jsonb_array_elements(p_reconciliation) line
        where jsonb_typeof(line->'month_end_quantity') is distinct from 'number'
          or not ((line->>'month_end_quantity')::numeric between 0 and 99999999999.999)
          or (line->>'month_end_quantity')::numeric <> trunc((line->>'month_end_quantity')::numeric, 3)
          or jsonb_typeof(line->'evidence') is distinct from 'string'
          or length(btrim(line->>'evidence')) not between 1 and 2000
      ) then
        raise exception 'Enter a verified month-end quantity and supporting evidence for every counted item.';
      end if;
      select round(sum((line->>'month_end_quantity')::numeric * row.unit_cost_snapshot), 2),
        jsonb_agg(jsonb_build_object(
          'item_id', row.item_id, 'month_end_quantity', (line->>'month_end_quantity')::numeric,
          'evidence', btrim(line->>'evidence')
        ) order by row.item_id)
      into v_amount, v_reconciliation
      from jsonb_array_elements(p_reconciliation) line
      join public.inventory_stock_check_items row
        on row.stock_check_id = v_check.id and row.item_id = (line->>'item_id')::uuid;
    end if;

    insert into inventory_authority.closing_stock_revisions (
      outlet_id, accounting_month, revision, supersedes_id, source_audit_id,
      physical_count_cutoff, month_end_cutoff, amount, reconciliation, correction_reason,
      approved_by, approved_at, request_id, request_payload
    ) values (
      v_check.outlet_id, v_check.accounting_month, coalesce(v_current.revision, 0) + 1,
      v_current.id, v_check.id, v_physical_cutoff, v_cutoff,
      v_amount, v_reconciliation, v_reason, v_actor, now(), p_request_id, v_payload
    ) returning * into v_close;
    insert into public.audit_logs (action, module, user_id, description, metadata)
    values ('inventory_closing_stock_approved', 'inventory', v_actor, 'Month-End Closing Stock approved.',
      jsonb_build_object('closing_id', v_close.id, 'stock_check_id', v_check.id,
        'outlet_id', v_check.outlet_id, 'accounting_month', v_check.accounting_month,
        'revision', v_close.revision, 'supersedes_id', v_current.id, 'request_id', p_request_id));
  end if;
  return jsonb_build_object('id', v_close.id, 'revision', v_close.revision,
    'source_audit_id', v_close.source_audit_id, 'amount', v_close.amount, 'approved_at', v_close.approved_at,
    'physical_count_cutoff', v_close.physical_count_cutoff);
end;
$$;

create or replace function public.crew_inventory_stock_checks(p_token text,p_outlet_id uuid default null,p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'stock_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid;
  v_today date:=timezone('Asia/Kuala_Lumpur',now())::date;
  v_check public.inventory_stock_checks%rowtype;
  v_detail jsonb;
begin
  if p_check_id is not null then
    select * into v_check from public.inventory_stock_checks where id=p_check_id and outlet_id=v_outlet;
    if not found or (v_check.correction_of_id is not null and v_check.status = 'draft') then raise exception using errcode='42501',message='Stock check is unavailable for this outlet.'; end if;
    if (v_check.status in ('submitted','skipped') or v_check.stock_check_type='scheduled' and v_check.check_date<v_today)
      and v_check.check_date<
        (date_trunc('month',timezone('Asia/Kuala_Lumpur',now()))-interval '1 month')::date then
      raise exception using errcode='42501',message='Stock check is outside Crew history.';
    end if;
    if (v_check.stock_check_type='audit' and not coalesce((v_context->>'can_create_audit_stock_check')::boolean,false))
      or (v_check.stock_check_type='scheduled' and not coalesce((v_context->>'can_perform_stock_check')::boolean,false)) then
      raise exception using errcode='42501',message='Stock check capability is unavailable.';
    end if;
    select jsonb_build_object('id',c.id,'type',c.stock_check_type,
      'status',case when c.stock_check_type='scheduled' and c.status='draft'
          then case when c.check_date<v_today then 'missed' else 'in_progress' end
        when c.status='submitted' then 'completed' else c.status end,
      'group_id',c.group_id,'check_name',c.check_name,'audit_name',c.audit_name,
      'audit_type',c.audit_type,'audit_category_ids',c.audit_category_ids,'check_date',c.check_date,
      'shift',c.shift,'notes',c.notes,'created_at',c.created_at,'submitted_at',c.submitted_at,
      'accounting_month',c.accounting_month,'physical_count_cutoff',c.physical_count_cutoff,
      'correction_of_id',c.correction_of_id,'correction_reason',c.correction_reason,
      'superseded',exists(select 1 from public.inventory_stock_checks next
        where next.correction_of_id=c.id and next.status='submitted'),
      'skipped_at',c.skipped_at,'skipped_by_employee_id',c.skipped_by_employee_id,
      'skipped_by_name',(select e.full_name from public.employees e where e.id=c.skipped_by_employee_id),
      'skip_reason',c.skip_reason,'outlet_id',c.outlet_id,
      'items',case when c.stock_check_type='scheduled' and c.status='draft' and c.check_date<v_today
        then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',ci.id,'item_id',ci.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'category_id',ci.category_id,
        'par_level_quantity',ci.par_level_quantity,'actual_count_quantity',ci.actual_count_quantity,
        'variance',ci.variance,'unit',ci.unit,'status',ci.status,'notes',ci.notes,
        'skipped',ci.skipped,'skip_reason',ci.skip_reason,'photo_url',i.photo_url) order by i.item_name,ci.id)
        from public.inventory_stock_check_items ci left join public.inventory_items i on i.id=ci.item_id
        where ci.stock_check_id=c.id),'[]'::jsonb) end) into v_detail
      from public.inventory_stock_checks c where c.id=p_check_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,'business_date',v_today,
    'can_perform_stock_check',v_context->'can_perform_stock_check',
    'can_create_audit_stock_check',v_context->'can_create_audit_stock_check',
    'due',case when coalesce((v_context->>'can_perform_stock_check')::boolean,false) then coalesce((
      select jsonb_agg(jsonb_build_object('group_id',g.id,'name',g.name,'shift',g.shift,
        'business_date',v_today,'status',case when check_row.status='submitted' then 'completed'
          when check_row.status='skipped' then 'skipped'
          when check_row.status='draft' then 'in_progress' else 'due' end,
        'check_id',check_row.id,
        'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',i.id,
          'item_name',i.item_name,'sku_code',i.sku_code,'category_id',i.category_id,
          'par_level_quantity',io.par_level,'unit',i.unit) order by i.item_name,i.id)
          from public.inventory_item_outlets io join public.inventory_items i on i.id=io.inventory_item_id
          where io.outlet_id=v_outlet and io.is_active and i.status='active'
            and exists(select 1 from public.inventory_stock_check_group_categories gc
              where gc.group_id=g.id and gc.category_id=i.category_id)),'[]'::jsonb)) order by g.name,g.id)
      from public.inventory_stock_check_groups g
      left join lateral (select c.id,c.status from public.inventory_stock_checks c
        where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=v_today
          and c.stock_check_type='scheduled'
        order by case c.status when 'submitted' then 0 when 'skipped' then 1 else 2 end,
          c.updated_at desc,c.id limit 1) check_row on true
      where g.outlet_id=v_outlet and inventory_authority.stock_group_due(g,v_today)
    ),'[]'::jsonb) else '[]'::jsonb end,
    'checks',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select row_data,sort_at from (
        select jsonb_build_object('id',c.id,'type',c.stock_check_type,
          'status',case when c.stock_check_type='scheduled' and c.status='draft'
            then case when c.check_date<v_today then 'missed' else 'in_progress' end
            when c.status='submitted' then 'completed' else c.status end,
          'name',coalesce(c.audit_name,c.check_name,g.name),'group_id',c.group_id,
          'audit_type',c.audit_type,'check_date',c.check_date,'shift',c.shift,
          'submitted_at',c.submitted_at,'skipped_at',c.skipped_at,
          'skipped_by_employee_id',c.skipped_by_employee_id,'skip_reason',c.skip_reason,
          'updated_at',c.updated_at,
          'cover_item_id',(select ci.item_id from public.inventory_stock_check_items ci
            where ci.stock_check_id=c.id order by ci.id limit 1),
          'cover_photo_url',(select i.photo_url from public.inventory_stock_check_items ci
            join public.inventory_items i on i.id=ci.item_id
            where ci.stock_check_id=c.id order by ci.id limit 1),
          'item_count',(select count(*) from public.inventory_stock_check_items ci
            where ci.stock_check_id=c.id)) row_data,
          case when c.stock_check_type='scheduled' and c.status='draft' and c.check_date<v_today
            then (c.check_date::timestamp at time zone 'Asia/Kuala_Lumpur') else coalesce(c.submitted_at,c.skipped_at,c.updated_at) end sort_at
        from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
        where c.outlet_id=v_outlet and c.status='draft' and c.correction_of_id is null
          and (c.stock_check_type='audit' or c.check_date>=v_today)
          and (c.stock_check_type='audit' or c.id=(select c2.id from public.inventory_stock_checks c2
            where c2.outlet_id=c.outlet_id and c2.group_id=c.group_id
              and c2.check_date=c.check_date and c2.shift is not distinct from c.shift
              and c2.stock_check_type='scheduled'
            order by case c2.status when 'submitted' then 0 when 'skipped' then 1 else 2 end,
              c2.updated_at desc,c2.id limit 1))
          and ((c.stock_check_type='scheduled' and coalesce((v_context->>'can_perform_stock_check')::boolean,false))
            or (c.stock_check_type='audit' and coalesce((v_context->>'can_create_audit_stock_check')::boolean,false)))
        union all
        select jsonb_build_object('id',null,'type','scheduled','status','missed',
          'name',g.name,'group_id',g.id,'check_date',day.run_date,'shift',g.shift,
          'item_count',null,'outlet_id',v_outlet) row_data,
          (day.run_date::timestamp at time zone 'Asia/Kuala_Lumpur') sort_at
        from public.inventory_stock_check_groups g
        cross join lateral (select series::date run_date from generate_series(
          (v_today-7)::timestamp,(v_today-1)::timestamp,interval '1 day') series) day
        where g.outlet_id=v_outlet
          and coalesce((v_context->>'can_perform_stock_check')::boolean,false)
          and day.run_date>=timezone('Asia/Kuala_Lumpur',g.created_at)::date
          and inventory_authority.stock_group_due(g,day.run_date)
          and not exists(select 1 from public.inventory_stock_checks c
            where c.group_id=g.id and c.outlet_id=v_outlet and c.check_date=day.run_date
              and c.stock_check_type='scheduled')
      ) all_rows order by sort_at desc limit 120) bounded),'[]'::jsonb),
    'detail',v_detail);
end; $$;

create or replace function public.inventory_dashboard_stock_evidence(p_outlet_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_dashboard.view') then
    raise exception 'Inventory Dashboard access is required.' using errcode = '42501';
  end if;
  if p_outlet_ids is null or cardinality(p_outlet_ids) = 0
     or exists (select 1 from unnest(p_outlet_ids) as requested(outlet_id)
                where requested.outlet_id is null or not public.current_user_can_access_outlet(requested.outlet_id)) then
    raise exception 'Inventory outlet scope is unavailable.' using errcode = '42501';
  end if;

  with recursive applicable as (
    select link.outlet_id, link.inventory_item_id as item_id,
           link.par_level as current_par
    from public.inventory_item_outlets link
    join public.inventory_items item on item.id = link.inventory_item_id
    where link.outlet_id = any(p_outlet_ids)
      and link.is_active is not false
      and coalesce(lower(item.status), 'active') not in ('inactive', 'archived', 'deleted')
      and link.par_level > 0
  ),
  scoped_submitted as materialized (
    select check_header.id, check_header.outlet_id, check_header.check_date,
           check_header.submitted_at, check_header.created_at, check_header.correction_of_id
    from public.inventory_stock_checks check_header
    where check_header.outlet_id = any(p_outlet_ids)
      and check_header.status in ('submitted', 'reviewed', 'locked')
  ),
  current_headers as (
    select audit.* from scoped_submitted audit where not exists (
      select 1 from scoped_submitted successor where successor.correction_of_id = audit.id)
  ),
  correction_sources as (
    select audit.id as evidence_id, audit.id, audit.correction_of_id, audit.submitted_at, audit.created_at
    from current_headers audit where audit.correction_of_id is not null
    union all
    select lineage.evidence_id, source.id, source.correction_of_id, source.submitted_at, source.created_at
    from correction_sources lineage join scoped_submitted source on source.id = lineage.correction_of_id
  ),
  scoped_headers as materialized (
    -- The correction records new evidence about the original count, not a later physical count.
    select audit.id, audit.outlet_id, audit.check_date,
           case when source.id is not null then source.submitted_at else audit.submitted_at end as submitted_at,
           coalesce(source.created_at, audit.created_at) as created_at,
           coalesce(source.id, audit.id) as count_id
    from current_headers audit left join correction_sources source
      on source.evidence_id = audit.id and source.correction_of_id is null
  ),
  scoped_rows as materialized (
    select row.*
    from inventory_projection.authorized_stock_check_rows(
      array(select check_header.id from scoped_headers check_header)
    ) row
  ),
  latest as (
    select distinct on (check_header.outlet_id, row.item_id)
           check_header.outlet_id, row.item_id, check_header.id as check_id,
           row.id as check_row_id, check_header.check_date,
           check_header.submitted_at, row.actual_count_quantity,
           row.par_level_quantity as submitted_par, row.skipped,
           row.status as row_status
    from scoped_headers check_header
    join scoped_rows row on row.stock_check_id = check_header.id
    join applicable position on position.outlet_id = check_header.outlet_id
                            and position.item_id = row.item_id
    order by check_header.outlet_id, row.item_id,
             coalesce(check_header.submitted_at::text, check_header.check_date::text,
                      check_header.created_at::date::text) desc,
             check_header.created_at desc, check_header.count_id, row.id
  ),
  evaluated as (
    select position.outlet_id, position.item_id, position.current_par,
           evidence.check_id, evidence.check_row_id, evidence.check_date,
           evidence.submitted_at, evidence.actual_count_quantity,
           evidence.submitted_par, evidence.skipped, evidence.row_status,
           coalesce(movement_state.has_after, false) as has_after,
           coalesce(movement_state.has_uncertain, false) as has_uncertain
    from applicable position
    left join latest evidence on evidence.outlet_id = position.outlet_id
                             and evidence.item_id = position.item_id
    left join lateral (
      select bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null
                 then movement.created_at > evidence.submitted_at
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date > evidence.check_date
               else false end) as has_after,
             bool_or(case
               when movement.created_at is not null and evidence.submitted_at is not null then false
               when movement.created_at is not null and evidence.check_date is not null
                 then (movement.created_at at time zone 'UTC')::date = evidence.check_date
               else true end) as has_uncertain
      from public.inventory_movements movement
      where evidence.check_id is not null
        and movement.outlet_id = position.outlet_id
        and movement.inventory_item_id = position.item_id
        and movement.quantity is not null and movement.quantity <> 0
    ) movement_state on true
  ),
  classified as (
    select *, case
      when check_id is null or skipped or row_status = 'na' or actual_count_quantity is null
        then 'unverified'
      when has_after then 'changed'
      when has_uncertain then 'unverified'
      when actual_count_quantity < current_par then 'below_par'
      else 'sufficient' end as evidence_state
    from evaluated
  )
  select jsonb_build_object(
    'position_count', count(*),
    'positions', coalesce(jsonb_agg(jsonb_build_object(
      'outlet_id', outlet_id, 'item_id', item_id,
      'state', evidence_state, 'check_id', check_id,
      'check_row_id', check_row_id, 'check_date', check_date,
      'submitted_at', submitted_at, 'actual_count', actual_count_quantity,
      'current_par', current_par, 'submitted_par', submitted_par,
      'movement_relation', case when has_after then 'after'
                                when has_uncertain then 'uncertain' else 'none' end
    ) order by outlet_id, item_id), '[]'::jsonb)
  ) into v_result
  from classified;

  return v_result;
end;
$function$;
