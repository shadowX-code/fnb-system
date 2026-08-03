-- Forward-only repair for staging instances where 202608020001 was applied
-- before the Production SOP/QC execution additions were finalized.
-- Preserves existing SOP, production, recipe, job-order and historical data.
--
-- FeedX tenancy invariant (Phase 1): one deployment/database represents one
-- company. The Restaurant/Factory "workspace" selector is UI navigation, not
-- a tenant selector. Factory master and transaction tables intentionally have
-- no company_id/workspace_id; authenticated company users are scoped by RBAC,
-- while outlet-owned Restaurant data uses the separate outlet access model.
-- Do not accept a caller-supplied tenant identifier in these RPCs. If FeedX
-- later becomes multi-company, introduce an authoritative company membership
-- model and tenant keys across every Factory parent before relaxing this rule.

create table if not exists public.factory_qc_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  description text,
  result_mode text not null default 'checklist',
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_qc_checklist_templates_name_required check (btrim(name) <> ''),
  constraint factory_qc_checklist_templates_result_mode check (result_mode in ('checklist', 'remarks'))
);

create table if not exists public.factory_production_sop_step_qc_checks (
  id uuid primary key default gen_random_uuid(),
  sop_step_id uuid not null references public.factory_production_sop_steps(id) on delete cascade,
  sequence_no integer not null,
  qc_type text not null,
  checklist_template_id uuid references public.factory_qc_checklist_templates(id) on delete set null,
  qc_name text not null,
  instructions text,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_production_sop_step_qc_checks_sequence_positive check (sequence_no > 0),
  constraint factory_production_sop_step_qc_checks_type check (qc_type in ('checklist', 'remarks')),
  constraint factory_production_sop_step_qc_checks_name_required check (btrim(qc_name) <> ''),
  unique (sop_step_id, sequence_no)
);

-- Production records are created only at completion in the current Factory flow.
-- The job order therefore owns the immutable SOP/QC snapshot while work is in progress.
alter table public.factory_job_orders
  add column if not exists production_sop_id uuid references public.factory_production_sops(id) on delete set null,
  add column if not exists sop_version text,
  add column if not exists qc_snapshot_created_at timestamptz;

create table if not exists public.factory_production_step_executions (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.factory_job_orders(id) on delete cascade,
  production_id uuid references public.factory_productions(id) on delete cascade,
  production_sop_id uuid references public.factory_production_sops(id) on delete set null,
  sop_step_id uuid references public.factory_production_sop_steps(id) on delete set null,
  step_no integer not null,
  step_name text not null,
  description text,
  sub_steps jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_production_step_executions_step_positive check (step_no > 0),
  constraint factory_production_step_executions_name_required check (btrim(step_name) <> ''),
  constraint factory_production_step_executions_status check (status in ('pending', 'completed')),
  unique (job_order_id, step_no)
);

create table if not exists public.factory_production_qc_results (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.factory_job_orders(id) on delete cascade,
  production_id uuid references public.factory_productions(id) on delete cascade,
  production_step_execution_id uuid not null references public.factory_production_step_executions(id) on delete cascade,
  sop_qc_check_id uuid references public.factory_production_sop_step_qc_checks(id) on delete set null,
  sequence_no integer not null,
  qc_type text not null,
  qc_name text not null,
  instructions text,
  is_required boolean not null default true,
  checklist_result text,
  remarks text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_production_qc_results_sequence_positive check (sequence_no > 0),
  constraint factory_production_qc_results_type check (qc_type in ('checklist', 'remarks')),
  constraint factory_production_qc_results_checklist_result check (checklist_result is null or checklist_result in ('pass', 'fail', 'na')),
  constraint factory_production_qc_results_result_type check (qc_type = 'checklist' or checklist_result is null),
  constraint factory_production_qc_results_na_reason check (
    checklist_result is distinct from 'na'
    or length(btrim(coalesce(remarks, ''))) > 0
  ),
  constraint factory_production_qc_results_name_required check (btrim(qc_name) <> ''),
  unique (production_step_execution_id, sequence_no)
);

insert into public.factory_qc_checklist_templates (name, category, description, result_mode)
values
  ('Raw Material Condition', 'Material', 'Confirm raw material condition is acceptable for production.', 'checklist'),
  ('Equipment Cleanliness', 'Equipment', 'Confirm production equipment has been cleaned.', 'checklist'),
  ('Temperature Check', 'Process', 'Confirm the required process temperature was checked.', 'checklist'),
  ('Product Texture', 'Product', 'Confirm finished product texture is acceptable.', 'checklist'),
  ('Product Colour', 'Product', 'Confirm finished product colour is acceptable.', 'checklist'),
  ('Product Appearance', 'Product', 'Confirm finished product appearance is acceptable.', 'checklist'),
  ('No Foreign Matter', 'Food Safety', 'Confirm no foreign matter is present.', 'checklist'),
  ('Packaging Seal', 'Packaging', 'Confirm packaging seal integrity and leakage.', 'checklist'),
  ('Label Accuracy', 'Packaging', 'Confirm the correct label is applied.', 'checklist'),
  ('Product Weight', 'Packaging', 'Confirm packaged weight was checked.', 'checklist'),
  ('No Leakage', 'Packaging', 'Confirm packaging has no leakage.', 'checklist'),
  ('QC Remarks', 'General', 'Record the QC observation or remarks.', 'remarks')
on conflict (name) do update
set category = excluded.category,
    description = excluded.description,
    result_mode = excluded.result_mode,
    updated_at = now();

create index if not exists factory_production_sops_recipe_id_idx
  on public.factory_production_sops(recipe_id);

create index if not exists factory_production_sop_sub_steps_step_idx
  on public.factory_production_sop_sub_steps(sop_step_id, sequence_no);

create index if not exists factory_production_sop_step_materials_material_idx
  on public.factory_production_sop_step_materials(raw_material_id);

create index if not exists factory_production_sop_step_qc_checks_step_idx
  on public.factory_production_sop_step_qc_checks(sop_step_id, sequence_no);

create index if not exists factory_production_step_executions_job_idx
  on public.factory_production_step_executions(job_order_id, step_no);

create index if not exists factory_production_qc_results_job_idx
  on public.factory_production_qc_results(job_order_id, production_step_execution_id, sequence_no);

alter table public.factory_production_sop_sub_steps enable row level security;
alter table public.factory_production_sop_step_materials enable row level security;
alter table public.factory_qc_checklist_templates enable row level security;
alter table public.factory_production_sop_step_qc_checks enable row level security;
alter table public.factory_production_step_executions enable row level security;
alter table public.factory_production_qc_results enable row level security;

grant select on public.factory_production_sop_sub_steps to authenticated;
grant select on public.factory_production_sop_step_materials to authenticated;
grant select on public.factory_qc_checklist_templates to authenticated;
grant select on public.factory_production_sop_step_qc_checks to authenticated;
grant select on public.factory_production_step_executions to authenticated;
grant select on public.factory_production_qc_results to authenticated;

drop policy if exists "factory qc checklist templates view" on public.factory_qc_checklist_templates;
create policy "factory qc checklist templates view" on public.factory_qc_checklist_templates
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
);

drop policy if exists "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks;
create policy "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  and exists (
    select 1 from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

drop policy if exists "factory production step executions view" on public.factory_production_step_executions;
create policy "factory production step executions view" on public.factory_production_step_executions
for select to authenticated
using (
  public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

drop policy if exists "factory production qc results view" on public.factory_production_qc_results;
create policy "factory production qc results view" on public.factory_production_qc_results
for select to authenticated
using (
  public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.edit')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_batch_traceability.view')
);

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
revoke insert, update, delete on public.factory_production_sop_step_qc_checks from authenticated;
revoke insert, update, delete on public.factory_production_step_executions from authenticated;
revoke insert, update, delete on public.factory_production_qc_results from authenticated;
revoke insert, update, delete on public.factory_qc_checklist_templates from authenticated;

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

create or replace function public.factory_validate_production_sop_qc_definition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_id uuid;
  v_sop_status text;
begin
  v_step_id := case when tg_op = 'DELETE' then old.sop_step_id else new.sop_step_id end;

  select lower(coalesce(sop.status, '')) into v_sop_status
  from public.factory_production_sop_steps step
  join public.factory_production_sops sop on sop.id = step.sop_id
  where step.id = v_step_id;

  if not found then raise exception 'Production SOP step not found.'; end if;
  if v_sop_status <> 'draft' then
    raise exception 'Production SOP QC definitions are editable only while the SOP is Draft.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists factory_validate_production_sop_qc_definition_trigger on public.factory_production_sop_step_qc_checks;
create trigger factory_validate_production_sop_qc_definition_trigger
before insert or update or delete on public.factory_production_sop_step_qc_checks
for each row execute function public.factory_validate_production_sop_qc_definition();

revoke execute on function public.factory_validate_production_sop_qc_definition() from public, anon, authenticated;

create or replace function public.factory_validate_production_execution_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_production_job_order_id uuid;
  v_step_sop_id uuid;
begin
  if new.production_id is not null then
    select production.job_order_id into v_production_job_order_id
    from public.factory_productions production
    where production.id = new.production_id;

    if not found or v_production_job_order_id is distinct from new.job_order_id then
      raise exception 'Production step execution must belong to the same Job Order as its Production record.';
    end if;
  end if;

  if new.sop_step_id is not null then
    select step.sop_id into v_step_sop_id
    from public.factory_production_sop_steps step
    where step.id = new.sop_step_id;

    if not found or v_step_sop_id is distinct from new.production_sop_id then
      raise exception 'Production step execution must belong to its snapshotted Production SOP.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.factory_validate_production_qc_result_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.factory_production_step_executions%rowtype;
  v_qc_step_id uuid;
  v_production_job_order_id uuid;
begin
  select execution.* into v_execution
  from public.factory_production_step_executions execution
  where execution.id = new.production_step_execution_id;

  if not found or v_execution.job_order_id is distinct from new.job_order_id then
    raise exception 'Production QC result must belong to the same Job Order as its Production step.';
  end if;

  if new.production_id is not null then
    select production.job_order_id into v_production_job_order_id
    from public.factory_productions production
    where production.id = new.production_id;

    if not found
       or v_production_job_order_id is distinct from new.job_order_id
       or v_execution.production_id is distinct from new.production_id then
      raise exception 'Production QC result must belong to the same Production and Job Order as its Production step.';
    end if;
  elsif v_execution.production_id is not null then
    raise exception 'Production QC result must retain the Production linked to its Production step.';
  end if;

  if new.sop_qc_check_id is not null then
    select qc.sop_step_id into v_qc_step_id
    from public.factory_production_sop_step_qc_checks qc
    where qc.id = new.sop_qc_check_id;

    if not found or v_qc_step_id is distinct from v_execution.sop_step_id then
      raise exception 'Production QC result must belong to its snapshotted SOP step.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists factory_validate_production_execution_link_trigger on public.factory_production_step_executions;
create trigger factory_validate_production_execution_link_trigger
before insert or update on public.factory_production_step_executions
for each row execute function public.factory_validate_production_execution_link();

drop trigger if exists factory_validate_production_qc_result_link_trigger on public.factory_production_qc_results;
create trigger factory_validate_production_qc_result_link_trigger
before insert or update on public.factory_production_qc_results
for each row execute function public.factory_validate_production_qc_result_link();

revoke execute on function public.factory_validate_production_execution_link() from public, anon, authenticated;
revoke execute on function public.factory_validate_production_qc_result_link() from public, anon, authenticated;

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

-- SECURITY DEFINER SOP lifecycle RPCs operate inside the single company
-- boundary documented above. Permission checks are the authoritative company
-- access gate; object IDs are additionally validated through their Factory
-- parent relationships to prevent cross-SOP structure reuse.
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
  v_sub_step_no integer;
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
      null,
      null,
      '',
      '',
      greatest(coalesce(nullif(v_step->>'estimated_time_minutes', '')::integer, 0), 0),
      greatest(coalesce(nullif(v_step->>'estimated_time_minutes', '')::integer, 0), 0),
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

  return jsonb_build_object('sop_id', v_new_id, 'version', 'v' || v_next_version::text);
end;
$$;

grant execute on function public.factory_create_production_sop_new_version(uuid) to authenticated;
revoke execute on function public.factory_create_production_sop_new_version(uuid) from public, anon;

-- Start Production remains stock-neutral. It snapshots the active SOP and its QC
-- definitions against the Job Order so later SOP edits cannot change history.
-- Job Order, Finished Good and SOP all belong to the deployment's single company
-- boundary; their relational IDs are resolved entirely in the database.
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
set search_path = public
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_product_family_id uuid;
  v_sop public.factory_production_sops%rowtype;
  v_step public.factory_production_sop_steps%rowtype;
  v_step_execution_id uuid;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception 'Missing permission to start production.';
  end if;

  select jo.* into v_job_order
  from public.factory_job_orders jo
  where jo.id = p_job_order_id
  for update;

  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'released' then
    raise exception 'Only Released Job Orders can start production.';
  end if;

  select fg.product_family_id into v_product_family_id
  from public.factory_finished_goods fg
  where fg.id = v_job_order.finished_good_id;

  if v_product_family_id is not null then
    select sop.* into v_sop
    from public.factory_production_sops sop
    where sop.finished_good_id = v_product_family_id
      and lower(coalesce(sop.status, '')) = 'active'
    order by sop.updated_at desc, sop.id desc
    limit 1;
  end if;

  update public.factory_job_orders jo
  set status = 'in_progress',
      started_at = now(),
      started_by = p_started_by,
      production_operator_id = coalesce(p_operator_id, p_started_by),
      production_operator_name = nullif(btrim(coalesce(p_operator_name, '')), ''),
      production_date = coalesce(p_production_date, current_date),
      start_time = p_start_time,
      production_sop_id = v_sop.id,
      sop_version = v_sop.version,
      qc_snapshot_created_at = now(),
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then jo.remarks
        when coalesce(btrim(jo.remarks), '') = '' then btrim(p_remarks)
        else jo.remarks || E'\n' || btrim(p_remarks)
      end,
      updated_at = now()
  where jo.id = p_job_order_id;

  delete from public.factory_production_step_executions execution
  where execution.job_order_id = p_job_order_id;

  if v_sop.id is null then return; end if;

  for v_step in
    select step.* from public.factory_production_sop_steps step
    where step.sop_id = v_sop.id
    order by step.step_no, step.id
  loop
    insert into public.factory_production_step_executions (
      job_order_id, production_sop_id, sop_step_id, step_no, step_name,
      description, sub_steps, status, updated_at
    ) values (
      p_job_order_id, v_sop.id, v_step.id, v_step.step_no,
      coalesce(nullif(v_step.process_name, ''), nullif(v_step.instruction, ''), 'Step ' || v_step.step_no),
      coalesce(v_step.description, v_step.instruction),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sequence_no', sub.sequence_no,
          'instruction', sub.instruction,
          'estimated_minutes', sub.estimated_minutes,
          'remarks', sub.remarks
        ) order by sub.sequence_no, sub.id)
        from public.factory_production_sop_sub_steps sub
        where sub.sop_step_id = v_step.id
      ), '[]'::jsonb),
      'pending', now()
    ) returning id into v_step_execution_id;

    insert into public.factory_production_qc_results (
      job_order_id, production_step_execution_id, sop_qc_check_id,
      sequence_no, qc_type, qc_name, instructions, is_required, updated_at
    )
    select p_job_order_id, v_step_execution_id, qc.id,
      qc.sequence_no, qc.qc_type, qc.qc_name, qc.instructions, qc.is_required, now()
    from public.factory_production_sop_step_qc_checks qc
    where qc.sop_step_id = v_step.id
    order by qc.sequence_no, qc.id;

    -- Legacy single-QC SOPs remain executable without mutating the SOP definition.
    if v_step.is_qc_checkpoint = true and not exists (
      select 1 from public.factory_production_qc_results result
      where result.production_step_execution_id = v_step_execution_id
    ) then
      insert into public.factory_production_qc_results (
        job_order_id, production_step_execution_id, sequence_no, qc_type,
        qc_name, instructions, is_required, updated_at
      ) values (
        p_job_order_id, v_step_execution_id, 1, 'checklist',
        coalesce(nullif(v_step.qc_label, ''), nullif(v_step.control_point, ''), 'QC Check'),
        nullif(v_step.qc_target_value, ''), true, now()
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.factory_start_job_order(uuid, uuid, text, date, time, text, uuid) to authenticated;
revoke execute on function public.factory_start_job_order(uuid, uuid, text, date, time, text, uuid) from public, anon;

create or replace function public.factory_get_production_qc_status(
  p_job_order_id uuid default null,
  p_production_id uuid default null
)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_total integer;
  v_entered integer;
  v_failed integer;
  v_required_incomplete integer;
begin
  select
    count(*),
    count(*) filter (where
      (result.qc_type = 'checklist' and result.checklist_result is not null)
      or (result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is not null)
    ),
    count(*) filter (where result.qc_type = 'checklist' and result.checklist_result = 'fail'),
    count(*) filter (where result.is_required and (
      (result.qc_type = 'checklist' and (
        result.checklist_result is null
        or (result.checklist_result = 'na' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
      ))
      or (result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
    ))
  into v_total, v_entered, v_failed, v_required_incomplete
  from public.factory_production_qc_results result
  where (p_job_order_id is not null and result.job_order_id = p_job_order_id)
     or (p_job_order_id is null and p_production_id is not null and result.production_id = p_production_id);

  if v_total = 0 then return 'No QC Required'; end if;
  if v_entered = 0 then return 'Not Started'; end if;
  if v_failed > 0 then return 'Failed'; end if;
  if v_required_incomplete > 0 then return 'In Progress'; end if;
  return 'Passed';
end;
$$;

revoke execute on function public.factory_get_production_qc_status(uuid, uuid) from public, anon, authenticated;

-- QC progress is scoped to the locked Job Order and its database-created
-- execution snapshot. The deployment is single-company; callers cannot supply
-- a company/workspace key or redirect result ownership through the payload.
create or replace function public.factory_save_production_qc_progress(
  p_job_order_id uuid,
  p_steps jsonb,
  p_results jsonb,
  p_actor_id uuid default null,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_item jsonb;
  v_status text;
  v_result text;
  v_remarks text;
  v_qc_type text;
  v_required boolean;
  v_existing_step_status text;
  v_existing_result text;
  v_existing_remarks text;
  v_changed boolean := false;
  v_previous_status text;
  v_current_status text;
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_required_total integer;
  v_required_completed integer;
begin
  if not (
    public.current_user_has_permission('factory_production.complete')
    or public.current_user_has_permission('factory_production.edit')
  ) then
    raise exception 'Missing permission to update Production QC.';
  end if;

  select jo.* into v_job_order
  from public.factory_job_orders jo
  where jo.id = p_job_order_id
  for update;
  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'in_progress' then
    raise exception 'Production QC can only be updated while the Job Order is In Progress.';
  end if;
  if v_job_order.qc_snapshot_created_at is null then
    raise exception 'This legacy production has no QC execution snapshot.';
  end if;

  v_previous_status := public.factory_get_production_qc_status(p_job_order_id, null);

  for v_item in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_status := lower(coalesce(v_item->>'status', 'pending'));
    if v_status not in ('pending', 'completed') then raise exception 'Invalid production step status.'; end if;

    select execution.status into v_existing_step_status
    from public.factory_production_step_executions execution
    where execution.id = nullif(v_item->>'id', '')::uuid
      and execution.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'Production step does not belong to this Job Order.'; end if;

    if v_existing_step_status is distinct from v_status then
      update public.factory_production_step_executions execution
      set status = v_status,
          completed_by = case when v_status = 'completed' then coalesce(p_actor_id, execution.completed_by) else null end,
          completed_at = case when v_status = 'completed' then coalesce(execution.completed_at, now()) else null end,
          updated_at = now()
      where execution.id = nullif(v_item->>'id', '')::uuid
        and execution.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    select result.qc_type, result.is_required, result.checklist_result,
           nullif(btrim(coalesce(result.remarks, '')), '')
    into v_qc_type, v_required, v_existing_result, v_existing_remarks
    from public.factory_production_qc_results result
    where result.id = nullif(v_item->>'id', '')::uuid
      and result.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'QC result does not belong to this Job Order.'; end if;

    v_result := nullif(lower(btrim(coalesce(v_item->>'checklist_result', ''))), '');
    v_remarks := nullif(btrim(coalesce(v_item->>'remarks', '')), '');
    if v_qc_type = 'checklist' and v_result is not null and v_result not in ('pass', 'fail', 'na') then
      raise exception 'Checklist result must be Pass, Fail or N/A.';
    end if;
    if v_qc_type = 'remarks' then v_result := null; end if;
    if v_result = 'na' and v_remarks is null then
      raise exception 'Add a reason when selecting N/A.';
    end if;

    if v_existing_result is distinct from v_result or v_existing_remarks is distinct from v_remarks then
      update public.factory_production_qc_results result
      set checklist_result = v_result,
          remarks = v_remarks,
          checked_by = case when v_result is not null or v_remarks is not null then coalesce(p_actor_id, result.checked_by) else null end,
          checked_by_name = case when v_result is not null or v_remarks is not null then coalesce(nullif(btrim(coalesce(p_actor_name, '')), ''), result.checked_by_name) else null end,
          checked_at = case when v_result is not null or v_remarks is not null then now() else null end,
          updated_at = now()
      where result.id = nullif(v_item->>'id', '')::uuid
        and result.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  select count(*),
         count(*) filter (where (qc_type = 'checklist' and checklist_result is not null) or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)),
         count(*) filter (where qc_type = 'checklist' and checklist_result = 'fail'),
         count(*) filter (where is_required),
         count(*) filter (where is_required and (
           (qc_type = 'checklist' and checklist_result is not null and (checklist_result <> 'na' or nullif(btrim(coalesce(remarks, '')), '') is not null))
           or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)
         ))
  into v_total, v_completed, v_failed, v_required_total, v_required_completed
  from public.factory_production_qc_results result
  where result.job_order_id = p_job_order_id;

  v_current_status := public.factory_get_production_qc_status(p_job_order_id, null);

  return jsonb_build_object(
    'changed', v_changed or v_previous_status is distinct from v_current_status,
    'previous_status', v_previous_status,
    'current_status', v_current_status,
    'total', v_total,
    'completed', v_completed,
    'failed', v_failed,
    'required_total', v_required_total,
    'required_completed', v_required_completed
  );
end;
$$;

grant execute on function public.factory_save_production_qc_progress(uuid, jsonb, jsonb, uuid, text) to authenticated;
revoke execute on function public.factory_save_production_qc_progress(uuid, jsonb, jsonb, uuid, text) from public, anon;

-- Server-side completion guard. Raising here aborts the existing completion RPC
-- before any material deduction or finished-goods stock-in can commit.
create or replace function public.factory_guard_production_qc_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
begin
  if lower(coalesce(new.status, '')) <> 'completed' or new.job_order_id is null then return new; end if;

  select jo.* into v_job_order
  from public.factory_job_orders jo
  where jo.id = new.job_order_id
  for update;
  if not found or v_job_order.qc_snapshot_created_at is null then return new; end if;

  if v_job_order.production_sop_id is not null
     and exists (
       select 1
       from public.factory_production_sop_steps step
       join public.factory_production_sop_step_qc_checks qc on qc.sop_step_id = step.id
       where step.sop_id = v_job_order.production_sop_id and qc.is_required = true
     )
     and not exists (
       select 1 from public.factory_production_qc_results result
       where result.job_order_id = new.job_order_id and result.is_required = true
     ) then
    raise exception 'Complete all required QC checks before completing production.';
  end if;

  if exists (
    select 1 from public.factory_production_qc_results result
    where result.job_order_id = new.job_order_id
      and result.is_required = true
      and (
        (result.qc_type = 'checklist' and (
          result.checklist_result is null
          or (result.checklist_result = 'na' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
        ))
        or (result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
      )
  ) then
    raise exception 'Complete all required QC checks before completing production.';
  end if;

  if exists (
    select 1 from public.factory_production_qc_results result
    where result.job_order_id = new.job_order_id
      and result.is_required = true
      and result.qc_type = 'checklist'
      and result.checklist_result = 'fail'
  ) then
    raise exception 'Production has failed QC checks that require review.';
  end if;

  new.production_sop_id := coalesce(new.production_sop_id, v_job_order.production_sop_id);
  new.sop_version := coalesce(nullif(new.sop_version, ''), v_job_order.sop_version);
  new.qc_status := public.factory_get_production_qc_status(new.job_order_id, null);
  return new;
end;
$$;

drop trigger if exists factory_guard_production_qc_completion_trigger on public.factory_productions;
create trigger factory_guard_production_qc_completion_trigger
before insert on public.factory_productions
for each row execute function public.factory_guard_production_qc_completion();

create or replace function public.factory_attach_production_qc_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_order_id is not null and lower(coalesce(new.status, '')) = 'completed' then
    update public.factory_production_step_executions execution
    set production_id = new.id, updated_at = now()
    where execution.job_order_id = new.job_order_id and execution.production_id is null;

    update public.factory_production_qc_results result
    set production_id = new.id, updated_at = now()
    where result.job_order_id = new.job_order_id and result.production_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_attach_production_qc_snapshot_trigger on public.factory_productions;
create trigger factory_attach_production_qc_snapshot_trigger
after insert on public.factory_productions
for each row execute function public.factory_attach_production_qc_snapshot();

revoke execute on function public.factory_guard_production_qc_completion() from public, anon, authenticated;
revoke execute on function public.factory_attach_production_qc_snapshot() from public, anon, authenticated;

create or replace function public.factory_guard_job_order_qc_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_sop_id uuid;
begin
  if lower(coalesce(old.status, '')) = 'in_progress'
     and (
       new.production_sop_id is distinct from old.production_sop_id
       or new.sop_version is distinct from old.sop_version
       or new.qc_snapshot_created_at is distinct from old.qc_snapshot_created_at
     ) then
    raise exception 'Production SOP/QC snapshot is immutable after Production starts.';
  end if;

  if lower(coalesce(old.status, '')) = 'released' and lower(coalesce(new.status, '')) = 'in_progress' then
    if new.qc_snapshot_created_at is null then
      raise exception 'Start Production through factory_start_job_order so QC can be snapshotted.';
    end if;
    select sop.id into v_expected_sop_id
    from public.factory_finished_goods fg
    join public.factory_production_sops sop on sop.finished_good_id = fg.product_family_id
    where fg.id = new.finished_good_id and lower(coalesce(sop.status, '')) = 'active'
    order by sop.updated_at desc, sop.id desc
    limit 1;
    if new.production_sop_id is distinct from v_expected_sop_id then
      raise exception 'Production must snapshot the active SOP for the selected Finished Good.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_guard_job_order_qc_snapshot_trigger on public.factory_job_orders;
create trigger factory_guard_job_order_qc_snapshot_trigger
before update on public.factory_job_orders
for each row execute function public.factory_guard_job_order_qc_snapshot();

revoke execute on function public.factory_guard_job_order_qc_snapshot() from public, anon, authenticated;
