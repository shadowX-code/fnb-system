-- Leave owns policy and grant versions; People alone owns dated employment truth.
-- This cutover records the current policy contract, never a historical policy.
create table public.crew_leave_policy_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  policy_id uuid not null references public.crew_leave_policies(id) on delete restrict,
  effective_from date not null,
  eligible_employment_types text[] not null,
  entitlement_method text not null check (entitlement_method in ('annual_allowance','unlimited')),
  proration_rule text not null check (proration_rule in ('calendar_days','none')),
  annual_days numeric(7,2) not null check (annual_days >= 0),
  balance_enforced boolean not null,
  carry_forward_enabled boolean not null,
  max_carry_forward_days numeric(7,2) not null,
  carry_forward_expiry_month smallint,
  carry_forward_expiry_day smallint,
  source_kind text not null check (source_kind in ('cutover_current','admin_change')),
  reason text not null,
  supersedes_version_id uuid unique references public.crew_leave_policy_versions(id) on delete restrict,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (cardinality(eligible_employment_types)>0),
  check (entitlement_method <> 'unlimited' or (not balance_enforced and proration_rule='none'))
);
create index crew_leave_policy_versions_asof_idx
  on public.crew_leave_policy_versions(policy_id,effective_from desc,recorded_at desc);
create unique index crew_leave_policy_one_baseline_idx
  on public.crew_leave_policy_versions(policy_id) where source_kind='cutover_current';
alter table public.crew_leave_policy_versions enable row level security;
revoke all on public.crew_leave_policy_versions from public,anon,authenticated;

alter table public.crew_leave_policies
  add column eligible_employment_types text[] not null
    default array['probation','full_time','part_time','intern','contract']::text[],
  add column entitlement_method text not null default 'annual_allowance',
  add column proration_rule text not null default 'none',
  add column current_version_id uuid references public.crew_leave_policy_versions(id) on delete restrict;
update public.crew_leave_policies
  set entitlement_method=case when balance_enforced then 'annual_allowance' else 'unlimited' end,
      proration_rule=case when balance_enforced and proration_enabled then 'calendar_days' else 'none' end;
insert into public.crew_leave_policy_versions
  (policy_id,effective_from,eligible_employment_types,entitlement_method,proration_rule,
   annual_days,balance_enforced,carry_forward_enabled,max_carry_forward_days,
   carry_forward_expiry_month,carry_forward_expiry_day,source_kind,reason)
select id,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date,
  eligible_employment_types,entitlement_method,proration_rule,annual_days,
  balance_enforced,carry_forward_enabled,max_carry_forward_days,
  carry_forward_expiry_month,carry_forward_expiry_day,'cutover_current',
  'Current Leave policy at cutover; earlier policy history is unverified.'
from public.crew_leave_policies;
update public.crew_leave_policies p set current_version_id=v.id
from public.crew_leave_policy_versions v where v.policy_id=p.id and v.source_kind='cutover_current';

-- Do not edit existing grants. Pin their observed balance-enforcement setting
-- in a separate labelled cutover record so a future policy change cannot
-- silently change how a historical grant is displayed or enforced.
create table public.crew_leave_legacy_balance_cutover (
  entitlement_id uuid primary key references public.crew_leave_entitlements(id) on delete restrict,
  balance_enforced boolean not null,
  observed_at timestamptz not null default clock_timestamp(),
  source_note text not null default 'Current policy at cutover; original grant policy is unverified.'
);
insert into public.crew_leave_legacy_balance_cutover(entitlement_id,balance_enforced)
select e.id,p.balance_enforced from public.crew_leave_entitlements e
join public.crew_leave_policies p on p.outlet_id=e.outlet_id and p.leave_type=e.leave_type;
alter table public.crew_leave_legacy_balance_cutover enable row level security;
revoke all on public.crew_leave_legacy_balance_cutover from public,anon,authenticated;

create function public.crew_leave_policy_version_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='55000',message='Leave policy versions are immutable.';
end $$;
create trigger crew_leave_policy_version_immutable before update or delete
  on public.crew_leave_policy_versions for each row
  execute function public.crew_leave_policy_version_immutable();
create trigger crew_leave_legacy_balance_cutover_immutable before update or delete
  on public.crew_leave_legacy_balance_cutover for each row
  execute function public.crew_leave_policy_version_immutable();
revoke all on function public.crew_leave_policy_version_immutable() from public,anon,authenticated;

create function public.crew_leave_policy_at(p_policy_id uuid,p_on date)
returns public.crew_leave_policy_versions
language sql stable security definer set search_path=public as $$
  select v from public.crew_leave_policy_versions v
  where v.policy_id=p_policy_id and v.effective_from<=p_on
    and not exists (select 1 from public.crew_leave_policy_versions newer
      where newer.supersedes_version_id=v.id)
  order by v.effective_from desc,v.recorded_at desc,v.id desc limit 1;
$$;
revoke all on function public.crew_leave_policy_at(uuid,date) from public,anon,authenticated;

-- The only annual calculation. Scheduled changes are deliberately ignored
-- until their effective day, then subsequent previews use them.
create function public.crew_leave_entitlement_preview(
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

create function public.crew_leave_apply_policy_current(p_policy_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_current public.crew_leave_policies%rowtype;
  v_version public.crew_leave_policy_versions%rowtype;
begin
  select * into v_current from public.crew_leave_policies where id=p_policy_id for update;
  if v_current.id is null then return false; end if;
  v_version:=public.crew_leave_policy_at(p_policy_id,
    timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date);
  if v_version.id is null or v_current.current_version_id=v_version.id then return false; end if;
  update public.crew_leave_policies set
    eligible_employment_types=v_version.eligible_employment_types,
    entitlement_method=v_version.entitlement_method,
    proration_rule=v_version.proration_rule,
    annual_days=v_version.annual_days,
    proration_enabled=v_version.proration_rule='calendar_days',
    balance_enforced=v_version.balance_enforced,
    carry_forward_enabled=v_version.carry_forward_enabled,
    max_carry_forward_days=v_version.max_carry_forward_days,
    carry_forward_expiry_month=v_version.carry_forward_expiry_month,
    carry_forward_expiry_day=v_version.carry_forward_expiry_day,
    current_version_id=v_version.id,updated_by=v_version.recorded_by,
    updated_at=clock_timestamp() where id=p_policy_id;
  return true;
end $$;
revoke all on function public.crew_leave_apply_policy_current(uuid)
  from public,anon,authenticated;

create table public.crew_leave_entitlement_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  entitlement_id uuid not null references public.crew_leave_entitlements(id) on delete restrict,
  source_kind text not null check (source_kind in ('employment_revision','policy_version')),
  source_id uuid not null,
  expected_evidence jsonb not null,
  expected_entitlement numeric(7,2),
  calculated_base numeric(7,2) not null,
  difference numeric(7,2),
  review_required boolean not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(entitlement_id,source_kind,source_id)
);
create index crew_leave_entitlement_reviews_latest_idx
  on public.crew_leave_entitlement_reviews(entitlement_id,recorded_at desc,id desc);
create table public.crew_leave_entitlement_review_resolutions (
  id uuid primary key default extensions.gen_random_uuid(),
  review_id uuid not null unique references public.crew_leave_entitlement_reviews(id) on delete restrict,
  adjustment_id uuid unique references public.crew_leave_adjustments(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  resolved_by uuid not null references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default clock_timestamp()
);
alter table public.crew_leave_entitlement_reviews enable row level security;
alter table public.crew_leave_entitlement_review_resolutions enable row level security;
revoke all on public.crew_leave_entitlement_reviews,
  public.crew_leave_entitlement_review_resolutions from public,anon,authenticated;

-- Append a review event. The original grant is never changed. A newer event
-- supersedes the previous review state without deleting older evidence.
create function public.crew_leave_note_entitlement_review(
  p_entitlement_id uuid,p_source_kind text,p_source_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_entitlement public.crew_leave_entitlements%rowtype;
  v_expected jsonb; v_expected_amount numeric; v_calculated numeric;
begin
  select * into v_entitlement from public.crew_leave_entitlements where id=p_entitlement_id;
  if v_entitlement.id is null or v_entitlement.leave_type='replacement' then return; end if;
  v_expected:=public.crew_leave_entitlement_preview(v_entitlement.employee_id,
    v_entitlement.leave_type,v_entitlement.period_start);
  select v_entitlement.prorated_entitlement+coalesce(sum(a.amount),0)
    into v_calculated from public.crew_leave_entitlement_review_resolutions rr
    join public.crew_leave_entitlement_reviews r on r.id=rr.review_id
    join public.crew_leave_adjustments a on a.id=rr.adjustment_id
    where r.entitlement_id=p_entitlement_id;
  v_expected_amount:=case when v_expected->>'state'='resolved'
    then (v_expected->>'rounded_entitlement')::numeric else null end;
  insert into public.crew_leave_entitlement_reviews
    (entitlement_id,source_kind,source_id,expected_evidence,expected_entitlement,
     calculated_base,difference,review_required)
  values (p_entitlement_id,p_source_kind,p_source_id,v_expected,v_expected_amount,
    v_calculated,case when v_expected_amount is null then null
      else v_expected_amount-v_calculated end,
    v_expected_amount is null or v_expected_amount<>v_calculated)
  on conflict(entitlement_id,source_kind,source_id) do nothing;
end $$;
revoke all on function public.crew_leave_note_entitlement_review(uuid,text,uuid)
  from public,anon,authenticated;

-- Historical People corrections can affect a grant even when the current
-- Employee projection does not move. Current/due changes also enter here.
create function public.crew_leave_employment_revision_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_entitlement uuid;
begin
  if new.source_kind<>'admin_change'
    or new.effective_from>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
    then return new; end if;
  for v_entitlement in select e.id from public.crew_leave_entitlements e
    where e.employee_id=new.employee_id and e.leave_type<>'replacement'
      and e.period_end>=new.effective_from loop
    perform public.crew_leave_note_entitlement_review(
      v_entitlement,'employment_revision',new.id);
  end loop;
  return new;
end $$;
create trigger crew_leave_employment_revision_review
  after insert on public.employee_employment_assignment_revisions
  for each row execute function public.crew_leave_employment_revision_review();
revoke all on function public.crew_leave_employment_revision_review()
  from public,anon,authenticated;

-- Future People changes only affect Leave when the established Employee
-- current projection actually changes on the effective date.
create function public.crew_leave_employment_effective_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_source uuid; v_entitlement uuid;
begin
  if (new.employment_type,new.employment_status,new.workplace,new.resigned_date)
    is not distinct from
    (old.employment_type,old.employment_status,old.workplace,old.resigned_date)
    then return new; end if;
  select r.id into v_source from public.employee_employment_assignment_revisions r
    where r.employee_id=new.id and r.effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id)
    order by r.effective_from desc,r.recorded_at desc,r.id desc limit 1;
  for v_entitlement in select e.id from public.crew_leave_entitlements e
    where e.employee_id=new.id and e.leave_type<>'replacement'
      and e.period_end>=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date loop
    perform public.crew_leave_note_entitlement_review(
      v_entitlement,'employment_revision',v_source);
  end loop;
  return new;
end $$;
create trigger crew_leave_employment_effective_review
  after update of employment_type,employment_status,workplace,resigned_date on public.employees
  for each row execute function public.crew_leave_employment_effective_review();
revoke all on function public.crew_leave_employment_effective_review()
  from public,anon,authenticated;

create or replace function public.crew_leave_policy_save(
  p_outlet_id uuid,p_leave_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_current public.crew_leave_policies%rowtype;
  v_prior public.crew_leave_policy_versions%rowtype;
  v_same public.crew_leave_policy_versions%rowtype;
  v_new public.crew_leave_policy_versions%rowtype;
  v_effective date; v_eligible text[]; v_method text; v_rule text;
  v_days numeric; v_carry numeric; v_month smallint; v_day smallint;
  v_reason text; v_entitlement uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave_settings.manage')
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Leave settings permission is required.';
  end if;
  if p_leave_type not in ('annual','medical','unpaid','other')
    or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='Leave policy payload is invalid.';
  end if;
  select * into v_current from public.crew_leave_policies
    where outlet_id=p_outlet_id and leave_type=p_leave_type for update;
  if v_current.id is null then
    raise exception using errcode='22023',message='Leave policy is unavailable.';
  end if;
  begin
    v_effective:=(p_payload->>'effective_from')::date;
    v_eligible:=array(select jsonb_array_elements_text(p_payload->'eligible_employment_types'));
    v_method:=p_payload->>'entitlement_method';
    v_rule:=p_payload->>'proration_rule';
    v_days:=(p_payload->>'annual_days')::numeric;
    v_carry:=coalesce((p_payload->>'max_carry_forward_days')::numeric,0);
    v_month:=nullif(p_payload->>'carry_forward_expiry_month','')::smallint;
    v_day:=nullif(p_payload->>'carry_forward_expiry_day','')::smallint;
  exception when others then
    raise exception using errcode='22023',message='Leave policy values are invalid.';
  end;
  v_reason:=btrim(coalesce(p_payload->>'reason',''));
  if v_effective is null or length(v_reason) not between 3 and 500
    or v_eligible is null or v_method is null or v_rule is null or v_days is null
    or cardinality(v_eligible)=0 or cardinality(v_eligible)>5
    or exists(select 1 from unnest(v_eligible) x
      where x not in ('probation','full_time','part_time','intern','contract'))
    or (select count(distinct x) from unnest(v_eligible) x)<>cardinality(v_eligible)
    or v_method not in ('annual_allowance','unlimited')
    or v_rule not in ('calendar_days','none') or v_days<0 or v_carry<0
    or (v_method='unlimited' and (v_rule<>'none' or v_days<>0))
    or (coalesce((p_payload->>'carry_forward_enabled')::boolean,false)
      and (v_month not between 1 and 12 or v_day not between 1 and 31))
  then raise exception using errcode='22023',message='Leave policy values are invalid.'; end if;
  if v_effective<(select min(effective_from) from public.crew_leave_policy_versions
    where policy_id=v_current.id and source_kind='cutover_current') then
    raise exception using errcode='22023',
      message='Leave policy before the verified cutover is unresolved.';
  end if;
  v_prior:=public.crew_leave_policy_at(v_current.id,v_effective);
  if v_prior.id is distinct from nullif(p_payload->>'expected_version_id','')::uuid then
    raise exception using errcode='40001',message='Leave policy changed. Review the latest version.';
  end if;
  select * into v_same from public.crew_leave_policy_versions v
    where v.policy_id=v_current.id and v.effective_from=v_effective
      and not exists (select 1 from public.crew_leave_policy_versions newer
        where newer.supersedes_version_id=v.id)
    order by v.recorded_at desc limit 1;
  if (v_eligible,v_method,v_rule,v_days,v_carry,v_month,v_day)
    is not distinct from
    (v_prior.eligible_employment_types,v_prior.entitlement_method,
     v_prior.proration_rule,v_prior.annual_days,v_prior.max_carry_forward_days,
     v_prior.carry_forward_expiry_month,v_prior.carry_forward_expiry_day)
    and coalesce((p_payload->>'carry_forward_enabled')::boolean,false)
      =v_prior.carry_forward_enabled then
    raise exception using errcode='22023',message='No Leave policy change was made.';
  end if;
  insert into public.crew_leave_policy_versions
    (policy_id,effective_from,eligible_employment_types,entitlement_method,
     proration_rule,annual_days,balance_enforced,carry_forward_enabled,
     max_carry_forward_days,carry_forward_expiry_month,carry_forward_expiry_day,
     source_kind,reason,supersedes_version_id,recorded_by)
  values (v_current.id,v_effective,v_eligible,v_method,v_rule,v_days,
    v_method='annual_allowance',coalesce((p_payload->>'carry_forward_enabled')::boolean,false),
    v_carry,v_month,v_day,'admin_change',v_reason,v_same.id,auth.uid())
  returning * into v_new;
  if v_effective<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then
    perform public.crew_leave_apply_policy_current(v_current.id);
    for v_entitlement in select e.id from public.crew_leave_entitlements e
      where e.leave_type=p_leave_type and e.period_end>=v_effective
        and (e.outlet_id=p_outlet_id or exists (
          select 1 from public.employee_employment_assignment_revisions r
          join public.outlets o on o.id=p_outlet_id
          where r.employee_id=e.employee_id and r.effective_from<=e.period_end
            and lower(r.workplace) in (lower(o.name),lower(coalesce(o.code,''))))) loop
      perform public.crew_leave_note_entitlement_review(
        v_entitlement,'policy_version',v_new.id);
    end loop;
  end if;
  return jsonb_build_object('version',to_jsonb(v_new),
    'projection_state',case when v_effective>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      then 'scheduled' else 'current' end);
end $$;
revoke all on function public.crew_leave_policy_save(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.crew_leave_policy_save(uuid,text,jsonb) to authenticated;

create function public.crew_leave_activate_due_policy_versions()
returns integer language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_count integer:=0; v_version uuid; v_entitlement uuid;
begin
  for v_id in select p.id from public.crew_leave_policies p
    where p.current_version_id is distinct from
      (public.crew_leave_policy_at(p.id,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date)).id
  loop
    if public.crew_leave_apply_policy_current(v_id) then
      v_count:=v_count+1;
      select current_version_id into v_version from public.crew_leave_policies where id=v_id;
      for v_entitlement in select e.id from public.crew_leave_entitlements e
        join public.crew_leave_policies p on p.leave_type=e.leave_type
        where p.id=v_id and e.period_end>=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
          and (e.outlet_id=p.outlet_id or exists (
            select 1 from public.employee_employment_assignment_revisions r
            join public.outlets o on o.id=p.outlet_id
            where r.employee_id=e.employee_id and r.effective_from<=e.period_end
              and lower(r.workplace) in (lower(o.name),lower(coalesce(o.code,''))))) loop
        perform public.crew_leave_note_entitlement_review(
          v_entitlement,'policy_version',v_version);
      end loop;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.crew_leave_activate_due_policy_versions()
  from public,anon,authenticated;
select cron.schedule('feedx_crew_leave_activate_due_policy_versions','* * * * *',
  'select public.crew_leave_activate_due_policy_versions()');

-- Existing grants are durable. Only a missing grant enters the dated
-- calculation path; replacement leave retains its independent PH source.
create or replace function public.crew_leave_ensure_entitlement(
  p_employee_id uuid,p_leave_type text,p_period_start date,
  p_outlet_id uuid default null,p_actor uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_start date:=date_trunc('year',p_period_start)::date;
  v_end date:=(date_trunc('year',p_period_start)+interval '1 year'-interval '1 day')::date;
  v_employee public.employees%rowtype; v_outlet uuid;
  v_policy public.crew_leave_policies%rowtype;
  v_preview jsonb; v_prior public.crew_leave_entitlements%rowtype;
  v_prior_balance jsonb; v_carry numeric:=0; v_expiry date; v_result uuid;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if v_employee.id is null then raise exception using errcode='22023',message='Employee is unavailable.'; end if;
  select id into v_result from public.crew_leave_entitlements
    where employee_id=p_employee_id and leave_type=p_leave_type and period_start=v_start;
  if v_result is not null then return v_result; end if;
  if not coalesce(v_employee.is_active,true)
    or coalesce(v_employee.employment_status,'') in ('resigned','terminated')
    or (v_employee.resigned_date is not null and v_start>v_employee.resigned_date)
    then raise exception using errcode='22023',message='Future leave entitlement cannot be generated for a departed employee.'; end if;
  v_outlet:=coalesce(p_outlet_id,public.crew_resolve_employee_outlet(p_employee_id));
  if v_outlet is null then raise exception using errcode='22023',message='Employee outlet is unavailable.'; end if;
  if p_leave_type='replacement' then
    insert into public.crew_leave_entitlements(employee_id,outlet_id,leave_type,period_start,period_end,
      base_entitlement,prorated_entitlement,carry_forward,calculation_version,
      calculation_explanation,generated_by)
    values(p_employee_id,v_outlet,'replacement',v_start,v_end,0,0,0,
      'company-ph-replacement-v1',jsonb_build_object('source','Confirmed company PH work grants only',
      'expires',v_end,'carry_forward',false),p_actor)
    on conflict(employee_id,leave_type,period_start) do nothing returning id into v_result;
    if v_result is null then select id into v_result from public.crew_leave_entitlements
      where employee_id=p_employee_id and leave_type='replacement' and period_start=v_start; end if;
    return v_result;
  end if;
  v_preview:=public.crew_leave_entitlement_preview(p_employee_id,p_leave_type,v_start);
  if v_preview->>'state'<>'resolved' then
    raise exception using errcode='22023',
      message='Leave entitlement needs review: verified employment or policy history is incomplete.';
  end if;
  select * into v_policy from public.crew_leave_policies
    where outlet_id=v_outlet and leave_type=p_leave_type;
  if v_policy.id is null then raise exception using errcode='22023',message='Leave policy is unavailable.'; end if;
  if v_policy.carry_forward_enabled then
    select * into v_prior from public.crew_leave_entitlements
      where employee_id=p_employee_id and leave_type=p_leave_type
        and period_start=(v_start-interval '1 year')::date;
    if v_prior.id is not null then
      v_prior_balance:=public.crew_leave_entitlement_balance(v_prior.id,v_prior.period_end);
      v_carry:=least(v_policy.max_carry_forward_days,
        greatest(0,coalesce((v_prior_balance->>'available')::numeric,0)));
    end if;
    v_expiry:=make_date(extract(year from v_start)::int,v_policy.carry_forward_expiry_month,
      least(v_policy.carry_forward_expiry_day,
        extract(day from (make_date(extract(year from v_start)::int,
          v_policy.carry_forward_expiry_month,1)+interval '1 month'-interval '1 day'))::int));
  end if;
  insert into public.crew_leave_entitlements(employee_id,outlet_id,leave_type,period_start,
    period_end,base_entitlement,prorated_entitlement,carry_forward,
    carry_forward_expires_at,calculation_version,calculation_explanation,generated_by)
  values(p_employee_id,v_outlet,p_leave_type,v_start,v_end,v_policy.annual_days,
    (v_preview->>'rounded_entitlement')::numeric,v_carry,v_expiry,
    'employment-eligibility-v2',v_preview||jsonb_build_object(
      'policy_balance_enforced',v_policy.balance_enforced,
      'policy_current_version_id',v_policy.current_version_id,
      'joined_date',v_employee.joined_date),p_actor)
  on conflict(employee_id,leave_type,period_start) do nothing returning id into v_result;
  if v_result is null then select id into v_result from public.crew_leave_entitlements
    where employee_id=p_employee_id and leave_type=p_leave_type and period_start=v_start; end if;
  return v_result;
end $$;
revoke all on function public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid)
  from public,anon,authenticated;

-- Balance arithmetic stays unchanged. The grant's original policy controls
-- balance enforcement for V2; historical grants retain their old behavior.
create or replace function public.crew_leave_entitlement_balance(
  p_entitlement_id uuid,p_as_of date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.crew_leave_entitlements%rowtype;
  policy public.crew_leave_policies%rowtype; adjusted numeric; used_days numeric;
  pending_days numeric; active_carry numeric; entitled numeric; available numeric;
  enforced boolean; legacy_enforced boolean;
  review public.crew_leave_entitlement_reviews%rowtype;
  resolved boolean;
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
  return jsonb_build_object('entitlement_id',e.id,'employee_id',e.employee_id,
    'outlet_id',e.outlet_id,'leave_type',e.leave_type,'period_start',e.period_start,
    'period_end',e.period_end,'base',e.base_entitlement,'prorated',e.prorated_entitlement,
    'carry_forward',active_carry,'carry_forward_awarded',e.carry_forward,
    'carry_forward_expires_at',e.carry_forward_expires_at,'adjustment',adjusted,
    'entitled',entitled,'used',used_days,'pending',pending_days,'available',available,
    'balance_enforced',enforced,'calculation_version',e.calculation_version,
    'explanation',e.calculation_explanation,'eligibility_state',case
      when review.id is not null and review.review_required and not resolved then 'review_required'
      else 'resolved' end,'review_id',case when not resolved then review.id else null end,
    'expected_entitlement',case when not resolved then review.expected_entitlement else null end,
    'expected_difference',case when not resolved then review.difference else null end,
    'expected_evidence',case when not resolved then review.expected_evidence else null end);
end $$;
revoke all on function public.crew_leave_entitlement_balance(uuid,date)
  from public,anon,authenticated;

-- A correction is an ordinary audited Leave adjustment linked to the review.
-- Neither the durable grant nor previous adjustment evidence is rewritten.
create function public.crew_leave_reconcile_entitlement(p_review_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_review public.crew_leave_entitlement_reviews%rowtype;
  v_entitlement public.crew_leave_entitlements%rowtype;
  v_latest uuid; v_now jsonb; v_base numeric; v_difference numeric;
  v_adjustment jsonb; v_adjustment_id uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave_balance.adjust')
    then raise exception using errcode='42501',message='Leave correction permission is required.'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 500
    then raise exception using errcode='22023',message='A correction reason is required.'; end if;
  select * into v_review from public.crew_leave_entitlement_reviews where id=p_review_id;
  if v_review.id is null then raise exception using errcode='P0002',message='Leave review is unavailable.'; end if;
  select * into v_entitlement from public.crew_leave_entitlements
    where id=v_review.entitlement_id for update;
  if not public.current_user_can_access_outlet(v_entitlement.outlet_id) then
    raise exception using errcode='42501',message='Leave entitlement is outside your outlet scope.';
  end if;
  select id into v_latest from public.crew_leave_entitlement_reviews
    where entitlement_id=v_entitlement.id order by recorded_at desc,id desc limit 1;
  if v_latest<>p_review_id or exists(select 1 from public.crew_leave_entitlement_review_resolutions
    where review_id=p_review_id) then
    raise exception using errcode='40001',message='Leave review changed. Reload the entitlement.';
  end if;
  v_now:=public.crew_leave_entitlement_preview(v_entitlement.employee_id,
    v_entitlement.leave_type,v_entitlement.period_start);
  if v_now->>'state'<>'resolved' then
    raise exception using errcode='22023',message='Verified employment or policy history is still incomplete.';
  end if;
  select v_entitlement.prorated_entitlement+coalesce(sum(a.amount),0)
    into v_base from public.crew_leave_entitlement_review_resolutions rr
    join public.crew_leave_entitlement_reviews r on r.id=rr.review_id
    join public.crew_leave_adjustments a on a.id=rr.adjustment_id
    where r.entitlement_id=v_entitlement.id;
  v_difference:=(v_now->>'rounded_entitlement')::numeric-v_base;
  if v_difference<>0 then
    v_adjustment:=public.crew_leave_adjust(v_entitlement.id,v_difference,
      'Employment/policy entitlement correction: '||btrim(p_reason));
    v_adjustment_id:=(v_adjustment->'adjustment'->>'id')::uuid;
  end if;
  insert into public.crew_leave_entitlement_review_resolutions
    (review_id,adjustment_id,reason,resolved_by)
  values(p_review_id,v_adjustment_id,btrim(p_reason),auth.uid());
  return jsonb_build_object('review_id',p_review_id,'expected_evidence',v_now,
    'adjustment_id',v_adjustment_id,'difference',v_difference,
    'balance',public.crew_leave_entitlement_balance(v_entitlement.id));
end $$;
revoke all on function public.crew_leave_reconcile_entitlement(uuid,text)
  from public,anon,authenticated;
grant execute on function public.crew_leave_reconcile_entitlement(uuid,text)
  to authenticated;

-- Existing request/approval RPCs retain their mutation and audit ownership.
-- A narrow guard prevents them from using a durable old grant as proof of
-- eligibility after a verified employment or policy change.
create function public.crew_leave_request_eligibility_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_day date; v_lookup date; v_today date:=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date;
  v_employee public.employees%rowtype;
  v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_policy public.crew_leave_policy_versions%rowtype; v_policy_id uuid; v_outlet uuid;
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
  return new;
end $$;
create trigger crew_leave_request_eligibility_guard
  before insert or update of status on public.crew_leave_requests
  for each row execute function public.crew_leave_request_eligibility_guard();
revoke all on function public.crew_leave_request_eligibility_guard()
  from public,anon,authenticated;
