-- Retain previously attested dates and allow an unknown actual count date on legacy evidence.
alter table inventory_authority.closing_stock_revisions
  drop constraint closing_stock_valuation_evidence_check,
  add constraint closing_stock_valuation_evidence_check check (
    (actual_count_date is null and physical_count_cutoff is not null
      and amount is not null and valuation_status = 'complete' and valued_item_count is null and total_item_count is null)
    or (coalesce(isfinite(actual_count_date), true)
      and physical_count_cutoff is null and reconciliation = '[]'::jsonb
      and valued_item_count is not null and total_item_count is not null
      and total_item_count > 0 and valued_item_count between 0 and total_item_count
      and (amount is null) = (valued_item_count = 0)
      and valuation_status = case when valued_item_count = total_item_count then 'complete' else 'partial' end)
  );

create or replace function inventory_authority.publish_closing_stock(
  p_check_id uuid, p_request_id uuid, p_actual_count_date date, p_from_submission boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_check public.inventory_stock_checks%rowtype;
  v_current inventory_authority.closing_stock_revisions%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_cutoff timestamptz;
  v_recorded_count_date date;
  v_original_submitted_at timestamptz;
  v_count_date date;
  v_root uuid;
  v_reason text;
  v_items uuid[];
  v_valued integer;
  v_total integer;
  v_status text;
  v_amount numeric;
  v_payload jsonb := jsonb_build_object(
    'check_id', p_check_id, 'count_date_input', p_actual_count_date, 'from_submission', p_from_submission
  );
begin
  if v_actor is null or not public.current_user_has_permission('inventory_stock_check.view')
    or not public.current_user_has_permission('inventory_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Closing Stock publication permission is required.';
  end if;
  select * into v_check from public.inventory_stock_checks where id = p_check_id for update;
  if not found or not public.current_user_can_access_outlet(v_check.outlet_id) then
    raise exception using errcode = '42501', message = 'Stock check is unavailable.';
  end if;
  if v_check.status <> 'submitted' or v_check.audit_type is distinct from 'Month-End Closing' or v_check.accounting_month is null or v_check.closing_item_ids is null then
    raise exception 'A complete submitted Month-End Closing audit is required.';
  end if;
  if p_request_id is null then raise exception 'A publication request is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory_closing_request:' || p_request_id::text, 0));
  select * into v_close from inventory_authority.closing_stock_revisions where request_id = p_request_id;
  if found then
    if v_close.approved_by <> v_actor or v_close.request_payload <> v_payload then
      raise exception 'This request ID was already used for a different publication.';
    end if;
  else
    -- The source row lock also serializes creating a correction against approval.
    if exists (select 1 from public.inventory_stock_checks where correction_of_id = v_check.id) then
      raise exception 'This audit has a correction. Open the current submitted evidence or discard the pending draft before publishing.';
    end if;
    v_cutoff := inventory_authority.month_end_cutoff(v_check.accounting_month);
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory_closing_period:' || v_check.outlet_id::text || ':' || v_check.accounting_month::text, 0
    ));
    select * into v_current from inventory_authority.closing_stock_revisions
    where outlet_id = v_check.outlet_id and accounting_month = v_check.accounting_month
    order by revision desc limit 1;
    v_root := inventory_authority.audit_evidence_root(v_check.id);
    if v_current.source_audit_id = v_check.id then
      raise exception 'This audit is already published.';
    end if;
    if v_current.id is not null then
      if inventory_authority.audit_evidence_root(v_current.source_audit_id) is distinct from v_root then
        raise exception 'This outlet already has a Closing Stock publication for this month. Edit the published closing to update it.';
      end if;
      v_reason := nullif(btrim(v_check.correction_reason), '');
      if v_reason is null then raise exception 'A Closing Stock update needs a correction reason.'; end if;
    end if;

    select array_agg(row.item_id order by row.item_id) into v_items
    from public.inventory_stock_check_items row where row.stock_check_id = v_check.id;
    if v_items is distinct from v_check.closing_item_ids or exists (
      select 1 from public.inventory_stock_check_items row
      where row.stock_check_id = v_check.id and (
        row.skipped or row.status in ('skipped', 'na', 'pending')
        or row.actual_count_quantity is null or not (row.actual_count_quantity >= 0 and row.actual_count_quantity < 'Infinity'::numeric)
        or nullif(btrim(row.unit), '') is null
      )
    ) then
      raise exception 'Publication requires a complete count and recorded unit for every eligible item.';
    end if;

    select submitted_at, (physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date
    into v_original_submitted_at, v_recorded_count_date
    from public.inventory_stock_checks where id = v_root;
    if v_recorded_count_date is not null and p_actual_count_date is not null
      and p_actual_count_date <> v_recorded_count_date then
      raise exception 'The actual count date recorded on the original audit is immutable.';
    end if;
    v_count_date := coalesce(v_recorded_count_date, p_actual_count_date,
      v_current.actual_count_date, (v_current.physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date);
    if p_from_submission and v_check.correction_of_id is null and v_count_date is null then
      raise exception 'Enter the actual count date (MYT) before submitting this closing.';
    end if;
    if v_count_date is not null and (not isfinite(v_count_date) or v_original_submitted_at is null
      or v_count_date > (v_original_submitted_at at time zone 'Asia/Kuala_Lumpur')::date) then
      raise exception 'The actual count date must be on or before the original submission date (MYT).';
    end if;

    -- Pinned costs already carry the submitted count unit basis. A missing pin stays unvalued.
    select count(*), round(sum(row.actual_count_quantity * row.unit_cost_snapshot), 2)
    into v_valued, v_amount
    from public.inventory_stock_check_items row
    where row.stock_check_id = v_check.id and row.unit_cost_snapshot >= 0 and row.unit_cost_snapshot < 'Infinity'::numeric;
    v_total := cardinality(v_items);
    v_status := case when v_valued = v_total then 'complete' else 'partial' end;

    insert into inventory_authority.closing_stock_revisions (
      outlet_id, accounting_month, revision, supersedes_id, source_audit_id,
      month_end_cutoff, amount, reconciliation, correction_reason, actual_count_date,
      valuation_status, valued_item_count, total_item_count, approved_by, approved_at, request_id, request_payload
    ) values (
      v_check.outlet_id, v_check.accounting_month, coalesce(v_current.revision, 0) + 1,
      v_current.id, v_check.id, v_cutoff, v_amount, '[]', v_reason, v_count_date,
      v_status, v_valued, v_total, v_actor, now(), p_request_id, v_payload
    ) returning * into v_close;
    insert into public.audit_logs (action, module, user_id, description, metadata)
    values ('inventory_closing_stock_published', 'inventory', v_actor, 'Month-End Closing Stock published.',
      jsonb_build_object('closing_id', v_close.id, 'stock_check_id', v_check.id,
        'outlet_id', v_check.outlet_id, 'accounting_month', v_check.accounting_month,
        'revision', v_close.revision, 'supersedes_id', v_current.id, 'request_id', p_request_id,
        'valuation_status', v_status, 'valued_item_count', v_valued, 'total_item_count', v_total,
        'actual_count_date', v_count_date));
  end if;
  return jsonb_build_object('id', v_close.id, 'revision', v_close.revision,
    'source_audit_id', v_close.source_audit_id, 'amount', v_close.amount, 'approved_at', v_close.approved_at,
    'valuation_status', v_close.valuation_status, 'valued_item_count', v_close.valued_item_count,
    'total_item_count', v_close.total_item_count, 'actual_count_date', v_close.actual_count_date);
end;
$$;

revoke all on function inventory_authority.publish_closing_stock(uuid,uuid,date,boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.inventory_approve_closing_stock(uuid,uuid,date,date,uuid,text)
  from public, anon, authenticated, service_role;

-- Existing submitted evidence is published explicitly, with only its recorded date if available.
create function public.inventory_publish_existing_closing(p_check_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select inventory_authority.publish_closing_stock(p_check_id, p_request_id, null, false);
$$;
revoke all on function public.inventory_publish_existing_closing(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.inventory_publish_existing_closing(uuid,uuid) to authenticated;

create or replace function inventory_authority.audit_correction_block(p_source public.inventory_stock_checks)
returns text language sql stable set search_path = '' as $$
  select case
    when (p_source).audit_type = 'Month-End Closing' and ((p_source).accounting_month is null or (p_source).closing_item_ids is null)
      then 'This historical closing has no frozen eligible roster. Start a new closing audit for corrected evidence.'
    when (select count(*) = 0 or count(distinct item_id) <> count(*)
        from public.inventory_stock_check_items where stock_check_id = (p_source).id)
      then 'This historical audit has missing or duplicate item references and cannot be copied.'
    when (p_source).accounting_month is not null and (
      (select array_agg(item_id order by item_id) from public.inventory_stock_check_items
        where stock_check_id = (p_source).id) is distinct from (p_source).closing_item_ids
      or exists (select 1 from public.inventory_stock_check_items item where item.stock_check_id = (p_source).id and
        nullif(btrim(item.unit), '') is null)
    ) then 'This closing lacks a complete frozen roster or recorded count units.'
  end;
$$;

create or replace function inventory_authority.save_audit_correction(
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
  v_source_notes text;
  v_notes text;
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
      nullif(btrim(row.unit), '') is null
  ) then
    raise exception 'Every closing item requires its original count unit.';
  end if;
  v_notes := case when v_check.accounting_month is not null and p_check ? 'notes'
    then nullif(p_check->>'notes','') else v_check.notes end;
  select notes into v_source_notes from public.inventory_stock_checks where id = v_check.correction_of_id;
  if v_status = 'submitted' and v_notes is not distinct from v_source_notes and not exists (
    select 1 from jsonb_array_elements(p_items) line
    join public.inventory_stock_check_items prior on prior.stock_check_id = v_check.correction_of_id
      and prior.item_id = (line->>'item_id')::uuid
    where (line->>'actual_count_quantity')::numeric is distinct from prior.actual_count_quantity
      or nullif(line->>'notes','') is distinct from nullif(prior.notes,'')
  ) then
    raise exception 'Change a quantity or note before submitting the correction.';
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

  update public.inventory_stock_checks set correction_reason = v_reason, notes = v_notes, status = v_status, updated_at = v_now,
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
  v_result jsonb;
  v_closing jsonb;
begin
  if exists (select 1 from public.inventory_stock_checks where id = v_id and correction_of_id is not null) then
    v_result := inventory_authority.save_audit_correction(v_id, p_request_id, p_check, p_items,
      p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
  else
    v_result := feedx_integrations.ra_save_stock_check(null::uuid, p_request_id, p_check, p_items,
      p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
  end if;

  -- A rejection rolls back submission, cost pinning and the request log together.
  if v_result->'check'->>'status' = 'submitted' and v_result->'check'->>'audit_type' = 'Month-End Closing' then
    if p_actor_kind <> 'admin' or p_actor_user is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'Save the closing draft for an authorized Admin to submit.';
    end if;
    if p_check->'publish_closing' is distinct from 'true'::jsonb then
      raise exception 'Reload FeedX to submit and publish this closing together.';
    end if;
    v_closing := inventory_authority.publish_closing_stock(
      (v_result->'check'->>'id')::uuid, p_request_id, nullif(p_check->>'actual_count_date','')::date, true);
    return v_result || jsonb_build_object('closing', v_closing);
  end if;
  return v_result;
end;
$$;

create or replace function public.inventory_closing_context(p_check_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_month_end timestamptz;
  v_root public.inventory_stock_checks%rowtype;
  v_source_item_count integer;
  v_same_evidence boolean := false;
  v_prior_actual_date date;
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
    v_same_evidence := true;
    v_prior_actual_date := coalesce(v_close.actual_count_date,
      (v_close.physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date);
  end if;
  if v_close.id is not null and v_close.total_item_count is null then
    select cardinality(c.closing_item_ids) into v_source_item_count
    from public.inventory_stock_checks c where c.id = v_close.source_audit_id;
  end if;
  return jsonb_build_object(
    'count_evidence_submitted_at', v_root.submitted_at,
    'prior_actual_count_date', v_prior_actual_date,
    'same_evidence_chain', v_same_evidence,
    'approval_blocked', exists (select 1 from public.inventory_stock_checks where correction_of_id = v_check.id),
    'month_end_cutoff', v_month_end, 'period_ended', v_month_end <= now(),
    'published', case when v_close.id is not null then jsonb_build_object(
      'id', v_close.id, 'revision', v_close.revision, 'source_audit_id', v_close.source_audit_id,
      'amount', v_close.amount, 'approved_at', v_close.approved_at,
      'valuation_status', v_close.valuation_status,
      'valued_item_count', coalesce(v_close.valued_item_count, v_source_item_count),
      'total_item_count', coalesce(v_close.total_item_count, v_source_item_count),
      'actual_count_date', coalesce(v_close.actual_count_date,
        (v_close.physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date)
    ) end
  );
end;
$$;

notify pgrst, 'reload schema';
