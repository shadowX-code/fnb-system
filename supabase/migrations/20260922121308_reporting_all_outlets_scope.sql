-- Canonical Reporting scope reads. A NULL outlet argument is intentionally
-- meaningful only inside these trusted functions: it resolves to every outlet
-- the authenticated report viewer may access, never every outlet in the system.

create or replace function public.reporting_scope_outlets(p_outlet_id uuid default null)
returns table(outlet_id uuid, outlet_name text, outlet_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if not public.current_user_has_permission('reports.view') then
    raise exception using errcode = '42501', message = 'Missing permission to view reports.';
  end if;

  if p_outlet_id is not null then
    if not public.current_user_can_access_outlet(p_outlet_id) then
      raise exception using errcode = '42501', message = 'You cannot view reports for this outlet.';
    end if;
    return query
      select o.id, o.name, o.code
      from public.outlets o
      where o.id = p_outlet_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'Outlet not found.';
    end if;
    return;
  end if;

  return query
    select o.id, o.name, o.code
    from public.outlets o
    where public.current_user_can_access_outlet(o.id)
    order by o.name, o.id;

  if not found then
    raise exception using errcode = '42501', message = 'You do not have access to any reportable outlets.';
  end if;
end; $$;

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
    'financial_completeness', case when v_complete then 'complete' else 'incomplete' end
  );
end; $$;

create or replace function public.reporting_monthly_scope_product_sales(
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
  v_report_count integer;
  v_completed_outlet_count integer;
  v_top_products jsonb;
  v_lowest_products jsonb;
  v_category_contributions jsonb;
  v_total_product_sales_revenue numeric;
  v_status text;
begin
  if p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid reporting period is required.';
  end if;

  select count(*) into v_scope_count from public.reporting_scope_outlets(p_outlet_id);
  select count(*) into v_report_count
  from public.product_sales_reports r
  where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and r.report_year = p_year and r.report_month = p_month;
  select count(*) into v_completed_outlet_count
  from public.product_sales_reports r
  where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and r.report_year = p_year and r.report_month = p_month
    and r.status = 'completed'
    and exists (select 1 from public.product_sales_items i where i.report_id = r.id);

  v_status := case
    when v_report_count = 0 then 'unavailable'
    when v_completed_outlet_count = v_scope_count then 'available'
    else 'incomplete'
  end;

  if v_status <> 'available' then
    return jsonb_build_object(
      'period', jsonb_build_object('year', p_year, 'month', p_month),
      'product_data_status', v_status,
      'top_products', '[]'::jsonb,
      'lowest_products', '[]'::jsonb,
      'category_contributions', '[]'::jsonb,
      'total_product_sales_revenue', null
    );
  end if;

  with products as (
    select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name,
      sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue
    from public.product_sales_items i
    join public.product_sales_reports r on r.id = i.report_id
    where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
      and r.report_year = p_year and r.report_month = p_month and r.status = 'completed'
    group by i.category_name, i.product_name, coalesce(i.variant_name, '')
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'category_name', category_name, 'product_name', product_name, 'variant_name', variant_name,
    'quantity', quantity, 'sales_revenue', sales_revenue
  ) order by sales_revenue desc, category_name, product_name, variant_name), '[]'::jsonb)
  into v_top_products from (select * from products order by sales_revenue desc, category_name, product_name, variant_name limit 10) ranked;

  with products as (
    select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name,
      sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue
    from public.product_sales_items i
    join public.product_sales_reports r on r.id = i.report_id
    where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
      and r.report_year = p_year and r.report_month = p_month and r.status = 'completed'
    group by i.category_name, i.product_name, coalesce(i.variant_name, '')
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'category_name', category_name, 'product_name', product_name, 'variant_name', variant_name,
    'quantity', quantity, 'sales_revenue', sales_revenue
  ) order by sales_revenue asc, category_name, product_name, variant_name), '[]'::jsonb)
  into v_lowest_products from (select * from products where sales_revenue > 0 order by sales_revenue asc, category_name, product_name, variant_name limit 10) ranked;

  with categories as (
    select i.category_name, sum(i.nett_sales) as sales_revenue
    from public.product_sales_items i
    join public.product_sales_reports r on r.id = i.report_id
    where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
      and r.report_year = p_year and r.report_month = p_month and r.status = 'completed'
    group by i.category_name
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'category_name', category_name, 'sales_revenue', sales_revenue
  ) order by sales_revenue desc, category_name), '[]'::jsonb)
  into v_category_contributions from categories;

  select coalesce(sum(i.nett_sales), 0) into v_total_product_sales_revenue
  from public.product_sales_items i
  join public.product_sales_reports r on r.id = i.report_id
  where r.outlet_id in (select outlet_id from public.reporting_scope_outlets(p_outlet_id))
    and r.report_year = p_year and r.report_month = p_month and r.status = 'completed';

  return jsonb_build_object(
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'product_data_status', 'available',
    'top_products', v_top_products,
    'lowest_products', v_lowest_products,
    'category_contributions', v_category_contributions,
    'total_product_sales_revenue', v_total_product_sales_revenue
  );
end; $$;

create or replace function public.reporting_yearly_scope_financials(
  p_outlet_id uuid,
  p_year integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_months jsonb;
  v_outlet jsonb;
begin
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'A valid reporting year is required.';
  end if;

  select jsonb_agg(public.reporting_monthly_scope_financials(p_outlet_id, p_year, month_number) order by month_number)
  into v_months
  from generate_series(1, 12) as months(month_number);
  v_outlet := v_months->0->'outlet';

  return jsonb_build_object('outlet', v_outlet, 'year', p_year, 'months', v_months);
end; $$;

revoke all on function public.reporting_scope_outlets(uuid) from public, anon, authenticated;
revoke all on function public.reporting_monthly_scope_financials(uuid, integer, integer) from public, anon;
revoke all on function public.reporting_monthly_scope_product_sales(uuid, integer, integer) from public, anon;
revoke all on function public.reporting_yearly_scope_financials(uuid, integer) from public, anon;
grant execute on function public.reporting_monthly_scope_financials(uuid, integer, integer) to authenticated;
grant execute on function public.reporting_monthly_scope_product_sales(uuid, integer, integer) to authenticated;
grant execute on function public.reporting_yearly_scope_financials(uuid, integer) to authenticated;
