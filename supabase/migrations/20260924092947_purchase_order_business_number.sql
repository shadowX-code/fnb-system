-- Freeze the former Admin display numbers before introducing server-owned numbers.
-- The historical ordering matches the old Admin projection (UTC created date,
-- created_at then technical po_no); historical suffixes remain three digits.
alter table public.inventory_purchase_orders add column business_po_no text;

with numbered as (
  select p.id,
    coalesce(nullif(left(regexp_replace(upper(coalesce(nullif(trim(o.code), ''), nullif(trim(o.name), ''), o.id::text, 'OUTLET')), '[^A-Z0-9]', '', 'g'), 8), ''), 'OUTLET') as prefix,
    to_char(p.created_at at time zone 'UTC', 'YYMMDD') as date_code,
    row_number() over (partition by (p.created_at at time zone 'UTC')::date
      order by p.created_at, coalesce(nullif(p.po_no, ''), p.id::text)) as daily_number
  from public.inventory_purchase_orders p
  left join public.outlets o on o.id = p.outlet_id
)
update public.inventory_purchase_orders p
set business_po_no = n.prefix || '-' || n.date_code || '-' || lpad(n.daily_number::text, greatest(3, length(n.daily_number::text)), '0')
from numbered n where n.id = p.id;

alter table public.inventory_purchase_orders alter column business_po_no set not null;
create unique index inventory_purchase_orders_business_po_no_key
  on public.inventory_purchase_orders (business_po_no);

-- The private counter is atomic across concurrent inserts. Its key is the
-- displayed prefix/date, rather than outlet_id, because outlet codes are not
-- globally unique. At 100 orders in one prefix/day the suffix expands to 100;
-- it never wraps to 00 or reuses a business number.
create table inventory_authority.purchase_order_business_sequences (
  prefix text not null,
  business_date date not null,
  last_number integer not null check (last_number > 0),
  primary key (prefix, business_date)
);
revoke all on inventory_authority.purchase_order_business_sequences from public, anon, authenticated;

create function inventory_authority.assign_purchase_order_business_no()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_date date := (new.created_at at time zone 'UTC')::date;
  v_date_code text := to_char(new.created_at at time zone 'UTC', 'YYMMDD');
  v_number integer;
begin
  select coalesce(nullif(left(regexp_replace(upper(coalesce(nullif(trim(o.code), ''), nullif(trim(o.name), ''), o.id::text, 'OUTLET')), '[^A-Z0-9]', '', 'g'), 8), ''), 'OUTLET')
    into v_prefix from public.outlets o where o.id = new.outlet_id;
  v_prefix := coalesce(v_prefix, 'OUTLET');

  insert into inventory_authority.purchase_order_business_sequences(prefix, business_date, last_number)
  values (v_prefix, v_date, coalesce((
    select max(substring(p.business_po_no from '[0-9]+$')::integer)
    from public.inventory_purchase_orders p
    where left(p.business_po_no, length(v_prefix) + 8) = v_prefix || '-' || v_date_code || '-'
  ), 0) + 1)
  on conflict (prefix, business_date) do update
    set last_number = inventory_authority.purchase_order_business_sequences.last_number + 1
  returning last_number into v_number;

  new.business_po_no := v_prefix || '-' || v_date_code || '-' || lpad(v_number::text, greatest(2, length(v_number::text)), '0');
  return new;
end; $$;

create function inventory_authority.protect_purchase_order_business_no()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.business_po_no is distinct from old.business_po_no then
    raise exception 'Purchase order business number is immutable.';
  end if;
  return new;
end; $$;

revoke all on function inventory_authority.assign_purchase_order_business_no(),
  inventory_authority.protect_purchase_order_business_no() from public, anon, authenticated;
create trigger inventory_purchase_order_business_no_insert
  before insert on public.inventory_purchase_orders for each row
  execute function inventory_authority.assign_purchase_order_business_no();
create trigger inventory_purchase_order_business_no_update
  before update of business_po_no on public.inventory_purchase_orders for each row
  execute function inventory_authority.protect_purchase_order_business_no();

-- Keep the existing opaque-session scope and suggestion authority intact;
-- expose the persisted identity alongside the technical po_no in both reads.
create or replace function public.crew_inventory_purchase_orders(p_token text,p_outlet_id uuid default null,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb:=inventory_authority.crew_scope(p_token,p_outlet_id,'order_read');
  v_outlet uuid:=(v_context->>'outlet_id')::uuid; v_order public.inventory_purchase_orders%rowtype;
  v_detail jsonb;
begin
  if p_order_id is not null then
    select * into v_order from public.inventory_purchase_orders where id=p_order_id and outlet_id=v_outlet;
    if not found then raise exception using errcode='42501',message='Purchase order is unavailable for this outlet.'; end if;
    select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'status',p.status,
      'supplier_id',p.supplier_id,'supplier_name',s.name,'source_type',p.source_type,
      'source_stock_check_id',p.source_stock_check_id,'created_at',p.created_at,
      'submitted_at',p.submitted_at,'confirmed_at',p.confirmed_at,'completed_at',p.completed_at,
      'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,
        'item_name',i.item_name,'sku_code',i.sku_code,'requested_qty',l.requested_qty,
        'received_qty',l.received_qty,'remaining_qty',greatest(l.requested_qty-l.received_qty,0),
        'unit',l.unit,'remark',l.remark,'source_stock_check_item_id',l.source_stock_check_item_id)
        order by i.item_name,l.id)
        from public.inventory_purchase_order_items l join public.inventory_items i on i.id=l.item_id
        where l.purchase_order_id=p.id),'[]'::jsonb),
      'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,
        'remark',r.remark,'lines',coalesce((select jsonb_agg(jsonb_build_object('item_id',ri.item_id,
        'purchase_order_item_id',ri.purchase_order_item_id,'received_qty',ri.received_qty,
        'unit',ri.unit,'remark',ri.remark) order by ri.id)
        from public.inventory_purchase_receipt_items ri where ri.receipt_id=r.id),'[]'::jsonb))
        order by r.received_at,r.id) from public.inventory_purchase_receipts r
        where r.purchase_order_id=p.id),'[]'::jsonb)) into v_detail
      from public.inventory_purchase_orders p left join public.suppliers s on s.id=p.supplier_id
      where p.id=p_order_id;
  end if;
  return jsonb_build_object('outlet_id',v_outlet,
    'can_manage_purchase_orders',v_context->'can_manage_purchase_orders',
    'can_receive_purchase_orders',v_context->'can_receive_purchase_orders',
    'orders',coalesce((select jsonb_agg(row_data order by sort_at desc)
      from (select jsonb_build_object('id',p.id,'po_no',p.po_no,'business_po_no',p.business_po_no,'supplier_id',p.supplier_id,
        'supplier_name',s.name,'status',p.status,'source_type',p.source_type,
        'source_stock_check_id',p.source_stock_check_id,
        'created_at',p.created_at,'line_count',(select count(*) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'requested_qty',(select coalesce(sum(l.requested_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id),
        'received_qty',(select coalesce(sum(l.received_qty),0) from public.inventory_purchase_order_items l where l.purchase_order_id=p.id)) row_data,
        p.created_at sort_at from public.inventory_purchase_orders p
        left join public.suppliers s on s.id=p.supplier_id where p.outlet_id=v_outlet
        order by p.created_at desc,p.id limit 100) bounded),'[]'::jsonb),
    'suggestions',case when coalesce((v_context->>'can_manage_purchase_orders')::boolean,false) then
      coalesce((select jsonb_agg(row_data order by checked_at desc)
        from (select jsonb_build_object('stock_check_id',c.id,'check_name',coalesce(c.check_name,g.name),
          'check_date',c.check_date,'shortages',coalesce((select jsonb_agg(jsonb_build_object(
            'stock_check_item_id',ci.id,'item_id',ci.item_id,'item_name',i.item_name,
            'current_qty',ci.actual_count_quantity,'par_qty',ci.par_level_quantity,
            'shortage_qty',ci.par_level_quantity-ci.actual_count_quantity,'unit',ci.unit,
            'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
              from public.inventory_item_outlet_suppliers ios
              join public.inventory_item_outlets io on io.id=ios.inventory_item_outlet_id
              join public.suppliers s on s.id=ios.supplier_id and s.status='active'
              join public.supplier_outlets so on so.supplier_id=s.id and so.outlet_id=v_outlet
              where io.outlet_id=v_outlet and io.inventory_item_id=ci.item_id),'[]'::jsonb)) order by i.item_name,ci.id)
            from public.inventory_stock_check_items ci join public.inventory_items i on i.id=ci.item_id
            where ci.stock_check_id=c.id and not ci.skipped and ci.actual_count_quantity is not null
              and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled')),'[]'::jsonb)) row_data,
          c.submitted_at checked_at
          from public.inventory_stock_checks c left join public.inventory_stock_check_groups g on g.id=c.group_id
          where c.outlet_id=v_outlet and c.stock_check_type='scheduled' and c.status='submitted'
            and exists(select 1 from public.inventory_stock_check_items ci where ci.stock_check_id=c.id
              and not ci.skipped and ci.actual_count_quantity is not null and ci.par_level_quantity>ci.actual_count_quantity
              and not exists(select 1 from public.inventory_purchase_order_items l
                join public.inventory_purchase_orders p on p.id=l.purchase_order_id
                where l.source_stock_check_item_id=ci.id and p.status<>'cancelled'))
          order by c.submitted_at desc,c.id limit 40) bounded),'[]'::jsonb)
      else '[]'::jsonb end,'detail',v_detail);
end; $$;
