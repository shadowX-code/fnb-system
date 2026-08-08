-- Align Factory master-data and lifecycle authority with the existing Role Setting catalog.
-- This migration changes permissions only; it does not rewrite inventory or history.

-- Finished Goods and Packaging SKU master rows are writable only through their
-- own create/edit permissions. Operational lifecycle RPCs retain owner-level
-- SECURITY DEFINER access for system-maintained inventory fields.
drop policy if exists "factory finished goods manage" on public.factory_finished_goods;
drop policy if exists "factory finished goods production stock in" on public.factory_finished_goods;
drop policy if exists "factory finished goods insert" on public.factory_finished_goods;
drop policy if exists "factory finished goods update" on public.factory_finished_goods;
drop policy if exists "factory finished goods delete" on public.factory_finished_goods;

create policy "factory finished goods insert"
on public.factory_finished_goods for insert to authenticated
with check (public.current_user_has_permission('factory_finished_goods.create'));

create policy "factory finished goods update"
on public.factory_finished_goods for update to authenticated
using (public.current_user_has_permission('factory_finished_goods.edit'))
with check (public.current_user_has_permission('factory_finished_goods.edit'));

revoke delete on table public.factory_finished_goods from authenticated;

drop policy if exists "factory product families insert" on public.factory_product_families;
drop policy if exists "factory product families update" on public.factory_product_families;
drop policy if exists "factory product families delete" on public.factory_product_families;

create policy "factory product families insert"
on public.factory_product_families for insert to authenticated
with check (public.current_user_has_permission('factory_finished_goods.create'));

create policy "factory product families update"
on public.factory_product_families for update to authenticated
using (public.current_user_has_permission('factory_finished_goods.edit'))
with check (public.current_user_has_permission('factory_finished_goods.edit'));

revoke delete on table public.factory_product_families from authenticated;

drop policy if exists "factory finished good categories manage" on public.factory_finished_good_categories;
drop policy if exists "factory finished good categories insert" on public.factory_finished_good_categories;
drop policy if exists "factory finished good categories update" on public.factory_finished_good_categories;
drop policy if exists "factory finished good categories delete" on public.factory_finished_good_categories;

create policy "factory finished good categories insert"
on public.factory_finished_good_categories for insert to authenticated
with check (public.current_user_has_permission('factory_finished_goods.create'));

create policy "factory finished good categories update"
on public.factory_finished_good_categories for update to authenticated
using (public.current_user_has_permission('factory_finished_goods.edit'))
with check (public.current_user_has_permission('factory_finished_goods.edit'));

revoke delete on table public.factory_finished_good_categories from authenticated;

-- Raw Material master metadata follows only Raw Material Inventory create/edit.
drop policy if exists "factory raw materials update" on public.factory_raw_materials;
create policy "factory raw materials update"
on public.factory_raw_materials for update to authenticated
using (public.current_user_has_permission('factory_raw_inventory.edit'))
with check (public.current_user_has_permission('factory_raw_inventory.edit'));

revoke delete on table public.factory_raw_materials from authenticated;

drop policy if exists "factory raw material categories manage" on public.factory_raw_material_categories;
drop policy if exists "factory raw material categories insert" on public.factory_raw_material_categories;
drop policy if exists "factory raw material categories update" on public.factory_raw_material_categories;
drop policy if exists "factory raw material categories delete" on public.factory_raw_material_categories;

create policy "factory raw material categories insert"
on public.factory_raw_material_categories for insert to authenticated
with check (public.current_user_has_permission('factory_raw_inventory.create'));

create policy "factory raw material categories update"
on public.factory_raw_material_categories for update to authenticated
using (public.current_user_has_permission('factory_raw_inventory.edit'))
with check (public.current_user_has_permission('factory_raw_inventory.edit'));

revoke delete on table public.factory_raw_material_categories from authenticated;

-- Raw Material image object actions mirror their corresponding master action.
drop policy if exists "factory raw material image editors can upload" on storage.objects;
create policy "factory raw material image editors can upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-material-images'
  and public.current_user_has_permission('factory_raw_inventory.create')
);

drop policy if exists "factory raw material image editors can update" on storage.objects;
create policy "factory raw material image editors can update"
on storage.objects for update to authenticated
using (
  bucket_id = 'raw-material-images'
  and public.current_user_has_permission('factory_raw_inventory.edit')
)
with check (
  bucket_id = 'raw-material-images'
  and public.current_user_has_permission('factory_raw_inventory.edit')
);

drop policy if exists "factory raw material image editors can delete" on storage.objects;
create policy "factory raw material image editors can delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'raw-material-images'
  and public.current_user_has_permission('factory_raw_inventory.edit')
);

-- Storage Location actions are operation-specific. Manage remains the explicit
-- umbrella permission; Create/Edit/Delete no longer imply one another.
drop policy if exists "factory storage locations manage" on public.factory_storage_locations;
drop policy if exists "factory storage locations insert" on public.factory_storage_locations;
drop policy if exists "factory storage locations update" on public.factory_storage_locations;
drop policy if exists "factory storage locations delete" on public.factory_storage_locations;

create policy "factory storage locations insert"
on public.factory_storage_locations for insert to authenticated
with check (
  public.current_user_has_permission('factory_storage_locations.create')
  or public.current_user_has_permission('factory_storage_locations.manage')
);

create policy "factory storage locations update"
on public.factory_storage_locations for update to authenticated
using (
  public.current_user_has_permission('factory_storage_locations.edit')
  or public.current_user_has_permission('factory_storage_locations.manage')
)
with check (
  public.current_user_has_permission('factory_storage_locations.edit')
  or public.current_user_has_permission('factory_storage_locations.manage')
);

create policy "factory storage locations delete"
on public.factory_storage_locations for delete to authenticated
using (
  public.current_user_has_permission('factory_storage_locations.delete')
  or public.current_user_has_permission('factory_storage_locations.manage')
);

-- Production Start keeps its compatibility actor parameters but ignores them.
-- The authenticated active employee is both the lifecycle actor and operator.
create or replace function public.factory_start_job_order(
  p_job_order_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_production_date date,
  p_start_time time,
  p_remarks text,
  p_started_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_actor_id uuid;
  v_actor_name text;
begin
  v_actor_id := public.factory_current_active_employee_id();
  v_actor_name := public.factory_current_active_employee_name();

  if not public.current_user_has_permission('factory_production.complete') then
    raise exception using errcode = '42501', message = 'Missing permission to start Production.';
  end if;

  select job_order.* into v_job_order
  from public.factory_job_orders job_order
  where job_order.id = p_job_order_id
  for update;

  if v_job_order.id is null then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'released' then
    raise exception 'Only Released Job Orders can start Production.';
  end if;

  update public.factory_job_orders
  set status = 'in_progress',
      started_at = now(),
      started_by = v_actor_id,
      production_operator_id = v_actor_id,
      production_operator_name = v_actor_name,
      production_date = coalesce(p_production_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
      start_time = p_start_time,
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then remarks
        when coalesce(btrim(remarks), '') = '' then btrim(p_remarks)
        else remarks || E'\n' || btrim(p_remarks)
      end,
      updated_at = now()
  where id = p_job_order_id;
end;
$$;

revoke all on function public.factory_start_job_order(uuid, uuid, text, date, time without time zone, text, uuid)
from public, anon;
grant execute on function public.factory_start_job_order(uuid, uuid, text, date, time without time zone, text, uuid)
to authenticated;

-- Production completion fingerprints and stores a server-canonicalized
-- authenticated employee. The exact deployed transaction implementation is
-- retained privately and receives no client-supplied operator authority.
alter function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
rename to factory_complete_production_with_raw_batch_allocations_impl_050031;

revoke all on function public.factory_complete_production_with_raw_batch_allocations_impl_050031(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.factory_complete_production_with_raw_batch_allocations(
  p_request_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
  v_employee_name text;
  v_authoritative_payload jsonb;
begin
  v_employee_id := public.factory_current_active_employee_id();
  v_employee_name := public.factory_current_active_employee_name();
  v_authoritative_payload := (
    p_payload - 'operator_id' - 'operator_name'
  ) || jsonb_build_object(
    'operator_id', v_employee_id,
    'operator_name', v_employee_name
  );

  return public.factory_complete_production_with_raw_batch_allocations_impl_050031(
    p_request_id,
    v_authoritative_payload
  );
end;
$$;

revoke all on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
to authenticated;

-- Recipe Archive is an Edit/Manage lifecycle transition. Delete remains for
-- deleting Drafts and is not an authority to archive an Active recipe.
drop policy if exists "factory product recipes update" on public.factory_product_recipes;
create policy "factory product recipes update"
on public.factory_product_recipes for update to authenticated
using (
  (
    public.current_user_has_permission('factory_product_recipes.edit')
    or public.current_user_has_permission('factory_product_recipes.manage')
  )
  and lower(btrim(coalesce(status, ''))) <> 'active'
)
with check (
  (
    public.current_user_has_permission('factory_product_recipes.edit')
    or public.current_user_has_permission('factory_product_recipes.manage')
  )
  and lower(btrim(coalesce(status, ''))) <> 'active'
);

create or replace function public.factory_archive_product_recipe(p_recipe_id uuid)
returns table(recipe_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipe public.factory_product_recipes%rowtype;
begin
  perform public.factory_current_active_employee_id();
  if not (
    public.current_user_has_permission('factory_product_recipes.edit')
    or public.current_user_has_permission('factory_product_recipes.manage')
  ) then
    raise exception using errcode = '42501', message = 'Missing permission to archive Product Recipe.';
  end if;

  select recipe.* into v_recipe
  from public.factory_product_recipes recipe
  where recipe.id = p_recipe_id
  for update;
  if v_recipe.id is null then raise exception 'Product Recipe was not found.'; end if;
  if lower(coalesce(v_recipe.status, '')) not in ('active', 'draft') then
    raise exception 'Only Active or Draft Product Recipes can be archived.';
  end if;

  update public.factory_product_recipes recipe
  set status = 'archived', updated_at = now()
  where recipe.id = v_recipe.id;
  return query select v_recipe.id;
end;
$$;

revoke all on function public.factory_archive_product_recipe(uuid) from public, anon;
grant execute on function public.factory_archive_product_recipe(uuid) to authenticated;

-- Preserve the exact currently deployed lifecycle implementations under
-- private names. Explicit entrypoints below add active-employee authority
-- without parsing or reconstructing function source text.
alter function public.factory_activate_product_recipe(uuid)
rename to factory_activate_product_recipe_impl_050031;
alter function public.factory_create_product_recipe_new_version(uuid)
rename to factory_create_product_recipe_new_version_impl_050031;
alter function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid)
rename to factory_save_production_sop_structure_impl_050031;
alter function public.factory_activate_production_sop(uuid)
rename to factory_activate_production_sop_impl_050031;
alter function public.factory_archive_production_sop(uuid)
rename to factory_archive_production_sop_impl_050031;
alter function public.factory_restore_production_sop(uuid)
rename to factory_restore_production_sop_impl_050031;
alter function public.factory_create_production_sop_new_version(uuid)
rename to factory_create_production_sop_new_version_impl_050031;
alter function public.factory_create_qc_checklist_template(text, text, text, uuid)
rename to factory_create_qc_checklist_template_impl_050031;
alter function public.factory_update_qc_checklist_template(uuid, text, text, text)
rename to factory_update_qc_checklist_template_impl_050031;
alter function public.factory_archive_qc_checklist_template(uuid)
rename to factory_archive_qc_checklist_template_impl_050031;
alter function public.factory_restore_qc_checklist_template(uuid)
rename to factory_restore_qc_checklist_template_impl_050031;
alter function public.factory_delete_qc_checklist_template(uuid)
rename to factory_delete_qc_checklist_template_impl_050031;

revoke all on function public.factory_activate_product_recipe_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_create_product_recipe_new_version_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_save_production_sop_structure_impl_050031(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.factory_activate_production_sop_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_archive_production_sop_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_restore_production_sop_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_create_production_sop_new_version_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_create_qc_checklist_template_impl_050031(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.factory_update_qc_checklist_template_impl_050031(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.factory_archive_qc_checklist_template_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_restore_qc_checklist_template_impl_050031(uuid) from public, anon, authenticated;
revoke all on function public.factory_delete_qc_checklist_template_impl_050031(uuid) from public, anon, authenticated;

create or replace function public.factory_activate_product_recipe(p_recipe_id uuid)
returns table(recipe_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return query
  select result.recipe_id
  from public.factory_activate_product_recipe_impl_050031(p_recipe_id) result;
end;
$$;

create or replace function public.factory_create_product_recipe_new_version(p_source_recipe_id uuid)
returns table(recipe_id uuid, version text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return query
  select result.recipe_id, result.version
  from public.factory_create_product_recipe_new_version_impl_050031(p_source_recipe_id) result;
end;
$$;

create or replace function public.factory_save_production_sop_structure(
  p_sop_id uuid,
  p_finished_good_id uuid,
  p_title text,
  p_effective_date date,
  p_remarks text,
  p_recipe_id uuid,
  p_recipe_version text,
  p_steps jsonb,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
begin
  v_employee_id := public.factory_current_active_employee_id();
  return public.factory_save_production_sop_structure_impl_050031(
    p_sop_id,
    p_finished_good_id,
    p_title,
    p_effective_date,
    p_remarks,
    p_recipe_id,
    p_recipe_version,
    p_steps,
    v_employee_id
  );
end;
$$;

create or replace function public.factory_activate_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_activate_production_sop_impl_050031(p_sop_id);
end;
$$;

create or replace function public.factory_archive_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_archive_production_sop_impl_050031(p_sop_id);
end;
$$;

create or replace function public.factory_restore_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_restore_production_sop_impl_050031(p_sop_id);
end;
$$;

create or replace function public.factory_create_production_sop_new_version(p_source_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_create_production_sop_new_version_impl_050031(p_source_sop_id);
end;
$$;

create or replace function public.factory_create_qc_checklist_template(
  p_name text,
  p_result_mode text,
  p_description text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
begin
  v_employee_id := public.factory_current_active_employee_id();
  return public.factory_create_qc_checklist_template_impl_050031(
    p_name,
    p_result_mode,
    p_description,
    v_employee_id
  );
end;
$$;

create or replace function public.factory_update_qc_checklist_template(
  p_template_id uuid,
  p_name text,
  p_result_mode text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_update_qc_checklist_template_impl_050031(
    p_template_id,
    p_name,
    p_result_mode,
    p_description
  );
end;
$$;

create or replace function public.factory_archive_qc_checklist_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_archive_qc_checklist_template_impl_050031(p_template_id);
end;
$$;

create or replace function public.factory_restore_qc_checklist_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  return public.factory_restore_qc_checklist_template_impl_050031(p_template_id);
end;
$$;

create or replace function public.factory_delete_qc_checklist_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.factory_current_active_employee_id();
  perform public.factory_delete_qc_checklist_template_impl_050031(p_template_id);
end;
$$;

revoke all on function public.factory_activate_product_recipe(uuid) from public, anon;
revoke all on function public.factory_create_product_recipe_new_version(uuid) from public, anon;
revoke all on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) from public, anon;
revoke all on function public.factory_activate_production_sop(uuid) from public, anon;
revoke all on function public.factory_archive_production_sop(uuid) from public, anon;
revoke all on function public.factory_restore_production_sop(uuid) from public, anon;
revoke all on function public.factory_create_production_sop_new_version(uuid) from public, anon;
revoke all on function public.factory_create_qc_checklist_template(text, text, text, uuid) from public, anon;
revoke all on function public.factory_update_qc_checklist_template(uuid, text, text, text) from public, anon;
revoke all on function public.factory_archive_qc_checklist_template(uuid) from public, anon;
revoke all on function public.factory_restore_qc_checklist_template(uuid) from public, anon;
revoke all on function public.factory_delete_qc_checklist_template(uuid) from public, anon;

grant execute on function public.factory_activate_product_recipe(uuid) to authenticated;
grant execute on function public.factory_create_product_recipe_new_version(uuid) to authenticated;
grant execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.factory_activate_production_sop(uuid) to authenticated;
grant execute on function public.factory_archive_production_sop(uuid) to authenticated;
grant execute on function public.factory_restore_production_sop(uuid) to authenticated;
grant execute on function public.factory_create_production_sop_new_version(uuid) to authenticated;
grant execute on function public.factory_create_qc_checklist_template(text, text, text, uuid) to authenticated;
grant execute on function public.factory_update_qc_checklist_template(uuid, text, text, text) to authenticated;
grant execute on function public.factory_archive_qc_checklist_template(uuid) to authenticated;
grant execute on function public.factory_restore_qc_checklist_template(uuid) to authenticated;
grant execute on function public.factory_delete_qc_checklist_template(uuid) to authenticated;

-- Fail migration review if the effective direct-write policies retain any
-- audited operational permission as master-data authority.
do $migration$
begin
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('factory_finished_goods', 'factory_product_families')
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and coalesce(policy.qual, '') || coalesce(policy.with_check, '') ~
        'factory_(production\.complete|product_stock_check\.approve)'
  ) then
    raise exception 'Finished Goods master policy still grants operational write authority.';
  end if;

  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'factory_raw_materials'
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and coalesce(policy.qual, '') || coalesce(policy.with_check, '') ~
        'factory_(raw_receiving\.(create|edit)|production\.complete|raw_stock_check\.approve)'
  ) then
    raise exception 'Raw Material master policy still grants operational write authority.';
  end if;
end;
$migration$;
