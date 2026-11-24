-- The bound book declares its first posting date once. Local checkpoints are only a cache.
alter table finance_private.source_connections add column gl_start_date date;
comment on column finance_private.source_connections.gl_start_date is
  'First posting date declared by the authenticated connector for this binding.';

create function finance_private.accepted_gl_days(p_connection_id uuid)
returns table(scope_date date, row_count integer, received_at timestamptz)
language sql stable set search_path = '' as $$
  select distinct on (s.scope_date) s.scope_date, jsonb_array_length(s.rows), r.received_at
  from finance_private.source_receipts r
  join finance_private.source_snapshots s on s.connection_id=r.connection_id and s.id=r.snapshot_id
  where r.connection_id=p_connection_id and s.dataset='GL' and s.scope_date is not null
  order by s.scope_date, r.received_at desc, s.id desc;
$$;

create function finance_private.gl_missing_dates(p_connection_id uuid, p_start date, p_through date)
returns setof date
language sql stable set search_path = '' as $$
  select p_start + d.day_offset
  from generate_series(0,p_through-p_start) as d(day_offset)
  left join finance_private.accepted_gl_days(p_connection_id) a on a.scope_date=p_start+d.day_offset
  where a.scope_date is null
  order by d.day_offset;
$$;

create or replace function finance_private.accepted_gl_coverage(p_connection_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  with coverage as (
    select min(scope_date) as first_date, max(scope_date) as through_date,
      max(scope_date) filter (where row_count>0) as latest_posting_date,
      count(*) as accepted_days, count(*) filter (where row_count=0) as empty_days,
      coalesce(sum(row_count),0) as accepted_rows, max(received_at) as last_accepted_at
    from finance_private.accepted_gl_days(p_connection_id)
  ), bounds as (
    select gl_start_date as start_date, (now() at time zone 'Asia/Kuala_Lumpur')::date as today
    from finance_private.source_connections where id=p_connection_id
  ), gaps as (
    select count(*) as remaining, min(missing_date) as first_missing
    from bounds, lateral finance_private.gl_missing_dates(p_connection_id,start_date,today) missing(missing_date)
  )
  select jsonb_build_object('firstDate',first_date,'throughDate',through_date,'latestPostingDate',latest_posting_date,
    'acceptedDays',accepted_days,'emptyDays',empty_days,'acceptedRows',accepted_rows,'lastAcceptedAt',last_accepted_at,
    'missingDays',coalesce(through_date-first_date+1-accepted_days,0),
    'configuredStartDate',start_date,'expectedThrough',case when start_date is not null then today end,
    'remainingDays',case when start_date is not null then remaining end,'nextMissingDate',first_missing,
    'contiguousThrough',case when start_date is not null and first_missing is distinct from start_date
      then coalesce(first_missing-1,today) end)
  from coverage cross join bounds cross join gaps;
$$;

create function public.finance_accounting_gl_plan(p_start_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  target_connection_id uuid;
  configured_start date;
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  first_missing date;
  missing_dates date[];
  remaining bigint;
  refresh_dates date[] := array[]::date[];
begin
  if headers->>'x-feedx-book' is null then
    raise sqlstate 'PT401' using message='Bound Account Book authentication required';
  end if;
  target_connection_id := finance_private.accounting_request_connection(headers);
  if p_start_date is null or p_start_date not between date '2000-01-01' and today then
    raise sqlstate 'PT422' using message='Invalid first GL posting date';
  end if;

  select gl_start_date into strict configured_start from finance_private.source_connections where id=target_connection_id;
  if configured_start is null then
    if exists (
      select 1 from finance_private.source_snapshots s
      join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
      where s.connection_id=target_connection_id and s.dataset='GL' and s.scope_date<p_start_date
    ) then raise sqlstate 'PT409' using message='First GL posting date would exclude accepted evidence'; end if;
    update finance_private.source_connections set gl_start_date=p_start_date where id=target_connection_id;
  elsif configured_start<>p_start_date then
    raise sqlstate 'PT409' using message='First GL posting date differs from the registered book';
  end if;

  with gaps as materialized (
    select d as missing_date from finance_private.gl_missing_dates(target_connection_id,p_start_date,today) d
  )
  select min(missing_date),count(*),
    array(select missing_date from gaps order by missing_date limit 7)
    into first_missing,remaining,missing_dates from gaps;

  if remaining=0 then
    -- Recheck the recent tail and rotate older days by their last receipt, including empty days.
    select array(
      select day from (
        select a.scope_date as day from finance_private.accepted_gl_days(target_connection_id) a
        where a.scope_date between greatest(p_start_date,today-6) and today
        union all
        select older.scope_date from (
          select a.scope_date from finance_private.accepted_gl_days(target_connection_id) a
          where a.scope_date between p_start_date and today-7
          order by a.received_at,a.scope_date limit 7
        ) older
      ) dates order by day
    ) into refresh_dates;
  end if;

  return jsonb_build_object('connectionId',target_connection_id,'startDate',p_start_date,'today',today,
    'nextDate',coalesce(first_missing,today+1),'remainingDays',remaining,
    'missingDates',missing_dates,'refreshDates',refresh_dates);
end
$$;

revoke all on function finance_private.accepted_gl_days(uuid), finance_private.gl_missing_dates(uuid,date,date)
  from public, anon, authenticated, service_role;
revoke all on function public.finance_accounting_gl_plan(date) from public, anon, authenticated, service_role;
grant execute on function public.finance_accounting_gl_plan(date) to anon;
