-- Restaurant queries are fixed resource projections, never a generic table/RPC API.
create function feedx_integrations.restaurant_read_authorize(p_token text,p_module text,p_outlet uuid)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m uuid; permission text;
begin
 if not exists(select 1 from feedx_integrations.navigation_modules where id=p_module and workspace='Restaurant') then raise exception using errcode='22023',message='Unsupported Restaurant module';end if;
 select c.permission_code into strict permission from feedx_integrations.capabilities c where c.navigation_module_id=p_module and c.workspace='Restaurant' and c.action_type='view' and c.implemented;
 m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if feedx_integrations.authorize(p_token,permission) is distinct from m or not feedx_integrations.restaurant_actor_outlet(m,p_outlet) then
 raise exception using errcode='42501',message='Restaurant View grant and outlet scope are required';end if;
 return m;
end $$;
revoke all on function feedx_integrations.restaurant_read_authorize(text,text,uuid) from public,anon,authenticated;

create function public.restaurant_agent_resource_query(p_token text,p_queries jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb; binding record; m uuid; outlet uuid; row_value jsonb; data jsonb; results jsonb:='[]';
 fields text[]; query_sql text; predicate text; kind text; total integer; size integer; last_id uuid; out_next uuid; id uuid; parent uuid; month_value integer;year_value integer;
begin
 if p_queries is null or jsonb_typeof(p_queries)<>'array' or jsonb_array_length(p_queries) not between 1 and 5 then raise exception using errcode='22023',message='Supply one to five Restaurant queries';end if;
 -- Authorize the complete request before reading any business evidence.
 for q in select value from jsonb_array_elements(p_queries) loop
  if jsonb_typeof(q)<>'object' or exists(select 1 from jsonb_object_keys(q) k where not k=any(array['business_module','resource','outlet_id','id','parent_id','after','page_size','year','month'])) then raise exception using errcode='22023',message='Unsupported Restaurant query fields';end if;
  outlet:=(q->>'outlet_id')::uuid;
  perform feedx_integrations.restaurant_read_authorize(p_token,q->>'business_module',outlet);
  if not exists(select 1 from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=q->>'business_module' and r.slug=q->>'resource' and r.workspace='Restaurant' and r.implemented) then raise exception using errcode='42501',message='Resource is not part of this Restaurant capability';end if;
 end loop;
 for q in select value from jsonb_array_elements(p_queries) loop
  outlet:=(q->>'outlet_id')::uuid;id:=nullif(q->>'id','')::uuid;parent:=nullif(q->>'parent_id','')::uuid;last_id:=nullif(q->>'after','')::uuid;
  size:=coalesce((q->>'page_size')::integer,50);if size not between 1 and 100 then raise exception using errcode='22023',message='Page size must be 1 to 100';end if;
  select b.*,r.slug into strict binding from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=q->>'business_module' and r.slug=q->>'resource' and r.workspace='Restaurant';
  select array_agg(v) into fields from jsonb_array_elements_text(binding.allowed_fields) v;
  kind:=coalesce(binding.row_scope->>'kind','outlet');data:='[]';out_next:=null;total:=0;
  m:=feedx_integrations.restaurant_read_authorize(p_token,q->>'business_module',outlet);
  if kind='pnl' then
   year_value:=(q->>'year')::integer;month_value:=(q->>'month')::integer;
   if year_value is null or year_value not between 2000 and 2100 or (month_value is not null and month_value not between 1 and 12) then raise exception using errcode='22023',message='Supply a valid P&L year and optional month';end if;
   for month_value in select generate_series(coalesce(month_value,1),coalesce(month_value,12)) loop
    data:=data||jsonb_build_array(feedx_integrations.ra_reporting_monthly_outlet_financials(m,outlet,year_value,month_value));
   end loop;
   total:=jsonb_array_length(data);
  elsif kind='periods' then
   select coalesce(jsonb_agg(jsonb_build_object('year',y,'month',mo) order by y,mo),'[]') into data from (
    select year y,month mo from public.sales_records where outlet_id=outlet union select year,month from public.purchase_records where outlet_id=outlet union select year,month from public.operating_expenses where outlet_id=outlet
   ) v;
   total:=jsonb_array_length(data);
   if total>1200 then raise exception using errcode='54000',message='Too many recorded financial periods';end if;
  else
   -- Registry-owned names are quoted identifiers. No client chooses a relation or predicate.
   if kind='item_links' then predicate:='exists(select 1 from public.inventory_item_outlets l where l.inventory_item_id=t.id and l.outlet_id=$1)';
   elsif kind='supplier_links' then predicate:='exists(select 1 from public.supplier_outlets l where l.supplier_id=t.id and l.outlet_id=$1)';
   elsif kind='master' then predicate:='true';
   elsif kind='child' then predicate:=format('exists(select 1 from public.%I h where h.id=t.%I and h.outlet_id=$1) and ($4 is null or t.%I=$4)',binding.row_scope->>'parent',binding.row_scope->>'fk',binding.row_scope->>'fk');
   else predicate:='t.outlet_id=$1';end if;
   predicate:=predicate||' and ($2 is null or t.id=$2)';
   query_sql:=format('select count(*) from public.%I t where %s',binding.row_scope->>'relation',predicate);
   execute query_sql into total using outlet,id,last_id,parent;
   if total>5000 then raise exception using errcode='54000',message='Restaurant source window exceeds 5000 records; narrow by record or parent identity';end if;
   query_sql:=format('select coalesce(jsonb_agg(v order by row_id),''[]''::jsonb) from (select t.id row_id,(select coalesce(jsonb_object_agg(e.key,e.value),''{}''::jsonb) from jsonb_each(to_jsonb(t)) e where e.key=any($5)) v from public.%I t where %s and ($3 is null or t.id>$3) order by t.id limit $6) p',binding.row_scope->>'relation',predicate);
   execute query_sql into data using outlet,id,last_id,parent,fields,size+1;
   if jsonb_array_length(data)>size then
    data:=data- size;out_next:=(data->(size-1)->>'id')::uuid;
   end if;
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('business_module',q->>'business_module','resource',q->>'resource','outlet_id',outlet,'records',data,'total_records',total,'page_complete',out_next is null,'next_after',out_next,
    'limitations','Saved canonical evidence, not a live stock balance or physical attestation. net_profit is the retained canonical management EBITDA field. Missing financial evidence remains missing.'));
 end loop;
 if octet_length(results::text)>524288 then raise exception using errcode='54000',message='Restaurant response exceeds 512 KiB; narrow the query';end if;
 return jsonb_build_object('results',results);
end $$;
revoke all on function public.restaurant_agent_resource_query(text,jsonb) from public;
grant execute on function public.restaurant_agent_resource_query(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
