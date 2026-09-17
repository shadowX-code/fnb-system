-- Factory Internal Transfer: move existing, traceable RM/FG batch stock between
-- active storage locations. Transfers never alter aggregate inventory or create
-- production, receiving, or reconciliation stock.

insert into public.permissions (code, module, description)
values
  ('factory_internal_transfer.view', 'Factory Internal Transfer', 'View Factory internal transfers.'),
  ('factory_internal_transfer.create', 'Factory Internal Transfer', 'Create and complete Factory internal transfers.'),
  ('factory_internal_transfer.export', 'Factory Internal Transfer', 'Export Factory internal transfer history.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role join public.permissions permission on permission.code like 'factory_internal_transfer.%'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.factory_internal_transfer_daily_sequences (
  business_date date primary key,
  last_number integer not null check (last_number > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.factory_internal_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  request_id uuid not null unique,
  inventory_type text not null check (inventory_type in ('raw_material', 'finished_good')),
  from_location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  to_location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  transfer_date date not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  notes text,
  status text not null default 'completed' check (status = 'completed'),
  created_by uuid not null references public.employees(id) on delete restrict,
  completed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  check (from_location_id <> to_location_id)
);

create index if not exists factory_internal_transfers_listing_idx
  on public.factory_internal_transfers (transfer_date desc, created_at desc, id desc);
create index if not exists factory_internal_transfers_locations_idx
  on public.factory_internal_transfers (from_location_id, to_location_id, transfer_date desc);

create table if not exists public.factory_internal_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.factory_internal_transfers(id) on delete restrict,
  source_raw_material_batch_balance_id uuid references public.factory_raw_material_batch_balances(id) on delete restrict,
  destination_raw_material_batch_balance_id uuid references public.factory_raw_material_batch_balances(id) on delete restrict,
  source_finished_good_batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict,
  destination_finished_good_batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict,
  raw_material_id uuid references public.factory_raw_materials(id) on delete restrict,
  finished_good_id uuid references public.factory_finished_goods(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  uom text not null,
  created_at timestamptz not null default clock_timestamp(),
  check ((raw_material_id is not null and finished_good_id is null and source_raw_material_batch_balance_id is not null and destination_raw_material_batch_balance_id is not null and source_finished_good_batch_balance_id is null and destination_finished_good_batch_balance_id is null) or (finished_good_id is not null and raw_material_id is null and source_finished_good_batch_balance_id is not null and destination_finished_good_batch_balance_id is not null and source_raw_material_batch_balance_id is null and destination_raw_material_batch_balance_id is null)),
  unique (transfer_id, source_raw_material_batch_balance_id),
  unique (transfer_id, source_finished_good_batch_balance_id)
);

create index if not exists factory_internal_transfer_items_transfer_idx on public.factory_internal_transfer_items(transfer_id);

-- A transferred location balance remains explicitly linked to its original
-- lot/batch balance. Existing history keeps a null origin and is its own root.
alter table public.factory_raw_material_batch_balances
  add column if not exists origin_batch_balance_id uuid references public.factory_raw_material_batch_balances(id) on delete restrict;
alter table public.factory_finished_good_batch_balances
  add column if not exists origin_batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict;

alter table public.factory_raw_material_batch_balances drop constraint if exists factory_raw_material_batch_balances_source_type_check;
alter table public.factory_raw_material_batch_balances add constraint factory_raw_material_batch_balances_source_type_check
  check (source_type in ('receiving', 'stock_check_adjustment', 'legacy_unallocated', 'transfer'));
alter table public.factory_finished_good_batch_balances drop constraint if exists factory_finished_good_batch_balances_source_type_check;
alter table public.factory_finished_good_batch_balances add constraint factory_finished_good_batch_balances_source_type_check
  check (source_type in ('production', 'adjustment', 'legacy_unallocated', 'transfer'));

alter table public.factory_raw_material_movements
  add column if not exists internal_transfer_id uuid references public.factory_internal_transfers(id) on delete restrict,
  add column if not exists counterpart_location_id uuid references public.factory_storage_locations(id) on delete restrict;
alter table public.factory_product_stock_movements
  add column if not exists finished_good_batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict,
  add column if not exists internal_transfer_id uuid references public.factory_internal_transfers(id) on delete restrict,
  add column if not exists counterpart_location_id uuid references public.factory_storage_locations(id) on delete restrict;

create index if not exists factory_raw_material_movements_internal_transfer_idx on public.factory_raw_material_movements(internal_transfer_id) where internal_transfer_id is not null;
create index if not exists factory_product_stock_movements_internal_transfer_idx on public.factory_product_stock_movements(internal_transfer_id) where internal_transfer_id is not null;

alter table public.factory_internal_transfers enable row level security;
alter table public.factory_internal_transfer_items enable row level security;
revoke all on public.factory_internal_transfers, public.factory_internal_transfer_items, public.factory_internal_transfer_daily_sequences from public, anon, authenticated;
grant select on public.factory_internal_transfers, public.factory_internal_transfer_items to authenticated;
create policy factory_internal_transfers_select on public.factory_internal_transfers for select to authenticated using (public.current_user_has_permission('factory_internal_transfer.view'));
create policy factory_internal_transfer_items_select on public.factory_internal_transfer_items for select to authenticated using (public.current_user_has_permission('factory_internal_transfer.view'));
create policy factory_internal_transfer_storage_locations_view on public.factory_storage_locations for select to authenticated using (public.current_user_has_permission('factory_internal_transfer.view') or public.current_user_has_permission('factory_internal_transfer.create'));
create policy factory_internal_transfer_raw_batch_view on public.factory_raw_material_batch_balances for select to authenticated using (public.current_user_has_permission('factory_internal_transfer.view') or public.current_user_has_permission('factory_internal_transfer.create'));
create policy factory_internal_transfer_finished_batch_view on public.factory_finished_good_batch_balances for select to authenticated using (public.current_user_has_permission('factory_internal_transfer.view') or public.current_user_has_permission('factory_internal_transfer.create'));

create or replace function public.factory_next_internal_transfer_reference()
returns text language plpgsql security definer set search_path = '' as $$
declare v_date date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date; v_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('factory_internal_transfer:' || v_date::text, 0));
  insert into public.factory_internal_transfer_daily_sequences(business_date, last_number) values(v_date, 1)
  on conflict(business_date) do update set last_number = public.factory_internal_transfer_daily_sequences.last_number + 1, updated_at = clock_timestamp()
  returning last_number into v_number;
  return 'TR' || to_char(v_date, 'YYMMDD') || '-' || public.factory_format_business_sequence(v_number);
end; $$;

create or replace function public.factory_internal_transfer_inventory(p_inventory_type text, p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not (public.current_user_has_permission('factory_internal_transfer.view') or public.current_user_has_permission('factory_internal_transfer.create')) then raise exception using errcode='42501', message='Internal Transfer view permission is required.'; end if;
  if p_inventory_type = 'raw_material' then
    select coalesce(jsonb_agg(jsonb_build_object('batch_balance_id', b.id, 'item_id', b.raw_material_id, 'name', coalesce(m.name_en,m.name), 'code', m.material_code, 'batch_no', coalesce(b.internal_batch_no,b.supplier_lot_no,'—'), 'quantity', b.current_balance, 'uom', b.uom, 'manufacturing_date', b.manufacturing_date, 'expiry_date', b.expiry_date) order by coalesce(m.name_en,m.name), b.expiry_date nulls last, b.id), '[]'::jsonb) into v_rows
    from public.factory_raw_material_batch_balances b join public.factory_raw_materials m on m.id=b.raw_material_id
    where b.storage_location_id=p_location_id and b.current_balance>0 and b.status='active';
  elsif p_inventory_type = 'finished_good' then
    select coalesce(jsonb_agg(jsonb_build_object('batch_balance_id', b.id, 'item_id', b.finished_good_id, 'name', coalesce(family.name_en, f.product_name_en, f.product_name), 'code', f.product_code, 'batch_no', b.batch_no, 'quantity', b.current_balance, 'uom', f.uom, 'manufacturing_date', b.manufacturing_date, 'expiry_date', b.expiry_date) order by coalesce(family.name_en,f.product_name_en,f.product_name), b.expiry_date nulls last, b.id), '[]'::jsonb) into v_rows
    from public.factory_finished_good_batch_balances b join public.factory_finished_goods f on f.id=b.finished_good_id left join public.factory_product_families family on family.id=f.product_family_id
    where b.storage_location_id=p_location_id and b.current_balance>0;
  else raise exception using errcode='22023', message='Select Raw Material or Finished Good inventory.'; end if;
  return v_rows;
end; $$;

create or replace function public.factory_complete_internal_transfer(p_request_id uuid, p_transfer jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.factory_current_active_employee_id(); v_type text := lower(btrim(coalesce(p_transfer->>'inventory_type','')));
  v_from uuid := nullif(p_transfer->>'from_location_id','')::uuid; v_to uuid := nullif(p_transfer->>'to_location_id','')::uuid;
  v_reason text := nullif(btrim(p_transfer->>'reason'),''); v_notes text := nullif(btrim(p_transfer->>'notes'),''); v_date date := coalesce(nullif(p_transfer->>'transfer_date','')::date,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date);
  v_existing public.factory_internal_transfers%rowtype; v_transfer public.factory_internal_transfers%rowtype; v_from_location public.factory_storage_locations%rowtype; v_to_location public.factory_storage_locations%rowtype;
  v_item jsonb; v_qty numeric; v_source_id uuid; v_raw public.factory_raw_material_batch_balances%rowtype; v_fg public.factory_finished_good_batch_balances%rowtype; v_destination_id uuid; v_result jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_internal_transfer.create') then raise exception using errcode='42501', message='Internal Transfer create permission is required.'; end if;
  if p_request_id is null then raise exception using errcode='22023', message='Transfer request identity is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('factory_internal_transfer_request:' || p_request_id::text, 0));
  select * into v_existing from public.factory_internal_transfers where request_id=p_request_id;
  if found then
    select jsonb_build_object('transfer', to_jsonb(v_existing), 'items', coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)) into v_result
    from public.factory_internal_transfer_items i where i.transfer_id=v_existing.id;
    return v_result;
  end if;
  if v_type not in ('raw_material','finished_good') or v_from is null or v_to is null or v_from=v_to or v_reason is null then raise exception using errcode='22023', message='Inventory type, different From/To Locations, and Reason are required.'; end if;
  select * into v_from_location from public.factory_storage_locations where id=v_from; select * into v_to_location from public.factory_storage_locations where id=v_to;
  if v_from_location.id is null or lower(coalesce(v_from_location.status,''))<>'active' or v_from_location.is_storage_location is not true then raise exception using errcode='22023', message='From Location must be active and storage-enabled.'; end if;
  if v_to_location.id is null or lower(coalesce(v_to_location.status,''))<>'active' or v_to_location.is_storage_location is not true then raise exception using errcode='22023', message='To Location must be active and storage-enabled.'; end if;
  if jsonb_typeof(p_transfer->'items') <> 'array' or jsonb_array_length(p_transfer->'items')=0 then raise exception using errcode='22023', message='Select at least one positive on-hand batch.'; end if;
  insert into public.factory_internal_transfers(transfer_no,request_id,inventory_type,from_location_id,to_location_id,transfer_date,reason,notes,created_by) values(public.factory_next_internal_transfer_reference(),p_request_id,v_type,v_from,v_to,v_date,v_reason,v_notes,v_actor) returning * into v_transfer;
  for v_item in select value from jsonb_array_elements(p_transfer->'items') loop
    v_source_id := nullif(v_item->>'batch_balance_id','')::uuid; v_qty := nullif(v_item->>'quantity','')::numeric;
    if v_source_id is null or v_qty is null or v_qty<=0 then raise exception using errcode='22023', message='Every transfer item needs a positive quantity.'; end if;
    if v_type='raw_material' then
      select * into v_raw from public.factory_raw_material_batch_balances where id=v_source_id for update;
      if not found or v_raw.storage_location_id is distinct from v_from or v_raw.status<>'active' or v_raw.current_balance<v_qty then raise exception using errcode='40001', message='Raw Material batch stock changed or is unavailable.'; end if;
      update public.factory_raw_material_batch_balances set current_balance=current_balance-v_qty, updated_at=clock_timestamp() where id=v_raw.id;
      insert into public.factory_raw_material_batch_balances(raw_material_id,source_type,internal_batch_no,supplier_lot_no,received_date,manufacturing_date,expiry_date,storage_location_id,uom,opening_qty,current_balance,status,diagnostic,origin_batch_balance_id) values(v_raw.raw_material_id,'transfer',v_raw.internal_batch_no,v_raw.supplier_lot_no,v_raw.received_date,v_raw.manufacturing_date,v_raw.expiry_date,v_to,v_raw.uom,v_qty,v_qty,'active','Internal Transfer from '||v_transfer.transfer_no,coalesce(v_raw.origin_batch_balance_id,v_raw.id)) returning id into v_destination_id;
      insert into public.factory_internal_transfer_items(transfer_id,source_raw_material_batch_balance_id,destination_raw_material_batch_balance_id,raw_material_id,quantity,uom) values(v_transfer.id,v_raw.id,v_destination_id,v_raw.raw_material_id,v_qty,v_raw.uom);
      insert into public.factory_raw_material_movements(raw_material_id,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,raw_material_batch_balance_id,internal_transfer_id,counterpart_location_id) values(v_raw.raw_material_id,'Transfer Out',-v_qty,v_raw.uom,'internal_transfer',v_transfer.id,v_transfer.transfer_no,v_date,v_reason,v_actor,v_raw.id,v_transfer.id,v_to),(v_raw.raw_material_id,'Transfer In',v_qty,v_raw.uom,'internal_transfer',v_transfer.id,v_transfer.transfer_no,v_date,v_reason,v_actor,v_destination_id,v_transfer.id,v_from);
    else
      select * into v_fg from public.factory_finished_good_batch_balances where id=v_source_id for update;
      if not found or v_fg.storage_location_id is distinct from v_from or v_fg.current_balance<v_qty then raise exception using errcode='40001', message='Finished Good batch stock changed or is unavailable.'; end if;
      update public.factory_finished_good_batch_balances set current_balance=current_balance-v_qty, updated_at=clock_timestamp() where id=v_fg.id;
      insert into public.factory_finished_good_batch_balances(finished_good_id,source_type,source_reference_id,source_reference_no,batch_no,manufacturing_date,expiry_date,storage_location_id,storage_location,storage_location_type,opening_qty,current_balance,remarks,origin_batch_balance_id) values(v_fg.finished_good_id,'transfer',v_transfer.id,v_transfer.transfer_no,v_fg.batch_no,v_fg.manufacturing_date,v_fg.expiry_date,v_to,v_to_location.location_name,v_to_location.location_type,v_qty,v_qty,'Internal Transfer from '||v_transfer.transfer_no,coalesce(v_fg.origin_batch_balance_id,v_fg.id)) returning id into v_destination_id;
      insert into public.factory_internal_transfer_items(transfer_id,source_finished_good_batch_balance_id,destination_finished_good_batch_balance_id,finished_good_id,quantity,uom) select v_transfer.id,v_fg.id,v_destination_id,v_fg.finished_good_id,v_qty,coalesce(f.uom,'') from public.factory_finished_goods f where f.id=v_fg.finished_good_id;
      insert into public.factory_product_stock_movements(finished_good_id,product_name,movement_type,quantity,uom,reference_type,reference_id,reference_no,movement_date,notes,created_by,finished_good_batch_balance_id,internal_transfer_id,counterpart_location_id) select v_fg.finished_good_id,f.product_name,'Transfer Out',-v_qty,f.uom,'internal_transfer',v_transfer.id,v_transfer.transfer_no,v_date,v_reason,v_actor,v_fg.id,v_transfer.id,v_to from public.factory_finished_goods f where f.id=v_fg.finished_good_id union all select v_fg.finished_good_id,f.product_name,'Transfer In',v_qty,f.uom,'internal_transfer',v_transfer.id,v_transfer.transfer_no,v_date,v_reason,v_actor,v_destination_id,v_transfer.id,v_from from public.factory_finished_goods f where f.id=v_fg.finished_good_id;
    end if;
  end loop;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('factory_internal_transfer_completed','factory',auth.uid(),public.factory_current_active_employee_name(),'Factory Internal Transfer completed.',jsonb_build_object('transfer_id',v_transfer.id,'transfer_no',v_transfer.transfer_no,'from_location_id',v_from,'to_location_id',v_to,'inventory_type',v_type));
  select jsonb_build_object('transfer', to_jsonb(v_transfer), 'items', coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)) into v_result
  from public.factory_internal_transfer_items i where i.transfer_id=v_transfer.id;
  return v_result;
end; $$;

create or replace function public.factory_internal_transfer_admin_data(p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in(20,50,100) then p_page_size else 20 end; v_offset integer; v_rows jsonb; v_total bigint;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_internal_transfer.view') then raise exception using errcode='42501', message='Internal Transfer view permission is required.'; end if;
  v_offset := (v_page-1)*v_size;
  select count(*) into v_total from public.factory_internal_transfers t left join public.factory_storage_locations f on f.id=t.from_location_id left join public.factory_storage_locations d on d.id=t.to_location_id where (nullif(p_filters->>'dateFrom','') is null or t.transfer_date>= (p_filters->>'dateFrom')::date) and (nullif(p_filters->>'dateTo','') is null or t.transfer_date<= (p_filters->>'dateTo')::date) and (nullif(p_filters->>'type','') is null or t.inventory_type=p_filters->>'type') and (nullif(p_filters->>'location','') is null or t.from_location_id=(p_filters->>'location')::uuid or t.to_location_id=(p_filters->>'location')::uuid) and (nullif(btrim(p_filters->>'search'),'') is null or concat_ws(' ',t.transfer_no,t.reason,t.notes,f.location_name,d.location_name) ilike '%'||btrim(p_filters->>'search')||'%');
  select coalesce(jsonb_agg(value order by (value->>'transfer_date') desc,(value->>'created_at') desc),'[]'::jsonb) into v_rows from (select jsonb_build_object('id',t.id,'transfer_no',t.transfer_no,'inventory_type',t.inventory_type,'transfer_date',t.transfer_date,'reason',t.reason,'notes',t.notes,'status',t.status,'created_at',t.created_at,'completed_at',t.completed_at,'from_location',jsonb_build_object('id',f.id,'name',f.location_name,'code',f.location_code),'to_location',jsonb_build_object('id',d.id,'name',d.location_name,'code',d.location_code),'created_by_name',coalesce(e.nickname,e.full_name),'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.quantity,'uom',i.uom,'raw_material_id',i.raw_material_id,'finished_good_id',i.finished_good_id,'source_batch_balance_id',coalesce(i.source_raw_material_batch_balance_id,i.source_finished_good_batch_balance_id),'destination_batch_balance_id',coalesce(i.destination_raw_material_batch_balance_id,i.destination_finished_good_batch_balance_id),'name',coalesce(rm.name_en,rm.name,fg.product_name_en,fg.product_name),'code',coalesce(rm.material_code,fg.product_code),'batch_no',coalesce(rb.internal_batch_no,rb.supplier_lot_no,fb.batch_no)) order by i.created_at,i.id) from public.factory_internal_transfer_items i left join public.factory_raw_materials rm on rm.id=i.raw_material_id left join public.factory_finished_goods fg on fg.id=i.finished_good_id left join public.factory_raw_material_batch_balances rb on rb.id=i.source_raw_material_batch_balance_id left join public.factory_finished_good_batch_balances fb on fb.id=i.source_finished_good_batch_balance_id where i.transfer_id=t.id),'[]'::jsonb)) as value from public.factory_internal_transfers t join public.factory_storage_locations f on f.id=t.from_location_id join public.factory_storage_locations d on d.id=t.to_location_id left join public.employees e on e.id=t.created_by where (nullif(p_filters->>'dateFrom','') is null or t.transfer_date>= (p_filters->>'dateFrom')::date) and (nullif(p_filters->>'dateTo','') is null or t.transfer_date<= (p_filters->>'dateTo')::date) and (nullif(p_filters->>'type','') is null or t.inventory_type=p_filters->>'type') and (nullif(p_filters->>'location','') is null or t.from_location_id=(p_filters->>'location')::uuid or t.to_location_id=(p_filters->>'location')::uuid) and (nullif(btrim(p_filters->>'search'),'') is null or concat_ws(' ',t.transfer_no,t.reason,t.notes,f.location_name,d.location_name) ilike '%'||btrim(p_filters->>'search')||'%') order by t.transfer_date desc,t.created_at desc offset v_offset limit v_size) page_rows;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size);
end; $$;

revoke all on function public.factory_next_internal_transfer_reference(), public.factory_internal_transfer_inventory(text,uuid), public.factory_complete_internal_transfer(uuid,jsonb), public.factory_internal_transfer_admin_data(jsonb,integer,integer) from public, anon;
grant execute on function public.factory_internal_transfer_inventory(text,uuid), public.factory_complete_internal_transfer(uuid,jsonb), public.factory_internal_transfer_admin_data(jsonb,integer,integer) to authenticated;

notify pgrst, 'reload schema';
