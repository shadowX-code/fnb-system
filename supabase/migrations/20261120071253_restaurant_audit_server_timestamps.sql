-- Reuse the original draft creation and submission timestamps. Old closing audit
-- timestamps stay on the source audit; approvals record the cutoff of new audits.
alter table public.inventory_stock_checks
  drop constraint inventory_stock_check_closing_metadata_check,
  add constraint inventory_stock_check_closing_metadata_check check (
    (accounting_month is null and physical_count_cutoff is null and closing_item_ids is null)
    or (
      stock_check_type = 'audit' and audit_type is not distinct from 'Month-End Closing'
      and accounting_month is not null and extract(day from accounting_month) = 1
      and extract(year from accounting_month) between 2000 and 2100
      and (physical_count_cutoff is null or isfinite(physical_count_cutoff))
      and (status <> 'submitted' or (closing_item_ids is not null and cardinality(closing_item_ids) > 0))
    )
  );

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
  v_date date := case when v_type = 'audit' then timezone('Asia/Kuala_Lumpur', v_now)::date
    else nullif(p_check->>'check_date','')::date end;
  v_audit_type text := coalesce(nullif(p_check->>'audit_type',''), 'Custom Audit');
  v_audit_name text := nullif(p_check->>'audit_name','');
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
  if v_type = 'audit' and v_audit_type = 'Month-End Closing' then
    if p_machine is not null then
      raise exception using errcode = '42501', message = 'Closing counts require an Admin or Crew stock checker.';
    end if;
    v_month := nullif(p_check->>'accounting_month','')::date;
    if v_month is null or extract(day from v_month) <> 1
      or extract(year from v_month) not between 2000 and 2100 then
      raise exception 'A valid Accounting Month is required.';
    end if;
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
    if v_type = 'audit' then
      v_date := v_existing.check_date;
      v_audit_name := coalesce(v_audit_name, v_existing.audit_name);
      -- Preserve recorded evidence from older drafts, without accepting a new cutoff from counting.
      v_cutoff := v_existing.physical_count_cutoff;
      if v_status = 'submitted' and v_cutoff > v_now then
        raise exception 'The recorded physical count cutoff cannot be in the future when submitting.';
      end if;
    end if;
    select coalesce(array_agg(distinct item_id),'{}') into v_legacy_item_ids
      from public.inventory_stock_check_items where stock_check_id=v_id and item_id is not null;
    delete from public.inventory_stock_check_items where stock_check_id=v_id;
    update public.inventory_stock_checks set group_id=case when v_type='audit' then null else v_group end,
      check_name=coalesce(nullif(p_check->>'check_name',''), case when v_type='audit' then v_existing.check_name end, case when v_type='audit' then v_audit_name end), shift=nullif(p_check->>'shift',''), check_date=v_date,
      audit_type=case when v_type='audit' then v_audit_type else null end,
      audit_name=case when v_type='audit' then v_audit_name else null end,
      audit_category_ids=case when v_type='audit' then coalesce(array(select jsonb_array_elements_text(coalesce(p_check->'audit_category_ids','[]'::jsonb))::uuid),'{}') else '{}' end,
      accounting_month=v_month, physical_count_cutoff=v_cutoff,
      closing_item_ids=v_closing_items, notes=nullif(p_check->>'notes',''), updated_at=v_now
      where id=v_id returning * into v_check;
  else
    if v_type = 'audit' and v_audit_name is null then
      v_audit_name := v_audit_type
        || case when v_month is not null then ' · ' || to_char(v_month, 'Mon YYYY') else '' end
        || ' · ' || to_char(v_date, 'FMDD Mon YYYY');
    end if;
    insert into public.inventory_stock_checks(outlet_id,group_id,stock_check_type,check_name,shift,check_date,
      audit_type,audit_name,audit_category_ids,accounting_month,physical_count_cutoff,closing_item_ids,
      notes,status,created_by,created_by_employee_id,created_at,updated_at)
    values(v_outlet,case when v_type='audit' then null else v_group end,v_type,
      coalesce(nullif(p_check->>'check_name',''), case when v_type='audit' then v_audit_name end),nullif(p_check->>'shift',''),v_date,
      case when v_type='audit' then v_audit_type else null end,
      case when v_type='audit' then v_audit_name else null end,
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

create or replace function public.inventory_closing_context(p_check_id uuid)
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
    'requires_reconciliation', coalesce(v_check.physical_count_cutoff,
      case when v_close.source_audit_id = v_check.id then v_close.physical_count_cutoff end) <> v_month_end,
    'published', case when v_close.id is not null then jsonb_build_object(
      'id', v_close.id, 'revision', v_close.revision, 'source_audit_id', v_close.source_audit_id,
      'amount', v_close.amount, 'approved_at', v_close.approved_at,
      'physical_count_cutoff', case when v_close.source_audit_id = v_check.id then v_close.physical_count_cutoff end,
      'reconciliation', case when v_close.source_audit_id = v_check.id then v_close.reconciliation end
    ) end
  );
end;
$$;

drop function public.inventory_approve_closing_stock(uuid,uuid,jsonb,uuid,text);

create function public.inventory_approve_closing_stock(
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

    if v_check.physical_count_cutoff is not null and p_physical_count_cutoff is not null
      and v_check.physical_count_cutoff <> p_physical_count_cutoff then
      raise exception 'The physical cutoff recorded on this audit is immutable.';
    end if;
    v_physical_cutoff := coalesce(v_check.physical_count_cutoff, p_physical_count_cutoff);
    if v_physical_cutoff is null or not isfinite(v_physical_cutoff) then
      raise exception 'Confirm the actual physical count cutoff for this audit before approval.';
    end if;
    if v_check.submitted_at is null or v_physical_cutoff > v_check.submitted_at then
      raise exception 'The physical count cutoff must be on or before the count submission time.';
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

revoke all on function public.inventory_approve_closing_stock(uuid,uuid,jsonb,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.inventory_approve_closing_stock(uuid,uuid,jsonb,uuid,text,timestamptz) to authenticated;

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
      'shift',c.shift,'notes',c.notes,'created_at',c.created_at,'submitted_at',c.submitted_at,
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
