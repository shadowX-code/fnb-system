-- Closing evidence stays in Stock Check. Publication is an append-only Inventory decision.
alter table public.inventory_stock_checks
  add column accounting_month date,
  add column physical_count_cutoff timestamptz,
  add column closing_item_ids uuid[],
  add constraint inventory_stock_check_closing_metadata_check check (
    (accounting_month is null and physical_count_cutoff is null and closing_item_ids is null)
    or (
      stock_check_type = 'audit' and audit_type is not distinct from 'Month-End Closing'
      and accounting_month is not null and extract(day from accounting_month) = 1
      and extract(year from accounting_month) between 2000 and 2100
      and physical_count_cutoff is not null and isfinite(physical_count_cutoff)
      and (status <> 'submitted' or (closing_item_ids is not null and cardinality(closing_item_ids) > 0))
    )
  );

revoke truncate on public.inventory_stock_checks, public.inventory_stock_check_items from public, anon, authenticated;

insert into public.permissions (code, module, description)
values ('inventory_stock_check.approve', 'Stock Check', 'Approve and revise Month-End Closing Stock.')
on conflict (code) do nothing;

create table inventory_authority.closing_stock_revisions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  accounting_month date not null,
  revision integer not null check (revision >= 1),
  supersedes_id uuid references inventory_authority.closing_stock_revisions(id),
  source_audit_id uuid not null references public.inventory_stock_checks(id),
  physical_count_cutoff timestamptz not null,
  month_end_cutoff timestamptz not null,
  amount numeric not null check (amount >= 0 and amount < 'Infinity'::numeric),
  reconciliation jsonb not null,
  correction_reason text,
  approved_by uuid not null,
  approved_at timestamptz not null,
  request_id uuid not null unique,
  request_payload jsonb not null,
  unique (outlet_id, accounting_month, revision),
  check ((revision = 1 and supersedes_id is null and correction_reason is null)
    or (revision > 1 and supersedes_id is not null and correction_reason is not null))
);
alter table inventory_authority.closing_stock_revisions enable row level security;
revoke all on inventory_authority.closing_stock_revisions from public, anon, authenticated, service_role;

-- Stock Check preserves both the eligible roster at submission and the pinned
-- per-line cost via the existing audit cost trigger.
create or replace function feedx_integrations.ra_save_stock_check(
  p_machine uuid, p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid,
  p_actor_user uuid, p_actor_employee uuid, p_actor_kind text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_existing public.inventory_stock_checks%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_now timestamptz := now();
  v_status text := coalesce(p_check->>'status','draft');
  v_type text := coalesce(p_check->>'stock_check_type','scheduled');
  v_outlet uuid := nullif(p_check->>'outlet_id','')::uuid;
  v_group uuid := nullif(p_check->>'group_id','')::uuid;
  v_id uuid := nullif(p_check->>'id','')::uuid;
  v_date date := nullif(p_check->>'check_date','')::date;
  v_month date;
  v_cutoff timestamptz;
  v_closing_items uuid[];
  v_fingerprint text := md5(jsonb_build_object('check',p_check,'items',p_items)::text);
  v_legacy_item_ids uuid[]:='{}';
begin
  if p_machine is not null and (p_actor_user is not null or p_actor_employee is not null
    or p_actor_kind <> 'machine' or not feedx_integrations.restaurant_actor_outlet(p_machine,p_scope_outlet)) then
    raise exception using errcode = '42501', message = 'Invalid Restaurant machine principal or outlet';
  end if;
  if p_request_id is null or v_outlet is null or v_outlet is distinct from p_scope_outlet or v_date is null then
    raise exception 'Request, outlet and stock check date are required.';
  end if;
  if v_type not in ('scheduled','audit') or v_status not in ('draft','submitted') then
    raise exception 'Invalid stock check type or status.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Stock check items are required.'; end if;
  if v_type = 'audit' and p_check->>'audit_type' = 'Month-End Closing' then
    if p_machine is not null then
      raise exception using errcode = '42501', message = 'Closing counts require an Admin or Crew stock checker.';
    end if;
    v_month := nullif(p_check->>'accounting_month','')::date;
    v_cutoff := nullif(p_check->>'physical_count_cutoff','')::timestamptz;
    if v_month is null or extract(day from v_month) <> 1
      or extract(year from v_month) not between 2000 and 2100
      or v_cutoff is null or not isfinite(v_cutoff) then
      raise exception 'Accounting Month and physical count cutoff are required.';
    end if;
    v_date := timezone('Asia/Kuala_Lumpur', v_cutoff)::date;
  end if;
  if v_type = 'scheduled' then
    if v_group is null or not exists (select 1 from public.inventory_stock_check_groups where id=v_group and outlet_id=v_outlet) then
      raise exception 'Stock check group does not belong to this outlet.';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory_lifecycle_'||p_request_id::text));
  select result into v_result from public.inventory_lifecycle_requests
    where request_id=p_request_id and operation='stock_check'
      and (payload_fingerprint is null or payload_fingerprint=v_fingerprint);
  if found then return v_result; end if;
  if exists (select 1 from public.inventory_lifecycle_requests where request_id=p_request_id) then
    raise exception 'Request ID was already used for another or changed inventory action.';
  end if;
  if v_month is not null and v_status = 'submitted' then
    if v_cutoff > v_now then
      raise exception 'Physical count cutoff cannot be in the future when submitting.';
    end if;
    select array_agg(item.id order by item.id) into v_closing_items
    from public.inventory_item_outlets link
    join public.inventory_items item on item.id = link.inventory_item_id
    where link.outlet_id = v_outlet and link.is_active and item.status = 'active';
    if v_closing_items is null
      or (select array_agg((line->>'item_id')::uuid order by (line->>'item_id')::uuid)
          from jsonb_array_elements(p_items) line) is distinct from v_closing_items then
      raise exception 'Closing counts must include every active outlet item exactly once. Start a new audit if the outlet roster changed.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_items) line
      where jsonb_typeof(line->'actual_count_quantity') is distinct from 'number'
        or not ((line->>'actual_count_quantity')::numeric between 0 and 99999999999.999)
        or (line->>'actual_count_quantity')::numeric <> trunc((line->>'actual_count_quantity')::numeric, 3)
        or coalesce((line->>'actual_missing')::boolean,false)
        or coalesce((line->>'skipped')::boolean,false)
        or coalesce((line->>'na')::boolean,false)
        or lower(coalesce(line->>'status','')) in ('skipped','na','pending')
    ) then
      raise exception 'Enter an explicit non-negative actual quantity for every closing item, with up to three decimals.';
    end if;
  end if;
  if v_type='scheduled' and v_id is null then
    perform pg_advisory_xact_lock(hashtext('inventory_stock_check_run_'||v_group::text||v_date::text||coalesce(p_check->>'shift','')));
    if exists(select 1 from public.inventory_stock_checks where group_id=v_group and check_date=v_date
      and shift is not distinct from nullif(p_check->>'shift','')) then
      raise exception 'A stock check already exists for this scheduled run.';
    end if;
  end if;
  if v_id is not null then
    select * into v_existing from public.inventory_stock_checks where id=v_id for update;
    if not found then raise exception 'Stock check was not found.'; end if;
    if v_existing.status <> 'draft' then raise exception 'Completed stock checks are immutable.'; end if;
    if (v_month is null) <> (v_existing.accounting_month is null) then
      raise exception 'Start a new audit to change the closing count requirement.';
    end if;
    if v_existing.outlet_id is distinct from v_outlet or v_existing.stock_check_type <> v_type then
      raise exception 'The stock check outlet and type cannot change.';
    end if;
    select coalesce(array_agg(distinct item_id),'{}') into v_legacy_item_ids
      from public.inventory_stock_check_items where stock_check_id=v_id and item_id is not null;
    delete from public.inventory_stock_check_items where stock_check_id=v_id;
    update public.inventory_stock_checks set group_id=case when v_type='audit' then null else v_group end,
      check_name=nullif(p_check->>'check_name',''), shift=nullif(p_check->>'shift',''), check_date=v_date,
      audit_type=case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      audit_name=case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      audit_category_ids=case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      accounting_month=v_month, physical_count_cutoff=v_cutoff,
      closing_item_ids=v_closing_items, notes=nullif(p_check->>'notes',''), updated_at=v_now
      where id=v_id returning * into v_check;
  else
    insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,check_date,
      audit_type,audit_name,audit_category_ids,accounting_month,physical_count_cutoff,closing_item_ids,
      notes,status,created_by,created_by_employee_id,created_at,updated_at)
    values(v_outlet,case when v_type='audit' then null else v_group end,v_type,
      nullif(p_check->>'check_name',''),nullif(p_check->>'shift',''),v_date,
      case when v_type='audit' then nullif(p_check->>'audit_type','') else null end,
      case when v_type='audit' then nullif(p_check->>'audit_name','') else null end,
      case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      v_month,v_cutoff,v_closing_items,nullif(p_check->>'notes',''),'draft',p_actor_user,p_actor_employee,v_now,v_now) returning * into v_check;
  end if;
  for v_row in select value from jsonb_array_elements(p_items) loop
    if nullif(v_row->>'item_id','') is null then raise exception 'Stock check item is required.'; end if;
    if not exists (select 1 from public.inventory_item_outlets where outlet_id=v_outlet and inventory_item_id=(v_row->>'item_id')::uuid)
      and not ((v_row->>'item_id')::uuid=any(v_legacy_item_ids)) then
      raise exception 'Stock check item does not belong to this outlet.';
    end if;
    insert into public.inventory_stock_check_items(stock_check_id,item_id,category_id,par_level_quantity,actual_count_quantity,
      variance,unit,status,notes,skipped,skip_reason,created_at,updated_at)
    values(v_check.id,(v_row->>'item_id')::uuid,nullif(v_row->>'category_id','')::uuid,nullif(v_row->>'par_level_quantity','')::numeric,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'actual_missing')::boolean,false) then null else nullif(v_row->>'actual_count_quantity','')::numeric end,
      case when coalesce((v_row->>'skipped')::boolean,false) or coalesce((v_row->>'na')::boolean,false) then null else coalesce(nullif(v_row->>'variance','')::numeric,0) end,
      nullif(v_row->>'unit',''),coalesce(nullif(v_row->>'status',''),'normal'),nullif(v_row->>'notes',''),
      coalesce((v_row->>'skipped')::boolean,false),case when coalesce((v_row->>'skipped')::boolean,false) then nullif(v_row->>'skip_reason','') else null end,v_now,v_now);
  end loop;
  if v_status='submitted' then
    update public.inventory_stock_checks set status='submitted',submitted_at=v_now,submitted_by=p_actor_employee,updated_at=v_now
      where id=v_check.id returning * into v_check;
    if v_type='scheduled' then
      update public.inventory_stock_check_groups set last_checked_at=v_now,updated_at=v_now where id=v_group;
    end if;
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values('inventory_stock_check_completed','inventory',p_actor_user,'Stock check completed.',
      jsonb_build_object('stock_check_id',v_check.id,'outlet_id',v_outlet,'actor_kind',p_actor_kind,
        'actor_employee_id',p_actor_employee,'request_id',p_request_id,'accounting_month',v_month));
  end if;
  v_result:=jsonb_build_object('check',to_jsonb(v_check),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at)
    from public.inventory_stock_check_items i where i.stock_check_id=v_check.id),'[]'::jsonb));
  insert into public.inventory_lifecycle_requests(request_id,operation,actor_id,actor_employee_id,actor_kind,outlet_id,result,payload_fingerprint,actor_machine_id)
    values(p_request_id,'stock_check',p_actor_user,p_actor_employee,p_actor_kind,v_outlet,v_result,v_fingerprint,p_machine);
  return v_result;
end; $$;

create function inventory_authority.month_end_cutoff(p_month date)
returns timestamptz language sql immutable set search_path = '' as $$
  select (p_month + interval '1 month') at time zone 'Asia/Kuala_Lumpur';
$$;
revoke all on function inventory_authority.month_end_cutoff(date) from public, anon, authenticated;

create function public.inventory_closing_context(p_check_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_check public.inventory_stock_checks%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_month_end timestamptz;
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
  return jsonb_build_object(
    'month_end_cutoff', v_month_end, 'period_ended', v_month_end <= now(),
    'requires_reconciliation', v_check.physical_count_cutoff <> v_month_end,
    'published', case when v_close.id is not null then jsonb_build_object(
      'id', v_close.id, 'revision', v_close.revision, 'source_audit_id', v_close.source_audit_id,
      'amount', v_close.amount, 'approved_at', v_close.approved_at,
      'reconciliation', case when v_close.source_audit_id = v_check.id then v_close.reconciliation end
    ) end
  );
end;
$$;

create function public.inventory_approve_closing_stock(
  p_check_id uuid, p_request_id uuid, p_reconciliation jsonb default '[]',
  p_supersedes_id uuid default null, p_correction_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_check public.inventory_stock_checks%rowtype;
  v_current inventory_authority.closing_stock_revisions%rowtype;
  v_close inventory_authority.closing_stock_revisions%rowtype;
  v_cutoff timestamptz;
  v_items uuid[];
  v_reconciliation jsonb := '[]';
  v_amount numeric;
  v_reason text := nullif(btrim(p_correction_reason), '');
  v_payload jsonb := jsonb_build_object(
    'check_id', p_check_id, 'reconciliation', p_reconciliation, 'supersedes_id', p_supersedes_id, 'reason', v_reason
  );
begin
  if v_actor is null or not public.current_user_has_permission('inventory_stock_check.view')
    or not public.current_user_has_permission('inventory_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Closing approval permission is required.';
  end if;
  select * into v_check from public.inventory_stock_checks where id = p_check_id;
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

    if v_check.physical_count_cutoff = v_cutoff then
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
      v_current.id, v_check.id, v_check.physical_count_cutoff, v_cutoff,
      v_amount, v_reconciliation, v_reason, v_actor, now(), p_request_id, v_payload
    ) returning * into v_close;
    insert into public.audit_logs (action, module, user_id, description, metadata)
    values ('inventory_closing_stock_approved', 'inventory', v_actor, 'Month-End Closing Stock approved.',
      jsonb_build_object('closing_id', v_close.id, 'stock_check_id', v_check.id,
        'outlet_id', v_check.outlet_id, 'accounting_month', v_check.accounting_month,
        'revision', v_close.revision, 'supersedes_id', v_current.id, 'request_id', p_request_id));
  end if;
  return jsonb_build_object('id', v_close.id, 'revision', v_close.revision,
    'source_audit_id', v_close.source_audit_id, 'amount', v_close.amount, 'approved_at', v_close.approved_at);
end;
$$;

revoke all on function public.inventory_closing_context(uuid),
  public.inventory_approve_closing_stock(uuid,uuid,jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.inventory_closing_context(uuid),
  public.inventory_approve_closing_stock(uuid,uuid,jsonb,uuid,text) to authenticated;

-- Crew may resume and submit its scoped draft. Approval stays in Admin.
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
    if not found then raise exception using errcode='42501',message='Stock check is unavailable for this outlet.'; end if;
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
      'shift',c.shift,'notes',c.notes,'submitted_at',c.submitted_at,
      'accounting_month',c.accounting_month,'physical_count_cutoff',c.physical_count_cutoff,
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
        where c.outlet_id=v_outlet and c.status='draft' and (c.stock_check_type='audit' or c.check_date>=v_today)
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

-- Add month-end stock to the existing scoped read as reference data.
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

  select count(closing.amount), sum(closing.amount)
  into v_published_outlets, v_closing_stock
  from public.reporting_scope_outlets(p_outlet_id) outlet
  left join lateral (
    select publication.amount
    from inventory_authority.closing_stock_revisions publication
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
    'closing_stock', case when v_published_outlets = v_scope_count then v_closing_stock end,
    'financial_completeness', case when v_complete then 'complete' else 'incomplete' end
  );
end; $$;
