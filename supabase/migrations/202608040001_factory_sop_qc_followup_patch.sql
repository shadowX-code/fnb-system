-- Forward-only follow-up for staging, where 202608020001 and 202608020002
-- are already recorded. This migration contains only the verified drift between
-- the deployed SOP/QC definitions and the current application contract.
-- Existing SOP, recipe, production, QC snapshot, stock and dispatch data is
-- preserved; no historical rows are rewritten.

-- QC preset reads are needed by SOP viewers, creators, editors and managers.
drop policy if exists "factory qc checklist templates view" on public.factory_qc_checklist_templates;
create policy "factory qc checklist templates view" on public.factory_qc_checklist_templates
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production_sop.create')
  or public.current_user_has_permission('factory_production_sop.edit')
  or public.current_user_has_permission('factory_production_sop.manage')
);

-- Production operators must review the active SOP before Start and may inspect
-- its instructions while a Job Order is In Progress. These remain read-only;
-- all direct structural writes stay revoked and controlled by SOP RPCs.
drop policy if exists "factory sops view" on public.factory_production_sops;
create policy "factory sops view" on public.factory_production_sops
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory sop steps view" on public.factory_production_sop_steps;
create policy "factory sop steps view" on public.factory_production_sop_steps
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory sop sub steps view" on public.factory_production_sop_sub_steps;
create policy "factory sop sub steps view" on public.factory_production_sop_sub_steps
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1 from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

drop policy if exists "factory sop step materials view" on public.factory_production_sop_step_materials;
create policy "factory sop step materials view" on public.factory_production_sop_step_materials
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1 from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

drop policy if exists "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks;
create policy "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1 from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

-- Preset mutations remain manage-only and run through permission-checking RPCs.
create or replace function public.factory_create_qc_checklist_template(
  p_name text,
  p_result_mode text,
  p_description text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_result_mode text := lower(btrim(coalesce(p_result_mode, '')));
begin
  if not public.current_user_has_permission('factory_production_sop.manage') then
    raise exception 'Missing permission: factory_production_sop.manage';
  end if;
  if v_name is null then raise exception 'QC Check Name is required.'; end if;
  if v_result_mode not in ('checklist', 'remarks') then
    raise exception 'Result Mode must be Checklist or Remarks.';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_qc_checklist_template:' || lower(v_name)));
  if exists (
    select 1 from public.factory_qc_checklist_templates template
    where lower(btrim(template.name)) = lower(v_name)
  ) then
    raise exception 'A QC Checklist Preset with this name already exists.';
  end if;

  insert into public.factory_qc_checklist_templates (
    name, description, result_mode, is_active, created_by, updated_at
  ) values (
    v_name, nullif(btrim(coalesce(p_description, '')), ''), v_result_mode, true, p_created_by, now()
  )
  returning id into v_id;

  return jsonb_build_object('template_id', v_id);
exception
  when unique_violation then
    raise exception 'A QC Checklist Preset with this name already exists.';
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
set search_path = public
as $$
declare
  v_template public.factory_qc_checklist_templates%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_result_mode text := lower(btrim(coalesce(p_result_mode, '')));
begin
  if not public.current_user_has_permission('factory_production_sop.manage') then
    raise exception 'Missing permission: factory_production_sop.manage';
  end if;
  if v_name is null then raise exception 'QC Check Name is required.'; end if;
  if v_result_mode not in ('checklist', 'remarks') then
    raise exception 'Result Mode must be Checklist or Remarks.';
  end if;

  perform pg_advisory_xact_lock(hashtext('factory_qc_checklist_template:' || lower(v_name)));

  select template.* into v_template
  from public.factory_qc_checklist_templates template
  where template.id = p_template_id
  for update;
  if not found then raise exception 'QC Checklist Preset not found.'; end if;
  if exists (
    select 1 from public.factory_qc_checklist_templates template
    where lower(btrim(template.name)) = lower(v_name)
      and template.id <> v_template.id
  ) then
    raise exception 'A QC Checklist Preset with this name already exists.';
  end if;

  update public.factory_qc_checklist_templates template
  set name = v_name,
      result_mode = v_result_mode,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      updated_at = now()
  where template.id = v_template.id;

  return jsonb_build_object('template_id', v_template.id);
exception
  when unique_violation then
    raise exception 'A QC Checklist Preset with this name already exists.';
end;
$$;

create or replace function public.factory_archive_qc_checklist_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.factory_qc_checklist_templates%rowtype;
begin
  if not public.current_user_has_permission('factory_production_sop.manage') then
    raise exception 'Missing permission: factory_production_sop.manage';
  end if;
  select template.* into v_template
  from public.factory_qc_checklist_templates template
  where template.id = p_template_id
  for update;
  if not found then raise exception 'QC Checklist Preset not found.'; end if;
  if not v_template.is_active then raise exception 'Only Active QC Checklist Presets can be archived.'; end if;

  update public.factory_qc_checklist_templates template
  set is_active = false, updated_at = now()
  where template.id = v_template.id;
  return jsonb_build_object('template_id', v_template.id);
end;
$$;

create or replace function public.factory_restore_qc_checklist_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.factory_qc_checklist_templates%rowtype;
begin
  if not public.current_user_has_permission('factory_production_sop.manage') then
    raise exception 'Missing permission: factory_production_sop.manage';
  end if;
  select template.* into v_template
  from public.factory_qc_checklist_templates template
  where template.id = p_template_id
  for update;
  if not found then raise exception 'QC Checklist Preset not found.'; end if;
  if v_template.is_active then raise exception 'Only Archived QC Checklist Presets can be restored.'; end if;

  update public.factory_qc_checklist_templates template
  set is_active = true, updated_at = now()
  where template.id = v_template.id;
  return jsonb_build_object('template_id', v_template.id);
end;
$$;

create or replace function public.factory_delete_qc_checklist_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.factory_qc_checklist_templates%rowtype;
begin
  if not public.current_user_has_permission('factory_production_sop.manage') then
    raise exception 'Missing permission: factory_production_sop.manage';
  end if;
  select template.* into v_template
  from public.factory_qc_checklist_templates template
  where template.id = p_template_id
  for update;
  if not found then raise exception 'QC Checklist Preset not found.'; end if;

  if exists (
    select 1
    from public.factory_production_sop_step_qc_checks qc
    where qc.checklist_template_id = v_template.id
  ) then
    raise exception 'Referenced QC Checklist Presets cannot be deleted. Archive this preset instead.';
  end if;

  delete from public.factory_qc_checklist_templates template
  where template.id = v_template.id;
end;
$$;

grant execute on function public.factory_create_qc_checklist_template(text, text, text, uuid) to authenticated;
grant execute on function public.factory_update_qc_checklist_template(uuid, text, text, text) to authenticated;
grant execute on function public.factory_archive_qc_checklist_template(uuid) to authenticated;
grant execute on function public.factory_restore_qc_checklist_template(uuid) to authenticated;
grant execute on function public.factory_delete_qc_checklist_template(uuid) to authenticated;
revoke execute on function public.factory_create_qc_checklist_template(text, text, text, uuid) from public, anon;
revoke execute on function public.factory_update_qc_checklist_template(uuid, text, text, text) from public, anon;
revoke execute on function public.factory_archive_qc_checklist_template(uuid) from public, anon;
revoke execute on function public.factory_restore_qc_checklist_template(uuid) from public, anon;
revoke execute on function public.factory_delete_qc_checklist_template(uuid) from public, anon;

-- Replace the Draft structure save with the final time-authority, identity and
-- QC deletion ordering implementation. The function remains transactional.
-- Atomic Draft structure replacement. In the current single-company model,
-- RBAC establishes company access and the SOP/step/QC ownership map establishes
-- object ownership. No frontend-supplied company/workspace value is trusted.
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
  v_qc_check jsonb;
  v_step_id uuid;
  v_existing_step_id uuid;
  v_existing_qc_id uuid;
  v_step_no integer := 0;
  v_step_minutes integer := 0;
  v_sub_step_no integer;
  v_sub_step_minutes integer;
  v_qc_no integer;
  v_estimated_minutes integer := 0;
  v_qc_type text;
  v_qc_template_id uuid;
  v_qc_template_name text;
  v_qc_template_result_mode text;
  v_legacy_qc_snapshot jsonb := '{}'::jsonb;
  v_seen_step_ids uuid[] := array[]::uuid[];
  v_seen_legacy_qc_ids uuid[] := array[]::uuid[];
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
    select coalesce(jsonb_object_agg(
      qc.id::text,
      jsonb_build_object(
        'sop_step_id', qc.sop_step_id,
        'qc_name', qc.qc_name,
        'qc_type', qc.qc_type,
        'instructions', qc.instructions,
        'is_required', qc.is_required
      )
    ), '{}'::jsonb)
    into v_legacy_qc_snapshot
    from public.factory_production_sop_step_qc_checks qc
    join public.factory_production_sop_steps step on step.id = qc.sop_step_id
    left join public.factory_qc_checklist_templates template on template.id = qc.checklist_template_id
    where step.sop_id = v_sop_id
      and (qc.checklist_template_id is null or coalesce(template.is_active, false) = false);
  end if;

  -- Validate legacy ownership before the existing Draft structure is replaced.
  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_existing_step_id := nullif(v_step->>'id', '')::uuid;
    if v_existing_step_id is not null then
      if v_existing_step_id = any(v_seen_step_ids) then
        raise exception 'A Production SOP step identity cannot be reused.';
      end if;
      if p_sop_id is null or not exists (
        select 1 from public.factory_production_sop_steps existing_step
        where existing_step.id = v_existing_step_id
          and existing_step.sop_id = v_sop_id
      ) then
        raise exception 'Production SOP step does not belong to this Draft.';
      end if;
      v_seen_step_ids := array_append(v_seen_step_ids, v_existing_step_id);
    end if;
    for v_qc_check in select value from jsonb_array_elements(coalesce(v_step->'qc_checks', '[]'::jsonb))
    loop
      if nullif(v_qc_check->>'checklist_template_id', '') is null then
        v_existing_qc_id := nullif(v_qc_check->>'id', '')::uuid;
        if v_existing_qc_id is null
           or v_existing_step_id is null
           or not (v_legacy_qc_snapshot ? v_existing_qc_id::text)
           or (v_legacy_qc_snapshot -> (v_existing_qc_id::text) ->> 'sop_step_id')::uuid is distinct from v_existing_step_id then
          raise exception 'New QC checks must use an active preset.';
        end if;
        if v_existing_qc_id = any(v_seen_legacy_qc_ids) then
          raise exception 'A legacy QC identity cannot be reused.';
        end if;
        v_seen_legacy_qc_ids := array_append(v_seen_legacy_qc_ids, v_existing_qc_id);
      end if;
    end loop;
  end loop;

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

    delete from public.factory_production_sop_step_qc_checks qc
    using public.factory_production_sop_steps step
    where qc.sop_step_id = step.id
      and step.sop_id = v_sop_id;

    delete from public.factory_production_sop_steps step
    where step.sop_id = v_sop_id;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_step_no := v_step_no + 1;
    v_existing_step_id := nullif(v_step->>'id', '')::uuid;
    if nullif(btrim(coalesce(v_step->>'step_name', v_step->>'process_name', '')), '') is null then
      raise exception 'Step % requires a Step Name.', v_step_no;
    end if;

    v_step_minutes := 0;
    if jsonb_array_length(coalesce(v_step->'sub_steps', '[]'::jsonb)) > 0 then
      for v_sub_step in select value from jsonb_array_elements(v_step->'sub_steps')
      loop
        if nullif(btrim(coalesce(v_sub_step->>'estimated_minutes', '')), '') is not null then
          if btrim(v_sub_step->>'estimated_minutes') !~ '^\d+$' then
            raise exception 'Sub-step minutes must be a non-negative whole number.';
          end if;
          v_sub_step_minutes := btrim(v_sub_step->>'estimated_minutes')::integer;
          v_step_minutes := v_step_minutes + v_sub_step_minutes;
        end if;
      end loop;
    elsif nullif(btrim(coalesce(v_step->>'estimated_time_minutes', '')), '') is not null then
      if btrim(v_step->>'estimated_time_minutes') !~ '^\d+$' then
        raise exception 'Step minutes must be a non-negative whole number.';
      end if;
      v_step_minutes := btrim(v_step->>'estimated_time_minutes')::integer;
    end if;
    v_estimated_minutes := v_estimated_minutes + v_step_minutes;

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
      null,
      null,
      '',
      '',
      v_step_minutes,
      v_step_minutes,
      false,
      null,
      null,
      null,
      null,
      null,
      false,
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
        nullif(btrim(coalesce(v_sub_step->>'estimated_minutes', '')), '')::integer,
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

    v_qc_no := 0;
    for v_qc_check in select value from jsonb_array_elements(coalesce(v_step->'qc_checks', '[]'::jsonb))
    loop
      v_qc_no := v_qc_no + 1;
      v_qc_template_id := nullif(v_qc_check->>'checklist_template_id', '')::uuid;
      v_qc_template_name := null;
      v_qc_template_result_mode := null;
      if v_qc_template_id is not null then
        select template.name, template.result_mode, template.id
        into v_qc_template_name, v_qc_template_result_mode, v_qc_template_id
        from public.factory_qc_checklist_templates template
        where template.id = nullif(v_qc_check->>'checklist_template_id', '')::uuid
          and template.is_active = true;
        if not found then
          raise exception 'Step % QC % uses an unavailable QC preset.', v_step_no, v_qc_no;
        end if;
        v_qc_type := v_qc_template_result_mode;
      else
        v_existing_qc_id := nullif(v_qc_check->>'id', '')::uuid;
        if v_existing_qc_id is null
           or not (v_legacy_qc_snapshot ? v_existing_qc_id::text)
           or (v_legacy_qc_snapshot -> (v_existing_qc_id::text) ->> 'sop_step_id')::uuid is distinct from v_existing_step_id then
          raise exception 'New QC checks must use an active preset.';
        end if;
        v_qc_template_name := v_legacy_qc_snapshot -> (v_existing_qc_id::text) ->> 'qc_name';
        v_qc_type := v_legacy_qc_snapshot -> (v_existing_qc_id::text) ->> 'qc_type';
      end if;

      insert into public.factory_production_sop_step_qc_checks (
        sop_step_id, sequence_no, qc_type, checklist_template_id,
        qc_name, instructions, is_required, updated_at
      ) values (
        v_step_id, v_qc_no, v_qc_type,
        v_qc_template_id,
        v_qc_template_name,
        nullif(btrim(coalesce(v_qc_check->>'instructions', '')), ''),
        coalesce((v_qc_check->>'is_required')::boolean, true),
        now()
      );
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

-- New versions remain Draft, copy the complete structure, and derive effective
-- Step/SOP minutes without rewriting the source Active SOP.
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
  v_new_step_minutes integer;
  v_new_sop_minutes integer := 0;
  v_source_sub_step_count integer;
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

  select sop.*
  into v_source
  from public.factory_production_sops sop
  where sop.id = p_source_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if lower(coalesce(v_source.status, '')) <> 'active' then
    raise exception 'New Version can only be created from an Active SOP.';
  end if;

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
    0,
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
    select count(*), coalesce(sum(coalesce(sub_step.estimated_minutes, 0)), 0)
    into v_source_sub_step_count, v_new_step_minutes
    from public.factory_production_sop_sub_steps sub_step
    where sub_step.sop_step_id = v_source_step.id;

    if v_source_sub_step_count = 0 then
      v_new_step_minutes := greatest(coalesce(v_source_step.estimated_time_minutes, 0), 0);
    end if;
    v_new_sop_minutes := v_new_sop_minutes + v_new_step_minutes;

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
      v_new_step_minutes,
      v_new_step_minutes,
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

    insert into public.factory_production_sop_step_qc_checks (
      sop_step_id, sequence_no, qc_type, checklist_template_id,
      qc_name, instructions, is_required, created_at, updated_at
    )
    select
      v_new_step_id, qc.sequence_no, qc.qc_type,
      case when template.id is not null and template.is_active then qc.checklist_template_id else null end,
      qc.qc_name, qc.instructions, qc.is_required, now(), now()
    from public.factory_production_sop_step_qc_checks qc
    left join public.factory_qc_checklist_templates template on template.id = qc.checklist_template_id
    where qc.sop_step_id = v_source_step.id
    order by qc.sequence_no, qc.id;
  end loop;

  update public.factory_production_sops sop
  set estimated_minutes = v_new_sop_minutes,
      updated_at = now()
  where sop.id = v_new_id;

  return jsonb_build_object('sop_id', v_new_id, 'version', 'v' || v_next_version::text);
end;
$$;

grant execute on function public.factory_create_production_sop_new_version(uuid) to authenticated;
revoke execute on function public.factory_create_production_sop_new_version(uuid) from public, anon;

-- Completion details are inventory-affecting inputs. Validate them on the
-- Production row before the existing completion RPC can deduct materials,
-- stock in finished goods, or create movements. Times are typed as `time`, so
-- PostgreSQL rejects malformed values before this trigger runs. Phase 1 treats
-- an earlier End Time as invalid rather than inferring a next-day completion.
create or replace function public.factory_guard_production_completion_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_start_time time;
  v_start_time time;
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;

  select job.start_time
  into v_job_start_time
  from public.factory_job_orders job
  where job.id = new.job_order_id;

  if not found then
    raise exception 'Job Order not found.';
  end if;
  if v_job_start_time is null then
    raise exception 'Job Order Start Time is required before completing production.';
  end if;
  if new.end_time is null then
    raise exception 'End Time is required.';
  end if;

  v_start_time := v_job_start_time;
  if new.end_time < v_start_time then
    raise exception 'End Time cannot be earlier than Start Time.';
  end if;

  if new.actual_pack_qty is null
     or new.actual_pack_qty <= 0
     or new.actual_pack_qty <> trunc(new.actual_pack_qty) then
    raise exception 'Actual Pack Qty must be a whole number greater than zero.';
  end if;

  new.start_time := v_start_time;
  return new;
end;
$$;

drop trigger if exists factory_guard_production_completion_details_trigger
on public.factory_productions;
create trigger factory_guard_production_completion_details_trigger
before insert on public.factory_productions
for each row execute function public.factory_guard_production_completion_details();

revoke execute on function public.factory_guard_production_completion_details()
from public, anon, authenticated;
