-- Activate the approved score-only Performance lifecycle; content cache/purge is unchanged.
do $guard$ begin
  if (select md5(prosrc) from pg_proc where oid='public.crew_performance_settle_customer_month(uuid,date,jsonb,jsonb)'::regprocedure)
    <> 'fc6bad875cb7d73e637fa9e8f0248e39' then raise exception 'Customer settlement authority drift'; end if;
  if (select md5(prosrc) from pg_proc where oid='google_business_private.complete_performance_if_ready(uuid)'::regprocedure)
    <> '5298a2f9b091ecd0f622b5a5b7e6e125' then raise exception 'Performance completion authority drift'; end if;
end $guard$;

-- Compatibility metadata only. Mutation authorities no longer use this predicate.
create or replace function google_business_private.customer_settlement_permitted() returns boolean
language sql stable set search_path=public,pg_temp as $$ select true $$;
revoke all on function google_business_private.customer_settlement_permitted() from public,anon,authenticated,service_role;

create or replace function google_business_private.complete_performance_if_ready(p_result uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crew_performance_results%rowtype; employment jsonb;
begin
  select * into r from public.crew_performance_results where id=p_result for update;
  if r.status='finalized' or r.components->'customer'->>'status' is distinct from 'settled'
    or r.period_start >= date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date
    or r.attendance_score is null or r.service_score is null or r.customer_score is null
    or r.knowledge_score is null or r.peer_score is null then return; end if;
  employment:=public.crew_performance_period_employment(r.employee_id,r.period_start);
  if public.crew_performance_employment_needs_review(r,employment) then return; end if;
  update public.crew_performance_results set status='finalized',
    total_score=round(attendance_score+service_score+customer_score+knowledge_score+peer_score,2),
    current_score=round(attendance_score+service_score+customer_score+knowledge_score+peer_score,2),
    finalized_at=now(),finalized_by=null where id=r.id and status<>'finalized';
end $$;
revoke all on function google_business_private.complete_performance_if_ready(uuid) from public,anon,authenticated,service_role;

create or replace function public.crew_performance_settle_customer_month(
  p_outlet uuid,p_period date default null,p_basis jsonb default null,p_customer jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.crew_google_monthly_targets%rowtype; mapping public.crew_google_outlet_locations%rowtype;
  connection_generation integer; target_revision bigint; basis jsonb; summary jsonb;
  employee record; r public.crew_performance_results%rowtype; employment jsonb; changed integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='Automatic settlement worker required.';
  end if;
  if p_period is null then
    return jsonb_build_object('status','ready','periods',(
      select jsonb_agg(period order by period) from (
        select (date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')-interval '1 month')::date as period
        union select period_start from public.crew_performance_results
          where outlet_id=p_outlet and status<>'finalized'
            and period_start<date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date
        union select t.period_start from public.crew_google_monthly_targets t
          where t.outlet_id=p_outlet and t.period_start<date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date
            and not exists(select 1 from public.crew_performance_results existing_result where existing_result.outlet_id=p_outlet
              and existing_result.period_start=t.period_start and existing_result.components->'customer'->>'status'='settled')
      ) pending));
  end if;
  if p_period is null or p_period<>date_trunc('month',p_period)::date then
    raise exception using errcode='22023',message='A whole Performance month is required.';
  end if;
  if p_period>=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date then
    return jsonb_build_object('status','pending','reason','month_not_closed');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer:'||p_outlet::text||':'||p_period::text,0));
  select components->'customer' into summary from public.crew_performance_results
    where outlet_id=p_outlet and period_start=p_period and components->'customer'->>'status'='settled'
    order by employee_id limit 1;
  if summary is null then
  select * into target from public.crew_google_monthly_targets
    where outlet_id=p_outlet and period_start=p_period for update;
  if not found then return jsonb_build_object('status','pending','reason','target_required'); end if;
  select a.id into target_revision from public.crew_google_monthly_target_audit a
    where a.outlet_id=p_outlet and a.period_start=p_period and a.new_target=target.positive_target
    order by a.changed_at desc,a.id desc limit 1;
  if target_revision is null then return jsonb_build_object('status','pending','reason','target_required'); end if;
  select * into mapping from public.crew_google_outlet_locations where outlet_id=p_outlet for share;
  if not found then return jsonb_build_object('status','pending','reason','mapping_required'); end if;
  select generation into connection_generation from google_business_private.connection
    where id and status='connected' for share;
  if not found then return jsonb_build_object('status','pending','reason','reconnect_required'); end if;
  if not exists(select 1 from public.outlets where id=p_outlet and is_active) then
    return jsonb_build_object('status','pending','reason','outlet_unavailable');
  end if;
  basis:=jsonb_build_object('generation',connection_generation,'revision',mapping.revision,
    'location',mapping.location_resource_name,'target_revision',target_revision);
  if p_customer is null then
    return jsonb_build_object('status','ready','basis',basis,'target',target.positive_target);
  end if;
  if p_basis-'fetchedAt' is distinct from basis
    or (p_basis->>'fetchedAt')::timestamptz is null
    or (p_basis->>'fetchedAt')::timestamptz>clock_timestamp()
    or (p_basis->>'fetchedAt')::timestamptz<=clock_timestamp()-interval '5 minutes' then
    return jsonb_build_object('status','pending','reason','evidence_changed_or_expired');
  end if;
  -- Permit only three numeric outcome fields, never a review dataset or identity.
  if jsonb_typeof(p_customer)<>'object' or p_customer-array['score','positiveTarget','quality']<>'{}'::jsonb
    or jsonb_typeof(p_customer->'score') is distinct from 'number'
    or jsonb_typeof(p_customer->'positiveTarget') is distinct from 'number'
    or jsonb_typeof(p_customer->'quality') is distinct from 'number'
    or (p_customer->>'positiveTarget')::numeric not between 0 and 15
    or (p_customer->>'quality')::numeric not in (0,1,2,3,4,5)
    or (p_customer->>'score')::numeric<>round((p_customer->>'positiveTarget')::numeric+(p_customer->>'quality')::numeric,2) then
    raise exception using errcode='22023',message='Invalid Customer summary.';
  end if;
  end if;
  -- Component subscores are transient calculation inputs, not stored evidence.
  -- Reuse a frozen outcome through an explicit internal-field allowlist only.
  summary:=jsonb_build_object('status','settled',
    'score',coalesce(summary->'score',p_customer->'score'),'max_score',20,
    'target_revision',coalesce(summary->'target_revision',to_jsonb(target_revision)),
    'calculation_version',coalesce(summary->'calculation_version','"performance-v2"'::jsonb),
    'settled_at',coalesce(summary->'settled_at',to_jsonb(now())),
    'settlement_method','automatic');
  -- Create a missing monthly baseline through the existing engine, never a
  -- parallel employee eligibility/calculation path. Existing dimensions stay intact.
  for employee in select e.id from public.employees e
    where not exists(select 1 from public.crew_performance_results existing_result
      where existing_result.employee_id=e.id and existing_result.period_start=p_period)
    order by e.id
  loop
    employment:=public.crew_performance_period_employment(employee.id,p_period);
    if employment->>'state'='eligible' and (employment->>'outlet_id')::uuid=p_outlet then
      perform public.crew_refresh_performance(employee.id,p_period);
    end if;
  end loop;
  for r in select * from public.crew_performance_results
    where outlet_id=p_outlet and period_start=p_period and status<>'finalized' order by employee_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.employee_id::text||':'||p_period::text,0));
    select * into r from public.crew_performance_results where id=r.id for update;
    if r.status='finalized' then continue; end if;
    employment:=public.crew_performance_period_employment(r.employee_id,p_period);
    if employment->>'state' is distinct from 'eligible'
      or (employment->>'outlet_id')::uuid<>p_outlet
      or public.crew_performance_employment_needs_review(r,employment) then continue; end if;
    if r.components->'customer'->>'status' is distinct from 'settled' then
      update public.crew_performance_results set customer_score=(summary->>'score')::numeric,
        components=jsonb_set(components,'{customer}',summary),
        current_score=round(coalesce(attendance_score,0)+coalesce(service_score,0)
          +(summary->>'score')::numeric+coalesce(knowledge_score,0)+coalesce(peer_score,0),2)
        where id=r.id;
      changed:=changed+1;
    end if;
    perform google_business_private.complete_performance_if_ready(r.id);
  end loop;
  return jsonb_build_object('status','settled','changed',changed,'summary',summary);
end $$;
revoke all on function public.crew_performance_settle_customer_month(uuid,date,jsonb,jsonb) from public,anon,authenticated;
