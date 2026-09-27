-- Staging applied the initial number authority before the >99 boundary was
-- caught in review. PostgreSQL lpad truncates overlength input, so install
-- the length-safe generator as a forward-only correction.
create or replace function inventory_authority.assign_purchase_order_business_no()
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
