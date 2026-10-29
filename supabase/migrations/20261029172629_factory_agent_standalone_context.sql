-- Essential references belong to the declared record projection, not a grant to the related domain.
alter table feedx_integrations.navigation_resources add column context_fields jsonb not null default '{}'::jsonb check(jsonb_typeof(context_fields)='object');
-- Reviewed all 97 mappings: existing relationship gates contain only these scalar references/labels.
do $$begin
 if exists(select 1 from feedx_integrations.navigation_resources b cross join lateral jsonb_object_keys(b.relationship_modules)f where f !~ '(_id|_ids|_no|_code|_name|_version)$' and f not in ('name','material_code')) then raise exception 'Unreviewed relationship field';end if;
end $$;
update feedx_integrations.navigation_resources set context_fields=relationship_modules,relationship_modules='{}' where relationship_modules<>'{}';

-- Fixed owner projections, never dynamic tables or full related records. Current labels are not historical snapshots.
create function feedx_integrations.navigation_reference_context(p_owner text,p_field text,p_value text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ref_id uuid;v jsonb;begin
 if p_value is null or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 ref_id:=p_value::uuid;
 case
 when p_owner='factory_storage_locations' then select jsonb_build_object('id',id,'label',location_name,'status',status) into v from public.factory_storage_locations where id=ref_id;
 when p_owner='factory_equipment' then select jsonb_build_object('id',id,'label',name,'status',status) into v from public.factory_equipment where id=ref_id;
 when p_owner='factory_raw_inventory' and p_field='raw_material_id' then select jsonb_build_object('id',id,'label',name,'status',status) into v from public.factory_raw_materials where id=ref_id;
 when p_owner in ('factory_finished_goods','factory_product_recipes') and p_field in ('finished_good_id','packaging_sku_id') then select jsonb_build_object('id',id,'label',product_name,'status',status) into v from public.factory_finished_goods where id=ref_id;
 when p_owner='factory_product_recipes' and p_field='product_family_id' then select jsonb_build_object('id',id,'label',name_en,'status',status) into v from public.factory_product_families where id=ref_id;
 when p_owner='factory_product_recipes' and p_field='recipe_id' then select jsonb_build_object('id',id,'label',recipe_name,'status',status) into v from public.factory_product_recipes where id=ref_id;
 when p_owner='factory_production' and p_field in ('production_id','record_id') then select jsonb_build_object('id',id,'label',production_no,'status',status) into v from public.factory_productions where id=ref_id;
 when p_owner='factory_job_order_records' and p_field='job_order_id' then select jsonb_build_object('id',id,'label',job_order_no,'status',status) into v from public.factory_job_orders where id=ref_id;
 when p_owner='factory_production_sop' and p_field in ('production_sop_id','sop_id','requirement_id') then select jsonb_build_object('id',id,'label',title,'status',status) into v from public.factory_production_sops where id=ref_id;
 when p_owner='factory_suppliers' and p_field='supplier_id' then select jsonb_build_object('id',id,'label',supplier_name,'status',status) into v from public.factory_suppliers where id=ref_id;
 when p_owner='factory_customers' and p_field='customer_id' then select jsonb_build_object('id',id,'label',customer_name,'status',status) into v from public.factory_customers where id=ref_id;
 else return jsonb_build_object('id',ref_id,'availability','identifier_only');
 end case;
 return coalesce(v||jsonb_build_object('basis','current_related_record'),jsonb_build_object('id',ref_id,'availability','unavailable'));
end $$;
revoke all on function feedx_integrations.navigation_reference_context(text,text,text) from public,anon,authenticated;

create or replace function feedx_integrations.navigation_project_row(p_token text,p_module text,p_resource text,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare b feedx_integrations.navigation_resources%rowtype;v jsonb;hidden text[];f record;ctx jsonb:='{}';v_context_value jsonb;begin
 select x.* into strict b from feedx_integrations.navigation_resources x join feedx_integrations.resources r on r.key=x.resource_key where x.module_id=p_module and r.slug=p_resource;
 if b.row_scope ? 'module' and p_row->>'module' is distinct from b.row_scope->>'module' then return null;end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into v from jsonb_each(p_row) where b.allowed_fields ? key;
 select coalesce(array_agg(key),'{}') into hidden from jsonb_each_text(b.relationship_modules) where not feedx_integrations.navigation_has_module(p_token,value);
 v:=v-hidden;
 for f in select key,value owner from jsonb_each_text(b.context_fields) where v ? key loop
  if jsonb_typeof(v->f.key)='array' then
   select coalesce(jsonb_agg(feedx_integrations.navigation_reference_context(f.owner,f.key,a.value)),'[]') into v_context_value from (select value from jsonb_array_elements_text(v->f.key) with ordinality a(value,n) where n<=50)a;
   if jsonb_array_length(v->f.key)>50 then ctx:=ctx||jsonb_build_object('limitation','Related labels limited to the first 50 references; original identifiers are unchanged.');end if;
  else v_context_value:=feedx_integrations.navigation_reference_context(f.owner,f.key,v->>f.key);end if;
  if v_context_value is not null then ctx:=ctx||jsonb_build_object(f.key,v_context_value);end if;
 end loop;
 if ctx<>'{}' then v:=v||jsonb_build_object('reference_context',ctx);end if;
 if b.row_scope ? 'module' and v ? 'parent_id' and jsonb_typeof(v->'parent_id')='string' then
  v:=v||jsonb_build_object('parent_id',p_module||':'||md5((case when b.row_scope->>'module'='waste_disposal' then 'evidence' else 'occurrences' end)||':'||(p_row->>'parent_id')));
 end if;
 if b.row_scope ? 'module' then v:=v||jsonb_build_object('id',p_module||':'||md5(p_resource||':'||(p_row->>'id')));end if;
 return v;
end $$;
revoke all on function feedx_integrations.navigation_project_row(text,text,text,jsonb) from public,anon,authenticated;
-- A standard's item name is intrinsic context; the core still owns active-standard eligibility.
do $$declare d text;begin
 select pg_get_functiondef('feedx_integrations.navigation_raw_control_rows(text,text,date,date)'::regprocedure) into d;
 d:=replace(d,'case when feedx_integrations.navigation_has_module(p_token,''factory_raw_inventory'') then r->>''item'' else ''Raw material control standard'' end','r->>''item''');execute d;
 -- Scope and dependency descriptions derive from the same 97 policies. Existing grants are untouched.
 select pg_get_functiondef('feedx_integrations.business_capability_catalog(uuid)'::regprocedure) into d;
 d:=replace(d,'''fields'',b.allowed_fields,','''fields'',b.allowed_fields,''context_fields'',b.context_fields,''scope_note'',''Basic related identifiers, names and current statuses only. Full related records, stock, costs and personal data are not included by reference.'',');
 d:=replace(d,'''retained_only'',v->>''module_id'' is null', '''description'',case when v->>''module_id'' is null then v->>''description'' else ''View the listed records with basic related identifiers, names and current statuses. Related full records, inventory and costs require their own access. Some reporting resources require the source capabilities listed in Review Changes.'' end,''retained_only'',v->>''module_id'' is null');
 execute d;
 select pg_get_functiondef('feedx_integrations.discovery(uuid)'::regprocedure) into d;
 d:=replace(d,'''row_scope'',b.row_scope,','''row_scope'',b.row_scope,''context_fields'',b.context_fields,''context_policy'',''Minimal identifiers, names and current statuses. No related full records, balances, costs or personal data.'',');execute d;
 select pg_get_functiondef('feedx_integrations.navigation_coverage(text)'::regprocedure) into d;
 d:=replace(d,'Only this business module. Related data and summaries require separately granted modules. Empty results do not certify completeness or compliance.','Declared records include minimal related identifiers, names and current statuses. Current related labels do not reconstruct historical master data. Full related records, balances, costs and composite summaries require their own source grants. Empty results do not certify completeness or compliance.');execute d;
end $$;
