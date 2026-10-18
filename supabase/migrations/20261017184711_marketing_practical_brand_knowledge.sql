-- One customer-facing knowledge authority; Restaurant remains the operational master.
alter table public.marketing_knowledge add column confirmed_revision integer, add column confirmed_keys text[] not null default '{}';
create table public.marketing_customer_knowledge (
 id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id),
 kind text not null check(kind in ('menu','promotion')), revision integer not null default 0,
 state text not null default 'pending' check(state in ('pending','preview','confirmed','inactive')),
 data jsonb not null default '{}', filename text, mime_type text, size_bytes bigint, object_path text unique,
 created_by uuid not null references public.employees(id), confirmed_by uuid references public.employees(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), confirmed_at timestamptz,
 check(octet_length(data::text)<=65536)
);
create index marketing_customer_knowledge_brand on public.marketing_customer_knowledge(brand_id,kind,updated_at);
alter table public.marketing_customer_knowledge enable row level security;
revoke all on public.marketing_customer_knowledge from public,anon,authenticated;
create table marketing_private.knowledge_ai_runs (
 request_id uuid primary key, brand_id uuid not null references public.brands(id), actor uuid not null references public.employees(id),
 kind text not null check(kind in ('menu','tone')), entry_id uuid references public.marketing_customer_knowledge(id),
 fingerprint text not null, state text not null default 'prepared' check(state in ('prepared','claimed','completed','failed','superseded')),
 lease uuid, source_revision integer not null, result jsonb, model text, input_tokens integer, output_tokens integer,
 latency_ms integer, failure_reason text, created_at timestamptz not null default now()
);
revoke all on marketing_private.knowledge_ai_runs from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketing-knowledge','marketing-knowledge',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']);
create function public.marketing_knowledge_storage_access(p_path text,p_upload boolean) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.marketing_customer_knowledge k join public.brands b on b.id=k.brand_id
 where k.object_path=p_path and marketing_private.actor_allowed(marketing_private.actor(),b.organization_id,b.id,case when p_upload then 'marketing_settings.manage' else 'marketing_settings.view' end)
 and (not p_upload or k.state='pending' and k.created_by=marketing_private.actor()));
$$;
revoke all on function public.marketing_knowledge_storage_access(text,boolean) from public,anon;
grant execute on function public.marketing_knowledge_storage_access(text,boolean) to authenticated;
create policy marketing_knowledge_insert on storage.objects for insert to authenticated with check(bucket_id='marketing-knowledge' and public.marketing_knowledge_storage_access(name,true));
create policy marketing_knowledge_select on storage.objects for select to authenticated using(bucket_id='marketing-knowledge' and public.marketing_knowledge_storage_access(name,false));
-- Immutable bytes: no client UPDATE/DELETE, including after confirmation.
create function public.marketing_knowledge_prepare_file(p_brand uuid,p_filename text,p_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; k public.marketing_customer_knowledge; asset uuid:=gen_random_uuid();
begin
 select organization_id into org from public.brands where id=p_brand;actor:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 if p_size is null or p_size not between 1 and 5242880 or coalesce(p_mime,'') not in ('application/pdf','image/jpeg','image/png','image/webp') or length(trim(coalesce(p_filename,''))) not between 1 and 180 then raise exception 'Choose a PDF, JPG, PNG or WebP menu up to 5 MB.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_brand::text,49));
 if (select count(*) from public.marketing_customer_knowledge where brand_id=p_brand and kind='menu' and state<>'inactive')>=20 then raise exception 'Deactivate an old menu before adding another (20 menu limit).';end if;
 insert into public.marketing_customer_knowledge(id,brand_id,kind,filename,mime_type,size_bytes,object_path,created_by) values(asset,p_brand,'menu',p_filename,p_mime,p_size,org::text||'/'||p_brand::text||'/'||asset::text,actor) returning * into k;
 return to_jsonb(k)||jsonb_build_object('bucket','marketing-knowledge');
end;$$;

create function marketing_private.knowledge_validate(p_brand uuid,p_kind text,p_data jsonb) returns void language plpgsql stable set search_path=public as $$
declare item jsonb; outlet uuid;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>65536 or length(trim(coalesce(p_data->>'name',''))) not between 1 and 160 or jsonb_typeof(p_data->'outlet_ids') is distinct from 'array' or jsonb_array_length(p_data->'outlet_ids')>30 then raise exception 'Provide a name and valid Outlet applicability.';end if;
 for outlet in select value::uuid from jsonb_array_elements_text(p_data->'outlet_ids') loop
  if not exists(select 1 from public.brand_outlets b join public.outlets o on o.id=b.outlet_id where b.brand_id=p_brand and b.outlet_id=outlet and o.is_active) then raise exception 'Choose only active Outlets mapped to this Brand.';end if;
 end loop;
 if p_kind='promotion' then
  if length(trim(coalesce(p_data->>'details',''))) not between 1 and 4000 or length(coalesce(p_data->>'terms',''))>4000 or coalesce(p_data->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_data->>'ends_on','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_data->>'ends_on')::date<(p_data->>'starts_on')::date then raise exception 'Provide promotion details and a valid inclusive date range.';end if;
 else
  if coalesce(p_data->>'currency','') not in ('MYR','SGD','USD') then raise exception 'Confirm the menu currency.';end if;
  if coalesce(p_data->>'source_date','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_data->>'source_date')::date>(now() at time zone 'Asia/Kuala_Lumpur')::date or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception 'Confirm a source date and 1–100 menu items.';end if;
  for item in select value from jsonb_array_elements(p_data->'items') loop
   if length(trim(coalesce(item->>'name',''))) not between 1 and 160 or length(coalesce(item->>'category',''))>120 or length(coalesce(item->>'description',''))>600 or (item->>'price' is not null and ((item->>'price') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or (item->>'price')::numeric>999999)) then raise exception 'Review bounded menu names, descriptions and prices. Leave unreadable prices empty.';end if;
   if nullif(item->>'recipe_id','') is not null and not exists(select 1 from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id where r.id=(item->>'recipe_id')::uuid and bo.brand_id=p_brand and r.status='active' and (jsonb_array_length(p_data->'outlet_ids')=0 or p_data->'outlet_ids' ? r.outlet_id::text)) then raise exception 'The linked Restaurant menu item is unavailable for this scope.';end if;
  end loop;
 end if;
end;$$;
revoke all on function marketing_private.knowledge_validate(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.marketing_knowledge_command(p_request uuid,p_brand uuid,p_command text,p_entry uuid,p_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; actor uuid; prior public.marketing_requests; fp text; k public.marketing_customer_knowledge; result jsonb; profile jsonb; old public.marketing_knowledge;
begin
 select organization_id into org from public.brands where id=p_brand;actor:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 if p_request is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>65536 then raise exception 'Invalid knowledge request.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('customer_knowledge',p_brand,p_command,p_entry,p_revision,p_data)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into prior from public.marketing_requests where request_id=p_request;
 if prior.request_id is not null then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity changed.';end if;return prior.result;end if;
 perform 1 from public.brands where id=p_brand for update;
 if p_command in ('identity','tone') then
  select * into old from public.marketing_knowledge where brand_id=p_brand;
  if coalesce(old.revision,0) is distinct from p_revision then raise exception 'Brand knowledge changed. Reload before saving.';end if;
  profile:=coalesce(old.profile,'{}');
  if p_command='identity' then
   if exists(select 1 from jsonb_each_text(p_data) x where key not in ('positioning','story','differentiation','audience') or length(value)>4000) or exists(select 1 from jsonb_each(p_data) x where jsonb_typeof(x.value)<>'string') then raise exception 'Use the guided Brand Identity fields.';end if;
   profile:=profile||jsonb_build_object('identity',jsonb_build_object('text',coalesce(p_data->>'story',''),'provenance','verified_brand_fact','fields',p_data),'positioning',jsonb_build_object('text',coalesce(p_data->>'positioning','')||case when coalesce(p_data->>'differentiation','')<>'' then E'\nDifference: '||(p_data->>'differentiation') else '' end,'provenance','verified_brand_fact'),'audience',jsonb_build_object('text',coalesce(p_data->>'audience',''),'provenance','verified_brand_fact'));
  else
   if coalesce(p_data->>'tone','') not in ('warm','friendly','professional','playful','calm') or coalesce(p_data->>'formality','') not in ('casual','balanced','formal') or coalesce(p_data->>'emoji','') not in ('none','light','expressive') or coalesce(p_data->>'language','') not in ('customer','EN','ZH','BM') or length(coalesce(p_data->>'guidelines',''))>4000 then raise exception 'Choose valid Tone & Persona settings.';end if;
   profile:=profile||jsonb_build_object('voice',jsonb_build_object('text',format('Tone: %s. Formality: %s. Emoji: %s. Language: %s.',p_data->>'tone',p_data->>'formality',p_data->>'emoji',p_data->>'language'),'provenance','verified_brand_fact','fields',p_data),'rules',jsonb_build_object('text',coalesce(p_data->>'guidelines',''),'provenance','verified_brand_fact'));
  end if;
  -- Preserve all legacy keys/history; confirm only the fields edited in this action.
  result:=public.marketing_save_knowledge(p_brand,p_revision,profile);
  update public.marketing_knowledge set confirmed_revision=revision,confirmed_keys=array(select distinct unnest(case when old.confirmed_revision=old.revision then old.confirmed_keys else '{}'::text[] end||array(select x.key from public.marketing_inbox_knowledge approved cross join lateral jsonb_each(approved.profile) x where approved.brand_id=p_brand and approved.knowledge_revision=old.revision and x.key in ('identity','positioning','audience','voice','rules') and x.value->>'provenance'='verified_brand_fact')||case when p_command='identity' then array['identity','positioning','audience'] else array['voice','rules'] end)) where brand_id=p_brand;
  result:=result||jsonb_build_object('confirmed_revision',(result->>'revision')::int);
 else
  select * into k from public.marketing_customer_knowledge where id=p_entry and brand_id=p_brand for update;
  if p_command='promotion' and p_entry is null then
   if (select count(*) from public.marketing_customer_knowledge where brand_id=p_brand and kind='promotion' and state<>'inactive')>=100 then raise exception 'Deactivate an old promotion before adding another (100 limit).';end if;
   insert into public.marketing_customer_knowledge(brand_id,kind,created_by) values(p_brand,'promotion',actor) returning * into k;
  end if;
  if k.id is null or k.revision is distinct from p_revision then raise exception 'Knowledge changed. Reload before saving.';end if;
  if p_command='deactivate' then update public.marketing_customer_knowledge set state='inactive',revision=revision+1,updated_at=now() where id=k.id returning * into k;
  elsif p_command in ('menu','promotion') and p_command=k.kind then
   perform marketing_private.knowledge_validate(p_brand,k.kind,p_data);
   if k.kind='menu' and not exists(select 1 from storage.objects where bucket_id='marketing-knowledge' and name=k.object_path and (metadata->>'size')::bigint=k.size_bytes) then raise exception 'Upload the original menu source before confirmation.';end if;
   update public.marketing_customer_knowledge set data=p_data,state='confirmed',revision=revision+1,confirmed_by=actor,confirmed_at=now(),updated_at=now() where id=k.id returning * into k;
  else raise exception 'Unknown knowledge action.';end if;
  result:=to_jsonb(k);
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'customer_knowledge_saved',actor,jsonb_build_object('command',p_command,'entry',p_entry,'result',result));
 insert into public.marketing_requests(request_id,actor_employee_id,fingerprint,result) values(p_request,actor,fp,result);return result;
end;$$;

-- Retrieval is current-date based in the Brand's Malaysia operating timezone. No inferred Outlet.
create function marketing_private.customer_knowledge_facts(p_brand uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare facts jsonb:='{}'; k public.marketing_customer_knowledge; item jsonb; items jsonb; recipe public.inventory_recipes; today date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; outlet_row record;
begin
 for k in select * from public.marketing_customer_knowledge where brand_id=p_brand and state='confirmed' order by id loop
  -- Scoped facts need an explicit conversational Outlet authority, which is not yet available.
  if jsonb_array_length(k.data->'outlet_ids')>0 then continue;end if;
  if k.kind='promotion' then
   if today not between (k.data->>'starts_on')::date and (k.data->>'ends_on')::date then continue;end if;
   facts:=facts||jsonb_build_object('promotion:'||k.id||':'||k.revision,jsonb_build_object('label',k.data->>'name','category','promotions','text',k.data->>'details','terms',k.data->>'terms','starts_on',k.data->>'starts_on','ends_on',k.data->>'ends_on','source','manager_confirmed_promotion','confirmed_at',k.confirmed_at));
  else
   items:='[]';
   for item in select value from jsonb_array_elements(k.data->'items') loop
    recipe:=null;
    if nullif(item->>'recipe_id','') is not null then
     select r.* into recipe from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id join public.outlets o on o.id=r.outlet_id where bo.brand_id=p_brand and r.id=(item->>'recipe_id')::uuid and r.status='active' and o.is_active;
     -- Restaurant recipes are Outlet-specific; unknown Outlet cannot establish one price.
     item:=item||jsonb_build_object('price',null,'price_issue','outlet_required','canonical_name',recipe.recipe_name,'canonical_updated_at',recipe.updated_at);
    elsif exists(select 1 from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id where bo.brand_id=p_brand and r.status='active' and lower(trim(r.recipe_name))=lower(trim(item->>'name'))) then
     item:=item||jsonb_build_object('price',null,'price_issue','canonical_menu_link_required');
    end if;
    items:=items||jsonb_build_array(item);
   end loop;
   facts:=facts||jsonb_build_object('menu:'||k.id||':'||k.revision,jsonb_build_object('label',k.data->>'name','category','menu_drinks','items',items,'currency',k.data->>'currency','source','manager_confirmed_menu','source_file',k.filename,'source_date',k.data->>'source_date','confirmed_at',k.confirmed_at));
  end if;
 end loop;
 for outlet_row in select o.id,o.name,o.address,o.updated_at from public.outlets o join public.brand_outlets bo on bo.outlet_id=o.id where bo.brand_id=p_brand and o.is_active order by o.id loop
  if nullif(trim(outlet_row.address),'') is not null then facts:=facts||jsonb_build_object('outlet:'||outlet_row.id,jsonb_build_object('label',outlet_row.name,'category','location','text',outlet_row.name||': '||outlet_row.address,'source','restaurant_outlet_master','updated_at',outlet_row.updated_at));end if;
 end loop;
 return facts;
end;$$;
revoke all on function marketing_private.customer_knowledge_facts(uuid) from public,anon,authenticated,service_role;

-- Preserve existing FAQ/history retrieval and extend its single source fingerprint.
alter function marketing_private.inbox_assistant_material(uuid) rename to inbox_assistant_material_v22;
create function marketing_private.inbox_assistant_material(p_conversation uuid) returns jsonb language plpgsql stable set search_path=public as $$
declare r jsonb; k public.marketing_knowledge; c public.marketing_conversations; direct jsonb; extra jsonb; bounded jsonb:='{}'; source_row record;
begin
 r:=marketing_private.inbox_assistant_material_v22(p_conversation);
 select * into c from public.marketing_conversations where id=p_conversation;
 select * into k from public.marketing_knowledge where brand_id=c.brand_id;
 if k.confirmed_revision=k.revision then
  select coalesce(jsonb_object_agg(key,value),'{}') into extra from jsonb_each(k.profile) where key=any(k.confirmed_keys) and length(trim(value->>'text'))>0 and value->>'provenance'='verified_brand_fact';
  r:=jsonb_set(r,'{facts}',coalesce(r->'facts','{}')||extra);
 end if;
 direct:=marketing_private.customer_knowledge_facts(c.brand_id);
 r:=jsonb_set(r,'{facts}',coalesce(r->'facts','{}')||direct);
 -- Fingerprint all live facts, even those outside the bounded candidate set.
 r:=jsonb_set(r,'{source_hash}',to_jsonb(encode(extensions.digest(jsonb_build_array(r->>'source_hash',r->'facts')::text,'sha256'),'hex')));
 -- Bound direct retrieval by the latest question, retaining intelligence and source integrity.
 for source_row in select key,value from jsonb_each(r->'facts') where key like 'menu:%' loop
  select coalesce(jsonb_agg(item),'[]') into extra from (select item from jsonb_array_elements(source_row.value->'items') item order by (select count(*) from regexp_split_to_table(lower(coalesce((r->'history'->-1)->>'text','')),'[^[:alnum:]一-龥]+') word where length(word)>2 and position(word in lower(item::text))>0) desc,item->>'name' limit 8)x;
  r:=jsonb_set(r,array['facts',source_row.key,'items'],extra);
 end loop;
 select coalesce(jsonb_object_agg(key,value),'{}') into extra from (
  select key,value from jsonb_each(r->'facts') order by case when key in ('identity','positioning','audience','voice','rules') then 100 else 0 end+
   (select count(*)::int from regexp_split_to_table(lower(coalesce((r->'history'->-1)->>'text','')),'[^[:alnum:]一-龥]+') word where length(word)>2 and position(word in lower(value::text))>0) desc,key limit 16
 )x;
 for source_row in select key,value from jsonb_each(extra) order by case when key in ('identity','positioning','audience','voice','rules') then 0 else 1 end,key loop
  if octet_length((bounded||jsonb_build_object(source_row.key,source_row.value))::text)<=24000 then bounded:=bounded||jsonb_build_object(source_row.key,source_row.value);end if;
 end loop;
 return jsonb_set(r,'{facts}',bounded);
end;$$;
revoke all on function marketing_private.inbox_assistant_material(uuid) from public,anon,authenticated,service_role;

alter function public.marketing_knowledge_workspace(uuid) rename to marketing_knowledge_workspace_legacy;
revoke all on function public.marketing_knowledge_workspace_legacy(uuid) from public,anon,authenticated;
create function public.marketing_knowledge_workspace(p_brand uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; entries jsonb; recipes jsonb;
begin
 r:=public.marketing_knowledge_workspace_legacy(p_brand);
 select coalesce(jsonb_agg(to_jsonb(k) order by updated_at desc),'[]') into entries from (select * from public.marketing_customer_knowledge where brand_id=p_brand order by updated_at desc limit 150)k;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',recipe_name,'outlet_id',outlet_id,'selling_price',selling_price,'category',menu_category,'updated_at',updated_at) order by recipe_name),'[]') into recipes from (select r.* from public.inventory_recipes r join public.brand_outlets bo on bo.outlet_id=r.outlet_id where bo.brand_id=p_brand and r.status='active' order by r.recipe_name limit 300) x;
 return r||jsonb_build_object('customer_knowledge',entries,'canonical_menu',recipes,'knowledge_confirmed_revision',(select confirmed_revision from public.marketing_knowledge where brand_id=p_brand));
end;$$;

create function public.marketing_knowledge_ai_prepare(p_request uuid,p_brand uuid,p_kind text,p_entry uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid; person uuid; k public.marketing_customer_knowledge; r marketing_private.knowledge_ai_runs; v integer; fp text;
begin
 select organization_id into org from public.brands where id=p_brand;person:=marketing_private.require_access(org,p_brand,'marketing_settings.manage');
 if p_request is null or coalesce(p_kind,'') not in ('menu','tone') then raise exception 'Choose menu extraction or a tone preview.';end if;
 if not exists(select 1 from public.marketing_inbox_policies where brand_id=p_brand and ai_allowed and automation_mode<>'off') then raise exception 'Enable this Brand’s AI consent in FAQ & AI first.';end if;
 if p_kind='menu' then
  select * into k from public.marketing_customer_knowledge where id=p_entry and brand_id=p_brand and kind='menu';
  if k.id is null or k.state not in ('pending','preview') then raise exception 'Choose an uploaded, unconfirmed menu.';end if;
  if k.state='preview' then return jsonb_build_object('state','completed','result',k.data);end if;
  if not exists(select 1 from storage.objects where bucket_id='marketing-knowledge' and name=k.object_path and (metadata->>'size')::bigint=k.size_bytes) then raise exception 'Upload the menu file first.';end if;
  v:=k.revision;
 else
  select coalesce(max(revision),0) into v from public.marketing_knowledge where brand_id=p_brand;
  if v=0 then raise exception 'Save Tone & Persona before previewing.';end if;
 end if;
 fp:=encode(extensions.digest(jsonb_build_array(p_brand,p_kind,p_entry,v)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_brand::text,52));
 perform pg_advisory_xact_lock(hashtextextended(person::text,51));
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request;
 if r.request_id is not null then if r.actor<>person or r.fingerprint<>fp then raise exception 'Request identity changed.';end if;return jsonb_build_object('state',r.state,'result',r.result);end if;
 if exists(select 1 from marketing_private.knowledge_ai_runs where brand_id=p_brand and state in ('prepared','claimed') and created_at>now()-interval '2 minutes') then raise exception 'A knowledge AI request is already running. Check again shortly.';end if;
 if (select count(*) from marketing_private.knowledge_ai_runs where actor=person and created_at>now()-interval '24 hours')>=10 then raise exception 'Daily knowledge AI limit reached (10).';end if;
 insert into marketing_private.knowledge_ai_runs(request_id,brand_id,actor,kind,entry_id,fingerprint,source_revision) values(p_request,p_brand,person,p_kind,p_entry,fp,v);
 return jsonb_build_object('state','prepared');
end;$$;

create function public.marketing_knowledge_ai_claim(p_request uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.knowledge_ai_runs; org uuid; person uuid; k public.marketing_customer_knowledge;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request for update;
 select id into person from public.employees where auth_user_id=p_auth_user;
 select organization_id into org from public.brands where id=r.brand_id;
 if r.state<>'prepared' or r.actor is distinct from person or not marketing_private.actor_allowed(person,org,r.brand_id,'marketing_settings.manage') or not exists(select 1 from public.marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') then raise exception 'Knowledge AI authority changed.';end if;
 update marketing_private.knowledge_ai_runs set state='claimed',lease=gen_random_uuid() where request_id=p_request returning * into r;
 select * into k from public.marketing_customer_knowledge where id=r.entry_id;
 if r.kind='menu' and (k.id is null or k.state<>'pending' or k.revision<>r.source_revision) or r.kind='tone' and not exists(select 1 from public.marketing_knowledge where brand_id=r.brand_id and revision=r.source_revision) then raise exception 'Knowledge source changed before generation.';end if;
 return jsonb_build_object('lease',r.lease,'kind',r.kind,'entry',to_jsonb(k),'profile',(select profile->'voice' from public.marketing_knowledge where brand_id=r.brand_id),'guidelines',(select profile->'rules'->>'text' from public.marketing_knowledge where brand_id=r.brand_id));
end;$$;

create function public.marketing_knowledge_ai_finish(p_request uuid,p_lease uuid,p_result jsonb,p_usage jsonb,p_error text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.knowledge_ai_runs; k public.marketing_customer_knowledge; org uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.knowledge_ai_runs where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'Unknown knowledge request.';end if;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state,'result',r.result);end if;
 if octet_length(coalesce(p_result,'{}')::text)>65536 or octet_length(coalesce(p_usage,'{}')::text)>1000 then raise exception 'Knowledge AI result too large.';end if;
 update marketing_private.knowledge_ai_runs set model=left(p_usage->>'model',100),input_tokens=(p_usage->>'input')::int,output_tokens=(p_usage->>'output')::int,latency_ms=(p_usage->>'latency_ms')::int where request_id=p_request;
 select organization_id into org from public.brands where id=r.brand_id;
 if not marketing_private.actor_allowed(r.actor,org,r.brand_id,'marketing_settings.manage') or not exists(select 1 from public.marketing_inbox_policies where brand_id=r.brand_id and ai_allowed and automation_mode<>'off') then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
 if p_error is not null then update marketing_private.knowledge_ai_runs set state='failed',failure_reason=left(p_error,80) where request_id=p_request;return jsonb_build_object('state','failed');end if;
 if r.kind='menu' then
  select * into k from public.marketing_customer_knowledge where id=r.entry_id for update;
  if k.revision<>r.source_revision or k.state<>'pending' then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
  if jsonb_typeof(p_result->'items') is distinct from 'array' or jsonb_array_length(p_result->'items')>100 then raise exception 'Invalid menu extraction.';end if;
  update public.marketing_customer_knowledge set data=p_result,state='preview',revision=revision+1,updated_at=now() where id=k.id;
 elsif not exists(select 1 from public.marketing_knowledge where brand_id=r.brand_id and revision=r.source_revision) then update marketing_private.knowledge_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');
 elsif length(coalesce(p_result->>'text','')) not between 1 and 1000 then raise exception 'Invalid tone preview.';end if;
 update marketing_private.knowledge_ai_runs set state='completed',result=p_result where request_id=p_request;
 return jsonb_build_object('state','completed','result',p_result,'usage',p_usage);
end;$$;

revoke all on function public.marketing_knowledge_prepare_file(uuid,text,text,bigint),public.marketing_knowledge_command(uuid,uuid,text,uuid,integer,jsonb),public.marketing_knowledge_workspace(uuid),public.marketing_knowledge_ai_prepare(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.marketing_knowledge_prepare_file(uuid,text,text,bigint),public.marketing_knowledge_command(uuid,uuid,text,uuid,integer,jsonb),public.marketing_knowledge_workspace(uuid),public.marketing_knowledge_ai_prepare(uuid,uuid,text,uuid) to authenticated;
revoke all on function public.marketing_knowledge_ai_claim(uuid,uuid),public.marketing_knowledge_ai_finish(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.marketing_knowledge_ai_claim(uuid,uuid),public.marketing_knowledge_ai_finish(uuid,uuid,jsonb,jsonb,text) to service_role;

-- Matched but unavailable FAQ identities are distinct from usable cited facts.
create or replace function public.marketing_inbox_ai_finish(p_request uuid,p_lease uuid,p_body jsonb,p_model text,p_input integer,p_output integer,p_error boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.inbox_ai_runs; c public.marketing_conversations; a public.marketing_inbox_ai_artifacts; material jsonb; refs jsonb; ref text; source jsonb; sources jsonb:='[]';
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only.';end if;
 select * into r from marketing_private.inbox_ai_runs where request_id=p_request and lease=p_lease for update;
 if r.request_id is null then raise exception 'AI lease unavailable.';end if;
 if r.state<>'claimed' then return jsonb_build_object('state',r.state,'artifact_id',r.artifact_id);end if;
 if p_input<0 or p_output<0 or length(p_model)>100 or coalesce(p_body->>'latency_ms','0') !~ '^[0-9]{1,6}$' then raise exception 'Invalid AI usage.';end if;
 update marketing_private.inbox_ai_runs set provider_model=nullif(p_model,''),input_tokens=p_input,output_tokens=p_output,latency_ms=(coalesce(p_body->>'latency_ms','0'))::integer,match_source=case when p_body->>'match_source' in ('deterministic','semantic','fallback') then p_body->>'match_source' else null end,failure_reason=left(p_body->>'failure_reason',80) where request_id=p_request;
 if p_error then update marketing_private.inbox_ai_runs set state='failed' where request_id=p_request;return jsonb_build_object('state','failed');end if;
 select * into c from public.marketing_conversations where id=r.conversation_id for update;
 material:=marketing_private.inbox_assistant_material(c.id);
 if c.version<>r.source_version or material->>'source_hash' is distinct from r.evidence_hash or not marketing_private.actor_allowed(r.actor_employee_id,c.organization_id,c.brand_id,'marketing_inbox.ai') or not exists(select 1 from public.marketing_inbox_policies where brand_id=c.brand_id and ai_allowed and automation_mode<>'off') then update marketing_private.inbox_ai_runs set state='superseded' where request_id=p_request;return jsonb_build_object('state','superseded');end if;
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>16000 or length(trim(coalesce(p_body->>'text',''))) not between 1 and (case when r.kind='reply' then 2000 else 4000 end) or jsonb_typeof(p_body->'reference_keys') is distinct from 'array' or jsonb_array_length(p_body->'reference_keys')>12 or jsonb_typeof(p_body->'human_required') is distinct from 'boolean' or coalesce(p_body->>'language','') not in ('EN','ZH','BM') or coalesce(p_body->>'classification','') not in ('suggestion_available','needs_human_attention','insufficient_knowledge') or jsonb_typeof(p_body->'matched_faq_ids') is distinct from 'array' or jsonb_array_length(p_body->'matched_faq_ids')>12 or jsonb_typeof(p_body->'unresolved_questions') is distinct from 'array' or jsonb_array_length(p_body->'unresolved_questions')>8 or jsonb_typeof(p_body->'handoff_reasons') is distinct from 'array' or jsonb_array_length(p_body->'handoff_reasons')>8 then raise exception 'AI evidence invalid.';end if;
 for ref in select jsonb_array_elements_text(p_body->'matched_faq_ids') loop
  if not exists(select 1 from jsonb_array_elements(r.evidence->'faqs') f where f->>'id'=ref) then raise exception 'Unknown FAQ evidence.';end if;
 end loop;
 for ref in select jsonb_array_elements_text(p_body->'reference_keys') loop
  if ref like 'faq:%' then
   select f into source from jsonb_array_elements(r.evidence->'faqs') f where 'faq:'||(f->>'id')||':'||(f->>'revision')=ref and f->>'use_issue' is null;
   if source is null then raise exception 'Unavailable FAQ evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind','faq','id',source->>'id','revision',source->'revision','label',source->>'question'));
  else
   if not (r.evidence->'facts' ? ref) then raise exception 'Unknown knowledge evidence.';end if;
   sources:=sources||jsonb_build_array(jsonb_build_object('key',ref,'kind',case when ref ~ '^(menu|promotion|outlet):' then 'customer_knowledge' else 'brand_intelligence' end,'label',coalesce(r.evidence->'facts'->ref->>'label',ref)));
  end if;
 end loop;
 if p_body->>'classification'='suggestion_available' and (jsonb_array_length(sources)=0 or (p_body->>'human_required')::boolean) then raise exception 'Supported answer requires sources.';end if;
 -- Handoff is advisory: no automatic assignment, status, closure, takeover or send.
 p_body:=p_body||jsonb_build_object('assistant_version','2.2','source_hash',r.evidence_hash,'sources',sources,'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',q->>'id','question',q->>'question','use_issue',q->>'use_issue')),'[]') from jsonb_array_elements(r.evidence->'faqs') q where q->>'id' in (select jsonb_array_elements_text(p_body->'matched_faq_ids'))),'suggest_only',true);
 if octet_length(p_body::text)>32768 then raise exception 'AI source evidence is too large.';end if;
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c.id,c.version,r.knowledge_revision,r.kind,p_body,p_model,p_input,p_output,r.actor_employee_id) returning * into a;
 update marketing_private.inbox_ai_runs set state='completed',artifact_id=a.id where request_id=p_request;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'inbox_ai_proposed',r.actor_employee_id,jsonb_build_object('artifact_id',a.id,'kind',a.kind,'model',p_model,'match_source',p_body->>'match_source','latency_ms',p_body->'latency_ms','input_tokens',p_input,'output_tokens',p_output,'estimated_cost_usd',a.cost,'failure_reason',p_body->>'failure_reason'));
 return jsonb_build_object('state','completed','artifact_id',a.id,'classification',p_body->>'classification');
end;$$;
