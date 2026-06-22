alter table public.factory_production_sops
  add column if not exists finished_good_id uuid references public.factory_product_families(id),
  add column if not exists estimated_minutes integer,
  add column if not exists remarks text;

alter table public.factory_production_sop_steps
  add column if not exists qc_label text,
  add column if not exists remarks text;

drop policy if exists "factory sops manage" on public.factory_production_sops;
drop policy if exists "factory sops insert draft archived" on public.factory_production_sops;
drop policy if exists "factory sops update draft archived" on public.factory_production_sops;
drop policy if exists "factory sops update draft" on public.factory_production_sops;
drop policy if exists "factory sops archive active" on public.factory_production_sops;
drop policy if exists "factory sops restore archived" on public.factory_production_sops;
drop policy if exists "factory sops delete draft" on public.factory_production_sops;
drop policy if exists "factory sop steps manage" on public.factory_production_sop_steps;
drop policy if exists "factory sop steps insert draft parent" on public.factory_production_sop_steps;
drop policy if exists "factory sop steps update draft parent" on public.factory_production_sop_steps;
drop policy if exists "factory sop steps delete draft parent" on public.factory_production_sop_steps;

create policy "factory sops insert draft archived" on public.factory_production_sops
for insert to authenticated
with check (
  (
    public.current_user_has_permission('factory_production_sop.create')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, 'draft')) in ('draft', 'archived')
);

create policy "factory sops update draft" on public.factory_production_sops
for update to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'draft'
)
with check (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, 'draft')) in ('draft', 'archived')
);

create policy "factory sops archive active" on public.factory_production_sops
for update to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'active'
)
with check (
  (
    public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'archived'
);

create policy "factory sops restore archived" on public.factory_production_sops
for update to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'archived'
)
with check (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'draft'
);

create policy "factory sops delete draft" on public.factory_production_sops
for delete to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and lower(coalesce(status, '')) = 'draft'
);

create policy "factory sop steps insert draft parent" on public.factory_production_sop_steps
for insert to authenticated
with check (
  (
    public.current_user_has_permission('factory_production_sop.create')
    or public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and exists (
    select 1
    from public.factory_production_sops s
    where s.id = sop_id
      and lower(coalesce(s.status, '')) = 'draft'
  )
);

create policy "factory sop steps update draft parent" on public.factory_production_sop_steps
for update to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and exists (
    select 1
    from public.factory_production_sops s
    where s.id = sop_id
      and lower(coalesce(s.status, '')) = 'draft'
  )
)
with check (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and exists (
    select 1
    from public.factory_production_sops s
    where s.id = sop_id
      and lower(coalesce(s.status, '')) = 'draft'
  )
);

create policy "factory sop steps delete draft parent" on public.factory_production_sop_steps
for delete to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.delete')
    or public.current_user_has_permission('factory_production_sop.manage')
  )
  and exists (
    select 1
    from public.factory_production_sops s
    where s.id = sop_id
      and lower(coalesce(s.status, '')) = 'draft'
  )
);

do $$
begin
  if not exists (
    select 1
    from public.factory_production_sops
    where finished_good_id is not null
      and lower(coalesce(status, '')) = 'active'
    group by finished_good_id
    having count(*) > 1
  ) then
    create unique index if not exists factory_production_sops_one_active_finished_good_idx
      on public.factory_production_sops(finished_good_id)
      where finished_good_id is not null and lower(coalesce(status, '')) = 'active';
  end if;
end $$;

create or replace function public.factory_activate_production_sop(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sop public.factory_production_sops%rowtype;
  v_lock_key text;
begin
  if not (
    public.current_user_has_permission('factory_production_sop.edit')
    or public.current_user_has_permission('factory_production_sop.manage')
  ) then
    raise exception 'Missing permission: factory_production_sop.edit';
  end if;

  select *
  into v_sop
  from public.factory_production_sops
  where id = p_sop_id
  for update;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  if lower(coalesce(v_sop.status, '')) <> 'draft' then
    raise exception 'Only draft Production SOPs can be activated.';
  end if;

  v_lock_key := coalesce(v_sop.finished_good_id::text, lower(coalesce(v_sop.product_name, 'unassigned')));
  perform pg_advisory_xact_lock(hashtext('factory_production_sop:' || v_lock_key));

  update public.factory_production_sops s
  set status = 'archived',
      updated_at = now()
  where s.id <> v_sop.id
    and lower(coalesce(s.status, '')) = 'active'
    and (
      (v_sop.finished_good_id is not null and s.finished_good_id = v_sop.finished_good_id)
      or (v_sop.finished_good_id is null and lower(coalesce(s.product_name, '')) = lower(coalesce(v_sop.product_name, '')))
    );

  update public.factory_production_sops
  set status = 'active',
      updated_at = now()
  where id = v_sop.id;

  return jsonb_build_object('sop_id', v_sop.id);
end;
$$;

grant execute on function public.factory_activate_production_sop(uuid) to authenticated;

create or replace function public.factory_create_production_sop_new_version(p_source_sop_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source public.factory_production_sops%rowtype;
  v_new_id uuid;
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

  select *
  into v_source
  from public.factory_production_sops
  where id = p_source_sop_id;

  if not found then
    raise exception 'Production SOP not found.';
  end if;

  v_lock_key := coalesce(v_source.finished_good_id::text, lower(coalesce(v_source.product_name, 'unassigned')));
  perform pg_advisory_xact_lock(hashtext('factory_production_sop:' || v_lock_key));

  select coalesce(max(nullif(regexp_replace(coalesce(s.version, ''), '[^0-9]', '', 'g'), '')::integer), 0) + 1
  into v_next_version
  from public.factory_production_sops s
  where (
    (v_source.finished_good_id is not null and s.finished_good_id = v_source.finished_good_id)
    or (v_source.finished_good_id is null and lower(coalesce(s.product_name, '')) = lower(coalesce(v_source.product_name, '')))
  );

  insert into public.factory_production_sops (
    sop_code,
    title,
    product_name,
    finished_good_id,
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
    'SOP-' || to_char(now(), 'YYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4)),
    v_source.title,
    v_source.product_name,
    v_source.finished_good_id,
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
    safety_note,
    remarks,
    updated_at
  )
  select
    v_new_id,
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
    safety_note,
    remarks,
    now()
  from public.factory_production_sop_steps
  where sop_id = v_source.id
  order by step_no, id;

  return jsonb_build_object('sop_id', v_new_id, 'version', 'v' || v_next_version::text);
end;
$$;

grant execute on function public.factory_create_production_sop_new_version(uuid) to authenticated;
