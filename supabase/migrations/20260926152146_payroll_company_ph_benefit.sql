-- Company benefit only: neither this policy nor Replacement Leave substitutes
-- for any statutory PH obligation. Fixed formula is a product policy, not an EA rule.
create table public.payroll_ph_policy_versions (
 id uuid primary key default gen_random_uuid(), legal_entity_id uuid not null references public.legal_entities(id),
 effective_from date not null, treatment text not null check(treatment in ('additional_pay','replacement_leave')),
 formula_version text not null default 'company_ph_v1' check(formula_version='company_ph_v1'),
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default now(),
 remark text, unique(legal_entity_id,effective_from)
);
create table public.payroll_ph_work_decisions (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.payroll_runs(id),
 employee_id uuid not null references public.employees(id), work_date date not null,
 revision integer not null, supersedes_id uuid references public.payroll_ph_work_decisions(id),
 treatment text not null check(treatment in ('additional_pay','replacement_leave')),
 policy_version_id uuid not null references public.payroll_ph_policy_versions(id),
 evidence jsonb not null, source_fingerprint text not null,
 request_id uuid not null unique, request_fingerprint text not null,
 remark text, actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default now(),
 unique(run_id,employee_id,work_date,revision)
);
-- Leave owns the balance and source-grant/revocation ledger, not Payroll.
create table public.crew_replacement_leave_grants (
 id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
 work_date date not null, entitlement_id uuid not null references public.crew_leave_entitlements(id),
 decision_id uuid not null unique references public.payroll_ph_work_decisions(id),
 adjustment_id uuid not null unique references public.crew_leave_adjustments(id),
 source_evidence jsonb not null, created_at timestamptz not null default now()
);
create table public.crew_replacement_leave_revocations (
 id uuid primary key default gen_random_uuid(), grant_id uuid not null unique references public.crew_replacement_leave_grants(id),
 decision_id uuid not null unique references public.payroll_ph_work_decisions(id),
 adjustment_id uuid not null unique references public.crew_leave_adjustments(id), created_at timestamptz not null default now()
);
create table public.crew_replacement_leave_consumptions (
 id uuid primary key default gen_random_uuid(), grant_id uuid not null references public.crew_replacement_leave_grants(id),
 approved_leave_id uuid not null references public.crew_approved_leaves(id), days numeric not null check(days>0 and days<=1),
 created_at timestamptz not null default now(), unique(grant_id,approved_leave_id)
);
do $$ declare t text; begin
 foreach t in array array['payroll_ph_policy_versions','payroll_ph_work_decisions','crew_replacement_leave_grants',
 'crew_replacement_leave_revocations','crew_replacement_leave_consumptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('create trigger ph_append_guard before insert or update or delete on public.%I for each row execute function public.payroll_command_guard()',t);
 end loop;
 foreach t in array array['crew_leave_requests','crew_approved_leaves','crew_leave_policies','crew_leave_entitlements'] loop
  execute format('alter table public.%I drop constraint %I',t,t||'_leave_type_check');
  execute format('alter table public.%I add constraint %I check(leave_type in (''annual'',''medical'',''unpaid'',''other'',''replacement''))',t,t||'_leave_type_check');
 end loop;
end $$;

create function public.payroll_ph_policy_save(p_legal_entity_id uuid,p_effective_from date,p_treatment text,p_remark text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor(); latest public.payroll_ph_policy_versions%rowtype; result uuid;
begin
 if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.manage') then
  raise exception using errcode='42501',message='Company policy authority denied.'; end if;
 if p_effective_from is null or p_treatment is null or p_treatment not in ('additional_pay','replacement_leave') then
  raise exception using errcode='22023',message='Choose a treatment and effective date.'; end if;
 perform pg_advisory_xact_lock(hashtext('ph-policy:'||p_legal_entity_id));
 select * into latest from public.payroll_ph_policy_versions where legal_entity_id=p_legal_entity_id order by effective_from desc limit 1;
 if latest.effective_from=p_effective_from and latest.treatment=p_treatment and coalesce(latest.remark,'')=coalesce(nullif(btrim(p_remark),''),'') then return latest.id; end if;
 if latest.id is not null and p_effective_from<=latest.effective_from then raise exception using errcode='22023',message='Choose a date after the latest policy version.'; end if;
 if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.period_id
  where p.legal_entity_id=p_legal_entity_id and r.status in ('finalized','paid') and p.period_end>=p_effective_from) then
  raise exception using errcode='55000',message='Policy cannot change finalized periods.'; end if;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_ph_policy_versions(legal_entity_id,effective_from,treatment,actor_employee_id,remark)
 values(p_legal_entity_id,p_effective_from,p_treatment,a,nullif(btrim(p_remark),'')) returning id into result;
 insert into public.payroll_events(event_type,actor_employee_id,details) values('ph_company_policy_confirmed',a,jsonb_build_object('policy_version_id',result));
 return result;
end $$;
create function public.payroll_ph_policy_read(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.payroll_admin_actor();
 if not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.view') then raise exception using errcode='42501',message='Company policy visibility denied.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(p) order by effective_from desc) from public.payroll_ph_policy_versions p where legal_entity_id=p_legal_entity_id),'[]'::jsonb);
end $$;

-- Pure projection: no record, entitlement or decision is created by this read.
create function public.payroll_ph_work_project(p_run_id uuid,p_employee_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; profile uuid;
 c public.payroll_compensation_versions%rowtype; t public.payroll_payable_time_versions%rowtype;
 policy public.payroll_ph_policy_versions%rowtype; decision public.payroll_ph_work_decisions%rowtype;
 source jsonb; paid jsonb; evidence jsonb; fingerprint text; amount numeric; grant_id uuid; issue text;
begin
 select * into r from public.payroll_runs where id=p_run_id;
 select * into p from public.payroll_periods where id=r.period_id;
 if p_work_date not between p.period_start and p.period_end or p_work_date>timezone('Asia/Kuala_Lumpur',now())::date then return null; end if;
 source:=public.payroll_time_evidence(p_employee_id,p_work_date);
 paid:=source->'paid_holiday_policy';
 if paid->>'status' is distinct from 'paid_holiday' or source->>'roster_entry_type' is distinct from 'working'
  or source->>'roster_publication_id' is null or source->>'clock_in_at' is null or source->>'clock_out_at' is null
  or coalesce((source->>'attendance_count')::integer,0)<>1 or source->>'leave_id' is not null then return null; end if;
 select id into profile from public.payroll_profiles where employee_id=p_employee_id;
 select * into c from public.payroll_compensation_versions where profile_id=profile and effective_from<=p_work_date order by effective_from desc limit 1;
 select * into t from public.payroll_payable_time_versions where profile_id=profile and work_date=p_work_date order by revision desc limit 1;
 if c.legal_entity_id is distinct from p.legal_entity_id or t.id is null or t.status='review_required'
  or t.source_fingerprint is distinct from source->>'source_fingerprint' or t.classification<>'public_holiday'
  or coalesce(t.approved_minutes,0)<=0 then return null; end if;
 select * into policy from public.payroll_ph_policy_versions where legal_entity_id=p.legal_entity_id and effective_from<=p_work_date order by effective_from desc limit 1;
 amount:=case c.pay_basis when 'monthly' then round(c.basic_salary/26,2) when 'hourly' then round(c.hourly_rate*t.approved_minutes/60,2) end;
 evidence:=jsonb_build_object('work_date',p_work_date,'employee_id',p_employee_id,'legal_entity_id',p.legal_entity_id,
  'source',source,'time',to_jsonb(t),'compensation',to_jsonb(c),'policy',to_jsonb(policy),
  'additional_amount',amount,'replacement_days',1,'formula_version','company_ph_v1',
  'formula',case c.pay_basis when 'monthly' then 'Monthly Basic Salary / 26 × 1 company benefit day' else 'Effective Hourly Rate × approved PH hours' end);
 fingerprint:=md5(evidence::text);
 select * into decision from public.payroll_ph_work_decisions where run_id=p_run_id and employee_id=p_employee_id and work_date=p_work_date order by revision desc limit 1;
 -- A correction inherits frozen treatment only if exact work/rate/policy evidence
 -- still matches; changed entitlement requires an explicit new revision decision.
 if decision.id is null and r.supersedes_run_id is not null then
  select * into decision from public.payroll_ph_work_decisions where run_id=r.supersedes_run_id and employee_id=p_employee_id and work_date=p_work_date order by revision desc limit 1;
 end if;
 if policy.id is null then issue:='ph_company_policy_required';
 elsif coalesce(t.approved_extra_minutes,0)>0 then issue:='public_holiday_ot_unsupported';
 elsif amount is null then issue:='ph_company_rate_required';
 elsif decision.id is null then issue:='ph_treatment_confirmation_required';
 elsif decision.source_fingerprint<>fingerprint then issue:='ph_treatment_evidence_changed'; end if;
 select g.id into grant_id from public.crew_replacement_leave_grants g where g.employee_id=p_employee_id and g.work_date=p_work_date
  and not exists(select 1 from public.crew_replacement_leave_revocations v where v.grant_id=g.id) order by g.created_at desc limit 1;
 if issue is null and decision.treatment='replacement_leave' and grant_id is null then issue:='replacement_leave_grant_required'; end if;
 return evidence||jsonb_build_object('source_fingerprint',fingerprint,'recommended_treatment',policy.treatment,
  'decision',to_jsonb(decision),'grant_id',grant_id,'issue',issue);
end $$;

create function public.payroll_ph_work_read(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; result jsonb;
begin
 perform public.payroll_admin_actor();
 select * into r from public.payroll_runs where id=p_run_id; select * into p from public.payroll_periods where id=r.period_id;
 if not public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view') or not exists
  (select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_employee_id) then
  raise exception using errcode='42501',message='Payroll employee visibility denied.'; end if;
 if r.status in ('finalized','paid') then
  select coalesce(s.calculation->'inputs'->'ph_work','[]'::jsonb) into result from public.payroll_run_calculation_snapshots s
    where s.run_id=p_run_id and s.employee_id=p_employee_id;
  return coalesce(result,'[]'::jsonb);
 end if;
 select coalesce(jsonb_agg(case_data order by work_date),'[]'::jsonb) into result from
  (select day::date work_date,public.payroll_ph_work_project(p_run_id,p_employee_id,day::date) case_data
   from generate_series(p.period_start,p.period_end,interval '1 day') day) cases where case_data is not null;
 return result;
end $$;
revoke all on function public.payroll_ph_work_project(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_ph_policy_save(uuid,date,text,text),public.payroll_ph_policy_read(uuid),public.payroll_ph_work_read(uuid,uuid) from public,anon;
grant execute on function public.payroll_ph_policy_save(uuid,date,text,text),public.payroll_ph_policy_read(uuid),public.payroll_ph_work_read(uuid,uuid) to authenticated;

create function public.payroll_ph_evidence_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='55000',message='PH policy, decision and Leave evidence is append-only.'; end if;
 if current_setting('feedx.payroll_command',true) is distinct from 'yes' then raise exception using errcode='42501',message='Canonical PH command required.'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['payroll_ph_policy_versions','payroll_ph_work_decisions','crew_replacement_leave_grants','crew_replacement_leave_revocations','crew_replacement_leave_consumptions'] loop
 execute format('drop trigger ph_append_guard on public.%I',t);
 execute format('create trigger ph_append_guard before insert or update or delete on public.%I for each row execute function public.payroll_ph_evidence_guard()',t);
 end loop;
end $$;
revoke all on function public.payroll_ph_evidence_guard() from public,anon,authenticated;

-- Extend the existing Leave owners in place; ordinary policies unchanged.
do $$ declare def text; begin
 def:=pg_get_functiondef('public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid)'::regprocedure);
 if position('select * into policy from public.crew_leave_policies' in def)=0 then raise exception 'Leave entitlement contract changed'; end if;
 def:=replace(def,'select * into policy from public.crew_leave_policies',
 $patch$if p_leave_type='replacement' then
  insert into public.crew_leave_entitlements(employee_id,outlet_id,leave_type,period_start,period_end,
   base_entitlement,prorated_entitlement,carry_forward,calculation_version,calculation_explanation,generated_by)
  values(employee.id,outlet,'replacement',v_period_start,v_period_end,0,0,0,'company-ph-replacement-v1',
   jsonb_build_object('source','Confirmed company PH work grants only','expires',v_period_end,'carry_forward',false),p_actor)
  on conflict(employee_id,leave_type,period_start) do nothing returning id into result_id;
  if result_id is null then select ce.id into result_id from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type='replacement' and ce.period_start=v_period_start; end if;
  return result_id;
 end if;
 select * into policy from public.crew_leave_policies$patch$);
 execute def;
 def:=pg_get_functiondef('public.crew_leave_entitlement_balance(uuid,date)'::regprocedure);
 def:=replace(def,'entitled:=e.prorated_entitlement+active_carry+adjusted;',
 'entitled:=e.prorated_entitlement+active_carry+adjusted; if e.leave_type=''replacement'' and p_as_of>e.period_end then entitled:=0; end if;');
 def:=replace(def,'coalesce(policy.balance_enforced,true)','(e.leave_type=''replacement'' or coalesce(policy.balance_enforced,true))');
 execute def;
end $$;
-- Current Leave reads/submit enumerate the same canonical types. Do not add a
-- second submit/review path. Configuration/ordinary manual adjustment cannot
-- manufacture Replacement Leave grants.
do $$ declare f record; def text; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like 'crew_leave%' or p.proname='crew_roster_employee_day') loop
 def:=pg_get_functiondef(f.oid);
 if f.proname not in ('crew_leave_policy_save','crew_leave_adjust') then
  def:=replace(def,'''annual'',''medical'',''unpaid'',''other''','''annual'',''medical'',''unpaid'',''other'',''replacement''');
  def:=replace(def,'''annual'', ''medical'', ''unpaid'', ''other''','''annual'', ''medical'', ''unpaid'', ''other'', ''replacement''');
 end if;
 def:=replace(def,'when ''unpaid'' then ''UL'' else ''OL''','when ''unpaid'' then ''UL'' when ''replacement'' then ''RL'' else ''OL''');
 if f.proname='crew_leave_adjust' then
  if position('v_before := public.crew_leave_entitlement_balance' in def)=0 then raise exception 'Leave adjustment contract changed'; end if;
  def:=replace(def,'v_before := public.crew_leave_entitlement_balance', 'if v_entitlement.leave_type=''replacement'' then raise exception using errcode=''42501'',message=''Replacement Leave is granted only by confirmed PH work.''; end if; v_before := public.crew_leave_entitlement_balance');
 end if;
 if def<>pg_get_functiondef(f.oid) then execute def; end if;
 end loop;
end $$;
create or replace function public.crew_leave_label(p_type text) returns text language sql immutable set search_path=public as $$
 select case p_type when 'annual' then 'Annual Leave' when 'medical' then 'Medical Leave' when 'unpaid' then 'Unpaid Leave' when 'replacement' then 'Replacement Leave' else 'Other Leave' end;
$$;
-- A distinct roster template is created only at the affected employment outlet
-- when its first Replacement Leave grant is established, not on every read.

create function public.crew_replacement_leave_consume() returns trigger language plpgsql security definer set search_path=public as $$
declare g record; needed numeric; take_days numeric;
begin
 if new.leave_type<>'replacement' then return new; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||new.employee_id::text));
 if extract(year from new.start_date)<>extract(year from new.end_date) then raise exception using errcode='22023',message='Replacement Leave must stay within its entitlement year.'; end if;
 needed:=public.crew_leave_requested_days(new.start_date,new.end_date,new.duration_type);
 perform set_config('feedx.payroll_command','yes',true);
 for g in select grant_row.id,1-coalesce((select sum(c.days) from public.crew_replacement_leave_consumptions c where c.grant_id=grant_row.id),0) remaining
  from public.crew_replacement_leave_grants grant_row join public.crew_leave_entitlements e on e.id=grant_row.entitlement_id
  where grant_row.employee_id=new.employee_id and e.period_start<=new.start_date and e.period_end>=new.end_date
   and grant_row.work_date<=new.start_date and not exists(select 1 from public.crew_replacement_leave_revocations v where v.grant_id=grant_row.id)
  order by grant_row.work_date,grant_row.created_at,grant_row.id loop
  take_days:=least(needed,g.remaining);
  if take_days>0 then insert into public.crew_replacement_leave_consumptions(grant_id,approved_leave_id,days) values(g.id,new.id,take_days); needed:=needed-take_days; end if;
  exit when needed<=0;
 end loop;
 if needed>0 then raise exception using errcode='22023',message='Insufficient source-linked Replacement Leave in the requested year.'; end if;
 return new;
end $$;
create trigger replacement_leave_consume after insert on public.crew_approved_leaves for each row execute function public.crew_replacement_leave_consume();
revoke all on function public.crew_replacement_leave_consume() from public,anon,authenticated;

create function public.payroll_ph_work_confirm(p_run_id uuid,p_employee_id uuid,p_work_date date,
 p_treatment text,p_source_fingerprint text,p_request_id uuid,p_remark text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor(); r public.payroll_runs%rowtype; p public.payroll_periods%rowtype;
 projected jsonb; prior public.payroll_ph_work_decisions%rowtype; retry public.payroll_ph_work_decisions%rowtype;
 grant_row public.crew_replacement_leave_grants%rowtype; result uuid; ent uuid; adj uuid; balance jsonb;
 fingerprint text:=md5(jsonb_build_array(p_run_id,p_employee_id,p_work_date,p_treatment,p_source_fingerprint,nullif(btrim(p_remark),''))::text);
begin
 select * into r from public.payroll_runs where id=p_run_id for update;
 select * into p from public.payroll_periods where id=r.period_id;
 if not public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage') or not exists
  (select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_employee_id) then
  raise exception using errcode='42501',message='Payroll employee treatment authority denied.'; end if;
 if r.status not in ('draft','review_required') or r.foundation_only then raise exception using errcode='55000',message='Treatment changes require a Draft or Correction Revision.'; end if;
 if p_request_id is null or p_treatment is null or p_treatment not in ('additional_pay','replacement_leave') then raise exception using errcode='22023',message='Choose a company treatment.'; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||p_employee_id));
 select * into retry from public.payroll_ph_work_decisions where request_id=p_request_id;
 if retry.id is not null then
  if retry.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Request identity belongs to different treatment input.'; end if;
  return retry.id;
 end if;
 projected:=public.payroll_ph_work_project(p_run_id,p_employee_id,p_work_date);
 if projected is null then raise exception using errcode='55000',message='Confirmed work on a selected Company Paid Holiday is required.'; end if;
 if projected->>'source_fingerprint' is distinct from p_source_fingerprint then raise exception using errcode='40001',message='PH work evidence changed. Refresh and review.'; end if;
 if projected->'policy'->>'id' is null or projected->>'issue' in ('public_holiday_ot_unsupported','ph_company_rate_required') then
  raise exception using errcode='55000',message='Company policy and supported approved PH time are required.'; end if;
 select * into prior from public.payroll_ph_work_decisions where run_id=p_run_id and employee_id=p_employee_id and work_date=p_work_date order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_ph_work_decisions(run_id,employee_id,work_date,revision,supersedes_id,treatment,policy_version_id,evidence,source_fingerprint,request_id,request_fingerprint,remark,actor_employee_id)
 values(p_run_id,p_employee_id,p_work_date,coalesce(prior.revision,0)+1,prior.id,p_treatment,(projected->'policy'->>'id')::uuid,
  projected-'decision'-'grant_id'-'issue',p_source_fingerprint,p_request_id,fingerprint,nullif(btrim(p_remark),''),a) returning id into result;
 select * into grant_row from public.crew_replacement_leave_grants g where g.employee_id=p_employee_id and g.work_date=p_work_date
  and not exists(select 1 from public.crew_replacement_leave_revocations v where v.grant_id=g.id) order by created_at desc limit 1;
 if p_treatment='additional_pay' and grant_row.id is not null then
  if exists(select 1 from public.crew_replacement_leave_consumptions c where c.grant_id=grant_row.id) then raise exception using errcode='55000',message='Replacement Leave has been consumed. Manual resolution is required.'; end if;
  balance:=public.crew_leave_entitlement_balance(grant_row.entitlement_id,p_work_date);
  if (balance->>'available')::numeric<1 then raise exception using errcode='55000',message='Replacement Leave is reserved or unavailable. Resolve leave requests before changing treatment.'; end if;
  insert into public.crew_leave_adjustments(entitlement_id,amount,reason,adjusted_by,previous_available,resulting_available)
   values(grant_row.entitlement_id,-1,'PH Draft treatment changed to Additional Pay',auth.uid(),(balance->>'available')::numeric,(balance->>'available')::numeric-1) returning id into adj;
  insert into public.crew_replacement_leave_revocations(grant_id,decision_id,adjustment_id) values(grant_row.id,result,adj);
 elsif p_treatment='replacement_leave' and grant_row.id is null then
  insert into public.shift_templates(outlet_id,name,code,start_time,end_time,break_minutes,shift_type,color,is_active)
   values((projected->'source'->>'outlet_id')::uuid,'Replacement Leave','RL',null,null,0,'replacement_leave','purple',true) on conflict do nothing;
  ent:=public.crew_leave_ensure_entitlement(p_employee_id,'replacement',date_trunc('year',p_work_date)::date,(projected->'source'->>'outlet_id')::uuid,auth.uid());
  balance:=public.crew_leave_entitlement_balance(ent,p_work_date);
  insert into public.crew_leave_adjustments(entitlement_id,amount,reason,adjusted_by,previous_available,resulting_available)
   values(ent,1,'Confirmed Company PH Work · Replacement Leave',auth.uid(),(balance->>'available')::numeric,(balance->>'available')::numeric+1) returning id into adj;
  insert into public.crew_replacement_leave_grants(employee_id,work_date,entitlement_id,decision_id,adjustment_id,source_evidence)
   values(p_employee_id,p_work_date,ent,result,adj,projected-'decision'-'grant_id'-'issue');
 end if;
 insert into public.payroll_events(event_type,run_id,actor_employee_id,details) values('ph_work_treatment_confirmed',p_run_id,a,jsonb_build_object('decision_id',result,'employee_id',p_employee_id,'work_date',p_work_date,'treatment',p_treatment));
 perform public.payroll_employee_recalculate(p_run_id,p_employee_id);
 return result;
end $$;
revoke all on function public.payroll_ph_work_confirm(uuid,uuid,date,text,text,uuid,text) from public,anon;
grant execute on function public.payroll_ph_work_confirm(uuid,uuid,date,text,text,uuid,text) to authenticated;

create index payroll_ph_work_employee_date on public.payroll_ph_work_decisions(employee_id,work_date);
create index replacement_leave_employee_date on public.crew_replacement_leave_grants(employee_id,work_date);
create index replacement_leave_consumed_grant on public.crew_replacement_leave_consumptions(grant_id);

-- Integrate at the single existing calculation owner. Normal salary continues;
-- Hourly PH ordinary pay reuses regular pricing, with a separate company benefit.
do $$ declare def text; anchor text; begin
 def:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
 anchor:='v_detail text; v_adjustment record; v_entitlement jsonb;';
 if position(anchor in def)=0 then raise exception 'Payroll calculation declaration contract changed'; end if;
 def:=replace(def,anchor,anchor||' v_ph jsonb;');
 anchor:='-- Regular Monthly time is already covered by Basic Salary, but an';
 if position(anchor in def)=0 then raise exception 'Payroll time calculation contract changed'; end if;
 def:=replace(def,anchor,$patch$
 if v_time.classification='public_holiday' then
  v_ph:=public.payroll_ph_work_project(p_run_id,p_employee_id,v_day);
  v_inputs:=jsonb_set(v_inputs,'{ph_work}',coalesce(v_inputs->'ph_work','[]'::jsonb)||jsonb_build_array(v_ph),true);
  if v_ph is null then v_issues:=array_append(v_issues,'ph_confirmed_work_evidence_required:'||v_day);
  elsif v_ph->>'issue' is not null then v_issues:=array_append(v_issues,(v_ph->>'issue')||':'||v_day);
  else
   if v_basis='hourly' then
    v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'regular',v_time.approved_minutes,v_day);
    if v_line is null then v_issues:=array_append(v_issues,'missing_regular_rule:'||v_day);
    else
     v_line:=jsonb_set(v_line,'{label}','"Regular Hourly Pay · PH worked hours"'::jsonb);
     v_lines:=v_lines||jsonb_build_array(v_line); v_gross:=v_gross+(v_line->>'amount')::numeric;
     v_regular_minutes:=v_regular_minutes+v_time.approved_minutes;
     v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
    end if;
   end if;
   if v_ph->'decision'->>'treatment'='additional_pay' then
    v_line:=jsonb_build_object('kind','earning','code','company_ph_benefit','label','Company Public Holiday Benefit',
     'amount',(v_ph->>'additional_amount')::numeric,'source',jsonb_build_object(
      'ph_work',v_ph,'formula',v_ph->>'formula','formula_version','company_ph_v1',
      'statutory_treatment',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','manual_confirmation'),
      'epf_source','https://www.kwsp.gov.my/en/employer/introduction — EPF Act overtime definition includes additional pay for PH work',
      'perkeso_source','https://www.perkeso.gov.my/uncategorised/774-employer-eligibility.html — wages include PH work payments'));
    v_lines:=v_lines||jsonb_build_array(v_line); v_gross:=v_gross+(v_line->>'amount')::numeric;
   end if;
  end if;
  if coalesce(v_time.approved_extra_minutes,0)>0 then v_issues:=array_append(v_issues,'public_holiday_ot_unsupported:'||v_day); end if;
  continue;
 end if;
 -- Regular Monthly time is already covered by Basic Salary, but an$patch$);
 execute def;
 def:=pg_get_functiondef('public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)'::regprocedure);
 anchor:='elsif v_line->>''code'' in (''monthly_basic'',''regular'') then v_treatment:=''included'';';
 if position(anchor in def)=0 then raise exception 'Statutory wage treatment contract changed'; end if;
 def:=replace(def,anchor,anchor||$patch$
 elsif v_line->>'code'='company_ph_benefit' then
  v_treatment:=case when v_scheme='epf' then 'excluded' when v_scheme in ('socso','eis') then 'included' else 'undetermined' end;
 $patch$);
 execute def;
end $$;
