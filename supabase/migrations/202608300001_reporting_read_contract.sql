-- Canonical, read-only Reporting contracts.
-- Financial Revenue remains the sales-channel aggregation; Product Analytics
-- nett_sales is used only for product ranking and never substitutes revenue.

insert into public.permissions (code, module, description)
values
  ('reports.view', 'Reports', 'View outlet-scoped Reporting datasets.'),
  ('reports.export', 'Reports', 'Export outlet-scoped Reporting datasets.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('reports.view', 'reports.export')
where lower(r.name) in ('owner', 'admin')
on conflict do nothing;

create or replace function public.reporting_monthly_outlet_financials(
  p_outlet_id uuid,
  p_year integer,
  p_month integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outlet public.outlets%rowtype;
  v_has_sales boolean;
  v_has_purchases boolean;
  v_has_opex boolean;
  v_revenue numeric;
  v_purchase_based_cogs numeric;
  v_opex numeric;
  v_complete boolean;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_outlet_id is null or p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid outlet and reporting period are required.';
  end if;
  if not public.current_user_has_permission('reports.view') then
    raise exception using errcode = '42501', message = 'Missing permission to view reports.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view reports for this outlet.';
  end if;

  select * into v_outlet from public.outlets where id = p_outlet_id;
  if not found then raise exception using errcode = 'P0002', message = 'Outlet not found.'; end if;

  select exists(select 1 from public.sales_records s where s.outlet_id = p_outlet_id and s.year = p_year and s.month = p_month)
    into v_has_sales;
  select coalesce(sum(case
    when coalesce(c.type, 'channel') = 'channel' then s.amount
    when coalesce(c.type, 'channel') = 'adjustment' then -abs(s.amount)
    else 0
  end), 0)
  into v_revenue
  from public.sales_records s
  left join public.sales_channels c on c.id = s.channel_id
  where s.outlet_id = p_outlet_id and s.year = p_year and s.month = p_month;

  select exists(select 1 from public.purchase_records p where p.outlet_id = p_outlet_id and p.year = p_year and p.month = p_month)
    into v_has_purchases;
  select coalesce(sum(p.amount), 0) into v_purchase_based_cogs
  from public.purchase_records p
  where p.outlet_id = p_outlet_id and p.year = p_year and p.month = p_month;

  select exists(select 1 from public.operating_expenses e where e.outlet_id = p_outlet_id and e.year = p_year and e.month = p_month)
    into v_has_opex;
  select e.amount into v_opex from public.operating_expenses e
  where e.outlet_id = p_outlet_id and e.year = p_year and e.month = p_month;

  v_complete := v_has_sales and v_has_purchases and v_has_opex;
  return jsonb_build_object(
    'outlet', jsonb_build_object('id', v_outlet.id, 'name', v_outlet.name, 'code', v_outlet.code),
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

create or replace function public.reporting_monthly_outlet_product_sales(
  p_outlet_id uuid,
  p_year integer,
  p_month integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.product_sales_reports%rowtype;
  v_top_products jsonb;
  v_lowest_products jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_outlet_id is null or p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'A valid outlet and reporting period are required.';
  end if;
  if not public.current_user_has_permission('reports.view') then raise exception using errcode = '42501', message = 'Missing permission to view reports.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode = '42501', message = 'You cannot view reports for this outlet.'; end if;

  select * into v_report from public.product_sales_reports
  where outlet_id = p_outlet_id and report_year = p_year and report_month = p_month;
  if not found then
    return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'unavailable', 'top_products', '[]'::jsonb, 'lowest_products', '[]'::jsonb);
  end if;
  if v_report.status <> 'completed' then
    return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'incomplete', 'top_products', '[]'::jsonb, 'lowest_products', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.product_sales_items where report_id = v_report.id) then
    return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'incomplete', 'top_products', '[]'::jsonb, 'lowest_products', '[]'::jsonb);
  end if;

  with products as (
    select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name,
      sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue
    from public.product_sales_items i
    where i.report_id = v_report.id
    group by i.category_name, i.product_name, coalesce(i.variant_name, '')
  )
  select coalesce(jsonb_agg(jsonb_build_object('category_name', category_name, 'product_name', product_name, 'variant_name', variant_name, 'quantity', quantity, 'sales_revenue', sales_revenue) order by sales_revenue desc, category_name, product_name, variant_name), '[]'::jsonb)
  into v_top_products from (select * from products order by sales_revenue desc, category_name, product_name, variant_name limit 10) ranked;

  with products as (
    select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name,
      sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue
    from public.product_sales_items i
    where i.report_id = v_report.id
    group by i.category_name, i.product_name, coalesce(i.variant_name, '')
  )
  select coalesce(jsonb_agg(jsonb_build_object('category_name', category_name, 'product_name', product_name, 'variant_name', variant_name, 'quantity', quantity, 'sales_revenue', sales_revenue) order by sales_revenue asc, category_name, product_name, variant_name), '[]'::jsonb)
  into v_lowest_products from (select * from products where sales_revenue > 0 order by sales_revenue asc, category_name, product_name, variant_name limit 10) ranked;

  return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'available', 'top_products', v_top_products, 'lowest_products', v_lowest_products);
end; $$;

revoke all on function public.reporting_monthly_outlet_financials(uuid, integer, integer) from public, anon;
revoke all on function public.reporting_monthly_outlet_product_sales(uuid, integer, integer) from public, anon;
grant execute on function public.reporting_monthly_outlet_financials(uuid, integer, integer) to authenticated;
grant execute on function public.reporting_monthly_outlet_product_sales(uuid, integer, integer) to authenticated;
