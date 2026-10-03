-- JTKSM Act 265 (2023), ss60D,60I and First Schedule; Part-Time Regulations
-- 2010 reg6. Rules price reviewed legal wage inputs, never scheduled hours.
-- Employee/day evidence is explicit; this migration backfills no eligibility.
alter table public.payroll_pay_rule_versions add column formula_version text not null default 'time_multiplier_v1'
 check(formula_version in ('time_multiplier_v1','my_ph_2023_v1'));
-- Legal formula packs do not use a generic monthly minute divisor.
do $$ declare x record; begin
 for x in select conname from pg_constraint where conrelid='public.payroll_pay_rule_versions'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%monthly_divisor_minutes%' and pg_get_constraintdef(oid) like '%monthly_basic%' loop
  execute format('alter table public.payroll_pay_rule_versions drop constraint %I',x.conname);
 end loop;
end $$;
alter table public.payroll_pay_rule_versions add constraint payroll_rule_formula_basis check(
 (formula_version='my_ph_2023_v1' and rule_code in ('public_holiday','public_holiday_ot') and monthly_divisor_minutes is null)
 or (formula_version='time_multiplier_v1' and ((pay_basis='hourly' and monthly_divisor_minutes is null)
 or (pay_basis='monthly' and ((rule_code in ('monthly_basic','non_payable','monthly_proration') and monthly_divisor_minutes is null)
 or (rule_code not in ('monthly_basic','non_payable','monthly_proration') and monthly_divisor_minutes is not null))))));
select set_config('feedx.payroll_command','yes',true);
insert into public.payroll_pay_rule_versions(rule_code,pay_basis,effective_from,multiplier,monthly_divisor_minutes,source_note,reason,approved_by_employee_id,formula_version)
select code,basis,'2023-01-01',case when code='public_holiday' then 2 else 3 end,
 null,
 'JTKSM Act 265 ss60D(2A),(3),60I; First Schedule; Part-Time Regulations 2010 reg6. Verified legal wage/category/hour inputs required.',
 'Official PH authority pack; no employee participation or eligibility inferred',actor.id,'my_ph_2023_v1'
from (values('public_holiday'),('public_holiday_ot')) codes(code)
cross join (values('monthly'),('hourly')) bases(basis)
cross join lateral(select e.id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.is_active order by e.created_at limit 1) actor;

insert into public.payroll_events(event_type,rule_version_id,actor_employee_id,reason,details)
select 'pay_rule_published',id,approved_by_employee_id,reason,jsonb_build_object('rule_version_id',id,'formula_version',formula_version,'migration','20261003183408','source','JTKSM Act265 and Part-Time Regulations') from public.payroll_pay_rule_versions where formula_version='my_ph_2023_v1';

create table public.payroll_ph_eligibility_reviews(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.payroll_runs(id),
 employee_id uuid not null references public.employees(id),work_date date not null,
 revision integer not null, supersedes_id uuid references public.payroll_ph_eligibility_reviews(id),
 evidence jsonb not null, context jsonb not null, context_fingerprint text not null,
 official_reference text not null, reason text not null,actor_employee_id uuid not null references public.employees(id),
 created_at timestamptz not null default clock_timestamp(),request_id uuid not null unique,request_fingerprint text not null,
 unique(run_id,employee_id,work_date,revision)
);
alter table public.payroll_ph_eligibility_reviews enable row level security;
revoke all on public.payroll_ph_eligibility_reviews from public,anon,authenticated;
create trigger ph_eligibility_append_guard before insert or update or delete on public.payroll_ph_eligibility_reviews
 for each row execute function public.payroll_ph_evidence_guard();

-- Private current context pins separate authorities. A changed time decision,
-- compensation, People assignment, calendar or benefit decision invalidates review.
create function public.payroll_ph_statutory_context(p_run uuid,p_employee uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; c public.payroll_compensation_versions%rowtype;
 t public.payroll_payable_time_versions%rowtype; a public.employee_employment_assignment_revisions%rowtype;
 paid jsonb; source jsonb; benefit jsonb; employment_outlet uuid; outlet_matches integer;
begin
 select * into r from payroll_runs where id=p_run; select * into p from payroll_periods where id=r.period_id;
 if p_day not between p.period_start and p.period_end then return null; end if;
 select v.* into c from payroll_compensation_effective_versions() v join payroll_profiles f on f.id=v.profile_id
 where f.employee_id=p_employee and v.effective_from<=p_day order by v.effective_from desc limit 1;
 a:=employee_employment_assignment_at(p_employee,p_day);
 if c.id is null or c.legal_entity_id is distinct from p.legal_entity_id or a.id is null
  or a.legal_entity_id is distinct from p.legal_entity_id or a.employment_status<>'active' then return null; end if;
 source:=payroll_time_evidence(p_employee,p_day);
 select count(*),(array_agg(o.id))[1] into outlet_matches,employment_outlet from outlets o where lower(btrim(a.workplace)) in (lower(btrim(o.name)),lower(btrim(o.code)));
 if source#>>'{paid_holiday_policy,status}'='paid_holiday' then paid:=source->'paid_holiday_policy';
 elsif source is null and outlet_matches=1 then paid:=payroll_paid_holiday_resolve(p.legal_entity_id,employment_outlet,p_day);
 else return null; end if;
 if paid->>'status' is distinct from 'paid_holiday' then return null; end if;
 select * into t from payroll_payable_time_versions where employee_id=p_employee and work_date=p_day order by revision desc limit 1;
 benefit:=payroll_ph_work_project(p_run,p_employee,p_day);
 return jsonb_build_object('date',p_day,'preceding_employer_verified',coalesce((employee_employment_assignment_at(p_employee,(date_trunc('month',p_day)-interval '1 day')::date)).legal_entity_id=p.legal_entity_id,false),'period_start',p.period_start,'period_end',p.period_end,'employee_age_verified',(select case when birthday is null then false else age(p_day,birthday)>=interval '18 years' end from employees where id=p_employee),'paid_holiday',paid,'employment',to_jsonb(a),'compensation',to_jsonb(c),
  'source',source,'time',to_jsonb(t),'company_benefit',benefit,
  'company_policy',(select to_jsonb(v) from payroll_ph_policy_versions v where legal_entity_id=p.legal_entity_id and effective_from<=p_day order by effective_from desc limit 1),
  'rules',coalesce((select jsonb_agg(to_jsonb(v) order by rule_code,effective_from) from payroll_pay_rule_versions v
   where rule_code in ('public_holiday','public_holiday_ot') and pay_basis=c.pay_basis and effective_from<=p_day),'[]'::jsonb));
end $$;

-- Numeric inputs below are reviewed wage evidence, NOT client-calculated pay.
-- Server calculates ORP/HRP and determines the RM4,000 premium boundary.
create function public.payroll_ph_statutory_price(p_context jsonb,p_evidence jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare c jsonb:=p_context->'compensation'; t jsonb:=p_context->'time'; e jsonb:=p_evidence;
 issues text[]:='{}'; lines jsonb:='[]'; source jsonb; rule jsonb; ot_rule jsonb;
 normal_mins integer; full_mins integer; worked integer:=coalesce((t->>'approved_minutes')::integer,0);
 extra integer:=coalesce((t->>'approved_extra_minutes')::integer,0); ordinary numeric; hourly numeric;
 premium boolean; coverage text:=e->>'coverage'; category text:=e->>'schedule_category'; basis text:=c->>'pay_basis';
 wages numeric; low_mins integer; high_mins integer; amount numeric; company numeric; subtotal numeric:=0;
begin
 if p_context is null then return jsonb_build_object('issues',jsonb_build_array('ph_published_eligibility_required'),'lines',lines); end if;
 if e is null or e='null'::jsonb then return jsonb_build_object('issues',jsonb_build_array('ph_eligibility_review_required'),'lines',lines); end if;
 if p_context->>'employee_age_verified' is distinct from 'true' then issues:=array_append(issues,'ph_age_category_requires_review'); end if;
 if p_context->>'period_start' is distinct from date_trunc('month',(p_context->>'date')::date)::date::text or p_context->>'period_end' is distinct from (date_trunc('month',(p_context->>'date')::date)+interval '1 month - 1 day')::date::text then issues:=array_append(issues,'ph_wage_period_requires_review'); end if;
 if coalesce(p_context#>>'{paid_holiday,outlet_state_code}','') not in ('MY-01','MY-02','MY-03','MY-04','MY-05','MY-06','MY-07','MY-08','MY-09','MY-10','MY-11','MY-14','MY-15','Johor','Kedah','Kelantan','Melaka','Negeri Sembilan','Pahang','Penang','Perak','Perlis','Selangor','Terengganu','Kuala Lumpur','Labuan') then
  issues:=array_append(issues,'ph_territory_requires_review'); end if;
 if coverage is null or coverage not in ('full_time','part_time') or category is null or category not in ('general','manual','vehicle','manual_supervisor','vessel') then
  issues:=array_append(issues,'ph_statutory_category_requires_review'); end if;
 if p_context#>>'{source,leave_type}' in ('annual','medical','unpaid') then issues:=array_append(issues,'ph_absence_or_substitution_requires_review'); end if;
 if e->>'holiday_eligibility' is distinct from 'eligible' then
  issues:=array_append(issues,'ph_absence_or_substitution_requires_review'); end if;
 normal_mins:=(e->>'normal_minutes')::integer; full_mins:=(e->>'comparable_full_time_minutes')::integer;
 if normal_mins is null or normal_mins<=0 or normal_mins>540 then issues:=array_append(issues,'ph_contract_hours_required'); end if;
 if coverage='part_time' and (full_mins is null or full_mins<normal_mins or full_mins>540
  or coalesce((e->>'part_time_weekly_minutes')::integer,0)<=0
  or coalesce((e->>'comparable_weekly_minutes')::integer,0)<=0
  or (e->>'part_time_weekly_minutes')::numeric/(e->>'comparable_weekly_minutes')::numeric not between 0.300001 and 0.7
  or (e->>'regular_contract_not_home_or_casual') is distinct from 'true') then issues:=array_append(issues,'ph_part_time_contract_category_required'); end if;
 wages:=(e->>'schedule_monthly_wages')::numeric;
 if wages is null or wages<=0 then issues:=array_append(issues,'ph_schedule_wages_required'); end if;
 premium:=wages<=4000 or category in ('manual','vehicle','manual_supervisor','vessel');
 if basis='monthly' then
  ordinary:=(e->>'monthly_ordinary_wages')::numeric/26;
  if ordinary is null or ordinary*26<(c->>'basic_salary')::numeric then issues:=array_append(issues,'ph_monthly_ordinary_wages_required'); end if;
 elsif basis='hourly' then
  if p_context->>'preceding_employer_verified'='true' and (e->>'preceding_worked_days')::integer between 1 and 31 and (e->>'preceding_qualifying_wages')::numeric>0
   and (e->>'preceding_period_end')::date=(date_trunc('month',(p_context->>'date')::date)-interval '1 day')::date
   and (e->>'preceding_period_start')::date=(date_trunc('month',(p_context->>'date')::date)-interval '1 month')::date then
    ordinary:=(e->>'preceding_qualifying_wages')::numeric/(e->>'preceding_worked_days')::integer;
  else issues:=array_append(issues,'ph_preceding_wage_period_evidence_required'); end if;
 else issues:=array_append(issues,'ph_pay_basis_requires_review'); end if;
 if p_context->'source' is not null and p_context->'source'<>'null'::jsonb and
  (t->>'id' is null or t->>'status'='review_required' or t->>'source_fingerprint' is distinct from p_context#>>'{source,source_fingerprint}') then
  issues:=array_append(issues,'ph_approved_time_required'); end if;
 if worked+extra>0 then
  if t->>'classification' not in ('public_holiday','public_holiday_ot') then issues:=array_append(issues,'ph_payable_classification_requires_review'); end if;
  if worked>normal_mins or (extra>0 and worked<>normal_mins) then issues:=array_append(issues,'ph_normal_ot_boundary_requires_review'); end if;
  if coverage='part_time' and worked<normal_mins then issues:=array_append(issues,'ph_part_time_partial_day_requires_review'); end if;
  if not premium then issues:=array_append(issues,'ph_over_4000_contract_work_rule_required'); end if;
 end if;
 select x into rule from jsonb_array_elements(p_context->'rules') x where x->>'rule_code'='public_holiday' order by x->>'effective_from' desc limit 1;
 select x into ot_rule from jsonb_array_elements(p_context->'rules') x where x->>'rule_code'='public_holiday_ot' order by x->>'effective_from' desc limit 1;
 if rule->>'formula_version' is distinct from 'my_ph_2023_v1' or (extra>0 and ot_rule->>'formula_version' is distinct from 'my_ph_2023_v1') then issues:=array_append(issues,'ph_official_pack_required'); end if;
 if cardinality(issues)>0 then return jsonb_build_object('issues',to_jsonb(issues),'lines',lines); end if;
 hourly:=ordinary*60/normal_mins;
 source:=jsonb_build_object('work_date',p_context->>'date','compensation_version_id',c->>'id','time_version_id',t->>'id',
  'rule_version_id',rule->>'id','formula_version','my_ph_2023_v1','ordinary_day_rate',ordinary,'normal_minutes',normal_mins,
  'coverage',coverage,'statutory_treatment','holiday_pay','statutory_treatments',jsonb_build_object('epf','included','socso','included','eis','included','pcb','undetermined'),'formula','ordinary_day');
 -- Monthly holiday pay is included in Basic; never add the same day twice.
 if basis='hourly' then
  amount:=round(ordinary,2); subtotal:=subtotal+amount;
  lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','public_holiday','label','Public Holiday Allowance',
   'quantity',1,'unit','day','rate',ordinary,'multiplier',1,'amount',amount,'source',source));
 end if;
 if worked+extra>0 then
  amount:=round(ordinary*2,2); subtotal:=subtotal+amount;
  lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','public_holiday','label','Public Holiday Allowance',
   'quantity',1,'unit','day','rate',ordinary,'multiplier',2,'amount',amount,'source',source||jsonb_build_object('statutory_treatment','holiday_work','statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','undetermined'),'formula','two_ordinary_days')));
 end if;
 if extra>0 then
  low_mins:=case when coverage='part_time' then least(extra,full_mins-normal_mins) else 0 end;
  high_mins:=extra-low_mins;
  foreach amount in array array[2::numeric,3::numeric] loop
   if (amount=2 and low_mins=0) or (amount=3 and high_mins=0) then continue; end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','public_holiday_ot','label','Public Holiday Allowance',
    'minutes',case when amount=2 then low_mins else high_mins end,'rate',hourly,'multiplier',amount,
    'amount',round((case when amount=2 then low_mins else high_mins end)*hourly/60*amount,2),
    'source',source||jsonb_build_object('rule_version_id',ot_rule->>'id','statutory_treatment','holiday_overtime','statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','undetermined'),'formula','ph_ot_hourly',
      'comparable_full_time_minutes',full_mins)));
  end loop;
 end if;
 -- A company policy is not statutory entitlement. A confirmed overlap contract
 -- decides top-up versus genuinely additional benefit. No interpretation by UI.
 if worked+extra>0 and p_context->'company_policy'<>'null'::jsonb then
  if e->>'company_overlap' is null or e->>'company_overlap' not in ('not_applicable','inclusive_top_up','additional_to_statutory') then
   issues:=array_append(issues,'ph_company_overlap_review_required');
  elsif e->>'company_overlap'<>'not_applicable' then
   if p_context#>>'{company_benefit,issue}' is not null or p_context#>>'{company_benefit,decision,id}' is null then
    issues:=array_append(issues,'ph_company_treatment_confirmation_required');
   elsif p_context#>>'{company_benefit,decision,treatment}'='additional_pay' then
    company:=(p_context#>>'{company_benefit,additional_amount}')::numeric;
    if e->>'company_overlap'='inclusive_top_up' then
     company:=greatest(0,company-round(ordinary*2,2));
    end if;
    if company>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','company_ph_benefit','label','Company Public Holiday Benefit','units',case when e->>'company_overlap'='inclusive_top_up' then 'Verified company benefit top-up' else 'Verified additional company benefit' end,'amount',company,
     'source',source||jsonb_build_object('ph_work',p_context->'company_benefit','formula','company_ph_'||(e->>'company_overlap'),'statutory_treatment','company_benefit','statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','undetermined')))); end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('issues',to_jsonb(issues),'lines',lines,'ordinary_day_rate',ordinary,'hourly_rate',hourly,'premium_covered',premium);
end $$;

create function public.payroll_ph_statutory_project(p_run uuid,p_employee uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare context jsonb:=payroll_ph_statutory_context(p_run,p_employee,p_day); review public.payroll_ph_eligibility_reviews%rowtype; result jsonb;
begin
 if context is null then return null; end if;
 select * into review from payroll_ph_eligibility_reviews where run_id=p_run and employee_id=p_employee and work_date=p_day order by revision desc limit 1;
 if review.id is null then result:=payroll_ph_statutory_price(context,null);
 elsif review.context_fingerprint is distinct from md5(context::text) then result:=jsonb_build_object('issues',jsonb_build_array('ph_eligibility_evidence_changed'),'lines','[]'::jsonb);
 else result:=payroll_ph_statutory_price(context,review.evidence); end if;
 return result||jsonb_build_object('date',p_day,'context',context,'context_fingerprint',md5(context::text),'review',to_jsonb(review),'history',coalesce((select jsonb_agg(to_jsonb(v) order by revision desc) from payroll_ph_eligibility_reviews v where run_id=p_run and employee_id=p_employee and work_date=p_day),'[]'::jsonb));
end $$;

create function public.payroll_ph_statutory_read(p_run uuid,p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; result jsonb;
begin
 perform payroll_admin_actor(); select * into r from payroll_runs where id=p_run; select * into p from payroll_periods where id=r.period_id;
 if not payroll_can_access_run_employee(p_run,p_employee,'payroll.view') then raise exception using errcode='42501',message='Payroll PH visibility denied.'; end if;
 if r.status in ('finalized','paid') then return coalesce((select calculation#>'{inputs,ph_statutory}' from payroll_run_calculation_snapshots where run_id=p_run and employee_id=p_employee),'[]'::jsonb); end if;
 select coalesce(jsonb_agg(x order by x->>'date'),'[]') into result from
 (select payroll_ph_statutory_project(p_run,p_employee,d::date) x from generate_series(p.period_start,p.period_end,interval '1 day') d) q where x is not null;
 return result;
end $$;

create function public.payroll_ph_statutory_confirm(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); r public.payroll_runs%rowtype; p public.payroll_periods%rowtype;
 emp uuid:=(p_input->>'employee_id')::uuid; day date:=(p_input->>'date')::date; context jsonb; result jsonb; review public.payroll_ph_eligibility_reviews%rowtype;
 prior public.payroll_ph_eligibility_reviews%rowtype; request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text); evidence jsonb:=p_input->'evidence';
begin
 select * into r from payroll_runs where id=(p_input->>'run_id')::uuid for update; select * into p from payroll_periods where id=r.period_id;
 if r.id is null or not payroll_can_access_run_employee(r.id,emp,'payroll.manage') then raise exception using errcode='42501',message='Payroll PH review authority denied.'; end if;
 if r.status not in ('draft','review_required') or r.foundation_only then raise exception using errcode='55000',message='PH review requires an open Payroll Run.'; end if;
 if request is null or length(btrim(coalesce(p_input->>'reference','')))<8 or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception using errcode='22023',message='Official/contract/wage evidence reference and review reason are required.'; end if;
 select * into review from payroll_ph_eligibility_reviews where request_id=request;
 if review.id is not null then
  if review.request_fingerprint<>fingerprint or review.actor_employee_id<>actor then raise exception using errcode='22023',message='Request identity belongs to another PH review.'; end if;
  return jsonb_build_object('review_id',review.id,'retry',true);
 end if;
 context:=payroll_ph_statutory_context(r.id,emp,day);
 if context is null or p_input->>'context_fingerprint' is distinct from md5(context::text) then raise exception using errcode='40001',message='PH evidence changed. Reopen and review the current evidence.'; end if;
 result:=payroll_ph_statutory_price(context,evidence);
 -- Unknown/special categories remain unresolved rather than accepting an override.
 if jsonb_array_length(result->'issues')>0 and exists(select 1 from jsonb_array_elements_text(result->'issues') x
  where x not in ('ph_company_treatment_confirmation_required','ph_over_4000_contract_work_rule_required','ph_part_time_partial_day_requires_review')) then
  raise exception using errcode='22023',message='PH review incomplete: '||(result->'issues')::text;
 end if;
 select * into prior from payroll_ph_eligibility_reviews where run_id=r.id and employee_id=emp and work_date=day order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_ph_eligibility_reviews(run_id,employee_id,work_date,revision,supersedes_id,evidence,context,context_fingerprint,official_reference,reason,actor_employee_id,request_id,request_fingerprint)
 values(r.id,emp,day,coalesce(prior.revision,0)+1,prior.id,evidence,context,md5(context::text),btrim(p_input->>'reference'),btrim(p_input->>'reason'),actor,request,fingerprint) returning * into review;
 insert into payroll_events(event_type,run_id,actor_employee_id,reason,details) values('ph_statutory_review_confirmed',r.id,actor,review.reason,jsonb_build_object('review_id',review.id,'supersedes_id',prior.id,'employee_id',emp,'date',day,'context_fingerprint',review.context_fingerprint));
 perform payroll_employee_recalculate(r.id,emp);
 return jsonb_build_object('review_id',review.id);
end $$;
revoke all on function public.payroll_ph_statutory_context(uuid,uuid,date),public.payroll_ph_statutory_price(jsonb,jsonb),public.payroll_ph_statutory_project(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_ph_statutory_read(uuid,uuid),public.payroll_ph_statutory_confirm(jsonb) from public,anon;
grant execute on function public.payroll_ph_statutory_read(uuid,uuid),public.payroll_ph_statutory_confirm(jsonb) to authenticated;

-- Preserve generic rules for other classifications. PH cannot be mispriced as
-- worked minutes times a generic multiplier, or overwritten through that API.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.payroll_rule_publish(text,text,date,numeric,integer,text,text)'::regprocedure);
 d:=replace(d,'  select max(effective_from)', '  if p_rule_code in (''public_holiday'',''public_holiday_ot'') then raise exception using errcode=''22023'',message=''PH uses the official legal formula pack and reviewed employee evidence, not a generic multiplier.''; end if; select max(effective_from)'); execute d;
 d:=pg_get_functiondef('public.payroll_price_time(uuid,uuid,text,integer,date)'::regprocedure);
 d:=replace(d,'  if p_minutes is null', '  if p_rule_code in (''public_holiday'',''public_holiday_ot'') then return null; end if; if p_minutes is null'); execute d;
 -- Company benefit normal approved minutes remain independent; PH OT is now
 -- priced by statutory owner, not rejected by the optional company projection.
 d:=pg_get_functiondef('public.payroll_ph_work_project(uuid,uuid,date)'::regprocedure);
 d:=replace(d,'elsif coalesce(t.approved_extra_minutes,0)>0 then issue:=''public_holiday_ot_unsupported'';',''); execute d;
end $$;

-- Replace only the prior PH guard at the canonical calculation owner. Once per
-- published day, including days with no roster/clock source. All other earnings,
-- time correction, fingerprints, snapshots and downstream statutory stay intact.
do $$ declare d text; a integer; b integer; begin
 d:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
 a:=strpos(d,'      if v_source is null and v_basis=''hourly'' then'); b:=strpos(substr(d,a),'      if v_source is null or v_source->>''legal_entity_id''');
 if a=0 or b=0 then raise exception 'PH source anchor changed'; end if;
 d:=substr(d,1,a-1)||substr(d,a+b-1);
 a:=strpos(d,' if v_time.classification in (''public_holiday'',''public_holiday_ot'') or');
 b:=strpos(substr(d,a),'      if v_time.classification=''leave'' then');
 if a=0 or b=0 then raise exception 'PH guard anchor changed'; end if;
 d:=substr(d,1,a-1)||substr(d,a+b-1);
 -- Resolve PH before ordinary missing-time branch. The helper checks time when
 -- present; no-work eligibility never derives wages from absent roster hours.
 d:=replace(d,'      if v_source is null or v_source->>''legal_entity_id'' is distinct',
 $patch$      v_ph:=public.payroll_ph_statutory_project(p_run_id,p_employee_id,v_day);
      if v_ph is not null then
       v_inputs:=jsonb_set(v_inputs,'{ph_statutory}',coalesce(v_inputs->'ph_statutory','[]'::jsonb)||jsonb_build_array(v_ph),true);
       select v_issues||coalesce(array_agg(issue||':'||v_day),'{}'::text[]) into v_issues from jsonb_array_elements_text(v_ph->'issues') issue;
       for v_line in select value from jsonb_array_elements(v_ph->'lines') loop
        v_line:=jsonb_set(v_line,'{source,ph_review_id}',coalesce(v_ph#>'{review,id}','null'::jsonb),true);
        v_lines:=v_lines||jsonb_build_array(v_line); v_gross:=v_gross+(v_line->>'amount')::numeric;
       end loop;
       continue;
      end if;
      if v_source#>>'{paid_holiday_policy,status}'='paid_holiday' then
       v_issues:=array_append(v_issues,'ph_employment_or_pay_evidence_required:'||v_day); continue;
      end if;
      if v_source is null or v_source->>'legal_entity_id' is distinct$patch$);
 d:=replace(d,$old$      if v_basis='monthly' and exists(select 1 from public.crew_approved_leaves l
        where l.employee_id=p_employee_id and l.leave_type='unpaid'
          and v_day between l.start_date and l.end_date) then continue; end if;$old$,'');
 d:=replace(d,'''payroll_ph_boundary_v2''','''payroll_my_ph_2023_v1'''); execute d;
end $$;

-- One presentation projection over canonical priced lines. No repricing or
-- mutation of daily financial evidence, calculation versions or frozen records.
create or replace function public.payroll_earning_groups(p_calculation jsonb)
returns jsonb language sql immutable set search_path=public as $$
 with normalized as (
  select x, n, case x->>'code' when 'regular' then 'Regular Pay'
    when 'company_ph_benefit' then 'Company Public Holiday Benefit'
    when 'public_holiday_ot' then 'Public Holiday Allowance' when 'public_holiday' then 'Public Holiday Allowance' else x->>'label' end label,
   coalesce((x->>'rate')::numeric,(x->>'rate_per_minute')::numeric*60,
    case when x->>'code'='company_ph_benefit' and x#>>'{source,formula_version}' is distinct from 'my_ph_2023_v1' then (x#>>'{source,ph_work,compensation,hourly_rate}')::numeric end) rate,
   coalesce((x->>'minutes')::numeric,case when x->>'code'='company_ph_benefit' and x#>>'{source,formula_version}' is distinct from 'my_ph_2023_v1'
     and x#>>'{source,ph_work,compensation,pay_basis}'='hourly' then (x#>>'{source,ph_work,time,approved_minutes}')::numeric end) minutes
  from jsonb_array_elements(coalesce(p_calculation->'lines','[]')) with ordinality a(x,n) where x->>'kind'='earning'
 ), keyed as (
  select *, case when minutes is null and x->>'quantity' is null then jsonb_build_array('individual',n) else
   jsonb_build_array(x->>'kind',x->>'code',rate,x->'rate_per_minute',x->'multiplier',
    x#>'{source,rule_version_id}',x#>'{source,compensation_version_id}',
    x#>'{source,formula}',x#>'{source,formula_version}',x#>'{source,statutory_treatment}',
    x#>'{source,ph_work,compensation,id}',x#>'{source,ph_work,policy,id}',x->'units',x->'unit',x#>'{source,normal_minutes}',x#>'{source,coverage}',x#>'{source,comparable_full_time_minutes}') end basis
  from normalized
 ), grouped as (
  select min(n) ordinal,min(label) label,sum((x->>'amount')::numeric) amount,sum(minutes) minutes,
   sum((x->>'quantity')::numeric) quantity, min(rate) rate, (array_agg(x order by n))[1] first_line,jsonb_agg(x order by n) details
  from keyed group by basis
 ) select coalesce(jsonb_agg(first_line||jsonb_build_object('label',label,'amount',amount,'minutes',minutes,
    'quantity',quantity,'units',case when first_line->>'unit'='day' then quantity::text||' ordinary day(s) x RM'||round(rate,2)::text||' x '||(first_line->>'multiplier') else first_line->>'units' end, 'rate',rate,'calculation_details',details,'day_count',jsonb_array_length(details)) order by ordinal),'[]') from grouped;
$$;

do $$ declare d text; a text; begin
 d:=pg_get_functiondef('public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)'::regprocedure);
 a:='elsif v_line->>''code'' in (''monthly_basic'',''regular'') then v_treatment:=''included'';';
 if strpos(d,a)=0 then raise exception 'Statutory treatment anchor changed'; end if;
 d:=replace(d,a,a||$patch$
 elsif v_line#>>'{source,formula_version}'='my_ph_2023_v1' and v_line->>'code' in ('public_holiday','public_holiday_ot','company_ph_benefit') then
  v_treatment:=v_line#>>array['source','statutory_treatments',v_scheme];
 $patch$); execute d;
end $$;
