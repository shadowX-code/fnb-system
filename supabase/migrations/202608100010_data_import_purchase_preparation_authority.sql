-- Request-bound, idempotent Purchase Import master-data preparation.

create unique index if not exists purchase_categories_normalized_name_unique
  on public.purchase_categories (lower(btrim(name)));
create unique index if not exists suppliers_normalized_name_unique
  on public.suppliers (lower(btrim(name)));

create or replace function public.import_prepare_purchase_masters(
  p_request_id uuid,
  p_categories jsonb,
  p_suppliers jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_batch public.import_batches%rowtype; v_category jsonb; v_supplier jsonb;
  v_category_id uuid; v_supplier_id uuid; v_category_map jsonb := '{}'::jsonb; v_supplier_map jsonb := '{}'::jsonb;
  v_category_key text; v_supplier_key text; v_category_name text; v_supplier_name text; v_outlet_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if not public.current_user_has_permission('purchase_input.import') then raise exception using errcode='42501', message='Missing permission to import purchases.'; end if;
  select * into v_batch from public.import_batches where request_id=p_request_id and lower(import_type)='purchase' for update;
  if not found then raise exception 'Purchase import request was not initialized.'; end if;

  for v_category in select value from jsonb_array_elements(coalesce(p_categories,'[]'::jsonb)) loop
    v_category_key := nullif(btrim(v_category->>'source_key'),''); v_category_name := nullif(regexp_replace(btrim(v_category->>'name'),'\s+',' ','g'),'');
    if v_category_key is null or v_category_name is null then raise exception 'Purchase category preparation requires a stable source key and name.'; end if;
    select id into v_category_id from public.purchase_categories where lower(btrim(name))=lower(v_category_name) limit 1;
    if v_category_id is null then
      if not public.current_user_has_permission('purchase_categories.create') then raise exception using errcode='42501', message='Missing permission to create purchase categories during import.'; end if;
      insert into public.purchase_categories(name,sort_order,is_active,status,updated_at) values(v_category_name,0,true,'active',now()) returning id into v_category_id;
    end if;
    v_category_map := v_category_map || jsonb_build_object(v_category_key,v_category_id);
  end loop;

  for v_supplier in select value from jsonb_array_elements(coalesce(p_suppliers,'[]'::jsonb)) loop
    v_supplier_key := nullif(btrim(v_supplier->>'source_key'),''); v_supplier_name := nullif(regexp_replace(btrim(v_supplier->>'name'),'\s+',' ','g'),'');
    v_category_key := nullif(btrim(v_supplier->>'category_source_key'),''); v_category_id := nullif(v_category_map->>v_category_key,'')::uuid;
    v_outlet_id := nullif(v_supplier->>'outlet_id','')::uuid;
    if v_supplier_key is null or v_supplier_name is null or v_category_id is null or v_outlet_id is null then raise exception 'Supplier preparation requires stable supplier/category keys and outlet.'; end if;
    if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501', message='You cannot prepare a supplier for this outlet.'; end if;
    select id into v_supplier_id from public.suppliers where lower(btrim(name))=lower(v_supplier_name) limit 1;
    if v_supplier_id is null then
      if not public.current_user_has_permission('suppliers.create') then raise exception using errcode='42501', message='Missing permission to create suppliers during import.'; end if;
      insert into public.suppliers(name,default_category_id,is_active,status,updated_at) values(v_supplier_name,v_category_id,true,'active',now()) returning id into v_supplier_id;
    end if;
    insert into public.supplier_outlets(supplier_id,outlet_id) values(v_supplier_id,v_outlet_id) on conflict do nothing;
    v_supplier_map := v_supplier_map || jsonb_build_object(v_supplier_key,v_supplier_id);
  end loop;
  return jsonb_build_object('request_id',p_request_id,'categories',v_category_map,'suppliers',v_supplier_map);
end; $$;

revoke all on function public.import_prepare_purchase_masters(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.import_prepare_purchase_masters(uuid,jsonb,jsonb) to authenticated;
