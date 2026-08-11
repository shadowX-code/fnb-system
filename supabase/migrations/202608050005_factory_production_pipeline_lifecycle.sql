-- Production Overview lifecycle refinement.
-- One Supabase deployment represents one company; Factory RBAC is the company
-- access boundary. No tenant identifier is accepted from callers.

create or replace function public.factory_release_due_job_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_job public.factory_job_orders%rowtype;
  v_released_count integer := 0;
begin
  if auth.uid() is not null
     and not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Job Orders.';
  end if;

  for v_job in
    select job.*
    from public.factory_job_orders job
    where lower(coalesce(job.status, '')) = 'planned'
      and job.planned_date is not null
      and job.planned_date <= v_business_date
    order by job.planned_date asc, job.created_at asc, job.id asc
    for update skip locked
  loop
    update public.factory_job_orders job
    set status = 'released',
        released_at = now(),
        released_by = null,
        updated_at = now()
    where job.id = v_job.id
      and lower(coalesce(job.status, '')) = 'planned';

    if found then
      v_released_count := v_released_count + 1;

      insert into public.audit_logs (
        action, module, user_id, user_name, description, metadata, created_at
      ) values (
        'factory_job_order_released',
        'factory',
        null,
        'System',
        'Factory Job Order automatically released on its Scheduled Date.',
        jsonb_build_object(
          'target', v_job.job_order_no,
          'job_order_id', v_job.id,
          'release_mode', 'automatic',
          'business_date', v_business_date,
          'before', jsonb_build_object('status', v_job.status),
          'after', jsonb_build_object('status', 'released')
        ),
        now()
      );
    end if;
  end loop;

  return v_released_count;
end;
$$;

revoke all on function public.factory_release_due_job_orders() from public, anon;
grant execute on function public.factory_release_due_job_orders() to authenticated;

create or replace function public.factory_release_job_order(
  p_job_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.factory_job_orders%rowtype;
  v_actor public.employees%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to release Job Orders.';
  end if;

  if not public.current_user_has_permission('factory_job_orders.edit') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission to release Job Orders.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to release Job Orders.';
  end if;

  select job.* into v_job
  from public.factory_job_orders job
  where job.id = p_job_order_id
  for update;

  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) = 'released' then return; end if;
  if lower(coalesce(v_job.status, '')) not in ('draft', 'planned') then
    raise exception 'Only Draft or Scheduled Job Orders can be released.';
  end if;

  v_actor_name := coalesce(v_actor.nickname, v_actor.full_name, 'Authenticated User');

  update public.factory_job_orders job
  set status = 'released',
      released_at = now(),
      released_by = v_actor.id,
      updated_at = now()
  where job.id = p_job_order_id;

  insert into public.audit_logs (
    action, module, user_id, user_name, description, metadata, created_at
  ) values (
    'factory_job_order_released',
    'factory',
    auth.uid(),
    coalesce(v_actor_name, 'Authenticated User'),
    'Factory Job Order released for production.',
    jsonb_build_object(
      'target', v_job.job_order_no,
      'job_order_id', v_job.id,
      'release_mode', 'manual',
      'before', jsonb_build_object('status', v_job.status),
      'after', jsonb_build_object('status', 'released')
    ),
    now()
  );
end;
$$;

revoke all on function public.factory_release_job_order(uuid) from public, anon;
grant execute on function public.factory_release_job_order(uuid) to authenticated;

-- Keep the prior signature rollout-safe, but never trust its actor argument.
create or replace function public.factory_release_job_order(
  p_job_order_id uuid,
  p_released_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.factory_release_job_order(p_job_order_id);
end;
$$;

revoke all on function public.factory_release_job_order(uuid, uuid) from public, anon;
grant execute on function public.factory_release_job_order(uuid, uuid) to authenticated;

create or replace function public.factory_cancel_job_order(
  p_job_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.factory_job_orders%rowtype;
begin
  if not public.current_user_has_permission('factory_job_orders.cancel') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission to cancel Job Orders.';
  end if;

  select job.* into v_job
  from public.factory_job_orders job
  where job.id = p_job_order_id
  for update;

  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) = 'cancelled' then
    raise exception 'Job Order is already cancelled.';
  end if;
  if lower(coalesce(v_job.status, '')) not in ('planned', 'released') then
    raise exception 'Only Scheduled or Released Job Orders can be cancelled.';
  end if;

  if v_job.started_at is not null
     or v_job.production_date is not null
     or v_job.start_time is not null
     or v_job.qc_snapshot_created_at is not null
     or exists (
       select 1 from public.factory_productions production
       where production.job_order_id = v_job.id
     )
     or exists (
       select 1 from public.factory_production_step_executions execution
       where execution.job_order_id = v_job.id
     )
     or exists (
       select 1 from public.factory_production_qc_results result
       where result.job_order_id = v_job.id
     ) then
    raise exception 'Job Order cannot be cancelled after Production has started.';
  end if;

  update public.factory_job_orders job
  set status = 'cancelled',
      updated_at = now()
  where job.id = p_job_order_id;

  insert into public.audit_logs (
    action, module, user_id, user_name, description, metadata, created_at
  ) values (
    'factory_job_order_cancelled',
    'factory',
    auth.uid(),
    'Authenticated User',
    'Factory Job Order cancelled before Production start.',
    jsonb_build_object(
      'target', v_job.job_order_no,
      'job_order_id', v_job.id,
      'before', jsonb_build_object('status', v_job.status),
      'after', jsonb_build_object('status', 'cancelled')
    ),
    now()
  );
end;
$$;

revoke all on function public.factory_cancel_job_order(uuid) from public, anon;
grant execute on function public.factory_cancel_job_order(uuid) to authenticated;

-- Re-group the existing complete operational payload in one SQL snapshot. The
-- underlying 202608040007 function remains the authoritative row builder.
create or replace function public.factory_get_production_pipeline_snapshot(
  p_operational_date date default timezone('Asia/Kuala_Lumpur', now())::date,
  p_include_productions boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Job Orders.';
  end if;

  with source_snapshot as materialized (
    select public.factory_get_production_control_snapshot(
      p_operational_date,
      p_include_productions
    ) as payload
  ), mixed_jobs as materialized (
    select jsonb_set(
      job.value,
      '{priority}',
      to_jsonb(case lower(btrim(coalesce(job.value ->> 'priority', '')))
        when 'urgent' then 'Urgent'
        when 'high' then 'High'
        when 'low' then 'Low'
        else 'Normal'
      end),
      true
    ) as payload
    from source_snapshot source,
      lateral jsonb_array_elements(coalesce(source.payload -> 'planned', '[]'::jsonb)) job
  ), in_progress_jobs as materialized (
    select jsonb_set(
      job.value,
      '{priority}',
      to_jsonb(case lower(btrim(coalesce(job.value ->> 'priority', '')))
        when 'urgent' then 'Urgent'
        when 'high' then 'High'
        when 'low' then 'Low'
        else 'Normal'
      end),
      true
    ) as payload
    from source_snapshot source,
      lateral jsonb_array_elements(coalesce(source.payload -> 'in_progress', '[]'::jsonb)) job
  ), completed_jobs as materialized (
    select jsonb_set(
      job.value,
      '{priority}',
      to_jsonb(case lower(btrim(coalesce(job.value ->> 'priority', '')))
        when 'urgent' then 'Urgent'
        when 'high' then 'High'
        when 'low' then 'Low'
        else 'Normal'
      end),
      true
    ) as payload
    from source_snapshot source,
      lateral jsonb_array_elements(coalesce(source.payload -> 'completed_today', '[]'::jsonb)) job
  ), counts as (
    select
      count(*) filter (where lower(coalesce(payload ->> 'status', '')) = 'planned'
        and (payload ->> 'planned_date')::date > p_operational_date)::integer as scheduled,
      count(*) filter (where lower(coalesce(payload ->> 'status', '')) = 'released')::integer as released
    from mixed_jobs
  )
  select jsonb_build_object(
    'scheduled', coalesce((
      select jsonb_agg(job.payload order by
        (job.payload ->> 'planned_date')::date asc nulls last,
        case lower(coalesce(job.payload ->> 'priority', ''))
          when 'urgent' then 1 when 'high' then 2 when 'low' then 4 else 3
        end asc,
        (job.payload ->> 'created_at')::timestamptz asc,
        (job.payload ->> 'id')::uuid asc)
      from mixed_jobs job
      where lower(coalesce(job.payload ->> 'status', '')) = 'planned'
        and (job.payload ->> 'planned_date')::date > p_operational_date
    ), '[]'::jsonb),
    'released', coalesce((
      select jsonb_agg(job.payload order by
        case lower(coalesce(job.payload ->> 'priority', ''))
          when 'urgent' then 1 when 'high' then 2 when 'low' then 4 else 3
        end asc,
        (job.payload ->> 'planned_date')::date asc nulls last,
        coalesce((job.payload ->> 'released_at')::timestamptz, (job.payload ->> 'updated_at')::timestamptz) asc,
        (job.payload ->> 'id')::uuid asc)
      from mixed_jobs job
      where lower(coalesce(job.payload ->> 'status', '')) = 'released'
    ), '[]'::jsonb),
    'in_progress', coalesce((
      select jsonb_agg(job.payload order by
        case lower(coalesce(job.payload ->> 'priority', ''))
          when 'urgent' then 1 when 'high' then 2 when 'low' then 4 else 3
        end asc,
        (job.payload ->> 'production_date')::date asc nulls last,
        (job.payload ->> 'start_time')::time asc nulls last,
        (job.payload ->> 'id')::uuid asc)
      from in_progress_jobs job
    ), '[]'::jsonb),
    'completed_today', coalesce((
      select jsonb_agg(job.payload order by
        coalesce((job.payload ->> 'completed_at')::timestamptz, (job.payload ->> 'updated_at')::timestamptz) desc,
        (job.payload ->> 'id')::uuid desc)
      from completed_jobs job
    ), '[]'::jsonb),
    'productions', source.payload -> 'productions',
    'summary', jsonb_build_object(
      'scheduled', counts.scheduled,
      'released', counts.released,
      'in_progress', coalesce((source.payload -> 'summary' ->> 'in_progress')::integer, 0),
      'completed_today', coalesce((source.payload -> 'summary' ->> 'completed_today')::integer, 0),
      'planned_today', coalesce((source.payload -> 'summary' ->> 'planned_today')::integer, 0),
      'completion_rate', coalesce((source.payload -> 'summary' ->> 'completion_rate')::numeric, 0),
      'output_by_uom', coalesce(source.payload -> 'summary' -> 'output_by_uom', '[]'::jsonb)
    )
  ) into v_result
  from source_snapshot source
  cross join counts;

  return coalesce(v_result, jsonb_build_object(
    'scheduled', '[]'::jsonb,
    'released', '[]'::jsonb,
    'in_progress', '[]'::jsonb,
    'completed_today', '[]'::jsonb,
    'productions', '[]'::jsonb,
    'summary', jsonb_build_object(
      'scheduled', 0, 'released', 0, 'in_progress', 0,
      'completed_today', 0, 'planned_today', 0,
      'completion_rate', 0, 'output_by_uom', '[]'::jsonb
    )
  ));
end;
$$;

revoke all on function public.factory_get_production_pipeline_snapshot(date, boolean) from public, anon;
grant execute on function public.factory_get_production_pipeline_snapshot(date, boolean) to authenticated;

do $$
declare
  v_existing_job bigint;
  v_cron_available boolean := false;
  v_cron_installed boolean := false;
  v_cron_cleanup_succeeded boolean := false;
  v_cron_timezone text;
  v_cron_schedule text;
begin
  select exists (
    select 1 from pg_catalog.pg_available_extensions extension
    where extension.name = 'pg_cron'
  ) into v_cron_available;

  select exists (
    select 1 from pg_catalog.pg_extension extension
    where extension.extname = 'pg_cron'
  ) into v_cron_installed;

  if v_cron_available and not v_cron_installed then
    begin
      execute 'create extension if not exists pg_cron with schema pg_catalog';
    exception
      when insufficient_privilege
        or undefined_file
        or feature_not_supported
        or object_not_in_prerequisite_state then
        raise notice 'pg_cron is unavailable; due Job Orders will still release when the operational snapshot is refreshed.';
      when others then
        raise notice 'pg_cron setup failed (%); due Job Orders will still release when the operational snapshot is refreshed.', sqlerrm;
    end;
  elsif not v_cron_available then
    raise notice 'pg_cron is unavailable; due Job Orders will still release when the operational snapshot is refreshed.';
  end if;

  select exists (
    select 1 from pg_catalog.pg_extension extension
    where extension.extname = 'pg_cron'
  ) into v_cron_installed;

  if v_cron_installed
     and pg_catalog.to_regnamespace('cron') is not null
     and pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null
     and pg_catalog.to_regprocedure('cron.unschedule(bigint)') is not null then
    begin
      for v_existing_job in
        execute 'select jobid from cron.job where jobname = $1'
        using 'factory-release-due-job-orders-malaysia'
      loop
        execute 'select cron.unschedule($1)' using v_existing_job;
      end loop;
      v_cron_cleanup_succeeded := true;
    exception
      when others then
        raise notice 'pg_cron cleanup failed (%); due Job Orders will still release when the operational snapshot is refreshed.', sqlerrm;
    end;

    if v_cron_cleanup_succeeded then
      v_cron_timezone := lower(coalesce(nullif(current_setting('cron.timezone', true), ''), 'gmt'));
      v_cron_schedule := case
        when v_cron_timezone in ('utc', 'gmt', 'etc/utc') then '5 16 * * *'
        when v_cron_timezone in ('asia/kuala_lumpur', 'asia/singapore') then '5 0 * * *'
        else null
      end;

      if v_cron_schedule is null then
        raise notice 'pg_cron timezone % is not supported by this migration; due Job Orders will still release when the operational snapshot is refreshed.', v_cron_timezone;
      else
        begin
          execute 'select cron.schedule($1, $2, $3)'
          using
            'factory-release-due-job-orders-malaysia',
            v_cron_schedule,
            'select public.factory_release_due_job_orders();';
        exception
          when others then
            raise notice 'pg_cron scheduling failed (%); due Job Orders will still release when the operational snapshot is refreshed.', sqlerrm;
        end;
      end if;
    end if;
  elsif v_cron_installed then
    raise notice 'pg_cron functions are unavailable; due Job Orders will still release when the operational snapshot is refreshed.';
  end if;
end;
$$;

comment on function public.factory_release_due_job_orders() is
  'Idempotently releases planned Factory Job Orders due on the Malaysia business date. Scheduled daily at 00:05 Asia/Kuala_Lumpur and safely callable before an operational snapshot.';
