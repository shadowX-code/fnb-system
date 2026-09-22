-- FeedX Crew Learn product reset.
--
-- Generic Journey records remain intact for history compatibility, while the
-- product-facing model becomes one mandatory, outlet-scoped onboarding lineage
-- plus an outlet-scoped SOP knowledge base. Existing assignment snapshots,
-- progress, attempts and acknowledgements are never rewritten.

alter table public.crew_journeys
  add column if not exists lineage_id uuid default gen_random_uuid(),
  add column if not exists is_mandatory_onboarding boolean not null default false;

alter table public.crew_journey_assignments
  add column if not exists enrollment_source text not null default 'admin'
  check (enrollment_source in ('automatic', 'admin', 'legacy'));

update public.crew_journey_assignments
set enrollment_source = 'legacy'
where enrollment_source = 'admin';

-- Published Phase B content is immutable. This compatibility migration uses
-- the existing transaction-scoped lifecycle lock only for outlet/lineage
-- metadata backfill; module, lesson, quiz, SOP version and section content are
-- never changed. Fresh databases have no Auth actor or legacy rows and skip it.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', actor.id, 'role', 'authenticated')::text,
  true
)
from auth.users actor
order by actor.created_at, actor.id
limit 1;

insert into public.crew_learning_transition_locks(transaction_id, actor_id)
select txid_current(), auth.uid()
where auth.uid() is not null
on conflict (transaction_id) do update
set actor_id = excluded.actor_id,
    created_at = now();

-- Infer a legacy Journey outlet only when its assignment history points to one
-- and only one Crew outlet. Ambiguous/global legacy content stays unscoped and
-- is therefore excluded from the new outlet-specific product UI.
with inferred as (
  select a.journey_id, min(ca.primary_outlet_id::text)::uuid as outlet_id
  from public.crew_journey_assignments a
  join public.crew_access ca on ca.employee_id = a.employee_id
  where ca.primary_outlet_id is not null
  group by a.journey_id
  having count(distinct ca.primary_outlet_id) = 1
)
update public.crew_journeys j
set outlet_id = inferred.outlet_id
from inferred
where j.id = inferred.journey_id
  and j.outlet_id is null;

-- Carry the uniquely inferred outlet across sibling versions of the same
-- legacy Journey without changing their immutable content.
with inferred as (
  select lower(btrim(name)) as name_key,
         journey_type,
         min(outlet_id::text)::uuid as outlet_id
  from public.crew_journeys
  where outlet_id is not null
  group by lower(btrim(name)), journey_type
  having count(distinct outlet_id) = 1
)
update public.crew_journeys j
set outlet_id = inferred.outlet_id
from inferred
where j.outlet_id is null
  and lower(btrim(j.name)) = inferred.name_key
  and j.journey_type = inferred.journey_type;

update public.crew_journeys
set is_mandatory_onboarding = true
where journey_type = 'onboarding'
  and outlet_id is not null
  and lower(btrim(name)) = 'new crew onboarding';

with lineage as (
  select id,
         first_value(id) over (
           partition by lower(btrim(name)), journey_type, outlet_id
           order by version, created_at, id
         ) as canonical_lineage_id
  from public.crew_journeys
)
update public.crew_journeys j
set lineage_id = lineage.canonical_lineage_id
from lineage
where j.id = lineage.id;

alter table public.crew_journeys alter column lineage_id set not null;

create unique index if not exists crew_journey_lineage_version_unique
  on public.crew_journeys(lineage_id, version);
create index if not exists crew_mandatory_onboarding_outlet_version_idx
  on public.crew_journeys(outlet_id, version desc)
  where is_mandatory_onboarding and status = 'published';
create unique index if not exists crew_mandatory_onboarding_single_draft_idx
  on public.crew_journeys(outlet_id)
  where is_mandatory_onboarding and status = 'draft';

create table public.crew_sop_categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crew_sop_categories_outlet_name_unique
  on public.crew_sop_categories(outlet_id, lower(btrim(name)));
alter table public.crew_sop_categories enable row level security;
revoke all on table public.crew_sop_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.crew_sop_categories to authenticated;

create policy crew_sop_categories_admin
on public.crew_sop_categories
for all
to authenticated
using (
  public.current_user_has_permission('crew_sop.manage')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('crew_sop.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

alter table public.crew_sops
  add column if not exists category_id uuid references public.crew_sop_categories(id) on delete restrict;

-- Infer SOP ownership only through outlet-scoped Journey references where the
-- reference resolves to exactly one outlet.
with inferred as (
  select (b.payload->>'sop_id')::uuid as sop_id,
         min(j.outlet_id::text)::uuid as outlet_id
  from public.crew_lesson_blocks b
  join public.crew_lessons l on l.id = b.lesson_id
  join public.crew_journey_modules m on m.id = l.module_id
  join public.crew_journeys j on j.id = m.journey_id
  where b.block_type = 'sop_reference'
    and b.payload ? 'sop_id'
    and j.outlet_id is not null
  group by (b.payload->>'sop_id')::uuid
  having count(distinct j.outlet_id) = 1
)
update public.crew_sops s
set outlet_id = inferred.outlet_id
from inferred
where s.id = inferred.sop_id
  and s.outlet_id is null;

insert into public.crew_sop_categories(outlet_id, name, sort_order)
select distinct s.outlet_id,
       coalesce(nullif(btrim(s.category), ''), 'Other'),
       case lower(coalesce(nullif(btrim(s.category), ''), 'Other'))
         when 'service' then 10
         when 'cleaning' then 20
         when 'opening & closing' then 30
         when 'cashier' then 40
         when 'kitchen' then 50
         else 90
       end
from public.crew_sops s
where s.outlet_id is not null
on conflict do nothing;

update public.crew_sops s
set category_id = c.id,
    category = c.name
from public.crew_sop_categories c
where s.outlet_id = c.outlet_id
  and lower(btrim(coalesce(s.category, 'Other'))) = lower(btrim(c.name))
  and s.category_id is null;

delete from public.crew_learning_transition_locks
where transaction_id = txid_current();
select set_config('request.jwt.claims', '{}'::text, true);

create or replace function public.crew_guard_sop_category_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  category_row public.crew_sop_categories%rowtype;
begin
  if new.category_id is null then
    return new;
  end if;

  select * into category_row
  from public.crew_sop_categories
  where id = new.category_id;

  if not found or new.outlet_id is null or category_row.outlet_id <> new.outlet_id then
    raise exception using errcode = '22023', message = 'SOP category must belong to the same outlet.';
  end if;

  new.category := category_row.name;
  return new;
end;
$$;
revoke all on function public.crew_guard_sop_category_scope() from public, anon, authenticated;

create trigger crew_guard_sop_category_scope
before insert or update of category_id, outlet_id
on public.crew_sops
for each row execute function public.crew_guard_sop_category_scope();

-- Tighten the Admin boundary: unscoped legacy content is retained but is no
-- longer visible through the outlet-based Learning product.
create or replace function public.crew_learning_admin_can_access_journey(p_journey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_has_permission('crew_learning.manage')
    and exists (
      select 1
      from public.crew_journeys j
      where j.id = p_journey_id
        and j.outlet_id is not null
        and public.current_user_can_access_outlet(j.outlet_id)
    );
$$;
revoke all on function public.crew_learning_admin_can_access_journey(uuid) from public, anon, authenticated;
grant execute on function public.crew_learning_admin_can_access_journey(uuid) to authenticated;

create or replace function public.crew_sop_admin_can_access_sop(p_sop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_has_permission('crew_sop.manage')
    and exists (
      select 1
      from public.crew_sops s
      where s.id = p_sop_id
        and s.outlet_id is not null
        and public.current_user_can_access_outlet(s.outlet_id)
    );
$$;
revoke all on function public.crew_sop_admin_can_access_sop(uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_admin_can_access_sop(uuid) to authenticated;

alter policy crew_learning_admin_journeys
on public.crew_journeys
using (
  public.current_user_has_permission('crew_learning.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('crew_learning.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

alter policy crew_sop_admin
on public.crew_sops
using (
  public.current_user_has_permission('crew_sop.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('crew_sop.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

create or replace function public.crew_current_onboarding_for_outlet(p_outlet_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.id
  from public.crew_journeys j
  where j.outlet_id = p_outlet_id
    and j.is_mandatory_onboarding
    and j.status = 'published'
  order by j.version desc, j.published_at desc nulls last, j.created_at desc
  limit 1;
$$;
revoke all on function public.crew_current_onboarding_for_outlet(uuid) from public, anon, authenticated;

create or replace function public.crew_ensure_onboarding_assignment(p_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_row public.employees%rowtype;
  access_row public.crew_access%rowtype;
  onboarding_id uuid;
  existing_assignment_id uuid;
  onboarding_row public.crew_journeys%rowtype;
  snapshot jsonb;
begin
  select * into employee_row
  from public.employees
  where id = p_employee_id;

  select * into access_row
  from public.crew_access
  where employee_id = p_employee_id;

  if employee_row.id is null
     or access_row.employee_id is null
     or access_row.access_state <> 'active'
     or access_row.primary_outlet_id is null
     or coalesce(employee_row.employment_status, 'active') in ('resigned', 'terminated') then
    return null;
  end if;

  -- A Crew member keeps the first mandatory onboarding snapshot for an outlet,
  -- including after completion. Publishing a new version does not silently
  -- replace or mutate that employee's learning history.
  select a.id into existing_assignment_id
  from public.crew_journey_assignments a
  join public.crew_journeys j on j.id = a.journey_id
  where a.employee_id = p_employee_id
    and j.is_mandatory_onboarding
    and j.outlet_id = access_row.primary_outlet_id
  order by a.assigned_at desc
  limit 1;

  if existing_assignment_id is not null then
    return existing_assignment_id;
  end if;

  onboarding_id := public.crew_current_onboarding_for_outlet(access_row.primary_outlet_id);
  if onboarding_id is null then
    return null;
  end if;

  select * into onboarding_row
  from public.crew_journeys
  where id = onboarding_id;

  snapshot := public.crew_assignment_snapshot(onboarding_id);

  insert into public.crew_journey_assignments(
    employee_id,
    journey_id,
    journey_version_assigned,
    assigned_by,
    journey_snapshot,
    enrollment_source
  )
  values (
    p_employee_id,
    onboarding_id,
    onboarding_row.version,
    null,
    snapshot,
    'automatic'
  )
  on conflict (employee_id, journey_id, journey_version_assigned)
  do nothing
  returning id into existing_assignment_id;

  if existing_assignment_id is null then
    select id into existing_assignment_id
    from public.crew_journey_assignments
    where employee_id = p_employee_id
      and journey_id = onboarding_id
      and journey_version_assigned = onboarding_row.version;
  end if;

  return existing_assignment_id;
end;
$$;
revoke all on function public.crew_ensure_onboarding_assignment(uuid) from public, anon, authenticated;

create or replace function public.crew_auto_enroll_on_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.access_state = 'active' and new.primary_outlet_id is not null then
    perform public.crew_ensure_onboarding_assignment(new.employee_id);
  end if;
  return new;
end;
$$;
revoke all on function public.crew_auto_enroll_on_access_change() from public, anon, authenticated;

create trigger crew_auto_enroll_on_access_change
after insert or update of access_state, primary_outlet_id
on public.crew_access
for each row execute function public.crew_auto_enroll_on_access_change();

create or replace function public.crew_sync_onboarding_enrollments(p_outlet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_row record;
  assignment_id uuid;
  enrolled_count integer := 0;
  eligible_count integer := 0;
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot manage onboarding for this outlet.';
  end if;

  for employee_row in
    select ca.employee_id
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    where ca.primary_outlet_id = p_outlet_id
      and ca.access_state = 'active'
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  loop
    eligible_count := eligible_count + 1;
    assignment_id := public.crew_ensure_onboarding_assignment(employee_row.employee_id);
    if assignment_id is not null then
      enrolled_count := enrolled_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'outlet_id', p_outlet_id,
    'eligible_count', eligible_count,
    'enrolled_count', enrolled_count
  );
end;
$$;
revoke all on function public.crew_sync_onboarding_enrollments(uuid) from public, anon, authenticated;
grant execute on function public.crew_sync_onboarding_enrollments(uuid) to authenticated;

create or replace function public.crew_create_default_onboarding(p_outlet_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  journey_id uuid;
  module_id uuid;
  lineage_id uuid := gen_random_uuid();
  module_record record;
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot create onboarding for this outlet.';
  end if;

  if exists (
    select 1 from public.crew_journeys
    where outlet_id = p_outlet_id
      and is_mandatory_onboarding
      and status in ('draft', 'published')
  ) then
    raise exception using errcode = '23505', message = 'This outlet already has an onboarding setup.';
  end if;

  insert into public.crew_journeys(
    name,
    description,
    journey_type,
    status,
    version,
    estimated_minutes,
    sequential_modules,
    outlet_id,
    position,
    created_by,
    lineage_id,
    is_mandatory_onboarding
  )
  values (
    'New Crew Onboarding',
    'Essential onboarding for every new restaurant Crew member.',
    'onboarding',
    'draft',
    1,
    120,
    true,
    p_outlet_id,
    'Mandatory for all Crew',
    auth.uid(),
    lineage_id,
    true
  )
  returning id into journey_id;

  for module_record in
    select * from (values
      (1, 'Welcome & Workplace', 'Meet the workplace, team and service expectations.'),
      (2, 'Customer Arrival & Greeting', 'Build a warm and consistent guest welcome.'),
      (3, 'Taking Orders', 'Learn the outlet order-taking flow and accuracy standards.'),
      (4, 'Serving & Table Service', 'Deliver orders and support guests with confidence.'),
      (5, 'Cleaning & Hygiene', 'Follow personal, food-safety and workplace hygiene standards.'),
      (6, 'Take Away & Packaging', 'Prepare takeaway orders accurately and consistently.'),
      (7, 'Opening & Closing', 'Understand shift-opening and closing responsibilities.'),
      (8, 'Final & Role Readiness', 'Review the essentials before independent shift work.')
    ) as modules(sort_order, title, description)
  loop
    insert into public.crew_journey_modules(
      journey_id, title, description, sort_order, estimated_minutes, required, status
    ) values (
      journey_id, module_record.title, module_record.description,
      module_record.sort_order, 15, true, 'draft'
    ) returning id into module_id;

    insert into public.crew_lessons(
      module_id, title, sort_order, content_type, required, estimated_minutes
    ) values (
      module_id, module_record.title || ' essentials', 1, 'lesson', true, 15
    );
  end loop;

  return journey_id;
end;
$$;
revoke all on function public.crew_create_default_onboarding(uuid) from public, anon, authenticated;
grant execute on function public.crew_create_default_onboarding(uuid) to authenticated;

create or replace function public.crew_clone_learning_setup(
  p_source_outlet_id uuid,
  p_target_outlet_id uuid,
  p_copy_onboarding boolean default true,
  p_copy_sop_categories boolean default true,
  p_copy_sops boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_journey public.crew_journeys%rowtype;
  source_module record;
  source_lesson record;
  source_block record;
  source_quiz record;
  source_question record;
  source_sop record;
  source_version record;
  source_category record;
  target_sop_id uuid;
  target_version_id uuid;
  target_category_id uuid;
  target_journey_id uuid;
  target_module_id uuid;
  target_lesson_id uuid;
  target_quiz_id uuid;
  target_question_id uuid;
  mapped_sop_id uuid;
  next_journey_version integer;
  cloned_sops integer := 0;
  cloned_categories integer := 0;
begin
  if p_source_outlet_id = p_target_outlet_id then
    raise exception using errcode = '22023', message = 'Choose a different source outlet.';
  end if;

  if not public.current_user_can_access_outlet(p_source_outlet_id)
     or not public.current_user_can_access_outlet(p_target_outlet_id) then
    raise exception using errcode = '42501', message = 'You need access to both outlets to clone learning.';
  end if;

  if p_copy_onboarding and not public.current_user_has_permission('crew_learning.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to clone onboarding.';
  end if;

  if (p_copy_sop_categories or p_copy_sops)
     and not public.current_user_has_permission('crew_sop.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to clone SOPs.';
  end if;

  if not p_copy_onboarding and not p_copy_sop_categories and not p_copy_sops then
    raise exception using errcode = '22023', message = 'Select at least one part of the learning setup.';
  end if;

  if p_copy_onboarding and exists (
    select 1 from public.crew_journeys
    where outlet_id = p_target_outlet_id
      and is_mandatory_onboarding
      and status in ('draft', 'published')
  ) then
    raise exception using errcode = '23505', message = 'The target outlet already has an onboarding setup.';
  end if;

  if p_copy_sops and exists (
    select 1 from public.crew_sops
    where outlet_id = p_target_outlet_id
      and status <> 'archived'
  ) then
    raise exception using errcode = '23505', message = 'The target outlet already has an SOP library.';
  end if;

  create temporary table if not exists pg_temp.crew_clone_sop_map (
    source_sop_id uuid primary key,
    target_sop_id uuid not null
  ) on commit drop;
  truncate table pg_temp.crew_clone_sop_map;

  if p_copy_sop_categories or p_copy_sops then
    for source_category in
      select * from public.crew_sop_categories
      where outlet_id = p_source_outlet_id
      order by sort_order, name
    loop
      select id into target_category_id
      from public.crew_sop_categories
      where outlet_id = p_target_outlet_id
        and lower(btrim(name)) = lower(btrim(source_category.name));

      if target_category_id is null then
        insert into public.crew_sop_categories(outlet_id, name, sort_order)
        values (p_target_outlet_id, source_category.name, source_category.sort_order)
        returning id into target_category_id;
      else
        update public.crew_sop_categories
        set sort_order = source_category.sort_order,
            updated_at = now()
        where id = target_category_id;
      end if;
      cloned_categories := cloned_categories + 1;
    end loop;
  end if;

  if p_copy_sops then
    for source_sop in
      select s.*
      from public.crew_sops s
      where s.outlet_id = p_source_outlet_id
        and s.status = 'published'
      order by s.category, s.title
    loop
      select c.id into target_category_id
      from public.crew_sop_categories source_c
      join public.crew_sop_categories c
        on c.outlet_id = p_target_outlet_id
       and lower(btrim(c.name)) = lower(btrim(source_c.name))
      where source_c.id = source_sop.category_id;

      insert into public.crew_sops(
        title, category, category_id, summary, status, current_version,
        outlet_id, position
      ) values (
        source_sop.title, source_sop.category, target_category_id,
        source_sop.summary, 'draft', null, p_target_outlet_id, source_sop.position
      ) returning id into target_sop_id;

      select v.* into source_version
      from public.crew_sop_versions v
      where v.sop_id = source_sop.id
        and v.status = 'published'
      order by v.version desc
      limit 1;

      insert into public.crew_sop_versions(
        sop_id, version, effective_date, change_summary, status,
        require_acknowledgement
      ) values (
        target_sop_id, 1, source_version.effective_date,
        'Cloned from ' || source_sop.title, 'draft',
        source_version.require_acknowledgement
      ) returning id into target_version_id;

      insert into public.crew_sop_sections(
        sop_version_id, title, body, sort_order, key_point, media_url
      )
      select target_version_id, title, body, sort_order, key_point, media_url
      from public.crew_sop_sections
      where sop_version_id = source_version.id
      order by sort_order;

      insert into pg_temp.crew_clone_sop_map(source_sop_id, target_sop_id)
      values (source_sop.id, target_sop_id);
      cloned_sops := cloned_sops + 1;
    end loop;
  end if;

  if p_copy_onboarding then
    select * into source_journey
    from public.crew_journeys
    where id = public.crew_current_onboarding_for_outlet(p_source_outlet_id);

    if source_journey.id is null then
      raise exception using errcode = 'P0002', message = 'The source outlet has no published onboarding setup.';
    end if;

    -- When SOPs are not cloned, every source reference must resolve to an
    -- independently published target SOP with the same title and category.
    if not p_copy_sops then
      insert into pg_temp.crew_clone_sop_map(source_sop_id, target_sop_id)
      select source_s.id, target_s.id
      from public.crew_sops source_s
      join public.crew_sops target_s
        on target_s.outlet_id = p_target_outlet_id
       and target_s.status = 'published'
       and lower(btrim(target_s.title)) = lower(btrim(source_s.title))
       and lower(btrim(target_s.category)) = lower(btrim(source_s.category))
      where source_s.outlet_id = p_source_outlet_id
      on conflict (source_sop_id) do update set target_sop_id = excluded.target_sop_id;

      if exists (
        select 1
        from public.crew_lesson_blocks b
        join public.crew_lessons l on l.id = b.lesson_id
        join public.crew_journey_modules m on m.id = l.module_id
        where m.journey_id = source_journey.id
          and b.block_type = 'sop_reference'
          and not exists (
            select 1 from pg_temp.crew_clone_sop_map map
            where map.source_sop_id = (b.payload->>'sop_id')::uuid
          )
      ) then
        raise exception using errcode = '22023', message = 'Clone the SOP Library or provide matching published SOPs in the target outlet.';
      end if;
    end if;

    select coalesce(max(version), 0) + 1 into next_journey_version
    from public.crew_journeys
    where outlet_id = p_target_outlet_id
      and is_mandatory_onboarding;

    insert into public.crew_journeys(
      name, description, journey_type, status, version, estimated_minutes,
      sequential_modules, outlet_id, position, created_by, lineage_id,
      is_mandatory_onboarding
    ) values (
      'New Crew Onboarding', source_journey.description, 'onboarding', 'draft',
      next_journey_version, source_journey.estimated_minutes, true,
      p_target_outlet_id, 'Mandatory for all Crew', auth.uid(), gen_random_uuid(), true
    ) returning id into target_journey_id;

    for source_module in
      select * from public.crew_journey_modules
      where journey_id = source_journey.id
      order by sort_order
    loop
      insert into public.crew_journey_modules(
        journey_id, title, description, sort_order, estimated_minutes, required, status
      ) values (
        target_journey_id, source_module.title, source_module.description,
        source_module.sort_order, source_module.estimated_minutes,
        source_module.required, 'draft'
      ) returning id into target_module_id;

      for source_lesson in
        select * from public.crew_lessons
        where module_id = source_module.id
        order by sort_order
      loop
        insert into public.crew_lessons(
          module_id, title, sort_order, content_type, required, estimated_minutes
        ) values (
          target_module_id, source_lesson.title, source_lesson.sort_order,
          source_lesson.content_type, source_lesson.required,
          source_lesson.estimated_minutes
        ) returning id into target_lesson_id;

        for source_block in
          select * from public.crew_lesson_blocks
          where lesson_id = source_lesson.id
          order by sort_order
        loop
          if source_block.block_type = 'sop_reference' then
            select map.target_sop_id into mapped_sop_id
            from pg_temp.crew_clone_sop_map map
            where map.source_sop_id = (source_block.payload->>'sop_id')::uuid;

            if mapped_sop_id is null then
              raise exception using errcode = '22023', message = 'A cloned onboarding SOP reference could not be mapped safely.';
            end if;

            insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
            values (
              target_lesson_id,
              source_block.block_type,
              jsonb_set(source_block.payload, '{sop_id}', to_jsonb(mapped_sop_id::text), true),
              source_block.sort_order
            );
          else
            insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
            values (target_lesson_id, source_block.block_type, source_block.payload, source_block.sort_order);
          end if;
        end loop;

        for source_quiz in
          select * from public.crew_quizzes
          where lesson_id = source_lesson.id
        loop
          insert into public.crew_quizzes(lesson_id, title, passing_score, status, required)
          values (target_lesson_id, source_quiz.title, source_quiz.passing_score, 'draft', source_quiz.required)
          returning id into target_quiz_id;

          for source_question in
            select * from public.crew_quiz_questions
            where quiz_id = source_quiz.id
            order by sort_order
          loop
            insert into public.crew_quiz_questions(
              quiz_id, prompt, question_type, explanation, sort_order
            ) values (
              target_quiz_id, source_question.prompt, source_question.question_type,
              source_question.explanation, source_question.sort_order
            ) returning id into target_question_id;

            insert into public.crew_quiz_options(question_id, label, is_correct, sort_order)
            select target_question_id, label, is_correct, sort_order
            from public.crew_quiz_options
            where question_id = source_question.id
            order by sort_order;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'target_outlet_id', p_target_outlet_id,
    'onboarding_id', target_journey_id,
    'sop_categories_cloned', cloned_categories,
    'sops_cloned', cloned_sops,
    'status', 'draft'
  );
end;
$$;
revoke all on function public.crew_clone_learning_setup(uuid, uuid, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.crew_clone_learning_setup(uuid, uuid, boolean, boolean, boolean) to authenticated;

-- Preserve lifecycle semantics while carrying mandatory-onboarding lineage into
-- a new editable version.
create or replace function public.crew_new_journey_version(p_journey_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_journey public.crew_journeys%rowtype;
  source_module record;
  source_lesson record;
  source_block record;
  source_quiz record;
  source_question record;
  new_journey uuid;
  new_module uuid;
  new_lesson uuid;
  new_quiz uuid;
  new_question uuid;
begin
  if not public.current_user_has_permission('crew_learning.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to version Crew learning.';
  end if;

  select * into source_journey
  from public.crew_journeys
  where id = p_journey_id
    and status = 'published';

  if not found then
    raise exception using errcode = '22023', message = 'Only a published Journey can be versioned.';
  end if;
  if not public.crew_learning_admin_can_access_journey(p_journey_id) then
    raise exception using errcode = '42501', message = 'You cannot version learning for this outlet.';
  end if;
  if source_journey.is_mandatory_onboarding and exists (
    select 1 from public.crew_journeys
    where outlet_id = source_journey.outlet_id
      and is_mandatory_onboarding
      and status = 'draft'
  ) then
    raise exception using errcode = '23505', message = 'This outlet already has draft onboarding changes.';
  end if;

  insert into public.crew_journeys(
    name, description, journey_type, status, version, estimated_minutes,
    sequential_modules, outlet_id, position, created_by, lineage_id,
    is_mandatory_onboarding
  ) values (
    source_journey.name, source_journey.description, source_journey.journey_type,
    'draft', source_journey.version + 1, source_journey.estimated_minutes,
    source_journey.sequential_modules, source_journey.outlet_id,
    source_journey.position, auth.uid(), source_journey.lineage_id,
    source_journey.is_mandatory_onboarding
  ) returning id into new_journey;

  for source_module in
    select * from public.crew_journey_modules
    where journey_id = p_journey_id order by sort_order
  loop
    insert into public.crew_journey_modules(
      journey_id, title, description, sort_order, estimated_minutes, required, status
    ) values (
      new_journey, source_module.title, source_module.description,
      source_module.sort_order, source_module.estimated_minutes,
      source_module.required, 'draft'
    ) returning id into new_module;

    for source_lesson in
      select * from public.crew_lessons
      where module_id = source_module.id order by sort_order
    loop
      insert into public.crew_lessons(
        module_id, title, sort_order, content_type, required, estimated_minutes
      ) values (
        new_module, source_lesson.title, source_lesson.sort_order,
        source_lesson.content_type, source_lesson.required,
        source_lesson.estimated_minutes
      ) returning id into new_lesson;

      insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
      select new_lesson, block_type, payload, sort_order
      from public.crew_lesson_blocks
      where lesson_id = source_lesson.id
      order by sort_order;

      for source_quiz in
        select * from public.crew_quizzes where lesson_id = source_lesson.id
      loop
        insert into public.crew_quizzes(lesson_id, title, passing_score, status, required)
        values (new_lesson, source_quiz.title, source_quiz.passing_score, 'draft', source_quiz.required)
        returning id into new_quiz;

        for source_question in
          select * from public.crew_quiz_questions
          where quiz_id = source_quiz.id order by sort_order
        loop
          insert into public.crew_quiz_questions(
            quiz_id, prompt, question_type, explanation, sort_order
          ) values (
            new_quiz, source_question.prompt, source_question.question_type,
            source_question.explanation, source_question.sort_order
          ) returning id into new_question;

          insert into public.crew_quiz_options(question_id, label, is_correct, sort_order)
          select new_question, label, is_correct, sort_order
          from public.crew_quiz_options
          where question_id = source_question.id
          order by sort_order;
        end loop;
      end loop;
    end loop;
  end loop;

  return new_journey;
end;
$$;
revoke all on function public.crew_new_journey_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_new_journey_version(uuid) to authenticated;

create or replace function public.crew_publish_journey(p_journey_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  journey_row public.crew_journeys%rowtype;
begin
  if not public.current_user_has_permission('crew_learning.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to publish Crew learning.';
  end if;

  select * into journey_row
  from public.crew_journeys
  where id = p_journey_id
    and status = 'draft';

  if not found then
    raise exception using errcode = '22023', message = 'Only a draft Journey can be published.';
  end if;
  if not public.crew_learning_admin_can_access_journey(p_journey_id) then
    raise exception using errcode = '42501', message = 'You cannot publish learning for this outlet.';
  end if;
  if journey_row.is_mandatory_onboarding and journey_row.outlet_id is null then
    raise exception using errcode = '22023', message = 'Mandatory onboarding requires an outlet.';
  end if;
  if journey_row.is_mandatory_onboarding and (
    select count(*) from public.crew_journey_modules where journey_id = p_journey_id
  ) <> 8 then
    raise exception using errcode = '22023', message = 'New Crew Onboarding must contain exactly eight modules.';
  end if;
  if not exists (
    select 1 from public.crew_journey_modules where journey_id = p_journey_id
  ) or exists (
    select 1
    from public.crew_journey_modules m
    where m.journey_id = p_journey_id
      and not exists (select 1 from public.crew_lessons l where l.module_id = m.id)
  ) then
    raise exception using errcode = '22023', message = 'Every module needs at least one lesson.';
  end if;
  if exists (
    select 1
    from public.crew_quizzes q
    join public.crew_lessons l on l.id = q.lesson_id
    join public.crew_journey_modules m on m.id = l.module_id
    where m.journey_id = p_journey_id
      and (
        not exists (select 1 from public.crew_quiz_questions qq where qq.quiz_id = q.id)
        or exists (
          select 1 from public.crew_quiz_questions qq
          where qq.quiz_id = q.id
            and not exists (select 1 from public.crew_quiz_options o where o.question_id = qq.id)
        )
        or not exists (
          select 1
          from public.crew_quiz_options o
          join public.crew_quiz_questions qq on qq.id = o.question_id
          where qq.quiz_id = q.id and o.is_correct
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'Each quiz needs questions, options and a correct answer.';
  end if;

  perform public.crew_begin_learning_transition();
  update public.crew_journeys
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_journey_id;
  update public.crew_journey_modules set status = 'published' where journey_id = p_journey_id;
  update public.crew_quizzes q
  set status = 'published'
  from public.crew_lessons l
  join public.crew_journey_modules m on m.id = l.module_id
  where q.lesson_id = l.id and m.journey_id = p_journey_id;
  perform public.crew_end_learning_transition();

  if journey_row.is_mandatory_onboarding then
    perform public.crew_sync_onboarding_enrollments(journey_row.outlet_id);
  end if;

  return p_journey_id;
end;
$$;
revoke all on function public.crew_publish_journey(uuid) from public, anon, authenticated;
grant execute on function public.crew_publish_journey(uuid) to authenticated;

create or replace function public.crew_learning_home(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  assignment_id uuid;
  assignment_row public.crew_journey_assignments%rowtype;
  required_total integer := 0;
  required_completed integer := 0;
  v_outlet_id uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id
  from public.crew_access
  where employee_id = v_employee_id;

  assignment_id := public.crew_ensure_onboarding_assignment(v_employee_id);

  if assignment_id is null then
    select a.id into assignment_id
    from public.crew_journey_assignments a
    join public.crew_journeys j on j.id = a.journey_id
    where a.employee_id = v_employee_id
      and j.is_mandatory_onboarding
    order by a.assigned_at desc
    limit 1;
  end if;

  if assignment_id is not null then
    select * into assignment_row
    from public.crew_journey_assignments
    where id = assignment_id;

    select count(*) into required_total
    from jsonb_array_elements(coalesce(assignment_row.journey_snapshot->'modules', '[]'::jsonb)) m
    cross join lateral jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where coalesce((l->'lesson'->>'required')::boolean, true);

    select count(*) into required_completed
    from public.crew_lesson_progress p
    where p.assignment_id = assignment_id
      and p.status = 'completed';
  end if;

  return jsonb_build_object(
    'outlet_id', v_outlet_id,
    'assignment', case when assignment_id is null then null else jsonb_build_object(
      'id', assignment_row.id,
      'status', assignment_row.status,
      'started_at', assignment_row.started_at,
      'completed_at', assignment_row.completed_at,
      'lessons_total', required_total,
      'lessons_completed', least(required_completed, required_total),
      'progress_percentage', case when required_total = 0 then 0 else round(100.0 * least(required_completed, required_total) / required_total) end,
      'enrollment_source', assignment_row.enrollment_source
    ) end,
    'onboarding_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', a.status,
        'completed_at', a.completed_at,
        'journey_name', a.journey_snapshot->'journey'->>'name',
        'journey_version', a.journey_version_assigned
      ) order by a.assigned_at desc)
      from public.crew_journey_assignments a
      join public.crew_journeys j on j.id = a.journey_id
      where a.employee_id = v_employee_id
        and j.is_mandatory_onboarding
    ), '[]'::jsonb),
    'sop_summary', jsonb_build_object(
      'published_count', (
        select count(*) from public.crew_sops s
        where s.outlet_id = v_outlet_id and s.status = 'published'
      ),
      'acknowledgement_required', (
        select count(*)
        from public.crew_sops s
        join public.crew_sop_versions v
          on v.sop_id = s.id and v.version = s.current_version and v.status = 'published'
        where s.outlet_id = v_outlet_id
          and s.status = 'published'
          and v.require_acknowledgement
          and not exists (
            select 1 from public.crew_sop_acknowledgements a
            where a.employee_id = v_employee_id and a.sop_version_id = v.id
          )
      )
    )
  );
end;
$$;
revoke all on function public.crew_learning_home(text) from public, anon, authenticated;
grant execute on function public.crew_learning_home(text) to anon, authenticated;

create or replace function public.crew_sop_library(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_outlet_id uuid;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id
  from public.crew_access
  where employee_id = v_employee_id;

  return jsonb_build_object(
    'outlet_id', v_outlet_id,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'sort_order', c.sort_order,
        'sop_count', (
          select count(*) from public.crew_sops s
          where s.category_id = c.id and s.status = 'published'
        )
      ) order by c.sort_order, c.name)
      from public.crew_sop_categories c
      where c.outlet_id = v_outlet_id
        and exists (
          select 1 from public.crew_sops s
          where s.category_id = c.id and s.status = 'published'
        )
    ), '[]'::jsonb),
    'sops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'summary', s.summary,
        'category', s.category,
        'category_id', s.category_id,
        'version_id', v.id,
        'version', v.version,
        'updated_at', coalesce(v.published_at, s.updated_at),
        'acknowledgement_required', v.require_acknowledgement,
        'acknowledged', exists (
          select 1 from public.crew_sop_acknowledgements a
          where a.employee_id = v_employee_id and a.sop_version_id = v.id
        )
      ) order by s.category, s.title)
      from public.crew_sops s
      join public.crew_sop_versions v
        on v.sop_id = s.id
       and v.version = s.current_version
       and v.status = 'published'
      where s.outlet_id = v_outlet_id
        and s.status = 'published'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.crew_sop_library(text) from public, anon, authenticated;
grant execute on function public.crew_sop_library(text) to anon, authenticated;

create or replace function public.crew_sop_version(p_token text, p_sop_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_outlet_id uuid;
  visible boolean := false;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id
  from public.crew_access
  where employee_id = v_employee_id;

  select exists (
    select 1
    from public.crew_sop_versions v
    join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id
      and v.status = 'published'
      and s.status = 'published'
      and s.outlet_id = v_outlet_id
  ) into visible;

  if not visible then
    select exists (
      select 1
      from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks', '[]'::jsonb)) b
      where a.employee_id = v_employee_id
        and b->>'block_type' = 'sop_reference'
        and b->'payload'->>'sop_version_id' = p_sop_version_id::text
    ) into visible;
  end if;

  if not visible then
    raise exception using errcode = '42501', message = 'SOP version is unavailable.';
  end if;

  return (
    select jsonb_build_object(
      'id', v.id,
      'version', v.version,
      'effective_date', v.effective_date,
      'change_summary', v.change_summary,
      'title', s.title,
      'category', s.category,
      'category_id', s.category_id,
      'summary', s.summary,
      'acknowledgement_required', v.require_acknowledgement,
      'sections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', section.id,
          'title', section.title,
          'body', section.body,
          'sort_order', section.sort_order,
          'key_point', section.key_point
        ) order by section.sort_order)
        from public.crew_sop_sections section
        where section.sop_version_id = v.id
      ), '[]'::jsonb),
      'acknowledged', exists (
        select 1 from public.crew_sop_acknowledgements a
        where a.employee_id = v_employee_id and a.sop_version_id = v.id
      )
    )
    from public.crew_sop_versions v
    join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id
      and v.status = 'published'
  );
end;
$$;
revoke all on function public.crew_sop_version(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_version(text, uuid) to anon, authenticated;

create or replace function public.crew_acknowledge_sop(
  p_token text,
  p_sop_version_id uuid,
  p_source text default 'journey'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_outlet_id uuid;
  visible boolean := false;
begin
  if p_source not in ('direct_library', 'journey', 'required_update') then
    raise exception using errcode = '22023', message = 'Unsupported SOP acknowledgement source.';
  end if;

  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id
  from public.crew_access
  where employee_id = v_employee_id;

  select exists (
    select 1
    from public.crew_sop_versions v
    join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id
      and v.status = 'published'
      and s.status = 'published'
      and s.outlet_id = v_outlet_id
  ) into visible;

  if not visible then
    select exists (
      select 1
      from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks', '[]'::jsonb)) b
      where a.employee_id = v_employee_id
        and b->>'block_type' = 'sop_reference'
        and b->'payload'->>'sop_version_id' = p_sop_version_id::text
    ) into visible;
  end if;

  if not visible then
    raise exception using errcode = '42501', message = 'SOP version is unavailable.';
  end if;

  insert into public.crew_sop_acknowledgements(employee_id, sop_version_id, source)
  values (v_employee_id, p_sop_version_id, p_source)
  on conflict (employee_id, sop_version_id) do nothing;

  return jsonb_build_object(
    'sop_version_id', p_sop_version_id,
    'acknowledged', true
  );
end;
$$;
revoke all on function public.crew_acknowledge_sop(text, uuid, text) from public, anon, authenticated;
grant execute on function public.crew_acknowledge_sop(text, uuid, text) to anon, authenticated;

create or replace function public.crew_admin_onboarding_progress(p_outlet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view onboarding progress for this outlet.';
  end if;

  perform public.crew_sync_onboarding_enrollments(p_outlet_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee', jsonb_build_object(
        'id', e.id,
        'full_name', e.full_name,
        'nickname', e.nickname,
        'position', e.position,
        'employee_code', e.employee_code
      ),
      'assignment_id', a.id,
      'status', coalesce(a.status, 'not_started'),
      'started_at', a.started_at,
      'completed_at', a.completed_at,
      'progress_percentage', case
        when a.id is null or stats.required_total = 0 then 0
        else round(100.0 * stats.required_completed / stats.required_total)
      end,
      'completed_modules', coalesce(stats.completed_modules, 0),
      'total_modules', coalesce(stats.total_modules, 0),
      'knowledge_checks_passed', coalesce(stats.knowledge_checks_passed, 0),
      'knowledge_checks_total', coalesce(stats.knowledge_checks_total, 0),
      'current_module', stats.current_module
    ) order by e.full_name)
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    left join lateral (
      select assignment.*
      from public.crew_journey_assignments assignment
      join public.crew_journeys journey on journey.id = assignment.journey_id
      where assignment.employee_id = e.id
        and journey.outlet_id = p_outlet_id
        and journey.is_mandatory_onboarding
      order by assignment.assigned_at desc
      limit 1
    ) a on true
    left join lateral (
      select
        count(*) filter (where lesson.required) as required_total,
        count(*) filter (where lesson.required and lesson.completed) as required_completed,
        count(distinct module.module_id) as total_modules,
        count(distinct module.module_id) filter (where module.completed) as completed_modules,
        count(*) filter (where lesson.quiz_required) as knowledge_checks_total,
        count(*) filter (where lesson.quiz_required and lesson.quiz_passed) as knowledge_checks_passed,
        (
          select module_name
          from (
            select
              module_item->'module'->>'title' as module_name,
              module_ordinality,
              public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
            from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb))
              with ordinality modules(module_item, module_ordinality)
          ) current_module_row
          where not completed
          order by module_ordinality
          limit 1
        ) as current_module
      from (
        select
          module_item->'module'->>'id' as module_id,
          public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
        from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
      ) module
      cross join lateral (
        select
          coalesce((lesson_item->'lesson'->>'required')::boolean, true) as required,
          exists (
            select 1 from public.crew_lesson_progress lp
            where lp.assignment_id = a.id
              and lp.lesson_id = (lesson_item->'lesson'->>'id')::uuid
              and lp.status = 'completed'
          ) as completed,
          coalesce((lesson_item->'quiz'->>'required')::boolean, false) as quiz_required,
          exists (
            select 1 from public.crew_quiz_attempts qa
            where qa.employee_id = e.id
              and qa.quiz_id = (lesson_item->'quiz'->>'id')::uuid
              and qa.passed
          ) as quiz_passed
        from jsonb_array_elements(coalesce((
          select module_item->'lessons'
          from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
          where module_item->'module'->>'id' = module.module_id
        ), '[]'::jsonb)) lesson_item
      ) lesson
    ) stats on a.id is not null
    where ca.primary_outlet_id = p_outlet_id
      and ca.access_state = 'active'
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.crew_admin_onboarding_progress(uuid) from public, anon, authenticated;
grant execute on function public.crew_admin_onboarding_progress(uuid) to authenticated;

comment on column public.crew_journeys.is_mandatory_onboarding is
  'Product-facing outlet onboarding. Generic Journeys remain historical only.';
comment on function public.crew_clone_learning_setup(uuid, uuid, boolean, boolean, boolean) is
  'Creates independent target-outlet draft copies; never aliases source content.';
