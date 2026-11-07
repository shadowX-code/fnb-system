-- Read-only Product Analytics; no report/import mutation is exposed.
insert into feedx_integrations.navigation_modules(id,workspace,section,label,route,sidebar,coverage,explanation,sort_order,human_permission)
values('product_analytics','Restaurant','Sales Analytics','Product Sales Analytics','/overview/product-analytics',true,'available','Complete canonical saved report windows; missing periods remain missing.',2200,'product_analytics.view');
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) values('restaurant_agent_nav_product_analytics.view','restaurant_agent_nav_product_analytics','Read Product Sales Analytics through the scoped Agent Gateway.',true);
insert into feedx_integrations.capabilities(tool_id,adapter_key,label,description,workspace,domain,domain_label,action_type,permission_code,requires_human_approval,implemented,sort_order,mcp_tool,navigation_module_id)
values('restaurant.view.product_analytics','factory_mesti','Product Sales Analytics','Read complete product rankings, quantities, net sales, discounts and comparisons. POS sources remain read-only.','Restaurant','Sales Analytics','Sales Analytics','view','restaurant_agent_nav_product_analytics.view',false,true,2200,'query_product_sales_analytics','product_analytics');
create function public.product_analytics_agent_source(p_token text,p_outlet_id uuid,p_year int default null,p_month int default null,p_after uuid default null,p_snapshot text default null,p_periods boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid;reports jsonb;items jsonb;total int;source_hash text;
begin
 m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if feedx_integrations.authorize(p_token,'restaurant_agent_nav_product_analytics.view') is distinct from m or not feedx_integrations.restaurant_actor_outlet(m,p_outlet_id) then raise exception using errcode='42501',message='Product Analytics View and outlet scope are required';end if;
 if p_periods then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'year',report_year,'month',report_month,'status',status,'uploaded_at',uploaded_at) order by report_year desc,report_month desc,id),'[]') into reports from product_sales_reports where outlet_id=p_outlet_id;
  if jsonb_array_length(reports)>1200 then raise exception using errcode='54000',message='Narrow the recorded period window';end if;
  return jsonb_build_object('periods',reports);
 end if;
 if p_year is null or p_year not between 2000 and 2100 or (p_month is not null and p_month not between 1 and 12) then raise exception using errcode='22023',message='Use a valid year and optional month';end if;
 -- A single statement observes report metadata, count, source digest and page together.
 with reports_source as materialized (
  select id,outlet_id,report_year,report_month,status,uploaded_at,total_net_sales,total_quantity,total_discount from product_sales_reports where outlet_id=p_outlet_id and report_year=p_year and (p_month is null or report_month=p_month)
 ), item_source as materialized (
  select i.id,i.report_id,i.outlet_id,i.category_name,i.product_name,i.variant_name,i.quantity,i.gross_sales,i.discount,i.sst,i.service_charge,i.nett_sales,i.created_at
  from product_sales_items i join reports_source r on r.id=i.report_id where i.outlet_id=p_outlet_id
 )
 select (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from reports_source r),
  (select count(*) from item_source),
  (select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by r.id),'')) from reports_source r)||':'||(select md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' order by i.id),'')) from item_source i),
  (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from (select * from item_source where p_after is null or id>p_after order by id limit 500) p)
 into reports,total,source_hash,items;
 if total>50000 then raise exception using errcode='54000',message='Narrow Product Analytics to a smaller report period';end if;
 if p_snapshot is not null and p_snapshot<>source_hash then raise exception using errcode='40001',message='Product reports changed; restart the complete read';end if;
 if exists(select 1 from product_sales_items i join product_sales_reports r on r.id=i.report_id where r.outlet_id=p_outlet_id and r.report_year=p_year and (p_month is null or r.report_month=p_month) and i.outlet_id is distinct from r.outlet_id) then raise exception using errcode='55000',message='Report item outlet evidence conflicts';end if;
 return jsonb_build_object('reports',reports,'records',items,'total_records',total,'snapshot',source_hash,'missing_source',jsonb_array_length(reports)=0,'limitations','Saved POS report window; missing months and non-completed report states are explicit. No source writes.');
end $$;
revoke all on function public.product_analytics_agent_source(text,uuid,int,int,uuid,text,boolean) from public;
grant execute on function public.product_analytics_agent_source(text,uuid,int,int,uuid,text,boolean) to anon,authenticated;
update feedx_integrations.adapters set tools=tools||'[{"name":"query_product_sales_analytics","description":"Read complete outlet-scoped Product Sales Analytics, periods and comparisons."}]'::jsonb where key='factory_mesti';
notify pgrst,'reload schema';
