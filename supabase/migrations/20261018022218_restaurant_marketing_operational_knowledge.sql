-- Restaurant owns service information. Marketing owns only supplemental product copy.
create table public.outlet_service_profiles (
 outlet_id uuid primary key references public.outlets(id), revision integer not null check(revision>0),
 data jsonb not null, updated_by uuid not null references public.employees(id), updated_at timestamptz not null default now(),
 check(octet_length(data::text)<=20000)
);
create table public.outlet_service_profile_history (
 outlet_id uuid not null references public.outlets(id),revision integer not null,data jsonb not null,
 actor uuid not null references public.employees(id),created_at timestamptz not null default now(),
 request_id uuid not null unique,fingerprint text not null,primary key(outlet_id,revision)
);
alter table public.outlet_service_profiles enable row level security;
alter table public.outlet_service_profile_history enable row level security;
revoke all on public.outlet_service_profiles,public.outlet_service_profile_history from public,anon,authenticated;

create function public.outlet_service_profile_read(p_outlet uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();
begin
 if not exists(select 1 from outlets where id=p_outlet) or not (
  (public.current_user_can_access_outlet(p_outlet) and (public.current_user_has_permission('outlets.view') or public.current_user_has_permission('outlets.edit')))
  or exists(select 1 from brand_outlets bo where bo.outlet_id=p_outlet and marketing_private.actor_allowed(actor,bo.organization_id,bo.brand_id,'marketing_settings.view'))
 ) then raise exception using errcode='42501',message='Outlet service information is unavailable for this scope.';end if;
 return jsonb_build_object('outlet',(select jsonb_build_object('id',id,'name',name,'address',address,'is_active',is_active) from outlets where id=p_outlet),
 'profile',(select to_jsonb(p) from outlet_service_profiles p where outlet_id=p_outlet),
 'can_edit',public.current_user_can_access_outlet(p_outlet) and public.current_user_has_permission('outlets.edit'));
end;$$;
revoke all on function public.outlet_service_profile_read(uuid) from public,anon;
grant execute on function public.outlet_service_profile_read(uuid) to authenticated;

create function public.outlet_service_profile_save(p_request uuid,p_outlet uuid,p_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();prior public.outlet_service_profile_history;v integer;fp text;hours jsonb;day jsonb;period jsonb;seen text[];value text;
begin
 if not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(p_outlet) then raise exception using errcode='42501',message='Outlet edit permission and Outlet access are required.';end if;
 if p_request is null or p_revision is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000
 or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('timezone','phone','email','website','weekly_hours','special_hours','service_policies'))
 or not p_data ?& array['timezone','phone','email','website','weekly_hours','special_hours','service_policies']
 or not exists(select 1 from pg_timezone_names where name=p_data->>'timezone')
 or length(coalesce(p_data->>'phone',''))>80 or length(coalesce(p_data->>'email',''))>160 or length(coalesce(p_data->>'website',''))>300 or length(coalesce(p_data->>'service_policies',''))>4000
 or (coalesce(p_data->>'website','')<>'' and p_data->>'website' !~ '^https://[^[:space:]]+$')
 or (coalesce(p_data->>'email','')<>'' and p_data->>'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
 then raise exception 'Provide valid, bounded Outlet service information.';end if;
 if exists(select 1 from jsonb_each(p_data) e where e.key in ('timezone','phone','email','website','service_policies') and jsonb_typeof(e.value)<>'string') then raise exception 'Contact details and policies must be text.';end if;
 if jsonb_typeof(p_data->'weekly_hours') is distinct from 'array' or jsonb_array_length(p_data->'weekly_hours')<>7 or jsonb_typeof(p_data->'special_hours') is distinct from 'array' or jsonb_array_length(p_data->'special_hours')>30 then raise exception 'Provide seven weekly days and at most 30 special dates.';end if;
 foreach value in array array['weekly_hours','special_hours'] loop
  seen:='{}';
  for day in select x from jsonb_array_elements(p_data->value) x loop
   if jsonb_typeof(day)<>'object' or day->>'status' not in ('unknown','closed','open') or day->>'status' is null or jsonb_typeof(day->'periods') is distinct from 'array' or jsonb_array_length(day->'periods')>3 then raise exception 'Choose unknown, closed or up to three opening periods.';end if;
   if exists(select 1 from jsonb_object_keys(day) k where k not in ('day','date','status','periods','reason')) then raise exception 'Unexpected hours field.';end if;
   if value='weekly_hours' then
    if day->>'day' !~ '^[0-6]$' or day->>'day' is null then raise exception 'Choose a valid weekday.';end if;
    if day->>'day'=any(seen) then raise exception 'Weekdays must be unique.';end if;seen:=seen||array[day->>'day'];
   else
    if day->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or day->>'date' is null or (day->>'date')::date::text<>day->>'date' or length(coalesce(day->>'reason',''))>200 then raise exception 'Provide a valid special date and bounded reason.';end if;
    if day->>'date'=any(seen) then raise exception 'Special dates must be unique.';end if;seen:=seen||array[day->>'date'];
   end if;
   if (day->>'status'='open') is distinct from (jsonb_array_length(day->'periods')>0) then raise exception 'Opening periods are required only for open days.';end if;
   for period in select x from jsonb_array_elements(day->'periods') x loop
    if jsonb_typeof(period)<>'object' or exists(select 1 from jsonb_object_keys(period) k where k not in ('opens','closes','overnight'))
    or coalesce(period->>'opens','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(period->>'closes','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(period->'overnight') is distinct from 'boolean'
    or (not (period->>'overnight')::boolean and period->>'closes'<=period->>'opens')
    or ((period->>'overnight')::boolean and period->>'closes'>period->>'opens') then raise exception 'Confirm opening/closing times and next-day closing explicitly.';end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(day->'periods') with ordinality a(p,n) join jsonb_array_elements(day->'periods') with ordinality b(p,n) on a.n<b.n
    where extract(epoch from (a.p->>'opens')::time)<extract(epoch from (b.p->>'closes')::time)+case when (b.p->>'overnight')::boolean then 86400 else 0 end
    and extract(epoch from (b.p->>'opens')::time)<extract(epoch from (a.p->>'closes')::time)+case when (a.p->>'overnight')::boolean then 86400 else 0 end) then raise exception 'Opening periods must not overlap.';end if;
  end loop;
 end loop;
 fp:=md5(jsonb_build_array(p_outlet,p_revision,p_data)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from outlet_service_profile_history where request_id=p_request;
 if found then if prior.actor<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return jsonb_build_object('outlet_id',p_outlet,'revision',prior.revision,'data',prior.data);end if;
 perform 1 from outlets where id=p_outlet for update;if not found then raise exception 'Outlet unavailable.';end if;
 select revision into v from outlet_service_profiles where outlet_id=p_outlet;
 if coalesce(v,0)<>p_revision then raise exception using errcode='40001',message='Outlet service information changed. Reload before saving.';end if;
 insert into outlet_service_profiles values(p_outlet,p_revision+1,p_data,actor,now()) on conflict(outlet_id) do update set revision=excluded.revision,data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 insert into outlet_service_profile_history values(p_outlet,p_revision+1,p_data,actor,now(),p_request,fp);
 return jsonb_build_object('outlet_id',p_outlet,'revision',p_revision+1,'data',p_data);
end;$$;
revoke all on function public.outlet_service_profile_save(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.outlet_service_profile_save(uuid,uuid,integer,jsonb) to authenticated;

create table public.marketing_product_descriptions (
 brand_id uuid not null references public.brands(id),outlet_id uuid not null references public.outlets(id),product_key text not null,
 revision integer not null,source_hash text not null,data jsonb not null,updated_by uuid not null references public.employees(id),updated_at timestamptz not null default now(),
 primary key(brand_id,outlet_id,product_key),check(octet_length(data::text)<=4000)
);
create table public.marketing_product_description_history (
 brand_id uuid not null references public.brands(id),outlet_id uuid not null references public.outlets(id),product_key text not null,
 revision integer not null,source_hash text not null,data jsonb not null,actor uuid not null references public.employees(id),created_at timestamptz not null default now(),
 primary key(brand_id,outlet_id,product_key,revision)
);
alter table public.marketing_product_descriptions enable row level security;
alter table public.marketing_product_description_history enable row level security;
revoke all on public.marketing_product_descriptions,public.marketing_product_description_history from public,anon,authenticated;

-- Exact Product Analytics normalized category/name/variant identity, always scoped to an Outlet.
-- POS amounts and quantities are deliberately not projected. Sales are not price/availability authority.
create function marketing_private.restaurant_brand_products(p_brand uuid) returns setof jsonb language sql stable set search_path=public as $$
 with reports as materialized (
  select distinct on (r.outlet_id) r.* from product_sales_reports r join brand_outlets bo on bo.outlet_id=r.outlet_id
  join outlets o on o.id=r.outlet_id and o.is_active
  where bo.brand_id=p_brand and r.status='completed' order by r.outlet_id,r.report_year desc,r.report_month desc,r.uploaded_at desc,r.id
 ), products as (
  select r.outlet_id,r.id report_id,r.report_year,r.report_month,
   lower(regexp_replace(btrim(i.category_name),'\s+',' ','g')) category_key,
   lower(regexp_replace(btrim(i.product_name),'\s+',' ','g')) name_key,
   lower(regexp_replace(btrim(coalesce(nullif(i.variant_name,''),'Default')),'\s+',' ','g')) variant_key,
   min(i.product_name) name,min(i.category_name) category,min(coalesce(i.variant_name,'')) variant
  from reports r join product_sales_items i on i.report_id=r.id and i.outlet_id=r.outlet_id
  where nullif(btrim(i.product_name),'') is not null group by r.outlet_id,r.id,r.report_year,r.report_month,category_key,name_key,variant_key
 ), identified as (
  select p.*,md5(jsonb_build_array(category_key,name_key,variant_key)::text) product_key,
   m.recipe_id,m.mapping_id,m.mapping_updated_at,r.selling_price,r.updated_at recipe_updated_at,
   case when p.variant_key='default' and m.matches=1 and r.status='active' and r.selling_price>0 then r.selling_price else null end current_price
  from products p
  left join lateral (select count(*) matches,min(m.id::text)::uuid mapping_id,case when count(*)=1 then min(m.recipe_id::text)::uuid else null end recipe_id,max(m.updated_at) mapping_updated_at
   from product_recipe_mappings m where m.outlet_id=p.outlet_id and m.status='mapped' and lower(regexp_replace(btrim(m.product_name),'\s+',' ','g'))=p.name_key) m on true
  left join inventory_recipes r on m.matches=1 and r.id=m.recipe_id and r.outlet_id=p.outlet_id
 ), source as (
  select i.*,md5(jsonb_build_array(i.outlet_id,i.product_key,i.name,i.category,i.variant,i.mapping_id,i.mapping_updated_at,i.recipe_id,i.recipe_updated_at,i.current_price)::text) source_hash from identified i
 )
 select jsonb_build_object('product_key',s.product_key,'outlet_id',s.outlet_id,'name',s.name,'category',s.category,'variant',s.variant,
  'report_id',s.report_id,'report_year',s.report_year,'report_month',s.report_month,'source','restaurant_product_sales','source_hash',s.source_hash,
  'recipe_id',s.recipe_id,'current_price',s.current_price,'currency','MYR','availability',null,
  'price_issue',case when s.current_price is not null then null when s.variant_key<>'default' then 'variant_price_unverified' when s.selling_price=0 then 'default_zero_unverified' else 'no_confirmed_recipe_price' end,
  'supplement',case when d.brand_id is not null then jsonb_build_object('revision',d.revision,'data',d.data,'source_hash',d.source_hash,'updated_at',d.updated_at,'current',d.source_hash=s.source_hash) else null end)
 from source s left join marketing_product_descriptions d on d.brand_id=p_brand and d.outlet_id=s.outlet_id and d.product_key=s.product_key;
$$;
revoke all on function marketing_private.restaurant_brand_products(uuid) from public,anon,authenticated,service_role;

create function public.marketing_knowledge_products(p_brand uuid,p_search text default '',p_category text default '',p_outlet uuid default null,p_page integer default 1,p_size integer default 50) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org uuid;result jsonb;
begin
 select organization_id into org from brands where id=p_brand;perform marketing_private.require_access(org,p_brand,'marketing_settings.view');
 if p_page is null or p_size is null or p_page<1 or p_size not between 1 and 100 or length(p_search)>200 or length(p_category)>200 then raise exception 'Use bounded product filters.';end if;
 if p_outlet is not null and not exists(select 1 from brand_outlets where brand_id=p_brand and outlet_id=p_outlet) then raise exception using errcode='42501',message='Choose a linked Outlet.';end if;
 with catalog as materialized(select value item from marketing_private.restaurant_brand_products(p_brand) value),filtered as(
  select item from catalog where (p_outlet is null or item->>'outlet_id'=p_outlet::text) and (p_category='' or item->>'category'=p_category)
  and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',item->>'name',item->>'category',item->>'variant',item->'supplement'->'data'->>'description')))>0)
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(item),'[]') from(select item from filtered order by item->>'name',item->>'category',item->>'variant',item->>'outlet_id' limit p_size offset (p_page-1)*p_size)x),
 'categories',(select coalesce(jsonb_agg(category order by category),'[]') from(select distinct item->>'category' category from catalog where nullif(item->>'category','') is not null)x)) into result;
 return result;
end;$$;
revoke all on function public.marketing_knowledge_products(uuid,text,text,uuid,integer,integer) from public,anon;
grant execute on function public.marketing_knowledge_products(uuid,text,text,uuid,integer,integer) to authenticated;

create function public.marketing_product_description_save(p_request uuid,p_brand uuid,p_outlet uuid,p_product_key text,p_revision integer,p_source_hash text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid;actor uuid;source jsonb;v integer;fp text;prior public.marketing_requests;result jsonb;
begin
 select organization_id into org from brands where id=p_brand;actor:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 if p_request is null or p_revision is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>4000 or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('description','signature','wording','customer_facing'))
 or not p_data ?& array['description','wording','signature','customer_facing']
 or exists(select 1 from jsonb_each(p_data) e where e.key in ('description','wording') and jsonb_typeof(e.value)<>'string')
 or length(coalesce(p_data->>'description',''))>2000 or length(coalesce(p_data->>'wording',''))>600 or jsonb_typeof(p_data->'signature') is distinct from 'boolean' or jsonb_typeof(p_data->'customer_facing') is distinct from 'boolean' then raise exception 'Provide bounded supplemental product copy.';end if;
 if concat_ws(' ',p_data->>'description',p_data->>'wording') ~* '(\m(RM|MYR|SGD|USD|price|costs?)\M\s*[:=]?\s*[0-9]|[0-9]\s*(元|令吉)|\m(in stock|sold out|always available|available today)\M|有货|售罄|现货|stok tersedia|habis dijual)' then raise exception 'Keep prices and availability at their Restaurant source, not in Marketing copy.';end if;
 fp:=md5(jsonb_build_array('product_description',p_brand,p_outlet,p_product_key,p_revision,p_source_hash,p_data)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into prior from marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 perform 1 from brands where id=p_brand for update;
 select value into source from marketing_private.restaurant_brand_products(p_brand) value where value->>'outlet_id'=p_outlet::text and value->>'product_key'=p_product_key;
 if source is null or source->>'source_hash' is distinct from p_source_hash then raise exception using errcode='40001',message='Product source changed or is unavailable. Reload before saving.';end if;
 select revision into v from marketing_product_descriptions where brand_id=p_brand and outlet_id=p_outlet and product_key=p_product_key;
 if coalesce(v,0)<>p_revision then raise exception using errcode='40001',message='Product copy changed. Reload before saving.';end if;
 insert into marketing_product_descriptions values(p_brand,p_outlet,p_product_key,p_revision+1,p_source_hash,p_data,actor,now()) on conflict(brand_id,outlet_id,product_key) do update set revision=excluded.revision,source_hash=excluded.source_hash,data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 insert into marketing_product_description_history values(p_brand,p_outlet,p_product_key,p_revision+1,p_source_hash,p_data,actor,now());
 result:=jsonb_build_object('revision',p_revision+1,'data',p_data,'source_hash',p_source_hash);
 insert into marketing_requests values(p_request,actor,fp,result);
 insert into marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'product_copy_saved',actor,jsonb_build_object('outlet_id',p_outlet,'product_key',p_product_key,'revision',p_revision+1));
 return result;
end;$$;
revoke all on function public.marketing_product_description_save(uuid,uuid,uuid,text,integer,text,jsonb) from public,anon;
grant execute on function public.marketing_product_description_save(uuid,uuid,uuid,text,integer,text,jsonb) to authenticated;

-- One explicit staff-confirmed context, through the existing version/permission/request/audit lifecycle.
alter table public.marketing_conversations add column outlet_id uuid references public.outlets(id);
do $$declare f text;needle text:='if p_command=''update'' then';begin
 f:=pg_get_functiondef('public.marketing_inbox_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Inbox command contract changed.';end if;
 f:=replace(f,needle,$patch$if p_command='outlet_context' then
   target:=nullif(p_payload->>'outlet_id','')::uuid;
   if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'outlet_id') or (target is not null and not exists(select 1 from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=p_brand and bo.outlet_id=target)) then raise exception 'Choose an active Outlet linked to this Brand, or clear the context.';end if;
   update marketing_conversations set outlet_id=target,version=version+1,updated_at=now() where id=c.id returning * into c;
  elsif p_command='update' then$patch$);execute f;
end;$$;
do $$declare f text;needle text:='return jsonb_build_object(''knowledge''';begin
 f:=pg_get_functiondef('public.marketing_inbox_detail(uuid,integer,integer)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Inbox detail contract changed.';end if;
 f:=replace(f,needle,$patch$return jsonb_build_object('outlet_options',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=c.brand_id),'knowledge'$patch$);execute f;
end;$$;

-- Current operational retrieval. Legacy uploaded menus remain evidence/history, not a competing product master.
create function marketing_private.customer_knowledge_facts(p_brand uuid,p_outlet uuid,p_question text default '') returns jsonb language plpgsql stable set search_path=public as $$
declare facts jsonb:='{}';k public.marketing_customer_knowledge;v_outlet uuid;row record;profile jsonb;local_day date;hours jsonb;products jsonb;catalog_hash text;counted integer;
begin
 select bo.outlet_id into v_outlet from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=p_brand and bo.outlet_id=p_outlet;
 for k in select * from marketing_customer_knowledge where brand_id=p_brand and kind='promotion' and state='confirmed' order by id loop
  if (now() at time zone 'Asia/Kuala_Lumpur')::date not between (k.data->>'starts_on')::date and (k.data->>'ends_on')::date then continue;end if;
  if jsonb_array_length(k.data->'outlet_ids')>0 and (v_outlet is null or not k.data->'outlet_ids' ? v_outlet::text) then continue;end if;
  facts:=facts||jsonb_build_object('promotion:'||k.id||':'||k.revision,jsonb_build_object('label',k.data->>'name','category','promotions','text',k.data->>'details','terms',k.data->>'terms','starts_on',k.data->>'starts_on','ends_on',k.data->>'ends_on','source','manager_confirmed_promotion','confirmed_at',k.confirmed_at,'applicability',case when jsonb_array_length(k.data->'outlet_ids')=0 then 'brand_wide' else 'confirmed_outlet' end));
 end loop;
 with catalog as materialized(select value item from marketing_private.restaurant_brand_products(p_brand) value where (v_outlet is null or value->>'outlet_id'=v_outlet::text) and value->'supplement'->>'current'='true' and value->'supplement'->'data'->>'customer_facing'='true')
 select count(*),md5(coalesce(string_agg(item::text,'|' order by item->>'outlet_id',item->>'product_key'),'')) into counted,catalog_hash from catalog;
 if counted>0 and counted<=2000 then
  select coalesce(jsonb_agg(item),'[]') into products from (
   select (item-'supplement')||jsonb_build_object('price',case when v_outlet is not null then item->'current_price' else 'null'::jsonb end,
    'price_issue',case when v_outlet is null then 'outlet_required' else item->>'price_issue' end,
    'description',case when item->'supplement'->>'current'='true' then item->'supplement'->'data'->>'description' else null end,
    'recommended_wording',case when item->'supplement'->>'current'='true' then item->'supplement'->'data'->>'wording' else null end,
    'signature',case when item->'supplement'->>'current'='true' then item->'supplement'->'data'->'signature' else 'false'::jsonb end,
    'outlet_name',(select name from outlets where id=(item->>'outlet_id')::uuid),
    'current_price',null) item
   from(select value item from marketing_private.restaurant_brand_products(p_brand) value where (v_outlet is null or value->>'outlet_id'=v_outlet::text) and value->'supplement'->>'current'='true' and value->'supplement'->'data'->>'customer_facing'='true')source
   order by (select count(*) from regexp_split_to_table(lower(concat_ws(' ',item->>'name',item->>'category')),'[^[:alnum:]一-龥]+') word where length(word)>=2 and position(word in lower(p_question))>0) desc,item->>'name',item->>'outlet_id',item->>'product_key' limit 8
  )x;
  facts:=facts||jsonb_build_object('menu:restaurant',jsonb_build_object('label','Restaurant products','category','menu_drinks','items',products,'currency','MYR','source','restaurant_product_sales_with_explicit_recipe_mapping','catalog_hash',catalog_hash,'catalog_size',counted,'availability','unverified','outlet_context_confirmed',v_outlet is not null));
 end if;
 for row in select o.id,o.name,o.address,o.updated_at,p.data,p.revision,p.updated_at service_updated_at from outlets o join brand_outlets bo on bo.outlet_id=o.id left join outlet_service_profiles p on p.outlet_id=o.id where bo.brand_id=p_brand and o.is_active and (v_outlet is null or o.id=v_outlet) order by o.id loop
  profile:=null;hours:=null;
  if v_outlet is not null and row.data is not null then
   local_day:=(now() at time zone (row.data->>'timezone'))::date;
   select value into hours from jsonb_array_elements(row.data->'special_hours') value where value->>'date'=local_day::text;
   if hours is null then select value into hours from jsonb_array_elements(row.data->'weekly_hours') value where (value->>'day')::int=extract(dow from local_day)::int;end if;
   profile:=row.data||jsonb_build_object('local_date',local_day,'today_hours',hours,'revision',row.revision,'updated_at',row.service_updated_at);
  end if;
  facts:=facts||jsonb_build_object('outlet:'||row.id,jsonb_build_object('label',row.name,'category',case when profile is not null then 'operating_hours' else 'location' end,'address',row.address,'text',concat_ws(': ',row.name,row.address),'source','restaurant_outlet_master','updated_at',row.updated_at,'service_profile',profile,'outlet_context_confirmed',v_outlet is not null,'missing_context',case when v_outlet is null then 'Ask which Outlet before hours, contacts, prices or Outlet-specific policies.' else null end));
 end loop;
 return facts;
end;$$;
revoke all on function marketing_private.customer_knowledge_facts(uuid,uuid,text) from public,anon,authenticated,service_role;
create or replace function marketing_private.customer_knowledge_facts(p_brand uuid) returns jsonb language sql stable set search_path=public as $$select marketing_private.customer_knowledge_facts(p_brand,null,'');$$;

-- Keep the existing complete source hash, relevance bounds and cache/draft/send invalidation.
do $$declare f text;needle text:='direct:=marketing_private.customer_knowledge_facts(c.brand_id);';begin
 f:=pg_get_functiondef('marketing_private.inbox_assistant_material(uuid)'::regprocedure);
 if position(needle in f)=0 then raise exception 'Assistant material contract changed.';end if;
 f:=replace(f,needle,$patch$direct:=marketing_private.customer_knowledge_facts(c.brand_id,c.outlet_id,coalesce((r->'history'->-1)->>'text',''));
 r:=jsonb_set(r,'{outlet_known}',to_jsonb(exists(select 1 from brand_outlets bo join outlets o on o.id=bo.outlet_id and o.is_active where bo.brand_id=c.brand_id and bo.outlet_id=c.outlet_id)));$patch$);
 f:=replace(f,$old$jsonb_build_array(r->>'source_hash',r->'facts')$old$,$new$jsonb_build_array(r->>'source_hash',r->'facts',c.outlet_id,r->'outlet_known')$new$);execute f;
end;$$;

create or replace function public.marketing_knowledge_workspace(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb;entries jsonb;mapped jsonb;
begin
 r:=public.marketing_knowledge_workspace_legacy(p_brand);
 select coalesce(jsonb_agg(to_jsonb(k) order by updated_at desc),'[]') into entries from (select * from marketing_customer_knowledge where brand_id=p_brand order by updated_at desc limit 150)k;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'address',o.address,'is_active',o.is_active,'updated_at',o.updated_at,
 'service_profile',(select jsonb_build_object('revision',p.revision,'data',p.data,'updated_at',p.updated_at) from outlet_service_profiles p where p.outlet_id=o.id),
 'can_edit_services',public.current_user_has_permission('outlets.edit') and public.current_user_can_access_outlet(o.id)) order by o.name),'[]') into mapped from brand_outlets bo join outlets o on o.id=bo.outlet_id where bo.brand_id=p_brand;
 return r||jsonb_build_object('customer_knowledge',entries,'canonical_menu','[]'::jsonb,'canonical_outlets',mapped,'product_count',(select count(*) from marketing_private.restaurant_brand_products(p_brand)),
 'knowledge_confirmed_revision',(select confirmed_revision from marketing_knowledge where brand_id=p_brand));
end;$$;
