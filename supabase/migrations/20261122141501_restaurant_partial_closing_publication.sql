-- Preserve prior publication rows and their original reconciliation evidence.
alter table inventory_authority.closing_stock_revisions
  alter column physical_count_cutoff drop not null,
  alter column amount drop not null,
  add column actual_count_date date,
  add column valuation_status text not null default 'complete',
  add column valued_item_count integer,
  add column total_item_count integer,
  add constraint closing_stock_valuation_evidence_check check (
    (actual_count_date is null and physical_count_cutoff is not null
      and amount is not null and valuation_status = 'complete' and valued_item_count is null and total_item_count is null)
    or (actual_count_date is not null and isfinite(actual_count_date)
      and physical_count_cutoff is null and reconciliation = '[]'::jsonb
      and valued_item_count is not null and total_item_count is not null
      and total_item_count > 0 and valued_item_count between 0 and total_item_count
      and (amount is null) = (valued_item_count = 0)
      and valuation_status = case when valued_item_count = total_item_count then 'complete' else 'partial' end)
  );

create or replace function public.inventory_closing_context(p_check_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_month_end timestamptz;
  v_root public.inventory_stock_checks%rowtype;
  v_source_item_count integer;
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

create or replace function public.inventory_approve_closing_stock(
  p_check_id uuid, p_request_id uuid, p_confirmed_closing_month date,
  p_actual_count_date date, p_supersedes_id uuid, p_correction_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_check public.inventory_stock_checks%rowtype;
  v_current inventory_authority.closing_stock_revisions%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_cutoff timestamptz;
  v_recorded_count_date date;
  v_original_submitted_at timestamptz;
  v_items uuid[];
  v_valued integer;
  v_total integer;
  v_status text;
  v_amount numeric;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_payload jsonb := jsonb_build_object(
    'check_id', p_check_id, 'closing_month', p_confirmed_closing_month, 'actual_count_date', p_actual_count_date,
    'supersedes_id', p_supersedes_id, 'reason', v_reason
  );
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
  if p_request_id is null then raise exception 'An approval request is required.'; end if;
  if p_confirmed_closing_month is distinct from v_check.accounting_month then
    raise exception 'Confirm the Closing Month recorded on this audit.';
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
      )
    ) then
      raise exception 'Approval requires a complete count and recorded unit for every eligible item.';
    end if;

    select submitted_at, (physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date
    into v_original_submitted_at, v_recorded_count_date
    from public.inventory_stock_checks where id = inventory_authority.audit_evidence_root(v_check.id);
    if v_recorded_count_date is not null and p_actual_count_date is distinct from v_recorded_count_date then
      raise exception 'The actual count date recorded on the original audit is immutable.';
    end if;
    if p_actual_count_date is null or not isfinite(p_actual_count_date) or v_original_submitted_at is null
      or p_actual_count_date > (v_original_submitted_at at time zone 'Asia/Kuala_Lumpur')::date then
      raise exception 'Confirm the actual count date on or before the original count submission date (MYT).';
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
      v_current.id, v_check.id, v_cutoff, v_amount, '[]', v_reason, p_actual_count_date,
      v_status, v_valued, v_total, v_actor, now(), p_request_id, v_payload
    ) returning * into v_close;
    insert into public.audit_logs (action, module, user_id, description, metadata)
    values ('inventory_closing_stock_approved', 'inventory', v_actor, 'Month-End Closing Stock approved.',
      jsonb_build_object('closing_id', v_close.id, 'stock_check_id', v_check.id,
        'outlet_id', v_check.outlet_id, 'accounting_month', v_check.accounting_month,
        'revision', v_close.revision, 'supersedes_id', v_current.id, 'request_id', p_request_id,
        'valuation_status', v_status, 'valued_item_count', v_valued, 'total_item_count', v_total,
        'actual_count_date', p_actual_count_date));
  end if;
  return jsonb_build_object('id', v_close.id, 'revision', v_close.revision,
    'source_audit_id', v_close.source_audit_id, 'amount', v_close.amount, 'approved_at', v_close.approved_at,
    'valuation_status', v_close.valuation_status, 'valued_item_count', v_close.valued_item_count,
    'total_item_count', v_close.total_item_count, 'actual_count_date', v_close.actual_count_date);
end;
$$;

revoke all on function public.inventory_approve_closing_stock(uuid, uuid, date, date, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.inventory_approve_closing_stock(uuid, uuid, date, date, uuid, text) to authenticated;

-- An open tab can replay a previous approval, but must collect the new confirmation before publishing.
create or replace function public.inventory_approve_closing_stock(
  p_check_id uuid, p_request_id uuid, p_reconciliation jsonb default '[]',
  p_supersedes_id uuid default null, p_correction_reason text default null,
  p_physical_count_cutoff timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_payload jsonb := jsonb_build_object('check_id', p_check_id, 'reconciliation', p_reconciliation,
    'supersedes_id', p_supersedes_id, 'reason', nullif(btrim(p_correction_reason), ''))
    || case when p_physical_count_cutoff is not null then
      jsonb_build_object('physical_count_cutoff', p_physical_count_cutoff) else '{}'::jsonb end;
begin
  if auth.uid() is null or not public.current_user_has_permission('inventory_stock_check.view')
    or not public.current_user_has_permission('inventory_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Closing approval permission is required.';
  end if;
  select * into v_close from inventory_authority.closing_stock_revisions
  where request_id = p_request_id and source_audit_id = p_check_id and approved_by = auth.uid();
  if not found or not public.current_user_can_access_outlet(v_close.outlet_id)
    or v_close.request_payload <> v_payload then
    raise exception 'Reload FeedX to confirm the actual count date and Closing Month.';
  end if;
  return jsonb_build_object('id', v_close.id, 'revision', v_close.revision,
    'source_audit_id', v_close.source_audit_id, 'amount', v_close.amount, 'approved_at', v_close.approved_at,
    'physical_count_cutoff', v_close.physical_count_cutoff);
end;
$$;

create or replace function public.reporting_monthly_scope_financials(
  p_outlet_id uuid,
  p_year integer,
  p_month integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope_count integer;
  v_outlet_name text;
  v_outlet_code text;
  v_sales_outlet_count integer;
  v_purchase_outlet_count integer;
  v_opex_outlet_count integer;
  v_has_sales boolean;
  v_has_purchases boolean;
  v_has_opex boolean;
  v_revenue numeric;
  v_purchase_based_cogs numeric;
  v_opex numeric;
  v_complete boolean;
  v_closing_stock numeric;
  v_published_outlets integer;
  v_closing_evidence jsonb;
begin
  if p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid reporting period is required.';
  end if;

  select count(*), max(outlet_name), max(outlet_code)
  into v_scope_count, v_outlet_name, v_outlet_code
  from public.reporting_scope_outlets(p_outlet_id);

  select count(distinct s.outlet_id), coalesce(sum(case
    when coalesce(c.type, 'channel') = 'channel' then s.amount
    when coalesce(c.type, 'channel') = 'adjustment' then -abs(s.amount)
    else 0
  end), 0)
  into v_sales_outlet_count, v_revenue
  from public.sales_records s
  left join public.sales_channels c on c.id = s.channel_id
  where s.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and s.year = p_year and s.month = p_month;

  select count(distinct p.outlet_id), coalesce(sum(p.amount), 0)
  into v_purchase_outlet_count, v_purchase_based_cogs
  from public.purchase_records p
  where p.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and p.year = p_year and p.month = p_month;

  select count(distinct e.outlet_id), coalesce(sum(e.amount), 0)
  into v_opex_outlet_count, v_opex
  from public.operating_expenses e
  where e.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and e.year = p_year and e.month = p_month;

  v_has_sales := v_sales_outlet_count = v_scope_count;
  v_has_purchases := v_purchase_outlet_count = v_scope_count;
  v_has_opex := v_opex_outlet_count = v_scope_count;
  v_complete := v_has_sales and v_has_purchases and v_has_opex;

  select count(closing.id), sum(closing.amount),
    jsonb_build_object(
      'amount', sum(closing.amount),
      'valuation_status', case when bool_or(closing.valuation_status = 'partial') then 'partial' else 'complete' end,
      'valued_item_count', case when count(closing.valued_item_count) = v_scope_count then sum(closing.valued_item_count) end,
      'total_item_count', case when count(closing.total_item_count) = v_scope_count then sum(closing.total_item_count) end,
      'actual_count_date', case when min(closing.actual_count_date) = max(closing.actual_count_date)
        and count(closing.actual_count_date) = v_scope_count then min(closing.actual_count_date) end
    )
  into v_published_outlets, v_closing_stock, v_closing_evidence
  from public.reporting_scope_outlets(p_outlet_id) outlet
  left join lateral (
    select publication.id, publication.amount, publication.valuation_status,
      coalesce(publication.valued_item_count, cardinality(source.closing_item_ids)) as valued_item_count,
      coalesce(publication.total_item_count, cardinality(source.closing_item_ids)) as total_item_count,
      coalesce(publication.actual_count_date,
        (publication.physical_count_cutoff at time zone 'Asia/Kuala_Lumpur')::date) as actual_count_date
    from inventory_authority.closing_stock_revisions publication
    join public.inventory_stock_checks source on source.id = publication.source_audit_id
    where publication.outlet_id = outlet.outlet_id
      and publication.accounting_month = make_date(p_year, p_month, 1)
    order by publication.revision desc limit 1
  ) closing on true;

  return jsonb_build_object(
    'outlet', jsonb_build_object(
      'id', p_outlet_id,
      'name', case when p_outlet_id is null then 'All Outlets' else v_outlet_name end,
      'code', case when p_outlet_id is null then null else v_outlet_code end,
      'scope', case when p_outlet_id is null then 'all' else 'outlet' end,
      'outlet_count', v_scope_count
    ),
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'financials', jsonb_build_object(
      'revenue', jsonb_build_object('amount', case when v_has_sales then v_revenue else null end, 'presence', case when v_has_sales then 'present' else 'missing' end),
      'purchase_based_cogs', jsonb_build_object('amount', case when v_has_purchases then v_purchase_based_cogs else null end, 'presence', case when v_has_purchases then 'present' else 'missing' end),
      'opex', jsonb_build_object('amount', case when v_has_opex then v_opex else null end, 'presence', case when v_has_opex then 'present' else 'missing' end),
      'net_profit', jsonb_build_object('amount', case when v_complete then v_revenue - v_purchase_based_cogs - v_opex else null end, 'presence', case when v_complete then 'present' else 'missing' end)
    ),
    -- Older P&L clients cannot label partial values.
    'closing_stock', case when v_published_outlets = v_scope_count
      and v_closing_evidence->>'valuation_status' = 'complete' then v_closing_stock end,
    'closing_stock_evidence', case when v_scope_count > 0 and v_published_outlets = v_scope_count then v_closing_evidence end,
    'financial_completeness', case when v_complete then 'complete' else 'incomplete' end
  );
end; $$;

notify pgrst, 'reload schema';
