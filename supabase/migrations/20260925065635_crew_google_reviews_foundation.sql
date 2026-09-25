-- GBP is not connected yet. These tables hold configuration only, never review data or credentials.
create table public.crew_google_business_connections (
  id boolean primary key default true check (id),
  status text not null default 'not_connected' check (status in ('not_connected', 'connected', 'error')),
  account_resource_name text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.crew_google_business_locations (
  resource_name text primary key,
  account_resource_name text not null,
  display_name text not null,
  verified_at timestamptz not null default now(),
  check (resource_name ~ '^accounts/[^/]+/locations/[^/]+$')
);
create table public.crew_google_outlet_locations (
  outlet_id uuid primary key references public.outlets(id) on delete restrict,
  location_resource_name text not null unique references public.crew_google_business_locations(resource_name) on delete restrict,
  mapped_at timestamptz not null default now(),
  mapped_by uuid references auth.users(id)
);
create table public.crew_google_monthly_targets (
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  positive_target integer not null check (positive_target > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (outlet_id, period_start)
);
create table public.crew_google_monthly_target_audit (
  id bigint generated always as identity primary key,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  period_start date not null,
  old_target integer,
  new_target integer not null check (new_target > 0),
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id)
);
create index crew_google_target_audit_lookup on public.crew_google_monthly_target_audit(outlet_id, period_start, changed_at desc);

alter table public.crew_google_business_connections enable row level security;
alter table public.crew_google_business_locations enable row level security;
alter table public.crew_google_outlet_locations enable row level security;
alter table public.crew_google_monthly_targets enable row level security;
alter table public.crew_google_monthly_target_audit enable row level security;
revoke all on public.crew_google_business_connections, public.crew_google_business_locations,
  public.crew_google_outlet_locations, public.crew_google_monthly_targets,
  public.crew_google_monthly_target_audit from public, anon, authenticated;

create function public.crew_google_reviews_admin_context(p_outlet_id uuid, p_period date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_target integer;
  v_locked boolean;
  v_connection record;
  v_location record;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.view')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Google Reviews is unavailable for this outlet.';
  end if;
  if p_period is null or p_period <> v_period then
    raise exception using errcode = '22023', message = 'A performance month is required.';
  end if;
  select positive_target into v_target from public.crew_google_monthly_targets
    where outlet_id = p_outlet_id and period_start = v_period;
  select exists(select 1 from public.crew_performance_results
    where outlet_id = p_outlet_id and period_start = v_period and status = 'finalized') into v_locked;
  select status, account_resource_name, last_synced_at into v_connection
    from public.crew_google_business_connections where id = true;
  select l.resource_name, l.display_name into v_location
    from public.crew_google_outlet_locations m
    join public.crew_google_business_locations l on l.resource_name = m.location_resource_name
    where m.outlet_id = p_outlet_id;
  return jsonb_build_object(
    'connection_status', coalesce(v_connection.status, 'not_connected'),
    'api_status', 'pending_allowlist',
    'account_resource_name', v_connection.account_resource_name,
    'last_synced_at', v_connection.last_synced_at,
    'location_resource_name', v_location.resource_name,
    'location_name', v_location.display_name,
    'positive_target', v_target,
    'target_locked', v_locked,
    'new_reviews', null, 'positive_reviews', null, 'average_rating', null,
    'negative_reviews', null, 'negative_rate', null,
    'rating_breakdown', null, 'review_trend', null, 'reviews', '[]'::jsonb
  );
end; $$;
revoke execute on function public.crew_google_reviews_admin_context(uuid, date) from public, anon, authenticated;
grant execute on function public.crew_google_reviews_admin_context(uuid, date) to authenticated;

create function public.crew_google_set_monthly_target(p_outlet_id uuid, p_period date, p_positive_target integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_old integer;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.review')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Monthly target cannot be changed for this outlet.';
  end if;
  if p_period is null or p_period <> v_period or p_positive_target is null or p_positive_target <= 0 then
    raise exception using errcode = '22023', message = 'Choose a month and a positive target greater than zero.';
  end if;
  if exists(select 1 from public.crew_performance_results
    where outlet_id = p_outlet_id and period_start = v_period and status = 'finalized') then
    raise exception using errcode = '23514', message = 'Monthly target is locked after Performance finalization.';
  end if;
  select positive_target into v_old from public.crew_google_monthly_targets
    where outlet_id = p_outlet_id and period_start = v_period for update;
  if v_old is distinct from p_positive_target then
    insert into public.crew_google_monthly_targets(outlet_id, period_start, positive_target, updated_by)
    values (p_outlet_id, v_period, p_positive_target, auth.uid())
    on conflict (outlet_id, period_start) do update
    set positive_target = excluded.positive_target, updated_at = now(), updated_by = excluded.updated_by;
    insert into public.crew_google_monthly_target_audit(outlet_id, period_start, old_target, new_target, changed_by)
    values (p_outlet_id, v_period, v_old, p_positive_target, auth.uid());
  end if;
  return jsonb_build_object('positive_target', p_positive_target, 'changed', v_old is distinct from p_positive_target);
end; $$;
revoke execute on function public.crew_google_set_monthly_target(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.crew_google_set_monthly_target(uuid, date, integer) to authenticated;
