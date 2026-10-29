-- MeSTI evidence alignment only; no Factory records, keys or role grants change.
do $share$
declare spec record;body text;original text;replacement text;wrapper text;gate text:='public.current_user_has_permission(''factory_raw_receiving.view'')';
begin
 for spec in select * from(values
 ('factory_mesti_raw_material_control_standards','','',''),
 ('factory_mesti_raw_material_control_receiving_report','date,date,uuid,uuid,uuid,text,text','p_date_from date,p_date_to date,p_raw_material_id uuid,p_supplier_id uuid,p_storage_location_id uuid,p_verification_status text,p_search text','p_date_from,p_date_to,p_raw_material_id,p_supplier_id,p_storage_location_id,p_verification_status,p_search')
 )s(name,argtypes,args,params) loop
  select prosrc,pg_get_functiondef(oid) into strict body,original from pg_proc where oid=to_regprocedure('public.'||spec.name||'('||spec.argtypes||')');
  if strpos(body,gate)=0 or strpos(body,'auth.uid() is not null')=0 then raise exception 'Canonical Raw Material Control gate changed; re-audit';end if;
  replacement:='(case when p_gateway_token is null then '||gate||' else feedx_integrations.navigation_has_module(p_gateway_token,''factory_mesti_raw_material_control'') end)';
  body:=replace(replace(body,gate,replacement),'auth.uid() is not null','(auth.uid() is not null or p_gateway_token is not null)');
  execute format('create function feedx_integrations.%I(%s%sp_gateway_token text) returns jsonb language sql stable security invoker set search_path=public,pg_temp as %L',spec.name||'_core',spec.args,case when spec.args='' then '' else ',' end,body);
  execute format('revoke all on function feedx_integrations.%I(%s%stext) from public,anon,authenticated',spec.name||'_core',spec.argtypes,case when spec.argtypes='' then '' else ',' end);
  wrapper:='select feedx_integrations.'||spec.name||'_core('||spec.params||case when spec.params='' then '' else ',' end||'null)';
  execute regexp_replace(original,'AS \$function\$[\s\S]*\$function\$', 'AS $function$'||wrapper||'$function$');
 end loop;
end $share$;

create function feedx_integrations.navigation_cleaning_method(p_method text,p_reference jsonb) returns jsonb language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('cleaning_method',p_method,'method_availability',case when p_method is null then 'unavailable' else 'recorded' end,'cleaning_method_reference',
 case when jsonb_typeof(p_reference)='object' then (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_reference) where
 (key in ('code','name','verification') and jsonb_typeof(value)='string') or
 (key='reference_version' and jsonb_typeof(value)='number') or (key='reference_only' and jsonb_typeof(value)='boolean') or
 (key in ('materials','steps') and jsonb_typeof(value)='array' and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(value)='array' then value else '[]' end)e where jsonb_typeof(e)<>'string'))
 ) else null end);
$$;
revoke all on function feedx_integrations.navigation_cleaning_method(text,jsonb) from public,anon,authenticated;

create function feedx_integrations.navigation_cleaning_rows(p_scope text,p_resource text,p_from date,p_to date) returns setof jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_scope='cleaning_of_area' then
  return query select v||feedx_integrations.navigation_cleaning_method(case when p_resource='requirements' then r.cleaning_method else o.requirement_snapshot->>'cleaning_method' end,case when p_resource='requirements' then r.cleaning_method_reference else o.requirement_snapshot->'cleaning_method_reference' end)||jsonb_build_object('method_basis',case when p_resource='requirements' then 'versioned_requirement' else 'issued_snapshot' end)
  from feedx_integrations.mesti_resource_rows(p_resource,p_from,p_to)v left join public.factory_mesti_cleaning_requirements r on r.id::text=v->>'requirement_id' left join public.factory_mesti_cleaning_occurrences o on o.id::text=v->>'record_id' where v->>'module'=p_scope limit 5001;
 else
  return query select v||feedx_integrations.navigation_cleaning_method(case when p_resource='requirements' then r.cleaning_method else o.requirement_snapshot->>'cleaning_method' end,case when p_resource='requirements' then r.cleaning_method_reference else o.requirement_snapshot->'cleaning_method_reference' end)||jsonb_build_object('method_basis',case when p_resource='requirements' then 'versioned_requirement' else 'issued_snapshot' end)
  from feedx_integrations.mesti_resource_rows(p_resource,p_from,p_to)v left join public.factory_mesti_equipment_cleaning_requirements r on r.id::text=v->>'requirement_id' left join public.factory_mesti_equipment_cleaning_occurrences o on o.id::text=v->>'record_id' where v->>'module'=p_scope limit 5001;
 end if;
end $$;
revoke all on function feedx_integrations.navigation_cleaning_rows(text,text,date,date) from public,anon,authenticated;

create function feedx_integrations.navigation_raw_control_rows(p_token text,p_resource text,p_from date,p_to date) returns setof jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_resource='raw_control_standards' then
  return query select jsonb_build_object('id',r->'raw_material_id','label',case when feedx_integrations.navigation_has_module(p_token,'factory_raw_inventory') then r->>'item' else 'Raw material control standard' end,'module','MeSTI','material_code',r->'material_code','name',r->'item','status','active','acceptance_procedure',r->'acceptance_procedure','control_methods',r->'control_methods') from jsonb_array_elements(feedx_integrations.factory_mesti_raw_material_control_standards_core(p_token))r limit 5001;
 else
  return query select jsonb_build_object('id',r->'id','label','Raw material control evidence','module','MeSTI','business_date',r->'received_date','receipt_no',i.receipt_no,'receiving_no',r->'receiving_no','batch_id',r->'batch_id','raw_material_id',r->'raw_material_id','supplier_id',r->'supplier_id','storage_location_id',r->'storage_location_id','received_date',r->'received_date','received_qty',r->'received_qty','uom',r->'uom','status',r->'status','verification_status',r->'verification_status','verified_at',r->'verified_at','expiry_date',i.expiry_date,'expiry_source',i.expiry_source,'expiry_confirmed',i.expiry_confirmed,'acceptance_procedure_snapshot',r->'acceptance_procedure_snapshot','control_methods_snapshot',r->'control_methods_snapshot') from jsonb_array_elements(feedx_integrations.factory_mesti_raw_material_control_receiving_report_core(p_from,p_to,null,null,null,null,null,p_token))r join public.factory_raw_material_receivings i on i.id::text=r->>'id' limit 5001;
 end if;
end $$;
revoke all on function feedx_integrations.navigation_raw_control_rows(text,text,date,date) from public,anon,authenticated;

-- Extend the single owning dispatcher; no parallel fallback/read authority.
do $route$
declare definition text;anchor text:=' elsif scope ? ''module'' then';replacement text:=$body$
 elsif p_module='factory_mesti_raw_material_control' and p_resource in ('raw_control_standards','raw_control_receipts') then
  return query select * from feedx_integrations.navigation_raw_control_rows(p_token,p_resource,p_from,p_to);
 elsif p_module in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning') and p_resource in ('requirements','occurrences','evidence') then
  return query select * from feedx_integrations.navigation_cleaning_rows(scope->>'module',p_resource,p_from,p_to);
$body$;
begin
 select pg_get_functiondef('feedx_integrations.navigation_source_rows(text,text,text,date,date)'::regprocedure) into definition;
 if strpos(definition,anchor)=0 then raise exception 'Gateway dispatcher drifted';end if;
 execute replace(definition,anchor,replacement||anchor);
end $route$;
update feedx_integrations.navigation_resources set allowed_fields=allowed_fields||'["cleaning_method","cleaning_method_reference","method_availability","method_basis"]' where module_id in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning') and resource_key in ('factory.mesti.requirements','factory.mesti.occurrences','factory.mesti.evidence');
update feedx_integrations.navigation_resources set relationship_modules=relationship_modules||'{"name":"factory_raw_inventory","material_code":"factory_raw_inventory"}' where module_id='factory_mesti_raw_material_control' and resource_key='factory.raw_control_standards';
update feedx_integrations.navigation_resources set allowed_fields=allowed_fields||'["receiving_no","batch_id","raw_material_id","supplier_id","storage_location_id","received_qty","uom","status","verification_status","verified_at"]',relationship_modules='{"receipt_no":"factory_raw_receiving","receiving_no":"factory_raw_receiving","batch_id":"factory_raw_receiving","raw_material_id":"factory_raw_inventory","supplier_id":"factory_suppliers","storage_location_id":"factory_storage_locations"}' where module_id='factory_mesti_raw_material_control' and resource_key='factory.raw_control_receipts';
update feedx_integrations.navigation_modules set explanation='Area-cleaning requirement versions, recurrence, saved states and redacted proof with recorded Cleaning Method reference procedures. Issued records use their saved method snapshot; legacy unspecified methods remain unavailable. Locations require separate access.' where id='factory_mesti_cleaning';
update feedx_integrations.navigation_modules set explanation='Equipment-cleaning requirement versions, recurrence, saved states and redacted proof with recorded Cleaning Method reference procedures. Issued records use their saved method snapshot; legacy unspecified methods remain unavailable. Equipment and Production identities require separate access.' where id='factory_mesti_equipment_cleaning';
update feedx_integrations.navigation_modules set explanation='Canonical active acceptance/control standards and completed Receiving evidence, including saved verification state and frozen guidance. Material, Receiving, Supplier and Location identities require their own modules. No stock balances, costs, contacts or actors.' where id='factory_mesti_raw_material_control';
update feedx_integrations.capabilities c set description=n.explanation from feedx_integrations.navigation_modules n where n.id=c.navigation_module_id and n.id in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning','factory_mesti_raw_material_control');
update public.permissions p set description='View Records: '||n.explanation from feedx_integrations.capabilities c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id where p.code=c.permission_code and n.id in ('factory_mesti_cleaning','factory_mesti_equipment_cleaning','factory_mesti_raw_material_control');
update feedx_integrations.resources set filter_fields=filter_fields||'["status","verification_status"]',date_semantics='Canonical completed Receiving document business date; draft/cancelled documents are excluded. Saved verification and frozen guidance only.' where slug='raw_control_receipts';
