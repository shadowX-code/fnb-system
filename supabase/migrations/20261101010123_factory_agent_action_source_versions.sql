-- Bind named child columns and all stock-adjustment/allocation evidence into action CAS versions.
create or replace function feedx_integrations.factory_action_state(p_action text,p_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a feedx_integrations.factory_actions%rowtype; value jsonb; child jsonb:='{}'; t text; fk text;
begin
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if p_id is null then return null; end if;
 if p_lock then execute format('select to_jsonb(t) from %s t where id=$1 for update',a.target_table) into value using p_id;
 else execute format('select to_jsonb(t) from %s t where id=$1',a.target_table) into value using p_id; end if;
 if value is null then raise exception using errcode='P0002',message='Factory action target was not found.'; end if;
 for t,fk in select child_table,foreign_key from (values
 ('factory_job_orders','factory_production_step_executions','job_order_id'),
 ('factory_job_orders','factory_production_qc_results','job_order_id'),
 ('factory_raw_material_receiving_batches','factory_raw_material_receivings','batch_id'),
 ('factory_product_stock_checks','factory_product_stock_check_items','stock_check_id'),
 ('factory_raw_material_stock_checks','factory_raw_material_stock_check_items','stock_check_id')
 ) x(parent,child_table,foreign_key) where parent=a.target_table::text
 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]''::jsonb) from public.%I t where %I=$1',t,fk) into child using p_id;
  value:=value||jsonb_build_object(t,child);
 end loop;
 if a.target_table='public.factory_product_stock_checks'::regclass then
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into child
  from public.factory_product_stock_check_batch_adjustments b join public.factory_product_stock_check_items i on i.id=b.stock_check_item_id where i.stock_check_id=p_id;
  value:=value||jsonb_build_object('batch_adjustments',child);
 elsif a.target_table='public.factory_raw_material_stock_checks'::regclass then
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into child
  from public.factory_raw_material_stock_check_batch_allocations b join public.factory_raw_material_stock_check_items i on i.id=b.stock_check_item_id where i.stock_check_id=p_id;
  value:=value||jsonb_build_object('batch_allocations',child);
 end if;
 return value;
end $$;
notify pgrst,'reload schema';
