-- Label-only drafts and content extend the existing immutable publication authority.
alter table public.factory_label_configs add column content jsonb not null default '{}' check(jsonb_typeof(content)='object');
create table public.factory_label_drafts (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('product','template')), entity_key text not null,
 revision integer not null default 1, base_version integer not null default 0, payload jsonb not null,
 state text not null default 'draft' check(state in ('draft','published')), published_id uuid, publish_request_id uuid,
 last_request_id uuid not null, last_request_hash text not null,
 updated_by uuid not null references public.employees(id), updated_at timestamptz not null default now(), unique(kind,entity_key)
);
create table public.factory_label_management_events (
 id bigint generated always as identity primary key, entity_key text not null, action text not null, detail jsonb not null,
 actor uuid not null references public.employees(id), created_at timestamptz not null default now()
);
alter table public.factory_label_drafts enable row level security;
alter table public.factory_label_management_events enable row level security;
revoke all on public.factory_label_drafts,public.factory_label_management_events from public,anon,authenticated;
create trigger label_management_event_immutable before update or delete on public.factory_label_management_events for each row execute function public.factory_label_immutable();

create function public.factory_label_validate_layout(p_definition jsonb,p_width numeric,p_height numeric) returns void language plpgsql set search_path=public,pg_temp as $$
declare e jsonb;
begin
 if p_width is null or p_height is null or p_width not between 20 and 120 or p_height not between 20 and 200 or jsonb_typeof(p_definition->'elements') is distinct from 'array' or jsonb_array_length(p_definition->'elements') not between 1 and 50 or length(p_definition::text)>500000 then raise exception 'A label needs valid dimensions and 1–50 elements.'; end if;
 for e in select value from jsonb_array_elements(p_definition->'elements') loop
  if e->>'type' not in ('text','rect','line','image','qr','barcode') or e->>'type' is null then raise exception 'Unsupported label element.'; end if;
  if (e->>'x')::numeric is null or (e->>'y')::numeric is null or (e->>'w')::numeric is null or (e->>'h')::numeric is null or (e->>'x')::numeric<0 or (e->>'y')::numeric<0 or (e->>'w')::numeric<=0 or (e->>'h')::numeric<=0 or (e->>'x')::numeric+(e->>'w')::numeric>p_width or (e->>'y')::numeric+(e->>'h')::numeric>p_height then raise exception 'Every element must fit inside the label.'; end if;
  if e ? 'field' and e->>'field' not in ('product_name','product_name_cn','product_name_bm','product_code','variant_name','net_weight','storage_instructions','ingredients','manufacturer_name','manufacturer_address','manufacturing_date','expiry_date','batch_no','packaged_units') then raise exception 'Unsupported label field.'; end if;
  if e->>'type'='text' and ((e->>'size')::numeric is null or (e->>'size')::numeric not between 1.5 and 20) then raise exception 'Text size must be 1.5–20 mm.'; end if;
  if e->>'type'='image' and (coalesce(e->>'src','') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(e->>'src')>400000) then raise exception 'Use an embedded PNG image under 300 KB.'; end if;
 end loop;
end $$;

create function public.factory_label_validate_content(p_content jsonb,p_definition jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare k text; v jsonb; e jsonb;
begin
 if p_content is null or jsonb_typeof(p_content)<>'object' or length(p_content::text)>20000 then raise exception 'Invalid SKU label content.'; end if;
 for k,v in select * from jsonb_each(p_content) loop
  if k not in ('product_name','product_name_cn','product_name_bm','ingredients','manufacturer_name','manufacturer_address','text_overrides') then raise exception 'Production-owned and product identity fields cannot be changed in label content.'; end if;
  if k<>'text_overrides' and (jsonb_typeof(v)<>'string' or length(v::text)>4000) then raise exception 'Label content must contain text under 4,000 characters per field.'; end if;
 end loop;
 if p_content ? 'product_name' and nullif(btrim(p_content->>'product_name'),'') is null then raise exception 'An English product label name is required.'; end if;
 if p_content ? 'text_overrides' then
  if jsonb_typeof(p_content->'text_overrides')<>'object' then raise exception 'Invalid static label text.'; end if;
  for k,v in select * from jsonb_each(p_content->'text_overrides') loop
   if k !~ '^[0-9]{1,2}$' or jsonb_typeof(v)<>'string' or length(v::text)>4000 then raise exception 'Invalid static text reference.'; end if;
   e:=p_definition->'elements'->k::integer;
   if e is null or e->>'type'<>'text' or e ? 'field' then raise exception 'Only static template text may have SKU overrides.'; end if;
  end loop;
 end if;
end $$;

create function public.factory_label_management(p_section text default 'products',p_page integer default 1,p_search text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; total integer; offset_rows integer:=(greatest(coalesce(p_page,1),1)-1)*20;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_section='products' then
  select count(*) into total from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name,x.id),'[]') into rows from (
   select f.id,f.product_code,coalesce(fa.name_en,f.product_name_en,f.product_name) product_name,f.variant_name,f.status,
   c.id config_id,c.version config_version,c.template_id,t.name template_name,t.version template_version,
   case when d.state='draft' then 'Draft' when c.id is not null then 'Approved' else 'Not configured' end configuration_status
   from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id
   left join lateral(select * from public.factory_label_configs where finished_good_id=f.id order by version desc limit 1)c on true
   left join public.factory_label_templates t on t.id=c.template_id
   left join public.factory_label_drafts d on d.kind='product' and d.entity_key=f.id::text
   where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%' order by product_name,f.id limit 20 offset offset_rows
  )x;
 elsif p_section='templates' then
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template') select count(*) into total from families where template_key ilike '%'||p_search||'%' or exists(select 1 from public.factory_label_templates where template_key=families.template_key and name ilike '%'||p_search||'%');
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template')
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.template_key),'[]') into rows from (
   select fam.template_key,coalesce(t.name,d.payload->>'name','New template') name,t.version,t.id,
    case when d.state='draft' then 'Draft' else 'Approved' end configuration_status,
    (select count(*) from public.factory_label_configs c where c.template_id=t.id and c.version=(select max(c2.version) from public.factory_label_configs c2 where c2.finished_good_id=c.finished_good_id)) assignments
   from families fam left join lateral(select * from public.factory_label_templates where template_key=fam.template_key order by version desc limit 1)t on true
   left join public.factory_label_drafts d on d.kind='template' and d.entity_key=fam.template_key
   where fam.template_key ilike '%'||p_search||'%' or t.name ilike '%'||p_search||'%' or d.payload->>'name' ilike '%'||p_search||'%' order by name,fam.template_key limit 20 offset offset_rows
  )x;
 elsif p_section='printers' then
  select count(*) into total from public.factory_label_devices where concat_ws(' ',name,printer_name) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into rows from (select id,name,printer_name,transport,enabled,status,printers,last_seen from public.factory_label_devices where concat_ws(' ',name,printer_name) ilike '%'||p_search||'%' order by name,id limit 20 offset offset_rows)x;
 else raise exception 'Unknown Label Management section.'; end if;
 return jsonb_build_object('rows',rows,'total',total);
end $$;

create function public.factory_label_editor(p_kind text,p_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare published jsonb; sku jsonb; templates jsonb; history jsonb;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_kind='product' then
  select to_jsonb(c) into published from public.factory_label_configs c where finished_good_id=p_key::uuid order by version desc limit 1;
  select jsonb_build_object('id',f.id,'product_code',f.product_code,'product_name',coalesce(fa.name_en,f.product_name_en,f.product_name),'product_name_cn',coalesce(fa.name_cn,f.product_name_cn,''),'product_name_bm',coalesce(fa.name_bm,f.product_name_bm,''),'pack_size_qty',f.pack_size_qty,'pack_size_uom',f.pack_size_uom,'shelf_life_days',f.shelf_life_days) into sku from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where f.id=p_key::uuid;
  if sku is null then raise exception 'Packaging SKU unavailable.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,template_id,approval_note,created_at,created_by from public.factory_label_configs where finished_good_id=p_key::uuid order by version desc limit 20)x;
 elsif p_kind='template' then
  select to_jsonb(t) into published from public.factory_label_templates t where template_key=p_key order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,name,created_at,created_by from public.factory_label_templates where template_key=p_key order by version desc limit 20)x;
 else raise exception 'Unknown label editor.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by name),'[]') into templates from (
  select distinct on (template_key) * from public.factory_label_templates order by template_key,version desc limit 100
 )x;
 -- Include an older pinned assignment without silently upgrading to the latest template.
 if p_kind='product' and published is not null and not exists(select 1 from jsonb_array_elements(templates) t where t->>'id'=published->>'template_id') then
  templates:=templates||coalesce((select jsonb_build_array(to_jsonb(t)) from public.factory_label_templates t where id=(published->>'template_id')::uuid),'[]');
 end if;
 return jsonb_build_object('published',published,'sku',sku,'draft',(select to_jsonb(d) from public.factory_label_drafts d where kind=p_kind and entity_key=p_key),'templates',templates,'history',history);
end $$;

create function public.factory_label_save_draft(p_kind text,p_key text,p_payload jsonb,p_revision integer,p_base_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); d public.factory_label_drafts; latest integer; fingerprint text:=md5(p_payload::text);
begin
 if p_kind not in ('product','template') or p_key is null or length(p_key) not between 1 and 100 or p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>550000 then raise exception 'Invalid label draft.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('label-draft:'||p_kind||':'||p_key,0));
 select * into d from public.factory_label_drafts where kind=p_kind and entity_key=p_key for update;
 if found and d.last_request_id=p_request_id then
  if d.last_request_hash<>fingerprint or d.updated_by<>actor then raise exception 'Draft request already used with different content.'; end if;
  return to_jsonb(d);
 end if;
 if coalesce(d.revision,0) is distinct from p_revision then raise exception 'Draft changed. Reload before saving.'; end if;
 if p_kind='product' then
  if not exists(select 1 from public.factory_finished_goods where id=p_key::uuid) then raise exception 'Packaging SKU unavailable.'; end if;
  select coalesce(max(version),0) into latest from public.factory_label_configs where finished_good_id=p_key::uuid;
 else select coalesce(max(version),0) into latest from public.factory_label_templates where template_key=p_key;
 end if;
 if latest is distinct from p_base_version then raise exception 'Approved version changed. Reload before continuing.'; end if;
 insert into public.factory_label_drafts(kind,entity_key,revision,base_version,payload,last_request_id,last_request_hash,updated_by)
 values(p_kind,p_key,1,latest,p_payload,p_request_id,fingerprint,actor)
 on conflict(kind,entity_key) do update set revision=factory_label_drafts.revision+1,base_version=latest,payload=excluded.payload,state='draft',published_id=null,publish_request_id=null,last_request_id=excluded.last_request_id,last_request_hash=excluded.last_request_hash,updated_by=actor,updated_at=now() returning * into d;
 return to_jsonb(d);
end $$;

create function public.factory_label_publish(p_draft uuid,p_revision integer,p_request_id uuid,p_approval_note text,p_content_approved boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); d public.factory_label_drafts; latest integer; published jsonb; v_published_id uuid; definition jsonb;
begin
 if p_request_id is null or p_content_approved is distinct from true or length(btrim(coalesce(p_approval_note,''))) not between 3 and 1000 then raise exception 'Review the preview and confirm label approval with a reason.'; end if;
 select * into d from public.factory_label_drafts where factory_label_drafts.id=p_draft for update;
 if not found then raise exception 'Save the label draft before publishing.'; end if;
 if d.state='published' and d.publish_request_id=p_request_id then return to_jsonb(d); end if;
 if d.state<>'draft' or d.revision is distinct from p_revision then raise exception 'Draft changed. Review the latest version.'; end if;
 if d.kind='product' then
  published:=public.factory_label_save_config(d.entity_key::uuid,d.payload||jsonb_build_object('content_approved',true,'approval_note',p_approval_note),d.base_version,p_request_id);
  v_published_id:=(published->>'id')::uuid;
 else
  perform pg_advisory_xact_lock(hashtextextended('label-template:'||d.entity_key,0));
  select coalesce(max(version),0) into latest from public.factory_label_templates where template_key=d.entity_key;
  if latest<>d.base_version then raise exception 'Template version changed. Reload before publishing.'; end if;
  definition:=d.payload->'definition';
  perform public.factory_label_validate_layout(definition,(d.payload->>'width_mm')::numeric,(d.payload->>'height_mm')::numeric);
  if length(btrim(coalesce(d.payload->>'name',''))) not between 1 and 120 then raise exception 'A template name is required.'; end if;
  insert into public.factory_label_templates(template_key,version,name,definition,created_by)
  values(d.entity_key,latest+1,btrim(d.payload->>'name'),definition||jsonb_build_object('width_mm',(d.payload->>'width_mm')::numeric,'height_mm',(d.payload->>'height_mm')::numeric),actor) returning factory_label_templates.id into v_published_id;
 end if;
 update public.factory_label_drafts set state='published',published_id=v_published_id,publish_request_id=p_request_id,updated_by=actor,updated_at=now() where factory_label_drafts.id=p_draft returning * into d;
 insert into public.factory_label_management_events(entity_key,action,detail,actor) values(d.entity_key,'published',jsonb_build_object('kind',d.kind,'draft_id',d.id,'revision',d.revision,'published_id',v_published_id,'approval_note',p_approval_note),actor);
 return to_jsonb(d);
end $$;

create function public.factory_label_set_device_enabled(p_device uuid,p_enabled boolean,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); old_enabled boolean;
begin
 if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'A printer configuration reason is required.'; end if;
 select enabled into old_enabled from public.factory_label_devices where id=p_device for update;
 if not found then raise exception 'Print bridge unavailable.'; end if;
 if old_enabled=p_enabled then return; end if;
 if exists(select 1 from public.factory_label_jobs where device_id=p_device and state='Printing') then raise exception 'Resolve the current Printing job before changing bridge availability.'; end if;
 update public.factory_label_devices set enabled=p_enabled where id=p_device;
 insert into public.factory_label_management_events(entity_key,action,detail,actor) values(p_device::text,'bridge_availability',jsonb_build_object('enabled',p_enabled,'reason',p_reason),actor);
end $$;
revoke all on function public.factory_label_validate_layout(jsonb,numeric,numeric),public.factory_label_validate_content(jsonb,jsonb),public.factory_label_management(text,integer,text),public.factory_label_editor(text,text),public.factory_label_save_draft(text,text,jsonb,integer,integer,uuid),public.factory_label_publish(uuid,integer,uuid,text,boolean),public.factory_label_set_device_enabled(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.factory_label_management(text,integer,text),public.factory_label_editor(text,text),public.factory_label_save_draft(text,text,jsonb,integer,integer,uuid),public.factory_label_publish(uuid,integer,uuid,text,boolean),public.factory_label_set_device_enabled(uuid,boolean,text) to authenticated;

create or replace function public.factory_label_save_config(p_sku uuid,p_config jsonb,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); v_version integer; v_saved public.factory_label_configs; v_template uuid; v_def jsonb; v_content jsonb:=coalesce(p_config->'content','{}');
begin
 perform pg_advisory_xact_lock(hashtextextended('label-config:'||p_sku::text,0));
 select * into v_saved from public.factory_label_configs where request_id=p_request_id;
 if found then
  if v_saved.finished_good_id<>p_sku or v_saved.created_by<>v_actor or v_saved.request_hash<>md5(p_config::text) then raise exception 'Request already used. Reload before saving.'; end if;
  return to_jsonb(v_saved);
 end if;
 select coalesce(max(version),0) into v_version from public.factory_label_configs where finished_good_id=p_sku;
 if p_expected_version is distinct from v_version then raise exception 'Label configuration changed. Reload before saving.'; end if;
 if p_config->>'content_approved' is distinct from 'true' then raise exception 'Explicit label content approval is required.'; end if;
 if not exists(select 1 from public.factory_finished_goods where id=p_sku) then raise exception 'Packaging SKU unavailable.'; end if;
 v_template:=(p_config->>'template_id')::uuid;
 if p_config ? 'new_template' then raise exception 'Publish reusable templates through Label Management before assigning them.'; end if;
 select definition into v_def from public.factory_label_templates where id=v_template;
 if not found then raise exception 'Select an approved label template.'; end if;
 perform public.factory_label_validate_layout(v_def,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric);
 perform public.factory_label_validate_content(v_content,v_def);
 insert into public.factory_label_configs(request_id,request_hash,finished_good_id,version,template_id,width_mm,height_mm,net_weight,storage_instructions,shelf_life_days,expiry_rule,approval_note,created_by,content)
 values(p_request_id,md5(p_config::text),p_sku,v_version+1,v_template,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric,btrim(p_config->>'net_weight'),btrim(p_config->>'storage_instructions'),nullif(p_config->>'shelf_life_days','')::integer,p_config->>'expiry_rule',p_config->>'approval_note',v_actor,v_content) returning * into v_saved;
 return to_jsonb(v_saved);
end $$;

create or replace function public.factory_label_candidate(p_production uuid,p_overrides jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.factory_productions; f public.factory_finished_goods; c public.factory_label_configs; t public.factory_label_templates;
 v_snapshot jsonb; v_mfg date; v_exp date; v_units numeric; v_batch text; v_missing jsonb:='[]'; v_sources jsonb:='{}';
begin
 select snapshot into v_snapshot from public.factory_label_snapshots where production_id=p_production;
 if found then return v_snapshot; end if;
 select * into p from public.factory_productions where id=p_production and status='completed';
 if not found then raise exception 'A completed Production batch is required.'; end if;
 select * into f from public.factory_finished_goods where id=p.finished_good_id;
 select * into c from public.factory_label_configs where finished_good_id=f.id order by version desc limit 1;
 if not found then return jsonb_build_object('production_id',p.id,'missing',jsonb_build_array('label_configuration')); end if;
 select * into t from public.factory_label_templates where id=c.template_id;
 v_mfg:=coalesce(p.manufacturing_date,p.end_date); v_exp:=p.expiry_date; v_units:=p.actual_pack_qty; v_batch:=nullif(btrim(p.batch_no),'');
 if p_overrides<>'{}'::jsonb then
  if p_overrides->>'confirmed' is distinct from 'true' or length(btrim(coalesce(p_overrides->>'reason','')))<3 then raise exception 'Confirm missing batch information with a reason.'; end if;
  if (v_mfg is not null and nullif(p_overrides->>'manufacturing_date','') is not null) or (v_exp is not null and nullif(p_overrides->>'expiry_date','') is not null) or (v_units is not null and nullif(p_overrides->>'packaged_units','') is not null) or (v_batch is not null and nullif(p_overrides->>'batch_no','') is not null) then raise exception 'Recorded Production evidence cannot be overridden.'; end if;
  v_mfg:=coalesce(v_mfg,nullif(p_overrides->>'manufacturing_date','')::date); v_exp:=coalesce(v_exp,nullif(p_overrides->>'expiry_date','')::date);
  v_units:=coalesce(v_units,nullif(p_overrides->>'packaged_units','')::numeric); v_batch:=coalesce(v_batch,nullif(btrim(p_overrides->>'batch_no'),''));
  v_sources:=p_overrides;
 end if;
 if v_exp is null and v_mfg is not null and c.expiry_rule<>'production' then
  v_exp:=v_mfg+c.shelf_life_days-case when c.expiry_rule='inclusive_days' then 1 else 0 end;
  v_sources:=v_sources||jsonb_build_object('expiry_calculation',c.expiry_rule,'approved_shelf_life_days',c.shelf_life_days);
 end if;
 if v_mfg is null then v_missing:=v_missing||'"manufacturing_date"'; end if;
 if v_exp is null then v_missing:=v_missing||'"expiry_date"'; end if;
 if v_batch is null then v_missing:=v_missing||'"batch_no"'; end if;
 if v_units is null then v_missing:=v_missing||'"packaged_units"';
 elsif v_units<1 or v_units<>trunc(v_units) or v_units>1000000 then raise exception 'Confirmed packaged units must be a positive whole number.'; end if;
 if v_exp<v_mfg then raise exception 'Expiry cannot precede manufacturing date.'; end if;
 return jsonb_build_object('production_id',p.id,'job_order_id',p.job_order_id,'finished_good_id',f.id,
 'production_product_name',p.product_name,'product_name',coalesce((select nullif(name_en,'') from public.factory_product_families where id=f.product_family_id),nullif(p.product_name,''),nullif(f.product_name_en,''),f.product_name),'product_name_cn',coalesce(nullif(f.product_name_cn,''),(select name_cn from public.factory_product_families where id=f.product_family_id)),
 'product_name_bm',coalesce(nullif(f.product_name_bm,''),(select name_bm from public.factory_product_families where id=f.product_family_id)),
 'product_code',f.product_code,'variant_name',f.variant_name,'batch_no',v_batch,'manufacturing_date',v_mfg,'expiry_date',v_exp,'packaged_units',v_units,
 'config_id',c.id,'config_version',c.version,'template_id',t.id,'template_version',t.version,'template_name',t.name,'definition',t.definition,'shelf_life_days',coalesce(p.shelf_life_days_snapshot,c.shelf_life_days),
 'width_mm',c.width_mm,'height_mm',c.height_mm,'dpi',203,'net_weight',c.net_weight,'storage_instructions',c.storage_instructions,
 'sources',v_sources,'missing',v_missing,'content',c.content) || (c.content-'text_overrides');
end $$;
