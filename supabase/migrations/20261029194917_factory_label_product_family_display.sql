-- Use the canonical product family title, preserving the original Production title as provenance.
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
 'sources',v_sources,'missing',v_missing);
end $$;
