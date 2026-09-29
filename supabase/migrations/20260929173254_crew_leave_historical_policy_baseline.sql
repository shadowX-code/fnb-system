-- Historical policy terms are evidence entered after the fact. The original
-- cutover observation stays immutable and remains the next effective boundary.
alter table public.crew_leave_policy_versions
  add column evidence_reference text,
  add column next_verified_version_id uuid references public.crew_leave_policy_versions(id) on delete restrict;
alter table public.crew_leave_policy_versions
  drop constraint crew_leave_policy_versions_source_kind_check;
alter table public.crew_leave_policy_versions
  add constraint crew_leave_policy_versions_source_kind_check
    check (source_kind in ('cutover_current','admin_change','historical_baseline')),
  add constraint crew_leave_policy_historical_evidence_check
    check (source_kind<>'historical_baseline' or
      (length(btrim(reason)) between 3 and 500 and
       length(btrim(evidence_reference)) between 3 and 500 and
       next_verified_version_id is not null));

-- The editor reads both sides of the selected effective date. The save RPC
-- rechecks these IDs under the policy row lock before inserting a version.
create function public.crew_leave_policy_edit_context(
  p_outlet_id uuid,p_leave_type text,p_effective_from date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_policy public.crew_leave_policies%rowtype;
  v_prior public.crew_leave_policy_versions%rowtype;
  v_next public.crew_leave_policy_versions%rowtype;
  v_cutover date;
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
  return jsonb_build_object('verified_cutover_from',v_cutover,
    'historical',p_effective_from<v_cutover,'expected_version_id',v_prior.id,
    'expected_next_version_id',v_next.id,'next_effective_from',v_next.effective_from,
    'version',case when v_prior.id is null then null else to_jsonb(v_prior) end);
end $$;
revoke all on function public.crew_leave_policy_edit_context(uuid,text,date)
  from public,anon,authenticated;
grant execute on function public.crew_leave_policy_edit_context(uuid,text,date)
  to authenticated;

create or replace function public.crew_leave_policy_save(
  p_outlet_id uuid,p_leave_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_current public.crew_leave_policies%rowtype;
  v_prior public.crew_leave_policy_versions%rowtype;
  v_same public.crew_leave_policy_versions%rowtype;
  v_next public.crew_leave_policy_versions%rowtype;
  v_new public.crew_leave_policy_versions%rowtype;
  v_effective date; v_eligible text[]; v_method text; v_rule text;
  v_days numeric; v_carry numeric; v_month smallint; v_day smallint;
  v_reason text; v_evidence text; v_entitlement uuid;
  v_cutover date; v_historical boolean; v_expected uuid; v_expected_next uuid;
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
    v_expected:=nullif(p_payload->>'expected_version_id','')::uuid;
    v_expected_next:=nullif(p_payload->>'expected_next_version_id','')::uuid;
  exception when others then
    raise exception using errcode='22023',message='Leave policy values are invalid.';
  end;
  v_reason:=btrim(coalesce(p_payload->>'reason',''));
  v_evidence:=nullif(btrim(coalesce(p_payload->>'evidence_reference','')),'');
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
  select min(effective_from) into v_cutover from public.crew_leave_policy_versions
    where policy_id=v_current.id and source_kind='cutover_current';
  if v_cutover is null then
    raise exception using errcode='22023',message='Verified Leave policy cutover is missing.';
  end if;
  v_historical:=v_effective<v_cutover;
  if v_historical and (
    not (p_payload ?& array['effective_from','eligible_employment_types',
      'entitlement_method','proration_rule','annual_days','carry_forward_enabled',
      'max_carry_forward_days','carry_forward_expiry_month','carry_forward_expiry_day',
      'reason','evidence_reference','expected_version_id','expected_next_version_id',
      'historical_terms_verified'])
    or jsonb_typeof(p_payload->'carry_forward_enabled')<>'boolean'
    or jsonb_typeof(p_payload->'max_carry_forward_days')<>'number'
    or p_payload->>'historical_terms_verified'<>'true'
    or v_evidence is null or length(v_evidence) not between 3 and 500
    or (v_method='annual_allowance' and not coalesce((p_payload->>'carry_forward_enabled')::boolean,false)
      and (v_carry<>0 or v_month is not null or v_day is not null))
    or (v_method='unlimited' and (coalesce((p_payload->>'carry_forward_enabled')::boolean,false)
      or v_carry<>0 or v_month is not null or v_day is not null))
  ) then
    raise exception using errcode='22023',
      message='Complete historical Leave policy terms, reason and evidence reference are required.';
  end if;
  v_prior:=public.crew_leave_policy_at(v_current.id,v_effective);
  if v_prior.id is distinct from v_expected then
    raise exception using errcode='40001',message='Leave policy changed. Review the latest version.';
  end if;
  if v_historical then
    select * into v_next from public.crew_leave_policy_versions v
      where v.policy_id=v_current.id and v.effective_from>v_effective
        and not exists (select 1 from public.crew_leave_policy_versions newer
          where newer.supersedes_version_id=v.id)
      order by v.effective_from,v.recorded_at desc,v.id desc limit 1;
    if v_next.id is null or v_next.id is distinct from v_expected_next then
      raise exception using errcode='40001',message='Leave policy timeline changed. Review the adjacent version.';
    end if;
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
     source_kind,reason,evidence_reference,next_verified_version_id,
     supersedes_version_id,recorded_by)
  values (v_current.id,v_effective,v_eligible,v_method,v_rule,v_days,
    v_method='annual_allowance',coalesce((p_payload->>'carry_forward_enabled')::boolean,false),
    v_carry,v_month,v_day,
    case when v_historical then 'historical_baseline' else 'admin_change' end,
    v_reason,v_evidence,case when v_historical then v_next.id else null end,
    v_same.id,auth.uid())
  returning * into v_new;
  if v_effective<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then
    perform public.crew_leave_apply_policy_current(v_current.id);
    for v_entitlement in select e.id from public.crew_leave_entitlements e
      where e.leave_type=p_leave_type and e.period_end>=v_effective
        and (not v_historical or e.period_start<v_next.effective_from)
        and (e.outlet_id=p_outlet_id or exists (
          select 1 from public.employee_employment_assignment_revisions r
          join public.outlets o on o.id=p_outlet_id
          where r.employee_id=e.employee_id and r.effective_from<=e.period_end
            and lower(r.workplace) in (lower(o.name),lower(coalesce(o.code,''))))) loop
      perform public.crew_leave_note_entitlement_review(
        v_entitlement,'policy_version',v_new.id);
    end loop;
  end if;
  if v_historical then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values ('crew_leave_historical_policy_established','crew',auth.uid(),
      'Admin established an evidenced historical Leave policy version.',
      jsonb_build_object('outlet_id',p_outlet_id,'leave_type',p_leave_type,
        'version_id',v_new.id,'effective_from',v_effective,
        'next_verified_version_id',v_next.id,'reason',v_reason,
        'evidence_reference',v_evidence));
  end if;
  return jsonb_build_object('version',to_jsonb(v_new),
    'projection_state',case when v_historical then 'historical'
      when v_effective>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      then 'scheduled' else 'current' end);
end $$;
revoke all on function public.crew_leave_policy_save(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.crew_leave_policy_save(uuid,text,jsonb) to authenticated;
