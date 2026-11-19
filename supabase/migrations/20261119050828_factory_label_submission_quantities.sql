-- Existing snapshots, allocations and queue contracts remain immutable.
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
  if position(':' in p_key)>0 and nullif(btrim(p_payload->>'label_name'),'') is null then raise exception 'Enter a label name.'; end if;
  if length(btrim(coalesce(p_payload->>'label_name','Product Label'))) not between 1 and 80
    or coalesce(p_payload->>'quantity_basis','packaged_units') not in ('packaged_units','batch','verified_cartons') then
   raise exception 'Enter a label name and supported legacy quantity evidence.';
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
declare v_actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); v_version integer; v_legacy_basis text; v_saved public.factory_label_configs; v_template uuid; v_def jsonb; v_content jsonb:=coalesce(p_config->'content','{}');
begin
 perform pg_advisory_xact_lock(hashtextextended('label-config:'||p_sku::text,0));
 select * into v_saved from public.factory_label_configs where request_id=p_request_id;
 if found then
  if v_saved.finished_good_id<>p_sku or v_saved.label_key<>p_key or v_saved.created_by<>v_actor or v_saved.request_hash<>md5(p_config::text) then raise exception 'Request already used. Reload before saving.'; end if;
  return to_jsonb(v_saved);
 end if;
 -- Existing strict evidence policies carry across revisions without an editor setting.
 select version, quantity_basis into v_version,v_legacy_basis
 from public.factory_label_configs where finished_good_id=p_sku and label_key=p_key
 order by version desc limit 1;
 v_version:=coalesce(v_version,0);
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
 values(p_request_id,md5(p_config::text),p_sku,v_version+1,v_template,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric,btrim(p_config->>'net_weight'),btrim(p_config->>'storage_instructions'),nullif(p_config->>'shelf_life_days','')::integer,p_config->>'expiry_rule',p_config->>'approval_note',v_actor,v_content,p_key,btrim(coalesce(p_config->>'label_name','Product Label')),coalesce(v_legacy_basis,p_config->>'quantity_basis','packaged_units')) returning * into v_saved;
 return to_jsonb(v_saved);
end $$;

create or replace function public.factory_label_selected_candidate(p_production uuid,p_overrides jsonb,p_label_key text,p_preview_job uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.factory_productions; f public.factory_finished_goods; c public.factory_label_configs; t public.factory_label_templates;
 v_snapshot jsonb; v_mfg date; v_exp date; v_units numeric; v_batch text; v_missing jsonb:='[]'; v_sources jsonb:='{}'; v_cartons numeric; v_limit numeric; v_preview boolean:=p_preview_job is not null; v_sku uuid;
 v_evidence jsonb:=coalesce(p_overrides,'{}')-'carton_evidence';
 v_use_cartons boolean:=coalesce(p_overrides->>'carton_evidence'='true',false);
begin
 if v_preview then
  select finished_good_id into v_sku from public.factory_job_orders where id=p_preview_job and status='in_progress';
  if not found then return null; end if;
  -- Real evidence only. Preview never reads target quantities or planned dates.
  select * into p from public.factory_productions where job_order_id=p_preview_job and status='in_progress' order by created_at desc limit 1;
  p.job_order_id:=p_preview_job;
 else
  select snapshot into v_snapshot from public.factory_label_snapshots where production_id=p_production and label_key=p_label_key;
  if found then
   if v_use_cartons and v_snapshot->>'quantity_basis' is distinct from 'verified_cartons' then
    raise exception 'Quantity evidence is already fixed for this label and batch.';
   end if;
   return v_snapshot;
  end if;
  select * into p from public.factory_productions where id=p_production and status='completed';
  if not found then raise exception 'A completed Production batch is required.'; end if;
  v_sku:=p.finished_good_id;
 end if;
 select * into f from public.factory_finished_goods where id=v_sku;
 select * into c from public.factory_label_configs where finished_good_id=f.id and label_key=p_label_key order by version desc limit 1;
 if not found then return jsonb_build_object('production_id',p.id,'missing',jsonb_build_array('label_configuration')); end if;
 select * into t from public.factory_label_templates where id=c.template_id;
 v_mfg:=coalesce(p.manufacturing_date,p.end_date); v_exp:=p.expiry_date; v_units:=p.actual_pack_qty; v_batch:=nullif(btrim(p.batch_no),'');
 if v_use_cartons and c.quantity_basis='batch' then
  raise exception 'This label already uses the confirmed batch limit.';
 end if;
 v_use_cartons:=v_use_cartons or c.quantity_basis='verified_cartons';
 if not v_preview and v_evidence<>'{}'::jsonb then
  if p_overrides->>'confirmed' is distinct from 'true' or length(btrim(coalesce(p_overrides->>'reason','')))<3 then raise exception 'Confirm missing batch information with a reason.'; end if;
  if (v_mfg is not null and nullif(p_overrides->>'manufacturing_date','') is not null) or (v_exp is not null and nullif(p_overrides->>'expiry_date','') is not null) or (v_units is not null and nullif(p_overrides->>'packaged_units','') is not null) or (v_batch is not null and nullif(p_overrides->>'batch_no','') is not null) then raise exception 'Recorded Production evidence cannot be overridden.'; end if;
  v_mfg:=coalesce(v_mfg,nullif(p_overrides->>'manufacturing_date','')::date); v_exp:=coalesce(v_exp,nullif(p_overrides->>'expiry_date','')::date);
  v_units:=coalesce(v_units,nullif(p_overrides->>'packaged_units','')::numeric); v_batch:=coalesce(v_batch,nullif(btrim(p_overrides->>'batch_no'),''));
  if v_use_cartons then v_cartons:=nullif(p_overrides->>'confirmed_cartons','')::numeric; end if;
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
 if v_use_cartons and not v_preview then
  if v_cartons is null then v_missing:=v_missing||'"confirmed_cartons"';
  elsif v_cartons not between 1 and 1000000 or v_cartons<>trunc(v_cartons) then raise exception 'Confirm the verified carton count as a positive whole number.';
  end if;
 end if;
 if not v_preview then
  v_limit:=case when v_use_cartons then v_cartons when c.quantity_basis='batch' then 1 else v_units end;
 end if;
 if v_exp<v_mfg then raise exception 'Expiry cannot precede manufacturing date.'; end if;
 return jsonb_build_object('production_id',p.id,'job_order_id',p.job_order_id,'finished_good_id',f.id,
 'production_product_name',p.product_name,'product_name',coalesce((select nullif(name_en,'') from public.factory_product_families where id=f.product_family_id),nullif(p.product_name,''),nullif(f.product_name_en,''),f.product_name),'product_name_cn',coalesce(nullif(f.product_name_cn,''),(select name_cn from public.factory_product_families where id=f.product_family_id)),
 'product_name_bm',coalesce(nullif(f.product_name_bm,''),(select name_bm from public.factory_product_families where id=f.product_family_id)),
 'product_code',f.product_code,'variant_name',f.variant_name,'batch_no',v_batch,'manufacturing_date',v_mfg,'expiry_date',v_exp,'packaged_units',v_units,
 'config_id',c.id,'config_version',c.version,'template_id',t.id,'template_version',t.version,'template_name',t.name,'definition',t.definition,'shelf_life_days',coalesce(p.shelf_life_days_snapshot,c.shelf_life_days),
 'width_mm',c.width_mm,'height_mm',c.height_mm,'dpi',203,'net_weight',c.net_weight,'storage_instructions',c.storage_instructions,
 'label_key',c.label_key,'label_name',c.label_name,'quantity_basis',case when v_use_cartons then 'verified_cartons' else c.quantity_basis end,'quantity_limit',v_limit,'confirmed_cartons',v_cartons,
 'preview_only',v_preview,'sources',v_sources,'missing',v_missing,'content',c.content) || (c.content-'text_overrides');
end $$;
