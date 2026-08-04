-- Fixed ID snapshots for complete Factory master-data loading.
-- These functions are read-only, use explicit entity whitelists, and execute
-- with the caller's privileges so existing table grants and RLS remain active.

create or replace function public.factory_get_master_id_snapshot(p_entity text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_ids jsonb;
begin
  case lower(coalesce(p_entity, ''))
    when 'raw_materials' then
      select coalesce(jsonb_agg(row_data.id order by row_data.name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_raw_materials row_data;
    when 'raw_material_categories' then
      select coalesce(jsonb_agg(row_data.id order by row_data.name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_raw_material_categories row_data;
    when 'finished_goods' then
      select coalesce(jsonb_agg(row_data.id order by row_data.product_name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_finished_goods row_data;
    when 'finished_good_categories' then
      select coalesce(jsonb_agg(row_data.id order by row_data.name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_finished_good_categories row_data;
    when 'product_families' then
      select coalesce(jsonb_agg(row_data.id order by row_data.name_en asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_product_families row_data;
    when 'suppliers' then
      select coalesce(jsonb_agg(row_data.id order by row_data.supplier_name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_suppliers row_data;
    when 'customers' then
      select coalesce(jsonb_agg(row_data.id order by row_data.customer_name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_customers row_data;
    when 'storage_locations' then
      select coalesce(jsonb_agg(row_data.id order by row_data.location_name asc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_storage_locations row_data;
    when 'product_recipes' then
      select coalesce(jsonb_agg(row_data.id order by row_data.product_name asc, row_data.version desc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_product_recipes row_data;
    when 'active_product_recipes' then
      select coalesce(jsonb_agg(row_data.id order by row_data.product_name asc, row_data.version desc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_product_recipes row_data
      where lower(coalesce(row_data.status, '')) = 'active';
    when 'production_sops' then
      select coalesce(jsonb_agg(row_data.id order by row_data.product_name asc, row_data.version desc, row_data.id asc), '[]'::jsonb)
      into v_ids
      from public.factory_production_sops row_data;
    when 'qc_checklist_templates' then
      select coalesce(jsonb_agg(
        row_data.id
        order by row_data.is_active desc, row_data.category asc nulls last, row_data.name asc, row_data.id asc
      ), '[]'::jsonb)
      into v_ids
      from public.factory_qc_checklist_templates row_data;
    else
      raise exception 'Unsupported Factory master snapshot entity.';
  end case;

  return v_ids;
end;
$$;

create or replace function public.factory_get_master_child_snapshot(
  p_entity text,
  p_parent_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if coalesce(cardinality(p_parent_ids), 0) = 0 then
    return '[]'::jsonb;
  end if;

  case lower(coalesce(p_entity, ''))
    when 'recipe_items' then
      select coalesce(jsonb_agg(
        jsonb_build_object('id', row_data.id, 'parent_id', row_data.recipe_id)
        order by row_data.recipe_id asc, row_data.sort_order asc, row_data.id asc
      ), '[]'::jsonb)
      into v_rows
      from public.factory_product_recipe_items row_data
      where row_data.recipe_id = any(p_parent_ids);
    when 'sop_steps' then
      select coalesce(jsonb_agg(
        jsonb_build_object('id', row_data.id, 'parent_id', row_data.sop_id)
        order by row_data.sop_id asc, row_data.step_no asc, row_data.id asc
      ), '[]'::jsonb)
      into v_rows
      from public.factory_production_sop_steps row_data
      where row_data.sop_id = any(p_parent_ids);
    when 'sop_sub_steps' then
      select coalesce(jsonb_agg(
        jsonb_build_object('id', row_data.id, 'parent_id', row_data.sop_step_id)
        order by row_data.sop_step_id asc, row_data.sequence_no asc, row_data.id asc
      ), '[]'::jsonb)
      into v_rows
      from public.factory_production_sop_sub_steps row_data
      where row_data.sop_step_id = any(p_parent_ids);
    when 'sop_qc_checks' then
      select coalesce(jsonb_agg(
        jsonb_build_object('id', row_data.id, 'parent_id', row_data.sop_step_id)
        order by row_data.sop_step_id asc, row_data.sequence_no asc, row_data.id asc
      ), '[]'::jsonb)
      into v_rows
      from public.factory_production_sop_step_qc_checks row_data
      where row_data.sop_step_id = any(p_parent_ids);
    when 'sop_step_materials' then
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'sop_step_id', row_data.sop_step_id,
          'raw_material_id', row_data.raw_material_id
        )
        order by row_data.sop_step_id asc, row_data.raw_material_id asc
      ), '[]'::jsonb)
      into v_rows
      from public.factory_production_sop_step_materials row_data
      where row_data.sop_step_id = any(p_parent_ids);
    else
      raise exception 'Unsupported Factory master child snapshot entity.';
  end case;

  return v_rows;
end;
$$;

revoke all on function public.factory_get_master_id_snapshot(text) from public;
revoke all on function public.factory_get_master_child_snapshot(text, uuid[]) from public;
grant execute on function public.factory_get_master_id_snapshot(text) to authenticated;
grant execute on function public.factory_get_master_child_snapshot(text, uuid[]) to authenticated;
