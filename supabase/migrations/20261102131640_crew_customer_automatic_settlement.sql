-- No Google-derived result may be retained until its retention contract is established.
-- No runtime toggle, Manager approval, or browser argument can enable this gate.
create function google_business_private.customer_settlement_permitted() returns boolean
language sql stable set search_path=public,pg_temp as $$ select false $$;
revoke all on function google_business_private.customer_settlement_permitted() from public,anon,authenticated,service_role;

-- Existing Performance result is the only score/snapshot authority. No new score table.
create function google_business_private.complete_performance_if_ready(p_result uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crew_performance_results%rowtype; employment jsonb;
begin
  if not google_business_private.customer_settlement_permitted() then return; end if;
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

create or replace function public.crew_refresh_performance(p_employee_id uuid,p_period date,p_confirm_employment boolean)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; v_employment jsonb;
  outlet uuid; attendance jsonb; knowledge jsonb; team_review jsonb;
  service_review public.crew_performance_reviews%rowtype;
  v_existing public.crew_performance_results%rowtype;
  result_id uuid; current_total numeric; v_components jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || period::text,0));
  select * into v_existing from public.crew_performance_results
    where employee_id=p_employee_id and period_start=period for update;
  if v_existing.status='finalized' then return v_existing.id; end if;
  v_employment:=public.crew_performance_period_employment(p_employee_id,period);
  if v_employment->>'state'<>'eligible' then return v_existing.id; end if;
  if v_existing.id is not null and not p_confirm_employment
    and public.crew_performance_employment_needs_review(v_existing,v_employment) then
    return v_existing.id;
  end if;
  outlet:=(v_employment->>'outlet_id')::uuid;
  if outlet is null then return v_existing.id; end if;
  attendance:=public.crew_performance_attendance_component(p_employee_id,period);
  knowledge:=public.crew_performance_knowledge_component(p_employee_id,period);
  team_review:=public.crew_team_review_performance_component(p_employee_id,period);
  select * into service_review from public.crew_performance_reviews
    where employee_id=p_employee_id and period_start=period and component='service'
      and outlet_id=outlet order by reviewed_at desc limit 1;
  current_total:=round(coalesce((attendance->>'score')::numeric,0)
    +coalesce(service_review.score,0)+coalesce((knowledge->>'score')::numeric,0)
    +coalesce((team_review->>'score')::numeric,0),2);
  v_components:=jsonb_build_object('employment',v_employment,'attendance',attendance,
    'service',case when service_review.id is null then
      jsonb_build_object('score',null,'max_score',30,'status','review_required')
      else jsonb_build_object('score',service_review.score,'max_score',30,'status','reviewed',
        'criteria',service_review.criteria,'reviewed_at',service_review.reviewed_at,
        'calculation_version',service_review.calculation_version) end,
    'customer',jsonb_build_object('score',null,'max_score',20,'status','pending',
      'reason','google_review_authority_not_available','calculation_version','performance-v2'),
    'knowledge',knowledge,'peer',team_review);
  insert into public.crew_performance_results(employee_id,outlet_id,period_start,status,
    calculation_version,attendance_score,service_score,customer_score,knowledge_score,
    conduct_score,peer_score,current_score,total_score,components,computed_at)
  values(p_employee_id,outlet,period,'review_required','performance-v2',
    (attendance->>'score')::numeric,service_review.score,null,(knowledge->>'score')::numeric,
    null,(team_review->>'score')::numeric,current_total,null,v_components,now())
  on conflict(employee_id,period_start) do update set outlet_id=excluded.outlet_id,
    status=excluded.status,calculation_version='performance-v2',
    attendance_score=excluded.attendance_score,service_score=excluded.service_score,
    customer_score=null,knowledge_score=excluded.knowledge_score,conduct_score=null,
    peer_score=excluded.peer_score,current_score=excluded.current_score,total_score=null,
    components=excluded.components,computed_at=now()
  returning id into result_id;
  -- A settled Customer component is frozen independently of later open reviews.
  if v_existing.outlet_id=outlet and v_existing.components->'customer'->>'status'='settled' then
    update public.crew_performance_results set customer_score=v_existing.customer_score,
      components=jsonb_set(components,'{customer}',v_existing.components->'customer'),
      current_score=round(current_total+v_existing.customer_score,2)
      where id=result_id;
    perform google_business_private.complete_performance_if_ready(result_id);
  end if;
  return result_id;
end $$;
revoke all on function public.crew_refresh_performance(uuid,date,boolean) from public,anon,authenticated;

-- Only the trusted Google worker can submit the shared scorer's result. The
-- immutable false gate runs before any score/evidence write, including retries.
create function public.crew_performance_settle_customer_month(
  p_outlet uuid,p_period date default null,p_basis jsonb default null,p_customer jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.crew_google_monthly_targets%rowtype; mapping public.crew_google_outlet_locations%rowtype;
  connection_generation integer; target_revision bigint; basis jsonb; summary jsonb;
  r public.crew_performance_results%rowtype; employment jsonb; changed integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='Automatic settlement worker required.';
  end if;
  if not google_business_private.customer_settlement_permitted() then
    return jsonb_build_object('status','pending','reason','google_retention_unresolved');
  end if;
  if p_period is null then
    return jsonb_build_object('status','ready','periods',(
      select jsonb_agg(period order by period) from (
        select (date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')-interval '1 month')::date as period
        union select period_start from public.crew_performance_results
          where outlet_id=p_outlet and status<>'finalized'
            and period_start<date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date
      ) pending));
  end if;
  if p_period is null or p_period<>date_trunc('month',p_period)::date then
    raise exception using errcode='22023',message='A whole Performance month is required.';
  end if;
  if p_period>=date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date then
    return jsonb_build_object('status','pending','reason','month_not_closed');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer:'||p_outlet::text||':'||p_period::text,0));
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
  select components->'customer' into summary from public.crew_performance_results
    where outlet_id=p_outlet and period_start=p_period and components->'customer'->>'status'='settled'
    order by employee_id limit 1;
  if summary is null then
    summary:=jsonb_build_object('status','settled','score',p_customer->'score',
      'positiveTarget',p_customer->'positiveTarget','quality',p_customer->'quality',
      'max_score',20,'target_revision',target_revision,'calculation_version','performance-v2',
      'settled_at',now(),'settlement_method','automatic');
  end if;
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
grant execute on function public.crew_performance_settle_customer_month(uuid,date,jsonb,jsonb) to service_role;


create or replace function public.crew_google_reviews_admin_context(p_outlet_id uuid, p_period date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_target integer;
  v_locked boolean;
  v_connection record;
  v_location record;
  v_customer jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.view')
     or not public.current_user_can_access_outlet(p_outlet_id)
     or not exists (select 1 from public.outlets where id = p_outlet_id and is_active = true) then
    raise exception using errcode = '42501', message = 'Google Reviews is unavailable for this outlet.';
  end if;
  if p_period is null or p_period <> v_period then
    raise exception using errcode = '22023', message = 'A performance month is required.';
  end if;
  select positive_target into v_target from public.crew_google_monthly_targets
    where outlet_id = p_outlet_id and period_start = v_period;
  select exists(select 1 from public.crew_performance_results
    where outlet_id = p_outlet_id and period_start = v_period and (status = 'finalized' or components->'customer'->>'status'='settled')) into v_locked;
  select status, account_resource_name, last_synced_at into v_connection
    from public.crew_google_business_connections where id = true;
  select l.resource_name, l.display_name into v_location
    from public.crew_google_outlet_locations m
    join public.crew_google_business_locations l on l.resource_name = m.location_resource_name
    where m.outlet_id = p_outlet_id;
  select components->'customer' into v_customer from public.crew_performance_results
    where outlet_id=p_outlet_id and period_start=v_period and components->'customer'->>'status'='settled'
    order by employee_id limit 1;
  return jsonb_build_object(
    'customer_summary',v_customer,
    'settlement_status',case when v_customer is not null then 'settled' else 'pending' end,
    'settlement_reason',case when google_business_private.customer_settlement_permitted() then null else 'google_retention_unresolved' end,
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

create or replace function public.crew_google_set_monthly_target(p_outlet_id uuid, p_period date, p_positive_target integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_old integer;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.review')
     or not public.current_user_can_access_outlet(p_outlet_id)
     or not exists (select 1 from public.outlets where id = p_outlet_id and is_active = true) then
    raise exception using errcode = '42501', message = 'Monthly target cannot be changed for this outlet.';
  end if;
  if p_period is null or p_period <> v_period or p_positive_target is null or p_positive_target <= 0 then
    raise exception using errcode = '22023', message = 'Choose a month and a positive target greater than zero.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer:'||p_outlet_id::text||':'||v_period::text,0));
  if exists(select 1 from public.crew_performance_results
    where outlet_id = p_outlet_id and period_start = v_period and (status = 'finalized' or components->'customer'->>'status'='settled')) then
    raise exception using errcode = '23514', message = 'Monthly target is locked after Customer settlement or Performance finalization.';
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
