-- Transactional, request-idempotent authority for monthly Sales snapshots.
-- Purchase uses the same request ledger in its follow-up checkpoint.

create table if not exists public.sales_purchase_monthly_save_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  operation text not null,
  actor_id uuid not null,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  year integer not null,
  month integer not null,
  payload_fingerprint text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists sales_purchase_monthly_save_requests_period_idx
  on public.sales_purchase_monthly_save_requests (operation, outlet_id, year, month);

alter table public.sales_purchase_monthly_save_requests enable row level security;
revoke all on table public.sales_purchase_monthly_save_requests from anon, authenticated;

create or replace function public.save_sales_period_snapshot(
  p_request_id uuid,
  p_outlet_id uuid,
  p_year integer,
  p_month integer,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_operation constant text := 'sales_period_snapshot';
  v_canonical_rows jsonb;
  v_fingerprint text;
  v_request public.sales_purchase_monthly_save_requests%rowtype;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if p_request_id is null or p_outlet_id is null then
    raise exception 'A request ID and outlet are required.';
  end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid accounting period is required.';
  end if;
  if not (
    public.current_user_has_permission('sales_input.create')
    or public.current_user_has_permission('sales_input.edit')
  ) then
    raise exception using errcode = '42501', message = 'Missing permission to save sales.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot save sales for this outlet.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Sales snapshot rows must be an array.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'channel_id', r.channel_id,
      'channel_name', coalesce(r.channel_name, ''),
      'amount', coalesce(r.amount, 0),
      'remark', coalesce(r.remark, '')
    ) order by r.channel_id
  ), '[]'::jsonb)
  into v_canonical_rows
  from jsonb_to_recordset(p_rows) as r(channel_id uuid, channel_name text, amount numeric, remark text);

  if exists (
    select 1
    from jsonb_to_recordset(v_canonical_rows) as r(channel_id uuid, channel_name text, amount numeric, remark text)
    group by r.channel_id having r.channel_id is null or count(*) > 1
  ) then
    raise exception 'Sales snapshot rows must have one valid channel per row.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_canonical_rows) as r(channel_id uuid, channel_name text, amount numeric, remark text)
    left join public.sales_channels channel on channel.id = r.channel_id
    where channel.id is null
  ) then
    raise exception 'Sales snapshot contains an unknown channel.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'operation', v_operation,
    'outlet_id', p_outlet_id,
    'year', p_year,
    'month', p_month,
    'rows', v_canonical_rows
  )::text);

  perform pg_advisory_xact_lock(hashtext(v_operation || ':' || p_outlet_id::text || ':' || p_year::text || ':' || p_month::text));
  select * into v_request
  from public.sales_purchase_monthly_save_requests
  where request_id = p_request_id
  for update;
  if found then
    if v_request.operation = v_operation
      and v_request.actor_id = v_actor
      and v_request.outlet_id = p_outlet_id
      and v_request.year = p_year
      and v_request.month = p_month
      and v_request.payload_fingerprint = v_fingerprint
      and v_request.result is not null then
      return v_request.result;
    end if;
    raise exception 'Request ID was already used for a different monthly save intent.';
  end if;

  insert into public.sales_purchase_monthly_save_requests(
    request_id, operation, actor_id, outlet_id, year, month, payload_fingerprint
  ) values (
    p_request_id, v_operation, v_actor, p_outlet_id, p_year, p_month, v_fingerprint
  );

  update public.sales_records record
  set channel_name = source.channel_name,
      amount = source.amount,
      remark = source.remark,
      updated_at = now()
  from jsonb_to_recordset(v_canonical_rows) as source(channel_id uuid, channel_name text, amount numeric, remark text)
  where record.outlet_id = p_outlet_id
    and record.year = p_year
    and record.month = p_month
    and record.channel_id = source.channel_id;

  insert into public.sales_records(outlet_id, year, month, channel_id, channel_name, amount, remark, updated_at)
  select p_outlet_id, p_year, p_month, source.channel_id, source.channel_name, source.amount, source.remark, now()
  from jsonb_to_recordset(v_canonical_rows) as source(channel_id uuid, channel_name text, amount numeric, remark text)
  where not exists (
    select 1 from public.sales_records record
    where record.outlet_id = p_outlet_id and record.year = p_year and record.month = p_month
      and record.channel_id = source.channel_id
  );

  delete from public.sales_records record
  where record.outlet_id = p_outlet_id
    and record.year = p_year
    and record.month = p_month
    and not exists (
      select 1 from jsonb_to_recordset(v_canonical_rows) as source(channel_id uuid, channel_name text, amount numeric, remark text)
      where source.channel_id = record.channel_id
    );

  select jsonb_build_object('records', coalesce(jsonb_agg(to_jsonb(record) order by record.channel_name), '[]'::jsonb))
  into v_result
  from public.sales_records record
  where record.outlet_id = p_outlet_id and record.year = p_year and record.month = p_month;

  update public.sales_purchase_monthly_save_requests
  set result = v_result, completed_at = now()
  where request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function public.save_sales_period_snapshot(uuid, uuid, integer, integer, jsonb) from public;
grant execute on function public.save_sales_period_snapshot(uuid, uuid, integer, integer, jsonb) to authenticated;

create or replace function public.save_purchase_period_snapshot(p_request_id uuid, p_outlet_id uuid, p_year integer, p_month integer, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_operation constant text := 'purchase_period_snapshot'; v_rows jsonb;
  v_fingerprint text; v_request public.sales_purchase_monthly_save_requests%rowtype; v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null then raise exception 'A request ID and outlet are required.'; end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then raise exception 'A valid accounting period is required.'; end if;
  if not (public.current_user_has_permission('purchase_input.create') or public.current_user_has_permission('purchase_input.edit')) then raise exception using errcode='42501', message='Missing permission to save purchases.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501', message='You cannot save purchases for this outlet.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Purchase snapshot rows must be an array.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('supplier_id',r.supplier_id,'category_id',r.category_id,'amount',coalesce(r.amount,0),'remark',coalesce(r.remark,'')) order by r.supplier_id,r.category_id),'[]'::jsonb)
  into v_rows from jsonb_to_recordset(p_rows) as r(supplier_id uuid, category_id uuid, amount numeric, remark text);
  if exists (select 1 from jsonb_to_recordset(v_rows) as r(supplier_id uuid,category_id uuid,amount numeric,remark text) group by r.supplier_id,r.category_id having r.supplier_id is null or r.category_id is null or count(*) > 1) then raise exception 'Purchase snapshot rows must have one valid supplier/category pair per row.'; end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) as r(supplier_id uuid,category_id uuid,amount numeric,remark text) left join public.suppliers s on s.id=r.supplier_id left join public.purchase_categories c on c.id=r.category_id where s.id is null or c.id is null) then raise exception 'Purchase snapshot contains an unknown supplier or category.'; end if;
  v_fingerprint := md5(jsonb_build_object('operation',v_operation,'outlet_id',p_outlet_id,'year',p_year,'month',p_month,'rows',v_rows)::text);
  perform pg_advisory_xact_lock(hashtext(v_operation || ':' || p_outlet_id::text || ':' || p_year::text || ':' || p_month::text));
  select * into v_request from public.sales_purchase_monthly_save_requests where request_id=p_request_id for update;
  if found then
    if v_request.operation=v_operation and v_request.actor_id=v_actor and v_request.outlet_id=p_outlet_id and v_request.year=p_year and v_request.month=p_month and v_request.payload_fingerprint=v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different monthly save intent.';
  end if;
  insert into public.sales_purchase_monthly_save_requests(request_id,operation,actor_id,outlet_id,year,month,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_year,p_month,v_fingerprint);
  update public.purchase_records record set amount=source.amount,remark=source.remark,updated_at=now()
  from jsonb_to_recordset(v_rows) as source(supplier_id uuid,category_id uuid,amount numeric,remark text)
  where record.outlet_id=p_outlet_id and record.year=p_year and record.month=p_month and record.supplier_id=source.supplier_id and record.category_id=source.category_id;
  insert into public.purchase_records(outlet_id,year,month,supplier_id,category_id,amount,remark,updated_at)
  select p_outlet_id,p_year,p_month,source.supplier_id,source.category_id,source.amount,source.remark,now()
  from jsonb_to_recordset(v_rows) as source(supplier_id uuid,category_id uuid,amount numeric,remark text)
  where not exists(select 1 from public.purchase_records record where record.outlet_id=p_outlet_id and record.year=p_year and record.month=p_month and record.supplier_id=source.supplier_id and record.category_id=source.category_id);
  delete from public.purchase_records record where record.outlet_id=p_outlet_id and record.year=p_year and record.month=p_month and not exists(select 1 from jsonb_to_recordset(v_rows) as source(supplier_id uuid,category_id uuid,amount numeric,remark text) where source.supplier_id=record.supplier_id and source.category_id=record.category_id);
  select jsonb_build_object('records',coalesce(jsonb_agg(jsonb_build_object('id',record.id,'outlet_id',record.outlet_id,'year',record.year,'month',record.month,'supplier_id',record.supplier_id,'category_id',record.category_id,'amount',record.amount,'remark',record.remark,'created_at',record.created_at,'updated_at',record.updated_at,'supplier_name',supplier.name,'category_name',category.name) order by supplier.name,category.name),'[]'::jsonb)) into v_result from public.purchase_records record left join public.suppliers supplier on supplier.id=record.supplier_id left join public.purchase_categories category on category.id=record.category_id where record.outlet_id=p_outlet_id and record.year=p_year and record.month=p_month;
  update public.sales_purchase_monthly_save_requests set result=v_result,completed_at=now() where request_id=p_request_id;
  return v_result;
end; $$;

revoke all on function public.save_purchase_period_snapshot(uuid,uuid,integer,integer,jsonb) from public;
grant execute on function public.save_purchase_period_snapshot(uuid,uuid,integer,integer,jsonb) to authenticated;
