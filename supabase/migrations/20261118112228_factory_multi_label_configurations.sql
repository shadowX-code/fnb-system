-- Preserve existing ids, revisions, published JSON, rasters and jobs as Product Label evidence.
alter table public.factory_label_configs
  add column label_key text not null default 'product' check (label_key = 'product' or label_key ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  add column label_name text not null default 'Product Label' check (length(btrim(label_name)) between 1 and 80),
  add column quantity_basis text not null default 'packaged_units' check (quantity_basis in ('packaged_units','batch','verified_cartons')),
  drop constraint factory_label_configs_finished_good_id_version_key,
  add unique (finished_good_id,label_key,version);

alter table public.factory_label_snapshots
  add column label_key text not null default 'product' check (label_key = 'product' or label_key ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  drop constraint factory_label_snapshots_production_id_key,
  add unique (production_id,label_key);

-- Stable SKU-scoped label keys also identify independent draft lineages.
create function public.factory_label_catalog(p_sku uuid,p_include_drafts boolean) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 with published as (
  select distinct on (label_key) label_key,label_name,quantity_basis,version,template_id
  from public.factory_label_configs where finished_good_id=p_sku order by label_key,version desc
 ), drafts as (
  select case when entity_key=p_sku::text then 'product' else split_part(entity_key,':',2) end label_key,
    payload,revision
  from public.factory_label_drafts
  where p_include_drafts and kind='product' and state='draft'
    and (entity_key=p_sku::text or entity_key like p_sku::text||':%')
 ), keys as (
  select label_key from published union select label_key from drafts union select 'product' where p_include_drafts
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'label_key',k.label_key,
  'name',coalesce(p.label_name,d.payload->>'label_name','Product Label'),
  'draft_name',d.payload->>'label_name','quantity_basis',coalesce(p.quantity_basis,d.payload->>'quantity_basis','packaged_units'),
  'active_version',p.version,'draft_revision',d.revision,
  'template_name',pt.name,'template_version',pt.version,
  'draft_template_name',dt.name,'draft_template_version',dt.version,
  'status',case when p.version is not null then 'Ready' when d.revision is not null then 'Draft' else 'Not Configured' end
 ) order by (k.label_key='product') desc,coalesce(p.label_name,d.payload->>'label_name','Product Label'),k.label_key),'[]')
 from keys k left join published p using (label_key) left join drafts d using (label_key)
 left join public.factory_label_templates pt on pt.id=p.template_id
 left join public.factory_label_templates dt on dt.id::text=d.payload->>'template_id'
$$;
revoke all on function public.factory_label_catalog(uuid,boolean) from public,anon,authenticated;

create or replace function public.factory_label_editor(p_kind text,p_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 published jsonb;
 sku jsonb;
 templates jsonb;
 active_template_ids jsonb;
 history jsonb;
 draft jsonb;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_kind='product' then
  select to_jsonb(c) into published from public.factory_label_configs c where finished_good_id=split_part(p_key,':',1)::uuid and label_key=coalesce(nullif(split_part(p_key,':',2),''),'product') order by version desc limit 1;
  select jsonb_build_object('id',f.id,'product_code',f.product_code,'product_name',coalesce(fa.name_en,f.product_name_en,f.product_name),'product_name_cn',coalesce(fa.name_cn,f.product_name_cn,''),'product_name_bm',coalesce(fa.name_bm,f.product_name_bm,''),'pack_size_qty',f.pack_size_qty,'pack_size_uom',f.pack_size_uom,'shelf_life_days',f.shelf_life_days) into sku from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where f.id=split_part(p_key,':',1)::uuid;
  if sku is null then raise exception 'Packaging SKU unavailable.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,template_id,approval_note,created_at,created_by from public.factory_label_configs where finished_good_id=split_part(p_key,':',1)::uuid and label_key=coalesce(nullif(split_part(p_key,':',2),''),'product') order by version desc limit 20)x;
 elsif p_kind='template' then
  select to_jsonb(t) into published from public.factory_label_templates t where template_key=p_key order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,name,created_at,created_by from public.factory_label_templates where template_key=p_key order by version desc limit 20)x;
 else raise exception 'Unknown label editor.'; end if;
 select to_jsonb(d) into draft
 from public.factory_label_drafts d where kind=p_kind and entity_key=p_key;

 with pinned as (
  select t.id,t.template_key from public.factory_label_templates t
  where p_kind='product' and (
   t.id::text=published->>'template_id'
   or (draft->>'state'='draft' and t.id::text=draft->'payload'->>'template_id')
  )
 ), catalog as (
  select distinct on (template_key) id
  from public.factory_label_templates order by template_key,version desc limit 100
 ), active as (
  select id from catalog
  union
  select newest.id from (select distinct template_key from pinned) p
  cross join lateral (
   select t.id from public.factory_label_templates t
   where t.template_key=p.template_key order by t.version desc limit 1
  ) newest
 ), available as (
  select id from active
  union
  select id from pinned
 )
 select
  coalesce(jsonb_agg(to_jsonb(t) order by (a.id is not null) desc,t.name,t.id),'[]'),
  coalesce(jsonb_agg(t.id order by t.name,t.id) filter (where a.id is not null),'[]')
 into templates,active_template_ids
 from available v
 join public.factory_label_templates t on t.id=v.id
 left join active a on a.id=v.id;

 return jsonb_build_object('published',published,'sku',sku,'draft',draft,
  'templates',templates,'active_template_ids',active_template_ids,'history',history);
end $$;

create or replace function public.factory_label_settings(p_sku uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 return jsonb_build_object('config',(select to_jsonb(c) from public.factory_label_configs c where finished_good_id=p_sku and label_key='product' order by version desc limit 1),
 'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by name,version desc),'[]') from public.factory_label_templates t));
end $$;

create or replace function public.factory_label_management(p_section text default 'products',p_page integer default 1,p_search text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; total integer; offset_rows integer:=(greatest(coalesce(p_page,1),1)-1)*20;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_section='products' then
  select count(*) into total from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name,x.id),'[]') into rows from (
   select f.id,f.product_code,coalesce(fa.name_en,f.product_name_en,f.product_name) product_name,f.variant_name,f.status,
   c.id config_id,c.version config_version,c.template_id,t.name template_name,t.version template_version,
   public.factory_label_catalog(f.id,true) labels,
   d.revision draft_revision, dt.name draft_template_name, dt.version draft_template_version,
   case when t.id is not null then 'Ready' when d.id is not null then 'Draft' else 'Not Configured' end configuration_status
   from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id
   left join lateral(select * from public.factory_label_configs where finished_good_id=f.id and label_key='product' order by version desc limit 1)c on true
   left join public.factory_label_templates t on t.id=c.template_id
   left join public.factory_label_drafts d on d.kind='product' and d.entity_key=f.id::text and d.state='draft'
   left join public.factory_label_templates dt on dt.id::text=d.payload->>'template_id'
   where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%' order by product_name,f.id limit 20 offset offset_rows
  )x;
 elsif p_section='templates' then
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template') select count(*) into total from families where template_key ilike '%'||p_search||'%' or exists(select 1 from public.factory_label_templates where template_key=families.template_key and name ilike '%'||p_search||'%');
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template')
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.template_key),'[]') into rows from (
   select fam.template_key,coalesce(t.name,d.payload->>'name','New template') name,t.version,t.id,
    case when d.state='draft' then 'Draft' else 'Approved' end configuration_status,
    (select count(distinct c.finished_good_id) from public.factory_label_configs c where c.template_id=t.id and c.version=(select max(c2.version) from public.factory_label_configs c2 where c2.finished_good_id=c.finished_good_id and c2.label_key=c.label_key)) assignments
   from families fam left join lateral(select * from public.factory_label_templates where template_key=fam.template_key order by version desc limit 1)t on true
   left join public.factory_label_drafts d on d.kind='template' and d.entity_key=fam.template_key
   where fam.template_key ilike '%'||p_search||'%' or t.name ilike '%'||p_search||'%' or d.payload->>'name' ilike '%'||p_search||'%' order by name,fam.template_key limit 20 offset offset_rows
  )x;
 elsif p_section='printers' then
  select count(*) into total from public.factory_label_devices where concat_ws(' ',name,printer_name) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into rows from (select d.id,d.name,d.printer_name,d.transport,d.enabled,d.status,d.printers,d.last_seen,
   coalesce(d.last_reported_calibration,public.factory_label_reported_calibration(d.printers,d.printer_name)) calibration_status,
   (select count(*) from public.factory_label_jobs j where j.device_id=d.id and j.state='Unknown') unresolved_jobs
   from public.factory_label_devices d where concat_ws(' ',d.name,d.printer_name) ilike '%'||p_search||'%' order by name,id limit 20 offset offset_rows)x;
 else raise exception 'Unknown Label Management section.'; end if;
 return jsonb_build_object('rows',rows,'total',total);
end $$;

create or replace function public.factory_label_save_draft(p_kind text,p_key text,p_payload jsonb,p_revision integer,p_base_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
  if p_key !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?$' then raise exception 'Invalid SKU label configuration.'; end if;
  if not exists(select 1 from public.factory_finished_goods where id=split_part(p_key,':',1)::uuid) then raise exception 'Packaging SKU unavailable.'; end if;
  if position(':' in p_key)>0 and not (p_payload ? 'label_name' and p_payload ? 'quantity_basis') then raise exception 'Enter a label name and select a quantity rule.'; end if;
  if length(btrim(coalesce(p_payload->>'label_name','Product Label'))) not between 1 and 80
    or coalesce(p_payload->>'quantity_basis','packaged_units') not in ('packaged_units','batch','verified_cartons') then
   raise exception 'Enter a label name and select a supported quantity rule.';
  end if;
  select coalesce(max(version),0) into latest from public.factory_label_configs where finished_good_id=split_part(p_key,':',1)::uuid and label_key=coalesce(nullif(split_part(p_key,':',2),''),'product');
 else select coalesce(max(version),0) into latest from public.factory_label_templates where template_key=p_key;
 end if;
 if latest is distinct from p_base_version then raise exception 'Approved version changed. Reload before continuing.'; end if;
 insert into public.factory_label_drafts(kind,entity_key,revision,base_version,payload,last_request_id,last_request_hash,updated_by)
 values(p_kind,p_key,1,latest,p_payload,p_request_id,fingerprint,actor)
 on conflict(kind,entity_key) do update set revision=factory_label_drafts.revision+1,base_version=latest,payload=excluded.payload,state='draft',published_id=null,publish_request_id=null,last_request_id=excluded.last_request_id,last_request_hash=excluded.last_request_hash,updated_by=actor,updated_at=now() returning * into d;
 return to_jsonb(d);
end $$;

create or replace function public.factory_label_save_configuration(p_key text,p_sku uuid,p_config jsonb,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); v_version integer; v_saved public.factory_label_configs; v_template uuid; v_def jsonb; v_content jsonb:=coalesce(p_config->'content','{}');
begin
 perform pg_advisory_xact_lock(hashtextextended('label-config:'||p_sku::text,0));
 select * into v_saved from public.factory_label_configs where request_id=p_request_id;
 if found then
  if v_saved.finished_good_id<>p_sku or v_saved.label_key<>p_key or v_saved.created_by<>v_actor or v_saved.request_hash<>md5(p_config::text) then raise exception 'Request already used. Reload before saving.'; end if;
  return to_jsonb(v_saved);
 end if;
 select coalesce(max(version),0) into v_version from public.factory_label_configs where finished_good_id=p_sku and label_key=p_key;
 if p_expected_version is distinct from v_version then raise exception 'Label configuration changed. Reload before saving.'; end if;
 if p_config->>'content_approved' is distinct from 'true' then raise exception 'Explicit label content approval is required.'; end if;
 if not exists(select 1 from public.factory_finished_goods where id=p_sku) then raise exception 'Packaging SKU unavailable.'; end if;
 v_template:=(p_config->>'template_id')::uuid;
 if p_config ? 'new_template' then raise exception 'Publish reusable templates through Label Management before assigning them.'; end if;
 select definition into v_def from public.factory_label_templates where id=v_template;
 if not found then raise exception 'Select an approved label template.'; end if;
 perform public.factory_label_validate_layout(v_def,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric);
 perform public.factory_label_validate_content(v_content,v_def);
 insert into public.factory_label_configs(request_id,request_hash,finished_good_id,version,template_id,width_mm,height_mm,net_weight,storage_instructions,shelf_life_days,expiry_rule,approval_note,created_by,content,label_key,label_name,quantity_basis)
 values(p_request_id,md5(p_config::text),p_sku,v_version+1,v_template,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric,btrim(p_config->>'net_weight'),btrim(p_config->>'storage_instructions'),nullif(p_config->>'shelf_life_days','')::integer,p_config->>'expiry_rule',p_config->>'approval_note',v_actor,v_content,p_key,btrim(coalesce(p_config->>'label_name','Product Label')),coalesce(p_config->>'quantity_basis','packaged_units')) returning * into v_saved;
 return to_jsonb(v_saved);
end $$;
revoke all on function public.factory_label_save_configuration(text,uuid,jsonb,integer,uuid) from public,anon,authenticated;

-- Older callers continue addressing the default Product Label.
create or replace function public.factory_label_save_config(p_sku uuid,p_config jsonb,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.factory_label_save_configuration('product',p_sku,p_config,p_expected_version,p_request_id)
$$;

create or replace function public.factory_label_publish(p_draft uuid,p_revision integer,p_request_id uuid,p_approval_note text,p_content_approved boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); d public.factory_label_drafts; latest integer; published jsonb; v_published_id uuid; definition jsonb; request_hash text:=md5(jsonb_build_object('revision',p_revision,'approval_note',p_approval_note,'approved',p_content_approved)::text);
begin
 if p_request_id is null or p_content_approved is distinct from true or length(btrim(coalesce(p_approval_note,''))) not between 3 and 1000 then raise exception 'Review the preview and confirm label approval with a reason.'; end if;
 select * into d from public.factory_label_drafts where factory_label_drafts.id=p_draft for update;
 if not found then raise exception 'Save the label draft before publishing.'; end if;
 if d.state='published' and d.publish_request_id=p_request_id then
  if d.publish_request_hash is distinct from request_hash or d.updated_by<>actor then raise exception 'Publication request already used with different approval details.'; end if;
  return to_jsonb(d);
 end if;
 if d.state<>'draft' or d.revision is distinct from p_revision then raise exception 'Draft changed. Review the latest version.'; end if;
 if d.kind='product' then
  published:=public.factory_label_save_configuration(coalesce(nullif(split_part(d.entity_key,':',2),''),'product'),split_part(d.entity_key,':',1)::uuid,d.payload||jsonb_build_object('content_approved',true,'approval_note',p_approval_note),d.base_version,p_request_id);
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
 update public.factory_label_drafts set state='published',published_id=v_published_id,publish_request_id=p_request_id,publish_request_hash=request_hash,updated_by=actor,updated_at=now() where factory_label_drafts.id=p_draft returning * into d;
 insert into public.factory_label_management_events(entity_key,action,detail,actor) values(d.entity_key,'published',jsonb_build_object('kind',d.kind,'draft_id',d.id,'revision',d.revision,'published_id',v_published_id,'approval_note',p_approval_note),actor);
 return to_jsonb(d);
end $$;

create or replace function public.factory_label_selected_candidate(p_production uuid,p_overrides jsonb,p_label_key text,p_preview_job uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.factory_productions; f public.factory_finished_goods; c public.factory_label_configs; t public.factory_label_templates;
 v_snapshot jsonb; v_mfg date; v_exp date; v_units numeric; v_batch text; v_missing jsonb:='[]'; v_sources jsonb:='{}'; v_cartons numeric; v_limit numeric; v_preview boolean:=p_preview_job is not null; v_sku uuid;
begin
 if v_preview then
  select finished_good_id into v_sku from public.factory_job_orders where id=p_preview_job and status='in_progress';
  if not found then return null; end if;
  -- Real evidence only. Preview never reads target quantities or planned dates.
  select * into p from public.factory_productions where job_order_id=p_preview_job and status='in_progress' order by created_at desc limit 1;
  p.job_order_id:=p_preview_job;
 else
  select snapshot into v_snapshot from public.factory_label_snapshots where production_id=p_production and label_key=p_label_key;
  if found then return v_snapshot; end if;
  select * into p from public.factory_productions where id=p_production and status='completed';
  if not found then raise exception 'A completed Production batch is required.'; end if;
  v_sku:=p.finished_good_id;
 end if;
 select * into f from public.factory_finished_goods where id=v_sku;
 select * into c from public.factory_label_configs where finished_good_id=f.id and label_key=p_label_key order by version desc limit 1;
 if not found then return jsonb_build_object('production_id',p.id,'missing',jsonb_build_array('label_configuration')); end if;
 select * into t from public.factory_label_templates where id=c.template_id;
 v_mfg:=coalesce(p.manufacturing_date,p.end_date); v_exp:=p.expiry_date; v_units:=p.actual_pack_qty; v_batch:=nullif(btrim(p.batch_no),'');
 if not v_preview and p_overrides<>'{}'::jsonb then
  if p_overrides->>'confirmed' is distinct from 'true' or length(btrim(coalesce(p_overrides->>'reason','')))<3 then raise exception 'Confirm missing batch information with a reason.'; end if;
  if (v_mfg is not null and nullif(p_overrides->>'manufacturing_date','') is not null) or (v_exp is not null and nullif(p_overrides->>'expiry_date','') is not null) or (v_units is not null and nullif(p_overrides->>'packaged_units','') is not null) or (v_batch is not null and nullif(p_overrides->>'batch_no','') is not null) then raise exception 'Recorded Production evidence cannot be overridden.'; end if;
  v_mfg:=coalesce(v_mfg,nullif(p_overrides->>'manufacturing_date','')::date); v_exp:=coalesce(v_exp,nullif(p_overrides->>'expiry_date','')::date);
  v_units:=coalesce(v_units,nullif(p_overrides->>'packaged_units','')::numeric); v_batch:=coalesce(v_batch,nullif(btrim(p_overrides->>'batch_no'),''));
  if c.quantity_basis='verified_cartons' then v_cartons:=nullif(p_overrides->>'confirmed_cartons','')::numeric; end if;
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
 elsif not v_preview and (v_units<1 or v_units<>trunc(v_units) or v_units>1000000) then raise exception 'Confirmed packaged units must be a positive whole number.'; end if;
 if c.quantity_basis='verified_cartons' and not v_preview then
  if v_cartons is null then v_missing:=v_missing||'"confirmed_cartons"';
  elsif v_cartons not between 1 and 1000000 or v_cartons<>trunc(v_cartons) then raise exception 'Confirm the verified carton count as a positive whole number.';
  end if;
 end if;
 if not v_preview then
  v_limit:=case c.quantity_basis when 'batch' then 1 when 'verified_cartons' then v_cartons else v_units end;
 end if;
 if v_exp<v_mfg then raise exception 'Expiry cannot precede manufacturing date.'; end if;
 return jsonb_build_object('production_id',p.id,'job_order_id',p.job_order_id,'finished_good_id',f.id,
 'production_product_name',p.product_name,'product_name',coalesce((select nullif(name_en,'') from public.factory_product_families where id=f.product_family_id),nullif(p.product_name,''),nullif(f.product_name_en,''),f.product_name),'product_name_cn',coalesce(nullif(f.product_name_cn,''),(select name_cn from public.factory_product_families where id=f.product_family_id)),
 'product_name_bm',coalesce(nullif(f.product_name_bm,''),(select name_bm from public.factory_product_families where id=f.product_family_id)),
 'product_code',f.product_code,'variant_name',f.variant_name,'batch_no',v_batch,'manufacturing_date',v_mfg,'expiry_date',v_exp,'packaged_units',v_units,
 'config_id',c.id,'config_version',c.version,'template_id',t.id,'template_version',t.version,'template_name',t.name,'definition',t.definition,'shelf_life_days',coalesce(p.shelf_life_days_snapshot,c.shelf_life_days),
 'width_mm',c.width_mm,'height_mm',c.height_mm,'dpi',203,'net_weight',c.net_weight,'storage_instructions',c.storage_instructions,
 'label_key',c.label_key,'label_name',c.label_name,'quantity_basis',c.quantity_basis,'quantity_limit',v_limit,'confirmed_cartons',v_cartons,
 'preview_only',v_preview,'sources',v_sources,'missing',v_missing,'content',c.content) || (c.content-'text_overrides');
end $$;
revoke all on function public.factory_label_selected_candidate(uuid,jsonb,text,uuid) from public,anon,authenticated;

create or replace function public.factory_label_candidate(p_production uuid,p_overrides jsonb default '{}')
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select public.factory_label_selected_candidate(p_production,p_overrides-'label_key',coalesce(p_overrides->>'label_key','product'),null)
$$;

create or replace function public.factory_label_context(p_job_order uuid,p_production uuid default null,p_overrides jsonb default '{}',p_page integer default 1) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batches jsonb; v_candidate jsonb; v_history jsonb; v_total integer; v_sku uuid; v_status text; v_labels jsonb;
 v_label_key text:=coalesce(p_overrides->>'label_key','product');
begin
 perform public.factory_label_actor('factory_job_orders.view');
 if public.current_user_has_permission('factory_production.view') is not true then raise exception using errcode='42501',message='Production view permission is required.'; end if;
 select finished_good_id,status into v_sku,v_status from public.factory_job_orders where id=p_job_order;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'batch_no',p.batch_no,'packaged_units',p.actual_pack_qty,'product_name',p.product_name) order by p.created_at desc),'[]') into v_batches from public.factory_productions p where p.job_order_id=p_job_order and p.status='completed';
 if p_production is not null then
  select finished_good_id into v_sku from public.factory_productions where id=p_production and job_order_id=p_job_order and status='completed';
  if not found then raise exception 'Select a completed batch from this Job Order.'; end if;
  v_candidate:=public.factory_label_candidate(p_production,p_overrides);
 elsif v_status='in_progress' then
  v_candidate:=public.factory_label_selected_candidate(null,'{}',v_label_key,p_job_order);
 end if;
 v_labels:=public.factory_label_catalog(v_sku,false);
 select count(*) into v_total from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production and s.label_key=v_label_key;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') into v_history from (
  select j.id,j.quantity,j.state,j.created_at,j.updated_at,j.reprint_of,j.reprint_reason,j.detail,j.device_id,j.created_by,
   coalesce(e.nickname,e.full_name) operator_name,s.snapshot->>'batch_no' batch_no,s.snapshot->>'template_version' template_version,coalesce(s.snapshot->>'label_name','Product Label') label_name,
   (select jsonb_agg(to_jsonb(ev) order by ev.id) from public.factory_label_events ev where ev.job_id=j.id) events
  from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id left join public.employees e on e.id=j.created_by
  where s.production_id=p_production and s.label_key=v_label_key order by j.created_at desc limit 20 offset (greatest(coalesce(p_page,1),1)-1)*20
 ) h;
 return jsonb_build_object('batches',v_batches,'labels',v_labels,'preview_only',v_status='in_progress' and p_production is null,'candidate',v_candidate,'history',v_history,'history_total',v_total,'saved_raster',(select j.raster from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production and s.label_key=v_label_key order by j.created_at,j.id limit 1),
 'allocated',coalesce((select sum(j.quantity) from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production and s.label_key=v_label_key and j.reprint_of is null),0),
 'devices',(select coalesce(jsonb_agg(to_jsonb(d)-'owner'||jsonb_build_object('hold',held.ref)),'[]')
   from public.factory_label_devices d
   left join lateral (
     select jsonb_build_object('job_order_no',jo.job_order_no,'batch_no',s.snapshot->>'batch_no') ref
     from public.factory_label_jobs j
     join public.factory_label_snapshots s on s.id=j.snapshot_id
     join public.factory_productions p on p.id=s.production_id
     join public.factory_job_orders jo on jo.id=p.job_order_id
     where j.device_id=d.id and j.state='Unknown'
     order by j.created_at,j.id limit 1
   ) held on true
   where d.enabled));
end $$;

create or replace function public.factory_label_enqueue(p_request_id uuid,p_production uuid,p_device uuid,p_quantity integer,p_expected_snapshot jsonb,p_raster jsonb,p_overrides jsonb default '{}',p_reprint_of uuid default null,p_reason text default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_production.complete'); v_snapshot jsonb; v_snap_id uuid; v_hash text; v_job public.factory_label_jobs; v_source public.factory_label_jobs; v_allocated integer; v_bitmap bytea; v_limit integer;
 v_label_key text:=coalesce(p_overrides->>'label_key','product');
begin
 if public.current_user_has_permission('factory_production.view') is not true or public.current_user_has_permission('factory_job_orders.view') is not true then raise exception using errcode='42501',message='Production and Job Order view permissions are required.'; end if;
 if p_quantity is null or p_quantity not between 1 and 10000 or p_request_id is null then raise exception 'Confirm a label quantity between 1 and 10,000.'; end if;
 v_hash:=md5(jsonb_build_object('production',p_production,'device',p_device,'quantity',p_quantity,'snapshot',p_expected_snapshot,'raster',p_raster,'overrides',p_overrides,'source',p_reprint_of,'reason',p_reason)::text);
 perform pg_advisory_xact_lock(hashtextextended('label-request:'||p_request_id::text,0));
 select * into v_job from public.factory_label_jobs where request_id=p_request_id;
 if found then
  if v_job.request_hash<>v_hash or v_job.created_by<>v_actor then raise exception 'Print request already used with different details.'; end if;
  return v_job.id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('label-batch:'||p_production::text,0));
 if not exists(select 1 from public.factory_label_devices where id=p_device and enabled) then raise exception 'Select an enabled print bridge.'; end if;
 if p_reprint_of is not null then
  perform public.factory_label_actor('factory_production.verify');
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'A reprint reason is required.'; end if;
  select * into v_source from public.factory_label_jobs where id=p_reprint_of for update;
  if not found or v_source.state not in ('Confirmed','Failed') then raise exception 'Resolve the original print before reprinting.'; end if;
  select id,snapshot into v_snap_id,v_snapshot from public.factory_label_snapshots where id=v_source.snapshot_id and production_id=p_production and label_key=v_label_key;
  if not found then raise exception 'Original print belongs to another batch or label.'; end if;
  if exists(select 1 from public.factory_label_jobs where snapshot_id=v_snap_id and state in ('Queued','Printing','Unknown')) then raise exception 'Resolve pending batch prints before reprinting.'; end if;
  p_raster:=v_source.raster;
 else
  v_snapshot:=public.factory_label_candidate(p_production,p_overrides);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'Batch or label configuration changed. Review the preview again.'; end if;
  if jsonb_array_length(v_snapshot->'missing')>0 then raise exception 'Confirm missing label information before printing.'; end if;
  select id into v_snap_id from public.factory_label_snapshots where production_id=p_production and label_key=v_label_key;
  if v_snap_id is not null then select raster into p_raster from public.factory_label_jobs where snapshot_id=v_snap_id order by created_at,id limit 1; end if;
  if v_snap_id is null then insert into public.factory_label_snapshots(production_id,label_key,snapshot,created_by) values(p_production,v_label_key,v_snapshot,v_actor) returning id into v_snap_id; end if;
  select coalesce(sum(quantity),0) into v_allocated from public.factory_label_jobs where snapshot_id=v_snap_id and reprint_of is null;
  v_limit:=coalesce((v_snapshot->>'quantity_limit')::integer,(v_snapshot->>'packaged_units')::integer);
  if v_limit is null or v_allocated+p_quantity>v_limit then raise exception 'Label quantity exceeds the confirmed limit for this label. Use an authorized reprint.'; end if;
  if p_raster->>'format' is distinct from 'mono1' or (p_raster->>'width')::integer is distinct from round((v_snapshot->>'width_mm')::numeric*203/25.4)::integer or (p_raster->>'height')::integer is distinct from round((v_snapshot->>'height_mm')::numeric*203/25.4)::integer then raise exception 'Label raster dimensions do not match the approved configuration.'; end if;
  if length(p_raster->>'data')>500000 then raise exception 'Label bitmap is too large.'; end if;
  v_bitmap:=decode(p_raster->>'data','base64');
  if v_bitmap is null or octet_length(v_bitmap)<>ceil((p_raster->>'width')::numeric/8)::integer*(p_raster->>'height')::integer then raise exception 'Invalid label bitmap.'; end if;
 end if;
 insert into public.factory_label_jobs(request_id,request_hash,snapshot_id,device_id,quantity,reprint_of,reprint_reason,raster,created_by)
 values(p_request_id,v_hash,v_snap_id,p_device,p_quantity,p_reprint_of,p_reason,p_raster,v_actor) returning * into v_job;
 insert into public.factory_label_events(job_id,state,actor,detail) values(v_job.id,'Queued',v_actor,case when p_reprint_of is null then 'Operator confirmed preview and quantity' else p_reason end);
 return v_job.id;
end $$;
