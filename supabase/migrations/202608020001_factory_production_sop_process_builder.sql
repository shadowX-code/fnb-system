-- Production SOP process builder foundation.
-- Recipe/BOM data remains read-only; SOP ingredient links are references only.

alter table public.factory_production_sops
  add column if not exists recipe_id uuid references public.factory_product_recipes(id) on delete set null,
  add column if not exists recipe_version text;

alter table public.factory_production_sop_steps
  add column if not exists qc_measurement_type text,
  add column if not exists qc_target_value text,
  add column if not exists qc_minimum numeric,
  add column if not exists qc_maximum numeric,
  add column if not exists qc_uom text,
  add column if not exists qc_required_before_completion boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'factory_production_sop_steps_qc_measurement_type_check'
      and conrelid = 'public.factory_production_sop_steps'::regclass
  ) then
    alter table public.factory_production_sop_steps
      add constraint factory_production_sop_steps_qc_measurement_type_check
      check (
        qc_measurement_type is null
        or lower(qc_measurement_type) in ('numeric', 'pass_fail', 'text', 'checklist')
      ) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'factory_production_sop_steps_qc_range_check'
      and conrelid = 'public.factory_production_sop_steps'::regclass
  ) then
    alter table public.factory_production_sop_steps
      add constraint factory_production_sop_steps_qc_range_check
      check (qc_minimum is null or qc_maximum is null or qc_minimum <= qc_maximum) not valid;
  end if;
end $$;

create table if not exists public.factory_production_sop_sub_steps (
  id uuid primary key default gen_random_uuid(),
  sop_step_id uuid not null references public.factory_production_sop_steps(id) on delete cascade,
  sequence_no integer not null,
  instruction text not null,
  estimated_minutes integer,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_production_sop_sub_steps_sequence_positive check (sequence_no > 0),
  constraint factory_production_sop_sub_steps_estimated_minutes_nonnegative check (estimated_minutes is null or estimated_minutes >= 0),
  constraint factory_production_sop_sub_steps_instruction_required check (btrim(instruction) <> ''),
  unique (sop_step_id, sequence_no)
);

create table if not exists public.factory_production_sop_step_materials (
  sop_step_id uuid not null references public.factory_production_sop_steps(id) on delete cascade,
  raw_material_id uuid not null references public.factory_raw_materials(id),
  created_at timestamptz not null default now(),
  primary key (sop_step_id, raw_material_id)
);

create index if not exists factory_production_sops_recipe_id_idx
  on public.factory_production_sops(recipe_id);

create index if not exists factory_production_sop_sub_steps_step_idx
  on public.factory_production_sop_sub_steps(sop_step_id, sequence_no);

create index if not exists factory_production_sop_step_materials_material_idx
  on public.factory_production_sop_step_materials(raw_material_id);

alter table public.factory_production_sop_sub_steps enable row level security;
alter table public.factory_production_sop_step_materials enable row level security;

grant select on public.factory_production_sop_sub_steps to authenticated;
grant select on public.factory_production_sop_step_materials to authenticated;

drop policy if exists "factory sop sub steps view" on public.factory_production_sop_sub_steps;
create policy "factory sop sub steps view" on public.factory_production_sop_sub_steps
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  and exists (
    select 1
    from public.factory_production_sop_steps step
    join public.factory_production_sops sop on sop.id = step.sop_id
    where step.id = sop_step_id
  )
);

drop policy if exists "factory sop step materials view" on public.factory_production_sop_step_materials;
create policy "factory sop step materials view" on public.factory_production_sop_step_materials
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  and exists (
    select 1
    from public.factory_production_sop_steps step
    join public.factory_production_sops sop on sop.id = step.sop_id
    where step.id = sop_step_id
  )
);

-- SOP structure and lifecycle writes are controlled by permission-checking RPCs.
revoke insert, update on public.factory_production_sops from authenticated;
revoke insert, update, delete on public.factory_production_sop_steps from authenticated;
revoke insert, update, delete on public.factory_production_sop_sub_steps from authenticated;
revoke insert, update, delete on public.factory_production_sop_step_materials from authenticated;

drop policy if exists "factory sops insert draft archived" on public.factory_production_sops;
drop policy if exists "factory sops update draft" on public.factory_production_sops;
drop policy if exists "factory sops archive active" on public.factory_production_sops;
drop policy if exists "factory sops restore archived" on public.factory_production_sops;
drop policy if exists "factory sop steps insert draft parent" on public.factory_production_sop_steps;
drop policy if exists "factory sop steps update draft parent" on public.factory_production_sop_steps;
drop policy if exists "factory sop steps delete draft parent" on public.factory_production_sop_steps;
drop policy if exists "factory sop sub steps insert draft parent" on public.factory_production_sop_sub_steps;
drop policy if exists "factory sop sub steps update draft parent" on public.factory_production_sop_sub_steps;
drop policy if exists "factory sop sub steps delete draft parent" on public.factory_production_sop_sub_steps;
drop policy if exists "factory sop step materials insert draft parent" on public.factory_production_sop_step_materials;
drop policy if exists "factory sop step materials update draft parent" on public.factory_production_sop_step_materials;
drop policy if exists "factory sop step materials delete draft parent" on public.factory_production_sop_step_materials;

create or replace function public.factory_validate_production_sop_header()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe_version text;
  v_recipe_finished_good_id uuid;
begin
  if tg_op = 'UPDATE' and lower(coalesce(old.status, '')) in ('active', 'archived') then
    if (to_jsonb(new) - array['status', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'updated_at']) then
      raise exception 'Active and archived Production SOP content is immutable.';
    end if;

    if lower(coalesce(old.status, '')) = 'active'
       and lower(coalesce(new.status, '')) <> 'archived' then
      raise exception 'An active Production SOP can only transition to archived.';
    end if;

    if lower(coalesce(old.status, '')) = 'archived'
       and lower(coalesce(new.status, '')) <> 'draft' then
      raise exception 'An archived Production SOP can only be restored to draft.';
    end if;
  end if;

  if new.recipe_id is not null then
    select recipe.version, recipe.product_family_id
    into v_recipe_version, v_recipe_finished_good_id
    from public.factory_product_recipes recipe
    where recipe.id = new.recipe_id;

    if not found then
      raise exception 'Linked Product Recipe not found.';
    end if;

    if new.finished_good_id is null or v_recipe_finished_good_id is distinct from new.finished_good_id then
      raise exception 'Linked Product Recipe does not belong to the selected Finished Good.';
    end if;

    if tg_op = 'UPDATE' and lower(coalesce(old.status, '')) in ('active', 'archived') then
      if new.recipe_version is distinct from v_recipe_version then
        raise exception 'Pinned Product Recipe version is stale or invalid.';
      end if;
    else
      new.recipe_version := v_recipe_version;
    end if;
  elsif tg_op = 'INSERT' then
    new.recipe_version := null;
  elsif lower(coalesce(old.status, 'draft')) = 'draft' then
    new.recipe_version := null;
  end if;

  return new;
end;
$$;

drop trigger if exists factory_validate_production_sop_header_trigger on public.factory_production_sops;
create trigger factory_validate_production_sop_header_trigger
before insert or update on public.factory_production_sops
for each row execute function public.factory_validate_production_sop_header();

create or replace function public.factory_validate_production_sop_step_material()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe_id uuid;
begin
  select sop.recipe_id
  into v_recipe_id
  from public.factory_production_sop_steps step
  join public.factory_production_sops sop on sop.id = step.sop_id
  where step.id = new.sop_step_id;

  if not found then
    raise exception 'Production SOP step not found.';
  end if;

  if v_recipe_id is null then
    raise exception 'Pin a Product Recipe before linking SOP step ingredients.';
  end if;

  if not exists (
    select 1
    from public.factory_product_recipe_items item
    where item.recipe_id = v_recipe_id
      and item.raw_material_id = new.raw_material_id
  ) then
    raise exception 'SOP step ingredient must belong to the pinned Product Recipe BOM.';
  end if;

  return new;
end;
$$;

drop trigger if exists factory_validate_production_sop_step_material_trigger on public.factory_production_sop_step_materials;
create trigger factory_validate_production_sop_step_material_trigger
before insert or update on public.factory_production_sop_step_materials
for each row execute function public.factory_validate_production_sop_step_material();

revoke execute on function public.factory_validate_production_sop_header() from public, anon, authenticated;
revoke execute on function public.factory_validate_production_sop_step_material() from public, anon, authenticated;

-- SOP users need read-only access to recipe ingredients and material names.
drop policy if exists "factory product recipes view" on public.factory_product_recipes;
create policy "factory product recipes view" on public.factory_product_recipes
for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_production_sop.view')
);

drop policy if exists "factory product recipe items view" on public.factory_product_recipe_items;
create policy "factory product recipe items view" on public.factory_product_recipe_items
for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_production_sop.view')
);

drop policy if exists "factory raw materials view" on public.factory_raw_materials;
create policy "factory raw materials view" on public.factory_raw_materials
for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_stock_check.view')
  or public.current_user_has_permission('factory_product_recipes.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production_reports.view')
  or public.current_user_has_permission('factory_production_sop.view')
);

create or replace function public.factory_activate_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.factory_production_sops%rowtype;
  v_recipe_version text;
  v_recipe_finished_good_id uuid;
  v_lock_key text;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.edit';
  end if;

  select sop.*
  into v_sop
  from public.factory_production_sops sop
  where sop.id = p_sop_id;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if v_sop.finished_good_id is null or not exists (
    select 1 from public.factory_product_families family where family.id = v_sop.finished_good_id
  ) then
    raise exception 'Production SOP requires a valid Finished Good before activation.';
  end if;

  v_lock_key := v_sop.finished_good_id::text;
  perform pg_advisory_xact_lock(hashtext('factory_production_sop:' || v_lock_key));

  select sop.*
  into v_sop
  from public.factory_production_sops sop
  where sop.id = p_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if v_sop.finished_good_id::text is distinct from v_lock_key then
    raise exception 'Production SOP Finished Good changed concurrently; retry activation.';
  end if;

  if lower(coalesce(v_sop.status, '')) <> 'draft' then
    raise exception 'Only draft Production SOPs can be activated.';
  end if;

  if v_sop.recipe_id is not null then
    select recipe.version, recipe.product_family_id
    into v_recipe_version, v_recipe_finished_good_id
    from public.factory_product_recipes recipe
    where recipe.id = v_sop.recipe_id;

    if not found or v_recipe_finished_good_id is distinct from v_sop.finished_good_id then
      raise exception 'Pinned Product Recipe does not belong to the Production SOP Finished Good.';
    end if;

    if v_sop.recipe_version is distinct from v_recipe_version then
      raise exception 'Pinned Product Recipe version is stale or invalid.';
    end if;
  end if;

  if exists (
    select 1
    from public.factory_production_sop_steps step
    join public.factory_production_sop_step_materials material on material.sop_step_id = step.id
    where step.sop_id = v_sop.id
      and (
        v_sop.recipe_id is null
        or not exists (
          select 1
          from public.factory_product_recipe_items item
          where item.recipe_id = v_sop.recipe_id
            and item.raw_material_id = material.raw_material_id
        )
      )
  ) then
    raise exception 'One or more SOP step ingredients are outside the pinned Product Recipe BOM.';
  end if;

  if exists (
    select 1
    from public.factory_production_sop_steps step
    where step.sop_id = v_sop.id
      and step.qc_minimum is not null
      and step.qc_maximum is not null
      and step.qc_minimum > step.qc_maximum
  ) then
    raise exception 'One or more SOP QC minimum values exceed their maximum values.';
  end if;

  update public.factory_production_sops sop
  set status = 'archived',
      updated_at = now()
  where sop.id <> v_sop.id
    and lower(coalesce(sop.status, '')) = 'active'
    and sop.finished_good_id = v_sop.finished_good_id;

  update public.factory_production_sops sop
  set status = 'active',
      updated_at = now()
  where sop.id = v_sop.id;

  return jsonb_build_object('sop_id', v_sop.id);
end;
$$;

create or replace function public.factory_archive_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.factory_production_sops%rowtype;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.delete';
  end if;

  select sop.* into v_sop
  from public.factory_production_sops sop
  where sop.id = p_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if lower(coalesce(v_sop.status, '')) <> 'active' then
    raise exception 'Only active Production SOPs can be archived.';
  end if;

  update public.factory_production_sops sop
  set status = 'archived', updated_at = now()
  where sop.id = v_sop.id;

  return jsonb_build_object('sop_id', v_sop.id);
end;
$$;

create or replace function public.factory_restore_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.factory_production_sops%rowtype;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.edit';
  end if;

  select sop.* into v_sop
  from public.factory_production_sops sop
  where sop.id = p_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if lower(coalesce(v_sop.status, '')) <> 'archived' then
    raise exception 'Only archived Production SOPs can be restored.';
  end if;

  update public.factory_production_sops sop
  set status = 'draft', updated_at = now()
  where sop.id = v_sop.id;

  return jsonb_build_object('sop_id', v_sop.id);
end;
$$;

grant execute on function public.factory_activate_production_sop(uuid) to authenticated;
grant execute on function public.factory_archive_production_sop(uuid) to authenticated;
grant execute on function public.factory_restore_production_sop(uuid) to authenticated;
revoke execute on function public.factory_activate_production_sop(uuid) from public, anon;
revoke execute on function public.factory_archive_production_sop(uuid) from public, anon;
revoke execute on function public.factory_restore_production_sop(uuid) from public, anon;

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
set search_path = public
as $$
declare
  v_sop public.factory_production_sops%rowtype;
  v_sop_id uuid;
  v_product_name text;
  v_version text;
  v_linked_recipe_version text;
  v_linked_recipe_status text;
  v_next_version integer;
  v_step jsonb;
  v_sub_step jsonb;
  v_material jsonb;
  v_step_id uuid;
  v_step_no integer := 0;
  v_sub_step_no integer;
  v_estimated_minutes integer := 0;
  v_qc_required boolean;
  v_measurement_type text;
  v_raw_material_id uuid;
begin
  if p_sop_id is null then
    if not (
      public.current_user_has_permission('factory_production_sop.create')
      or public.current_user_has_permission('factory_production_sop.manage')
    ) then
      raise exception 'Missing permission: factory_production_sop.create';
    end if;
  elsif not (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.edit';
  end if;

  if p_finished_good_id is null then
    raise exception 'Finished Good is required.';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'SOP name is required.';
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'At least one SOP step is required.';
  end if;

  select family.name_en
  into v_product_name
  from public.factory_product_families family
  where family.id = p_finished_good_id;

  if not found then
    raise exception 'Finished Good not found.';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_production_sop:' || p_finished_good_id::text));

  -- The stored snapshot is always derived from the pinned recipe row.
  v_linked_recipe_version := null;
  if p_recipe_id is not null then
    select recipe.version, lower(coalesce(recipe.status, ''))
    into v_linked_recipe_version, v_linked_recipe_status
    from public.factory_product_recipes recipe
    where recipe.id = p_recipe_id
      and recipe.product_family_id = p_finished_good_id;

    if not found then
      raise exception 'Linked Product Recipe does not belong to the selected Finished Good.';
    end if;
  end if;

  if p_sop_id is not null then
    select *
    into v_sop
    from public.factory_production_sops sop
    where sop.id = p_sop_id
    for update;

    if not found then
      raise exception 'Production SOP not found.';
    end if;

    if lower(coalesce(v_sop.status, '')) <> 'draft' then
      raise exception 'Only draft Production SOPs can be edited.';
    end if;

    v_sop_id := v_sop.id;
    v_version := coalesce(nullif(v_sop.version, ''), 'v1');

    if p_recipe_id is distinct from v_sop.recipe_id and coalesce(v_linked_recipe_status, '') <> 'active' then
      raise exception 'Only the active Product Recipe can be newly linked to an SOP.';
    end if;
  else
    if p_recipe_id is not null and coalesce(v_linked_recipe_status, '') <> 'active' then
      raise exception 'Only the active Product Recipe can be linked to a new SOP.';
    end if;

    select coalesce(max(nullif(regexp_replace(coalesce(sop.version, ''), '[^0-9]', '', 'g'), '')::integer), 0) + 1
    into v_next_version
    from public.factory_production_sops sop
    where sop.finished_good_id = p_finished_good_id;

    v_version := 'v' || v_next_version::text;

    insert into public.factory_production_sops (
      sop_code,
      title,
      product_name,
      finished_good_id,
      recipe_id,
      recipe_version,
      version,
      effective_date,
      equipment,
      estimated_minutes,
      status,
      notes,
      remarks,
      created_by,
      updated_at
    )
    values (
      'SOP-' || to_char(clock_timestamp(), 'YYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4)),
      btrim(p_title),
      v_product_name,
      p_finished_good_id,
      p_recipe_id,
      v_linked_recipe_version,
      v_version,
      p_effective_date,
      '',
      0,
      'draft',
      nullif(btrim(coalesce(p_remarks, '')), ''),
      nullif(btrim(coalesce(p_remarks, '')), ''),
      p_created_by,
      now()
    )
    returning id into v_sop_id;
  end if;

  if p_sop_id is not null then
    update public.factory_production_sops sop
    set title = btrim(p_title),
        product_name = v_product_name,
        finished_good_id = p_finished_good_id,
        recipe_id = p_recipe_id,
        recipe_version = v_linked_recipe_version,
        effective_date = p_effective_date,
        notes = nullif(btrim(coalesce(p_remarks, '')), ''),
        remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
        updated_at = now()
    where sop.id = v_sop_id;

    delete from public.factory_production_sop_steps step
    where step.sop_id = v_sop_id;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_step_no := v_step_no + 1;
    if nullif(btrim(coalesce(v_step->>'step_name', v_step->>'process_name', '')), '') is null then
      raise exception 'Step % requires a Step Name.', v_step_no;
    end if;

    v_qc_required := coalesce((v_step->>'qc_required')::boolean, false);
    v_measurement_type := nullif(lower(btrim(coalesce(v_step->>'qc_measurement_type', ''))), '');

    if v_qc_required and nullif(btrim(coalesce(v_step->>'qc_label', '')), '') is null then
      raise exception 'Step % requires a QC Check Name.', v_step_no;
    end if;

    if v_qc_required and coalesce(v_measurement_type, '') not in ('numeric', 'pass_fail', 'text', 'checklist') then
      raise exception 'Step % requires a valid QC Measurement Type.', v_step_no;
    end if;

    if v_qc_required
       and nullif(v_step->>'qc_minimum', '') is not null
       and nullif(v_step->>'qc_maximum', '') is not null
       and (v_step->>'qc_minimum')::numeric > (v_step->>'qc_maximum')::numeric then
      raise exception 'Step % QC minimum cannot exceed maximum.', v_step_no;
    end if;

    v_estimated_minutes := v_estimated_minutes + greatest(coalesce(nullif(v_step->>'estimated_time_minutes', '')::integer, 0), 0);

    insert into public.factory_production_sop_steps (
      sop_id,
      step_no,
      instruction,
      process_name,
      description,
      control_point,
      qc_label,
      materials,
      equipment,
      expected_duration_minutes,
      estimated_time_minutes,
      is_qc_checkpoint,
      qc_measurement_type,
      qc_target_value,
      qc_minimum,
      qc_maximum,
      qc_uom,
      qc_required_before_completion,
      safety_note,
      remarks,
      updated_at
    )
    values (
      v_sop_id,
      v_step_no,
      coalesce(nullif(btrim(coalesce(v_step->>'description', '')), ''), btrim(coalesce(v_step->>'step_name', v_step->>'process_name'))),
      btrim(coalesce(v_step->>'step_name', v_step->>'process_name')),
      nullif(btrim(coalesce(v_step->>'description', '')), ''),
      case when v_qc_required then nullif(btrim(coalesce(v_step->>'qc_label', '')), '') else null end,
      case when v_qc_required then nullif(btrim(coalesce(v_step->>'qc_label', '')), '') else null end,
      '',
      '',
      greatest(coalesce(nullif(v_step->>'estimated_time_minutes', '')::integer, 0), 0),
      greatest(coalesce(nullif(v_step->>'estimated_time_minutes', '')::integer, 0), 0),
      v_qc_required,
      case when v_qc_required then v_measurement_type else null end,
      case when v_qc_required then nullif(btrim(coalesce(v_step->>'qc_target_value', '')), '') else null end,
      case when v_qc_required then nullif(v_step->>'qc_minimum', '')::numeric else null end,
      case when v_qc_required then nullif(v_step->>'qc_maximum', '')::numeric else null end,
      case when v_qc_required then nullif(btrim(coalesce(v_step->>'qc_uom', '')), '') else null end,
      case when v_qc_required then coalesce((v_step->>'qc_required_before_completion')::boolean, false) else false end,
      nullif(btrim(coalesce(v_step->>'remarks', '')), ''),
      nullif(btrim(coalesce(v_step->>'remarks', '')), ''),
      now()
    )
    returning id into v_step_id;

    v_sub_step_no := 0;
    for v_sub_step in select value from jsonb_array_elements(coalesce(v_step->'sub_steps', '[]'::jsonb))
    loop
      v_sub_step_no := v_sub_step_no + 1;
      if nullif(btrim(coalesce(v_sub_step->>'instruction', '')), '') is null then
        raise exception 'Sub-step %.% requires an instruction.', v_step_no, v_sub_step_no;
      end if;

      insert into public.factory_production_sop_sub_steps (
        sop_step_id,
        sequence_no,
        instruction,
        estimated_minutes,
        remarks,
        updated_at
      )
      values (
        v_step_id,
        v_sub_step_no,
        btrim(v_sub_step->>'instruction'),
        nullif(v_sub_step->>'estimated_minutes', '')::integer,
        nullif(btrim(coalesce(v_sub_step->>'remarks', '')), ''),
        now()
      );
    end loop;

    for v_material in select value from jsonb_array_elements(coalesce(v_step->'ingredient_material_ids', '[]'::jsonb))
    loop
      v_raw_material_id := trim(both '"' from v_material::text)::uuid;
      if p_recipe_id is null or not exists (
        select 1
        from public.factory_product_recipe_items item
        where item.recipe_id = p_recipe_id
          and item.raw_material_id = v_raw_material_id
      ) then
        raise exception 'Step % contains an ingredient outside the linked Product Recipe.', v_step_no;
      end if;

      insert into public.factory_production_sop_step_materials (sop_step_id, raw_material_id)
      values (v_step_id, v_raw_material_id)
      on conflict do nothing;
    end loop;
  end loop;

  update public.factory_production_sops sop
  set estimated_minutes = v_estimated_minutes,
      updated_at = now()
  where sop.id = v_sop_id;

  return jsonb_build_object('sop_id', v_sop_id, 'version', v_version);
end;
$$;

grant execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) to authenticated;
revoke execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) from public, anon;

create or replace function public.factory_create_production_sop_new_version(p_source_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.factory_production_sops%rowtype;
  v_source_step public.factory_production_sop_steps%rowtype;
  v_new_id uuid;
  v_new_step_id uuid;
  v_next_version integer;
  v_lock_key text;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.create')
    or public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.create';
  end if;

  select sop.*
  into v_source
  from public.factory_production_sops sop
  where sop.id = p_source_sop_id;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  v_lock_key := coalesce(v_source.finished_good_id::text, lower(coalesce(v_source.product_name, 'unassigned')));
  perform pg_advisory_xact_lock(hashtext('factory_production_sop:' || v_lock_key));

  select coalesce(max(nullif(regexp_replace(coalesce(sop.version, ''), '[^0-9]', '', 'g'), '')::integer), 0) + 1
  into v_next_version
  from public.factory_production_sops sop
  where (
    (v_source.finished_good_id is not null and sop.finished_good_id = v_source.finished_good_id)
    or (v_source.finished_good_id is null and lower(coalesce(sop.product_name, '')) = lower(coalesce(v_source.product_name, '')))
  );

  insert into public.factory_production_sops (
    sop_code,
    title,
    product_name,
    finished_good_id,
    recipe_id,
    recipe_version,
    version,
    effective_date,
    equipment,
    estimated_minutes,
    status,
    notes,
    remarks,
    created_by,
    updated_at
  )
  values (
    'SOP-' || to_char(clock_timestamp(), 'YYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4)),
    v_source.title,
    v_source.product_name,
    v_source.finished_good_id,
    v_source.recipe_id,
    v_source.recipe_version,
    'v' || v_next_version::text,
    v_source.effective_date,
    v_source.equipment,
    v_source.estimated_minutes,
    'draft',
    v_source.notes,
    v_source.remarks,
    v_source.created_by,
    now()
  )
  returning id into v_new_id;

  for v_source_step in
    select step.*
    from public.factory_production_sop_steps step
    where step.sop_id = v_source.id
    order by step.step_no, step.id
  loop
    insert into public.factory_production_sop_steps (
      sop_id,
      step_no,
      instruction,
      process_name,
      description,
      control_point,
      qc_label,
      materials,
      equipment,
      expected_duration_minutes,
      estimated_time_minutes,
      is_qc_checkpoint,
      qc_measurement_type,
      qc_target_value,
      qc_minimum,
      qc_maximum,
      qc_uom,
      qc_required_before_completion,
      safety_note,
      remarks,
      updated_at
    )
    values (
      v_new_id,
      v_source_step.step_no,
      v_source_step.instruction,
      v_source_step.process_name,
      v_source_step.description,
      v_source_step.control_point,
      v_source_step.qc_label,
      v_source_step.materials,
      v_source_step.equipment,
      v_source_step.expected_duration_minutes,
      v_source_step.estimated_time_minutes,
      v_source_step.is_qc_checkpoint,
      v_source_step.qc_measurement_type,
      v_source_step.qc_target_value,
      v_source_step.qc_minimum,
      v_source_step.qc_maximum,
      v_source_step.qc_uom,
      v_source_step.qc_required_before_completion,
      v_source_step.safety_note,
      v_source_step.remarks,
      now()
    )
    returning id into v_new_step_id;

    insert into public.factory_production_sop_sub_steps (
      sop_step_id,
      sequence_no,
      instruction,
      estimated_minutes,
      remarks,
      created_at,
      updated_at
    )
    select
      v_new_step_id,
      sub_step.sequence_no,
      sub_step.instruction,
      sub_step.estimated_minutes,
      sub_step.remarks,
      now(),
      now()
    from public.factory_production_sop_sub_steps sub_step
    where sub_step.sop_step_id = v_source_step.id
    order by sub_step.sequence_no, sub_step.id;

    insert into public.factory_production_sop_step_materials (sop_step_id, raw_material_id, created_at)
    select v_new_step_id, material.raw_material_id, now()
    from public.factory_production_sop_step_materials material
    where material.sop_step_id = v_source_step.id;
  end loop;

  return jsonb_build_object('sop_id', v_new_id, 'version', 'v' || v_next_version::text);
end;
$$;

grant execute on function public.factory_create_production_sop_new_version(uuid) to authenticated;
revoke execute on function public.factory_create_production_sop_new_version(uuid) from public, anon;
