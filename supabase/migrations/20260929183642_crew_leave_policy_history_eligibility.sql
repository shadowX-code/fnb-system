-- A cutover policy is an immutable observation, not a fabricated transition
-- after an evidenced earlier policy. Re-evaluate grants without rewriting them.

create or replace function public.crew_leave_policy_at(p_policy_id uuid,p_on date)
returns public.crew_leave_policy_versions
language sql stable security definer set search_path=public as $$
  select v from public.crew_leave_policy_versions v
  where v.policy_id=p_policy_id and v.effective_from<=p_on
    and not exists (select 1 from public.crew_leave_policy_versions newer
      where newer.supersedes_version_id=v.id)
    and (v.source_kind<>'cutover_current' or not exists (
      select 1 from public.crew_leave_policy_versions h
      where h.policy_id=v.policy_id and h.source_kind='historical_baseline'
        and h.effective_from<v.effective_from
        and not exists (select 1 from public.crew_leave_policy_versions newer
          where newer.supersedes_version_id=h.id)))
  order by v.effective_from desc,v.recorded_at desc,v.id desc limit 1;
$$;
revoke all on function public.crew_leave_policy_at(uuid,date) from public,anon,authenticated;

create or replace function public.crew_leave_entitlement_preview(
  p_employee_id uuid,p_leave_type text,p_year date,p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_employee public.employees%rowtype;
  v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_policy public.crew_leave_policy_versions%rowtype;
  v_year_start date:=date_trunc('year',p_year)::date;
  v_year_end date:=(date_trunc('year',p_year)+interval '1 year'-interval '1 day')::date;
  v_asof date:=coalesce(p_as_of,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date);
  v_start date; v_end date; v_lookup date; v_outlet uuid; v_policy_id uuid;
  v_total integer; v_days integer; v_eligible boolean; v_contribution numeric;
  v_raw numeric:=0; v_latest_fixed numeric:=0; v_fixed boolean:=false;
  v_calendar boolean:=false;
  v_spans jsonb:='[]'::jsonb; v_unresolved jsonb:='[]'::jsonb;
  v_boundary record;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null or p_leave_type not in ('annual','medical','unpaid','other')
    then raise exception using errcode='22023',message='Leave entitlement input is invalid.'; end if;
  if v_employee.joined_date is null then
    return jsonb_build_object('state','unresolved','reason','Joined Date is missing',
      'spans','[]'::jsonb,'year_start',v_year_start,'year_end',v_year_end);
  end if;
  v_total:=v_year_end-v_year_start+1;
  if v_employee.joined_date>v_year_end then
    return jsonb_build_object('state','resolved','rounded_entitlement',0,'raw_entitlement',0,
      'spans','[]'::jsonb,'year_start',v_year_start,'year_end',v_year_end,
      'calendar_year_days',v_total);
  end if;
  for v_boundary in
    with boundaries as (
      select v_year_start as day union select v_year_end+1
      union select v_employee.joined_date where v_employee.joined_date between v_year_start and v_year_end
      union select r.effective_from from public.employee_employment_assignment_revisions r
        where r.employee_id=p_employee_id and r.effective_from between v_year_start and least(v_year_end,v_asof)
          and not exists (select 1 from public.employee_employment_assignment_revisions newer
            where newer.supersedes_revision_id=r.id)
      union select pv.effective_from from public.crew_leave_policy_versions pv
        join public.crew_leave_policies p on p.id=pv.policy_id and p.leave_type=p_leave_type
        where pv.effective_from between v_year_start and least(v_year_end,v_asof)
          and not exists (select 1 from public.crew_leave_policy_versions newer
            where newer.supersedes_version_id=pv.id)
          and (pv.source_kind<>'cutover_current' or not exists (
            select 1 from public.crew_leave_policy_versions h
            where h.policy_id=pv.policy_id and h.source_kind='historical_baseline'
              and h.effective_from<pv.effective_from
              and not exists (select 1 from public.crew_leave_policy_versions newer
                where newer.supersedes_version_id=h.id)))
    )
    select day,lead(day) over(order by day)-1 as last_day from boundaries order by day
  loop
    if v_boundary.last_day is null then continue; end if;
    v_start:=greatest(v_boundary.day,v_employee.joined_date);
    v_end:=v_boundary.last_day;
    if v_start>v_end then continue; end if;
    v_lookup:=least(v_start,v_asof);
    v_assignment:=public.employee_employment_assignment_at(p_employee_id,v_lookup);
    if v_assignment.id is null then
      v_unresolved:=v_unresolved||jsonb_build_array(jsonb_build_object(
        'from',v_start,'to',v_end,'reason','Employment assignment is unverified'));
      continue;
    end if;
    if v_assignment.employment_status<>'active'
       or (v_assignment.employment_end_date is not null and v_start>v_assignment.employment_end_date)
    then
      v_spans:=v_spans||jsonb_build_array(jsonb_build_object('from',v_start,'to',v_end,
        'employment_revision_id',v_assignment.id,'employment_type',v_assignment.employment_type,
        'eligible_days',0,'calculated_contribution',0,'reason','Not actively employed'));
      continue;
    end if;
    select o.id into v_outlet from public.outlets o
      where lower(o.name)=lower(v_assignment.workplace)
         or lower(coalesce(o.code,''))=lower(v_assignment.workplace)
      order by case when lower(o.name)=lower(v_assignment.workplace) then 0 else 1 end,o.id limit 1;
    if v_outlet is null then
      v_unresolved:=v_unresolved||jsonb_build_array(jsonb_build_object(
        'from',v_start,'to',v_end,'reason','Employment workplace has no Leave policy outlet'));
      continue;
    end if;
    select p.id into v_policy_id from public.crew_leave_policies p
      where p.outlet_id=v_outlet and p.leave_type=p_leave_type;
    v_policy:=public.crew_leave_policy_at(v_policy_id,v_lookup);
    if v_policy.id is null then
      v_unresolved:=v_unresolved||jsonb_build_array(jsonb_build_object(
        'from',v_start,'to',v_end,'reason','Leave policy version is unverified'));
      continue;
    end if;
    v_eligible:=v_assignment.employment_type=any(v_policy.eligible_employment_types);
    v_days:=case when v_eligible then v_end-v_start+1 else 0 end;
    v_contribution:=case when not v_eligible or v_policy.entitlement_method='unlimited' then 0
      when v_policy.proration_rule='calendar_days' then v_policy.annual_days*v_days/v_total
      else v_policy.annual_days end;
    if v_eligible and v_policy.entitlement_method='annual_allowance' then
      if v_policy.proration_rule='calendar_days' then
        v_raw:=v_raw+v_contribution; v_calendar:=true;
      else v_latest_fixed:=v_policy.annual_days; v_fixed:=true; end if;
    end if;
    v_spans:=v_spans||jsonb_build_array(jsonb_build_object('from',v_start,'to',v_end,
      'employment_revision_id',v_assignment.id,'employment_type',v_assignment.employment_type,
      'policy_version_id',v_policy.id,'policy_outlet_id',v_outlet,
      'eligible_days',v_days,'annual_days',v_policy.annual_days,
      'entitlement_method',v_policy.entitlement_method,'proration_rule',v_policy.proration_rule,
      'calculated_contribution',v_contribution));
  end loop;
  if jsonb_array_length(v_unresolved)>0 then
    return jsonb_build_object('state','unresolved','reason','Employment or policy history is incomplete',
      'unresolved_spans',v_unresolved,'spans',v_spans,'year_start',v_year_start,
      'year_end',v_year_end,'calendar_year_days',v_total);
  end if;
  if v_calendar and v_fixed then
    return jsonb_build_object('state','unresolved','reason',
      'Mixed prorated and fixed policy methods need review','spans',v_spans,
      'year_start',v_year_start,'year_end',v_year_end,'calendar_year_days',v_total);
  end if;
  -- Non-prorated policy grants the latest eligible full-year rate once; it is
  -- never multiplied by the number of spans. Annual prorated spans sum first.
  v_raw:=v_raw+case when v_fixed then v_latest_fixed else 0 end;
  return jsonb_build_object('state','resolved','raw_entitlement',v_raw,
    'rounded_entitlement',floor(v_raw*2+0.5)/2,'rounding','nearest_half_day_half_up',
    'spans',v_spans,'year_start',v_year_start,'year_end',v_year_end,
    'calendar_year_days',v_total);
end $$;
revoke all on function public.crew_leave_entitlement_preview(uuid,text,date,date)
  from public,anon,authenticated;

create or replace function public.crew_leave_entitlement_balance(
  p_entitlement_id uuid,p_as_of date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.crew_leave_entitlements%rowtype;
  policy public.crew_leave_policies%rowtype; adjusted numeric; used_days numeric;
  pending_days numeric; active_carry numeric; entitled numeric; available numeric;
  enforced boolean; legacy_enforced boolean;
  review public.crew_leave_entitlement_reviews%rowtype;
  resolved boolean; v_preview jsonb; v_expected numeric; v_reconciled numeric;
  v_requires_review boolean:=false;
begin
  select * into e from public.crew_leave_entitlements where id=p_entitlement_id;
  if e.id is null then return null; end if;
  select * into policy from public.crew_leave_policies
    where outlet_id=e.outlet_id and leave_type=e.leave_type;
  select balance_enforced into legacy_enforced from public.crew_leave_legacy_balance_cutover
    where entitlement_id=e.id;
  enforced:=coalesce((e.calculation_explanation->>'policy_balance_enforced')::boolean,
    legacy_enforced,policy.balance_enforced,true);
  select coalesce(sum(a.amount),0) into adjusted from public.crew_leave_adjustments a
    where a.entitlement_id=e.id;
  select coalesce(sum(public.crew_leave_days_in_period(a.start_date,a.end_date,a.duration_type,
    e.period_start,e.period_end)),0) into used_days from public.crew_approved_leaves a
    where a.employee_id=e.employee_id and a.leave_type=e.leave_type
      and a.end_date>=e.period_start and a.start_date<=e.period_end;
  select coalesce(sum(public.crew_leave_days_in_period(r.start_date,r.end_date,r.duration_type,
    e.period_start,e.period_end)),0) into pending_days from public.crew_leave_requests r
    where r.employee_id=e.employee_id and r.leave_type=e.leave_type and r.status='pending'
      and r.end_date>=e.period_start and r.start_date<=e.period_end;
  active_carry:=case when e.carry_forward_expires_at is null
    or p_as_of<=e.carry_forward_expires_at then e.carry_forward else 0 end;
  entitled:=e.prorated_entitlement+active_carry+adjusted;
  available:=case when enforced then entitled-used_days-pending_days else null end;
  select * into review from public.crew_leave_entitlement_reviews
    where entitlement_id=e.id order by recorded_at desc,id desc limit 1;
  select exists(select 1 from public.crew_leave_entitlement_review_resolutions rr
    where rr.review_id=review.id) into resolved;
  if e.leave_type<>'replacement' then
    v_preview:=public.crew_leave_entitlement_preview(e.employee_id,e.leave_type,e.period_start);
    select e.prorated_entitlement+coalesce(sum(a.amount),0) into v_reconciled
      from public.crew_leave_entitlement_review_resolutions rr
      join public.crew_leave_entitlement_reviews r on r.id=rr.review_id
      join public.crew_leave_adjustments a on a.id=rr.adjustment_id
      where r.entitlement_id=e.id;
    v_expected:=case when v_preview->>'state'='resolved'
      then (v_preview->>'rounded_entitlement')::numeric else null end;
    v_requires_review:=v_expected is null or v_expected is distinct from v_reconciled;
  end if;
  v_requires_review:=v_requires_review or
    (review.id is not null and review.review_required and not resolved);
  return jsonb_build_object('entitlement_id',e.id,'employee_id',e.employee_id,
    'outlet_id',e.outlet_id,'leave_type',e.leave_type,'period_start',e.period_start,
    'period_end',e.period_end,'base',e.base_entitlement,'prorated',e.prorated_entitlement,
    'carry_forward',active_carry,'carry_forward_awarded',e.carry_forward,
    'carry_forward_expires_at',e.carry_forward_expires_at,'adjustment',adjusted,
    'entitled',entitled,'used',used_days,'pending',pending_days,
    'available',case when v_requires_review then null else available end,
    'recorded_available',available,
    'balance_enforced',enforced,'calculation_version',e.calculation_version,
    'explanation',e.calculation_explanation,'eligibility_state',case
      when v_requires_review then 'review_required' else 'resolved' end,
    'review_id',case when not resolved then review.id else null end,
    'expected_entitlement',case when v_requires_review then v_expected
      when not resolved then review.expected_entitlement else null end,
    'expected_difference',case when v_requires_review and v_expected is not null
      then v_expected-v_reconciled when not resolved then review.difference else null end,
    'expected_evidence',case when v_requires_review then v_preview
      when not resolved then review.expected_evidence else null end,
    'review_reason',case when v_requires_review then
      coalesce(v_preview->>'reason','Existing grant differs from verified Leave policy and People history.')
      else null end);
end $$;
revoke all on function public.crew_leave_entitlement_balance(uuid,date)
  from public,anon,authenticated;

create or replace function public.crew_leave_safe_balance(
  p_employee_id uuid,p_leave_type text,p_year date,p_outlet_id uuid,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_entitlement uuid; v_preview jsonb; v_reason text; v_balance jsonb;
  v_current text:=public.crew_leave_current_eligibility(p_employee_id,p_leave_type);
  v_start date:=date_trunc('year',p_year)::date;
begin
  begin
    v_entitlement:=public.crew_leave_ensure_entitlement(p_employee_id,p_leave_type,
      p_year,p_outlet_id,p_actor);
    v_balance:=public.crew_leave_entitlement_balance(v_entitlement);
    return v_balance||jsonb_build_object('current_eligibility',v_current,
      'available',case when v_current='eligible' then v_balance->'available' else 'null'::jsonb end,
      'eligibility_state',case when v_current='unresolved' then 'review_required'
        else v_balance->>'eligibility_state' end,
      'review_reason',case when v_current='unresolved' then
        'Current employment or Leave policy eligibility is unverified.'
        else v_balance->>'review_reason' end);
  exception when invalid_parameter_value then
    v_reason:=sqlerrm;
  end;
  v_preview:=public.crew_leave_entitlement_preview(p_employee_id,p_leave_type,p_year);
  return jsonb_build_object('entitlement_id',null,'employee_id',p_employee_id,
    'outlet_id',p_outlet_id,'leave_type',p_leave_type,'period_start',v_start,
    'period_end',(v_start+interval '1 year'-interval '1 day')::date,
    'balance_enforced',true,'available',null,'entitled',null,'used',null,'pending',null,
    'eligibility_state','review_required','current_eligibility',v_current,
    'explanation',v_preview,'review_reason',v_reason);
end $$;
revoke all on function public.crew_leave_safe_balance(uuid,text,date,uuid,uuid)
  from public,anon,authenticated;

create or replace function public.crew_leave_request_eligibility_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_day date; v_lookup date; v_today date:=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date;
  v_employee public.employees%rowtype;
  v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_policy public.crew_leave_policy_versions%rowtype; v_policy_id uuid; v_outlet uuid;
  v_year date; v_entitlement uuid;
begin
  if tg_op='UPDATE' and (new.status<>'approved' or old.status='approved') then return new; end if;
  if new.leave_type='replacement' then return new; end if;
  select * into v_employee from public.employees where id=new.employee_id;
  for v_day in select distinct least(d::date,v_today)
    from generate_series(new.start_date,new.end_date,interval '1 day') d loop
    v_lookup:=v_day;
    v_assignment:=public.employee_employment_assignment_at(new.employee_id,v_lookup);
    if v_assignment.id is null or v_employee.joined_date is null
      or v_day<v_employee.joined_date or v_assignment.employment_status<>'active'
      or (v_assignment.employment_end_date is not null
        and v_day>v_assignment.employment_end_date) then
      raise exception using errcode='22023',
        message='Leave eligibility needs verified employment history for the requested dates.';
    end if;
    select o.id into v_outlet from public.outlets o
      where lower(o.name)=lower(v_assignment.workplace)
        or lower(coalesce(o.code,''))=lower(v_assignment.workplace)
      order by case when lower(o.name)=lower(v_assignment.workplace) then 0 else 1 end,o.id limit 1;
    select p.id into v_policy_id from public.crew_leave_policies p
      where p.outlet_id=v_outlet and p.leave_type=new.leave_type;
    v_policy:=public.crew_leave_policy_at(v_policy_id,v_lookup);
    if v_policy.id is null or not v_assignment.employment_type=any(v_policy.eligible_employment_types)
      then raise exception using errcode='22023',
        message='This employment type is not eligible for the requested Leave policy.';
    end if;
  end loop;
  for v_year in select distinct date_trunc('year',d)::date
    from generate_series(new.start_date,new.end_date,interval '1 day') d loop
    select e.id into v_entitlement from public.crew_leave_entitlements e
      where e.employee_id=new.employee_id and e.leave_type=new.leave_type
        and e.period_start=v_year;
    if v_entitlement is not null and
      public.crew_leave_entitlement_balance(v_entitlement)->>'eligibility_state'='review_required'
    then raise exception using errcode='22023',
      message='Leave entitlement evidence requires review before this request can be used.';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.crew_leave_request_eligibility_guard()
  from public,anon,authenticated;

-- Admin policy history includes observed and superseded evidence, while the
-- effective range is derived from versions that actually govern eligibility.
create function public.crew_leave_policy_history(p_outlet_id uuid,p_leave_type text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_policy_id uuid; v_version record; v_rows jsonb:='[]'::jsonb;
  v_effective boolean; v_next date;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave_settings.manage')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Leave settings permission is required.';
  end if;
  if p_leave_type not in ('annual','medical','unpaid','other') then
    raise exception using errcode='22023',message='Leave type is invalid.';
  end if;
  select id into v_policy_id from public.crew_leave_policies
    where outlet_id=p_outlet_id and leave_type=p_leave_type;
  if v_policy_id is null then
    raise exception using errcode='22023',message='Leave policy is unavailable.';
  end if;
  for v_version in
    select v.*,coalesce(e.nickname,e.full_name) actor_name
    from public.crew_leave_policy_versions v
    left join public.employees e on e.auth_user_id=v.recorded_by
    where v.policy_id=v_policy_id
    order by v.effective_from desc,v.recorded_at desc,v.id desc
  loop
    v_effective:=(public.crew_leave_policy_at(v_policy_id,v_version.effective_from)).id=v_version.id;
    v_next:=null;
    if v_effective then
      select min(later.effective_from) into v_next
      from public.crew_leave_policy_versions later
      where later.policy_id=v_policy_id
        and later.effective_from>v_version.effective_from
        and (public.crew_leave_policy_at(v_policy_id,later.effective_from)).id=later.id;
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'id',v_version.id,'effective_from',v_version.effective_from,
      'effective_until',case when v_next is null then null else v_next-1 end,
      'authority_state',case when v_effective then 'effective'
        when v_version.source_kind='cutover_current' then 'observation'
        else 'superseded' end,
      'source_kind',v_version.source_kind,'eligible_employment_types',v_version.eligible_employment_types,
      'entitlement_method',v_version.entitlement_method,'proration_rule',v_version.proration_rule,
      'annual_days',v_version.annual_days,'balance_enforced',v_version.balance_enforced,
      'carry_forward_enabled',v_version.carry_forward_enabled,
      'max_carry_forward_days',v_version.max_carry_forward_days,
      'carry_forward_expiry_month',v_version.carry_forward_expiry_month,
      'carry_forward_expiry_day',v_version.carry_forward_expiry_day,
      'reason',v_version.reason,'evidence_reference',v_version.evidence_reference,
      'recorded_at',v_version.recorded_at,'recorded_by_name',v_version.actor_name,
      'next_verified_version_id',v_version.next_verified_version_id,
      'supersedes_version_id',v_version.supersedes_version_id));
  end loop;
  return v_rows;
end $$;
revoke all on function public.crew_leave_policy_history(uuid,text) from public,anon,authenticated;
grant execute on function public.crew_leave_policy_history(uuid,text) to authenticated;


create or replace function public.crew_leave_policy_edit_context(
  p_outlet_id uuid,p_leave_type text,p_effective_from date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_policy public.crew_leave_policies%rowtype;
  v_prior public.crew_leave_policy_versions%rowtype;
  v_next public.crew_leave_policy_versions%rowtype;
  v_cutover date; v_next_change date;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave_settings.manage')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Leave settings permission is required.';
  end if;
  if p_leave_type not in ('annual','medical','unpaid','other') or p_effective_from is null then
    raise exception using errcode='22023',message='Leave policy date is invalid.';
  end if;
  select * into v_policy from public.crew_leave_policies
    where outlet_id=p_outlet_id and leave_type=p_leave_type;
  if v_policy.id is null then
    raise exception using errcode='22023',message='Leave policy is unavailable.';
  end if;
  select min(effective_from) into v_cutover from public.crew_leave_policy_versions
    where policy_id=v_policy.id and source_kind='cutover_current';
  v_prior:=public.crew_leave_policy_at(v_policy.id,p_effective_from);
  select * into v_next from public.crew_leave_policy_versions v
    where v.policy_id=v_policy.id and v.effective_from>p_effective_from
      and not exists (select 1 from public.crew_leave_policy_versions newer
        where newer.supersedes_version_id=v.id)
    order by v.effective_from,v.recorded_at desc,v.id desc limit 1;
  select min(v.effective_from) into v_next_change
    from public.crew_leave_policy_versions v
    where v.policy_id=v_policy.id and v.effective_from>p_effective_from
      and v.source_kind<>'cutover_current'
      and not exists (select 1 from public.crew_leave_policy_versions newer
        where newer.supersedes_version_id=v.id);
  return jsonb_build_object('verified_cutover_from',v_cutover,
    'historical',p_effective_from<v_cutover,'expected_version_id',v_prior.id,
    'expected_next_version_id',v_next.id,
    'next_observation_from',case when v_next.source_kind='cutover_current' then v_next.effective_from else null end,
    'next_effective_from',v_next_change,
    'version',case when v_prior.id is null then null else to_jsonb(v_prior) end);
end $$;
revoke all on function public.crew_leave_policy_edit_context(uuid,text,date)
  from public,anon,authenticated;
grant execute on function public.crew_leave_policy_edit_context(uuid,text,date)
  to authenticated;
