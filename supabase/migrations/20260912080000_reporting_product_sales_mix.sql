-- Extend the canonical Reporting product-ranking projection with its own denominator.
-- Product Analytics sales remain distinct from Financial Revenue.
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
  v_total_product_sales_revenue numeric;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_outlet_id is null or p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then raise exception 'A valid outlet and reporting period are required.'; end if;
  if not public.current_user_has_permission('reports.view') then raise exception using errcode = '42501', message = 'Missing permission to view reports.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode = '42501', message = 'You cannot view reports for this outlet.'; end if;
  select * into v_report from public.product_sales_reports where outlet_id = p_outlet_id and report_year = p_year and report_month = p_month;
  if not found then return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'unavailable', 'top_products', '[]'::jsonb, 'lowest_products', '[]'::jsonb, 'total_product_sales_revenue', null); end if;
  if v_report.status <> 'completed' or not exists (select 1 from public.product_sales_items where report_id = v_report.id) then return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'incomplete', 'top_products', '[]'::jsonb, 'lowest_products', '[]'::jsonb, 'total_product_sales_revenue', null); end if;
  select coalesce(sum(i.nett_sales), 0) into v_total_product_sales_revenue from public.product_sales_items i where i.report_id = v_report.id;
  with products as (select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name, sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue from public.product_sales_items i where i.report_id = v_report.id group by i.category_name, i.product_name, coalesce(i.variant_name, '')) select coalesce(jsonb_agg(jsonb_build_object('category_name', category_name, 'product_name', product_name, 'variant_name', variant_name, 'quantity', quantity, 'sales_revenue', sales_revenue) order by sales_revenue desc, category_name, product_name, variant_name), '[]'::jsonb) into v_top_products from (select * from products order by sales_revenue desc, category_name, product_name, variant_name limit 10) ranked;
  with products as (select i.category_name, i.product_name, coalesce(i.variant_name, '') as variant_name, sum(i.quantity) as quantity, sum(i.nett_sales) as sales_revenue from public.product_sales_items i where i.report_id = v_report.id group by i.category_name, i.product_name, coalesce(i.variant_name, '')) select coalesce(jsonb_agg(jsonb_build_object('category_name', category_name, 'product_name', product_name, 'variant_name', variant_name, 'quantity', quantity, 'sales_revenue', sales_revenue) order by sales_revenue asc, category_name, product_name, variant_name), '[]'::jsonb) into v_lowest_products from (select * from products where sales_revenue > 0 order by sales_revenue asc, category_name, product_name, variant_name limit 10) ranked;
  return jsonb_build_object('period', jsonb_build_object('year', p_year, 'month', p_month), 'product_data_status', 'available', 'top_products', v_top_products, 'lowest_products', v_lowest_products, 'total_product_sales_revenue', v_total_product_sales_revenue);
end; $$;

revoke all on function public.reporting_monthly_outlet_product_sales(uuid, integer, integer) from public, anon;
grant execute on function public.reporting_monthly_outlet_product_sales(uuid, integer, integer) to authenticated;
