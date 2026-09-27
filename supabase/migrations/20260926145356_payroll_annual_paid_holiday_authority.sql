-- No holiday dates are seeded. Source-reviewed existing geographic definitions
-- are pinned at publication; company selection is a separate authority.
create table public.payroll_holiday_calendar_versions (
  id uuid primary key default gen_random_uuid(),
  year integer not null check(year between 2000 and 2200),
  revision integer not null,
  supersedes_id uuid references public.payroll_holiday_calendar_versions(id),
  status text not null check(status in ('draft','published')),
  source_reference text not null check(length(btrim(source_reference))>0),
  source_complete boolean not null default false,
  entries jsonb not null check(jsonb_typeof(entries)='array'),
  request_id uuid not null unique,
  request_fingerprint text not null,
  actor_employee_id uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(year,revision)
);
create table public.payroll_paid_holiday_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  name text not null check(length(btrim(name))>0),
  year integer not null check(year between 2000 and 2200),
  revision integer not null,
  supersedes_id uuid references public.payroll_paid_holiday_policy_versions(id),
  calendar_version_id uuid not null references public.payroll_holiday_calendar_versions(id),
  status text not null check(status in ('draft','published')),
  selected_holiday_ids uuid[] not null,
  legal_entity_ids uuid[] not null check(cardinality(legal_entity_ids)>0),
  outlet_ids uuid[] not null default '{}',
  override_reason text,
  request_id uuid not null unique,
  request_fingerprint text not null,
  actor_employee_id uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(policy_id,revision)
);
create table public.payroll_paid_holiday_assignments (
  legal_entity_id uuid not null references public.legal_entities(id),
  year integer not null,
  -- Null = shared company calendar; an explicit outlet assignment wins.
  outlet_id uuid references public.outlets(id),
  policy_version_id uuid not null references public.payroll_paid_holiday_policy_versions(id),
  unique nulls not distinct(legal_entity_id,year,outlet_id)
);
create table public.payroll_holiday_policy_events (
  id uuid primary key default gen_random_uuid(),
  calendar_version_id uuid references public.payroll_holiday_calendar_versions(id),
  policy_version_id uuid references public.payroll_paid_holiday_policy_versions(id),
  event_type text not null,
  actor_employee_id uuid not null references public.employees(id),
  occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null,
  check(num_nonnulls(calendar_version_id,policy_version_id)=1)
);

create function public.payroll_holiday_authority_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Use the canonical holiday command.';
  end if;
  if tg_op<>'INSERT' and tg_table_name<>'payroll_paid_holiday_assignments' then
    raise exception using errcode='55000',message='Annual holiday evidence is append-only.';
  end if;
  if tg_op='DELETE' then raise exception using errcode='55000',message='Holiday authority cannot be deleted.'; end if;
  return new;
end; $$;
do $$ declare t text; begin
  foreach t in array array['payroll_holiday_calendar_versions','payroll_paid_holiday_policy_versions',
    'payroll_paid_holiday_assignments','payroll_holiday_policy_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create trigger holiday_authority_guard before insert or update or delete on public.%I for each row execute function public.payroll_holiday_authority_guard()',t);
  end loop;
end $$;

create function public.payroll_holiday_settings_actor()
returns uuid language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor();
begin
  if not public.current_user_has_permission('payroll.manage')
    or not public.current_user_has_all_outlet_access()
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=a and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Shared Payroll holiday authority required.';
  end if;
  return a;
end; $$;

-- Import/review boundary: entry kinds must come from the stated official source,
-- never from fuzzy holiday-name matching or generated dates.
create function public.payroll_holiday_calendar_save(
  p_year integer,p_entries jsonb,p_source_reference text,p_source_complete boolean,
  p_publish boolean,p_previous_id uuid,p_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); v_previous uuid; v_revision integer;
  v_id uuid; v_fingerprint text; v_retry public.payroll_holiday_calendar_versions%rowtype;
  e jsonb; h public.payroll_public_holidays%rowtype; v_entries jsonb:='[]'; v_seen uuid[]:='{}';
begin
  if p_year is null or p_year not between 2000 and 2200 or p_entries is null
    or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>1000
    or nullif(btrim(p_source_reference),'') is null or p_request_id is null
    or p_publish is null or p_source_complete is null then
    raise exception using errcode='22023',message='Year, source and reviewed calendar entries are required.';
  end if;
  v_fingerprint:=md5(jsonb_build_array(p_year,p_entries,p_source_reference,p_source_complete,p_publish,p_previous_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||p_year,0));
  select * into v_retry from public.payroll_holiday_calendar_versions where request_id=p_request_id;
  if found then
    if v_retry.request_fingerprint<>v_fingerprint then raise exception using errcode='22023',message='Request identity has different calendar content.'; end if;
    return v_retry.id;
  end if;
  select id,revision into v_previous,v_revision from public.payroll_holiday_calendar_versions
    where year=p_year order by revision desc limit 1;
  if v_previous is distinct from p_previous_id then
    raise exception using errcode='40001',message='Annual calendar changed. Refresh before saving.';
  end if;
  for e in select value from jsonb_array_elements(p_entries) loop
    select * into h from public.payroll_public_holidays where id=(e->>'holiday_id')::uuid;
    if h.id is null or not h.is_active or h.legal_entity_id is not null or h.scope not in ('national','state')
      or extract(year from h.holiday_date)::integer<>p_year or h.id=any(v_seen)
      or coalesce(e->>'kind','') not in ('required','gazetted','special','substitute')
      or nullif(btrim(e->>'source_reference'),'') is null then
      raise exception using errcode='22023',message='Each calendar entry needs one active shared national/state holiday, classification and source.';
    end if;
    if e->>'kind'='substitute' and not exists(select 1 from public.payroll_public_holidays
      where id=nullif(e->>'substitutes_holiday_id','')::uuid and id<>h.id
        and extract(year from holiday_date)::integer=p_year) then
      raise exception using errcode='22023',message='A substituted holiday must identify its original holiday.';
    end if;
    v_seen:=array_append(v_seen,h.id);
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object('holiday_id',h.id,'kind',e->>'kind',
      'source_reference',btrim(e->>'source_reference'),'substitutes_holiday_id',e->>'substitutes_holiday_id',
      'holiday',to_jsonb(h)));
  end loop;
  if p_publish and (not p_source_complete or cardinality(v_seen)=0) then
    raise exception using errcode='23514',message='Verify the complete official annual source before publishing.';
  end if;
  if exists(select 1 from public.payroll_holiday_calendar_versions c,
    lateral jsonb_array_elements(c.entries) required
    where c.year=p_year and c.status='published' and required->>'kind'='required'
      and not exists(select 1 from jsonb_array_elements(v_entries) reviewed
        where reviewed->>'holiday_id'=required->>'holiday_id' and reviewed->>'kind'='required')) then
    raise exception using errcode='23514',message='Previously published required holidays cannot be removed or downgraded.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_holiday_calendar_versions(year,revision,supersedes_id,status,source_reference,
    source_complete,entries,request_id,request_fingerprint,actor_employee_id)
  values(p_year,coalesce(v_revision,0)+1,v_previous,case when p_publish then 'published' else 'draft' end,
    btrim(p_source_reference),p_source_complete,v_entries,p_request_id,v_fingerprint,a) returning id into v_id;
  insert into public.payroll_holiday_policy_events(calendar_version_id,event_type,actor_employee_id,details)
    values(v_id,case when p_publish then 'calendar_published' else 'calendar_draft_saved' end,a,
      jsonb_build_object('year',p_year,'supersedes_id',v_previous,'source_reference',p_source_reference));
  return v_id;
end; $$;

create function public.payroll_paid_holiday_policy_save(
  p_name text,p_calendar_version_id uuid,p_selected_holiday_ids uuid[],p_legal_entity_ids uuid[],
  p_outlet_ids uuid[],p_override_reason text,p_publish boolean,p_previous_id uuid,p_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_calendar_versions%rowtype;
  v_previous public.payroll_paid_holiday_policy_versions%rowtype; v_retry public.payroll_paid_holiday_policy_versions%rowtype;
  v_latest uuid; v_id uuid; v_policy_id uuid; v_fingerprint text; v_entity uuid; v_outlet uuid;
  v_existing uuid; v_assignments jsonb:='[]';
begin
  select * into c from public.payroll_holiday_calendar_versions where id=p_calendar_version_id;
  if c.id is null or c.status<>'published' or p_publish is null or p_request_id is null
    or nullif(btrim(p_name),'') is null or coalesce(cardinality(p_legal_entity_ids),0)=0
    or p_selected_holiday_ids is null or p_outlet_ids is null then
    raise exception using errcode='22023',message='A published annual calendar, company scope and name are required.';
  end if;
  v_fingerprint:=md5(jsonb_build_array(p_name,p_calendar_version_id,p_selected_holiday_ids,p_legal_entity_ids,
    p_outlet_ids,p_override_reason,p_publish,p_previous_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||c.year,0));
  select * into v_retry from public.payroll_paid_holiday_policy_versions where request_id=p_request_id;
  if found then
    if v_retry.request_fingerprint<>v_fingerprint then raise exception using errcode='22023',message='Request identity has different policy content.'; end if;
    return v_retry.id;
  end if;
  if p_previous_id is not null then
    select * into v_previous from public.payroll_paid_holiday_policy_versions where id=p_previous_id;
    select id into v_latest from public.payroll_paid_holiday_policy_versions
      where policy_id=v_previous.policy_id order by revision desc limit 1;
    if v_previous.id is null or v_latest<>p_previous_id or v_previous.year<>c.year then
      raise exception using errcode='40001',message='Paid Holiday policy changed. Refresh before saving.';
    end if;
    -- A new scope is a different policy, not an implicit reassignment of history.
    if v_previous.legal_entity_ids<>p_legal_entity_ids or v_previous.outlet_ids<>p_outlet_ids then
      raise exception using errcode='22023',message='Create a separate policy for a different company/outlet scope.';
    end if;
  end if;
  if exists(select 1 from unnest(p_legal_entity_ids) x where x is null or not exists(select 1 from public.legal_entities where id=x))
    or exists(select 1 from unnest(p_outlet_ids) x where x is null or not exists(select 1 from public.outlets where id=x))
    or exists(select 1 from unnest(p_selected_holiday_ids) x where x is null or not exists(
      select 1 from jsonb_array_elements(c.entries) e where (e->>'holiday_id')::uuid=x)) then
    raise exception using errcode='22023',message='Policy selection/scope must use canonical calendar and master records.';
  end if;
  if p_publish and exists(select 1 from jsonb_array_elements(c.entries) e
    where e->>'kind'='required' and not ((e->>'holiday_id')::uuid=any(p_selected_holiday_ids))) then
    raise exception using errcode='23514',message='Required paid holidays cannot be deselected.';
  end if;
  if cardinality(p_outlet_ids)>0 and nullif(btrim(p_override_reason),'') is null then
    raise exception using errcode='22023',message='An explicit outlet calendar override needs its operational reason.';
  end if;
  v_policy_id:=coalesce(v_previous.policy_id,gen_random_uuid());
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_paid_holiday_policy_versions(policy_id,name,year,revision,supersedes_id,
    calendar_version_id,status,selected_holiday_ids,legal_entity_ids,outlet_ids,override_reason,
    request_id,request_fingerprint,actor_employee_id)
  values(v_policy_id,btrim(p_name),c.year,coalesce(v_previous.revision,0)+1,p_previous_id,c.id,
    case when p_publish then 'published' else 'draft' end,p_selected_holiday_ids,p_legal_entity_ids,p_outlet_ids,
    nullif(btrim(p_override_reason),''),p_request_id,v_fingerprint,a) returning id into v_id;
  if p_publish then
    foreach v_entity in array p_legal_entity_ids loop
      foreach v_outlet in array (case when cardinality(p_outlet_ids)=0 then array[null::uuid] else p_outlet_ids end) loop
        select policy_version_id into v_existing from public.payroll_paid_holiday_assignments
          where legal_entity_id=v_entity and year=c.year and outlet_id is not distinct from v_outlet;
        if v_existing is not null and (select policy_id from public.payroll_paid_holiday_policy_versions where id=v_existing)<>v_policy_id then
          raise exception using errcode='23505',message='This company/outlet already has a policy. Revise that policy or create an explicit outlet override.';
        end if;
        insert into public.payroll_paid_holiday_assignments(legal_entity_id,year,outlet_id,policy_version_id)
        values(v_entity,c.year,v_outlet,v_id) on conflict(legal_entity_id,year,outlet_id)
          do update set policy_version_id=excluded.policy_version_id;
        v_assignments:=v_assignments||jsonb_build_array(jsonb_build_object('legal_entity_id',v_entity,
          'outlet_id',v_outlet,'previous_version_id',v_existing));
      end loop;
    end loop;
  end if;
  insert into public.payroll_holiday_policy_events(policy_version_id,event_type,actor_employee_id,details)
  values(v_id,case when p_publish then 'paid_holiday_policy_published' else 'paid_holiday_policy_draft_saved' end,a,
    jsonb_build_object('assignments',v_assignments,'supersedes_id',p_previous_id));
  return v_id;
end; $$;

-- One applicability resolver for future time/PH consumers. No mutation on reads.
create function public.payroll_paid_holiday_resolve(p_legal_entity_id uuid,p_outlet_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.payroll_paid_holiday_policy_versions%rowtype; c public.payroll_holiday_calendar_versions%rowtype;
  v_state text; v_state_id uuid; e jsonb; v_matches jsonb:='[]'; v_unknown boolean:=false;
begin
  select id,state_code into v_state_id,v_state from public.payroll_outlet_state_versions
    where outlet_id=p_outlet_id and effective_from<=p_date order by effective_from desc,created_at desc limit 1;
  select v.* into p from public.payroll_paid_holiday_assignments a join public.payroll_paid_holiday_policy_versions v
    on v.id=a.policy_version_id where a.year=extract(year from p_date)::integer
    and a.legal_entity_id=p_legal_entity_id and (a.outlet_id is null or a.outlet_id=p_outlet_id)
    order by (a.outlet_id is not null) desc limit 1;
  if p.id is null then return jsonb_build_object('status','policy_required','year',extract(year from p_date)::integer); end if;
  select * into c from public.payroll_holiday_calendar_versions where id=p.calendar_version_id;
  for e in select value from jsonb_array_elements(c.entries) where value->'holiday'->>'holiday_date'=p_date::text loop
    if not ((e->>'holiday_id')::uuid=any(p.selected_holiday_ids)) then continue; end if;
    if e->'holiday'->>'scope'='state' and v_state is null then v_unknown:=true; continue; end if;
    if e->'holiday'->>'scope'='national' or e->'holiday'->>'state_code'=v_state then
      v_matches:=v_matches||jsonb_build_array(e);
    end if;
  end loop;
  return jsonb_build_object('status',case when jsonb_array_length(v_matches)>0 then 'paid_holiday'
      when v_unknown then 'geography_required' else 'not_selected' end,
    'policy_version_id',p.id,'calendar_version_id',c.id,'outlet_state_version_id',v_state_id,
    'outlet_state_code',v_state,'holidays',v_matches);
end; $$;

create function public.payroll_annual_holiday_read(p_year integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor();
begin
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view authority required.';
  end if;
  -- Shared calendar is non-personal master data. Policy scope is restricted to
  -- the same all-outlet settings boundary; never expose linked entities through
  -- access to just one outlet of a shared policy.
  return jsonb_build_object('calendars',(select coalesce(jsonb_agg(to_jsonb(c) order by c.revision desc),'[]')
      from public.payroll_holiday_calendar_versions c where year=p_year),
    'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]')
      from public.payroll_paid_holiday_policy_versions p where year=p_year
        and public.current_user_has_all_outlet_access()),
    'can_manage',public.current_user_has_permission('payroll.manage') and public.current_user_has_all_outlet_access()
      and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=a and lower(r.name) in ('owner','admin')));
end; $$;

create function public.payroll_published_holiday_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.payroll_holiday_calendar_versions c,
    lateral jsonb_array_elements(c.entries) e where c.status='published' and (e->>'holiday_id')::uuid=old.id) then
    raise exception using errcode='55000',message='Published annual calendar evidence is immutable. Create a sourced replacement definition.';
  end if;
  return new;
end; $$;
create trigger payroll_published_holiday_guard before update or delete on public.payroll_public_holidays
  for each row execute function public.payroll_published_holiday_guard();

revoke all on function public.payroll_holiday_authority_guard(),public.payroll_holiday_settings_actor(),
  public.payroll_paid_holiday_resolve(uuid,uuid,date),public.payroll_published_holiday_guard() from public,anon,authenticated;
revoke all on function public.payroll_holiday_calendar_save(integer,jsonb,text,boolean,boolean,uuid,uuid),
  public.payroll_paid_holiday_policy_save(text,uuid,uuid[],uuid[],uuid[],text,boolean,uuid,uuid),
  public.payroll_annual_holiday_read(integer) from public,anon;
grant execute on function public.payroll_holiday_calendar_save(integer,jsonb,text,boolean,boolean,uuid,uuid),
  public.payroll_paid_holiday_policy_save(text,uuid,uuid[],uuid[],uuid[],text,boolean,uuid,uuid),
  public.payroll_annual_holiday_read(integer) to authenticated;
