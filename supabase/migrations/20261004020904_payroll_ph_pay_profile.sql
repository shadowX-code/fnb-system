-- Reusable PH legal evidence belongs to the effective Payroll Profile. Original
-- per-occurrence reviews and all finalized snapshots remain immutable.
create table public.payroll_ph_profile_versions (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.payroll_profiles(id),
 effective_from date not null, revision integer not null, supersedes_id uuid references public.payroll_ph_profile_versions(id),
 evidence jsonb not null, basis jsonb not null, basis_fingerprint text not null,
 reference text not null, reason text not null, actor_employee_id uuid not null references public.employees(id),
 created_at timestamptz not null default clock_timestamp(), request_id uuid not null unique, request_fingerprint text not null,
 unique(profile_id,effective_from,revision));
create table public.payroll_ph_wage_evidence_versions (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.payroll_profiles(id),
 legal_entity_id uuid not null references public.legal_entities(id), period_start date not null, period_end date not null,
 revision integer not null, supersedes_id uuid references public.payroll_ph_wage_evidence_versions(id),
 qualifying_wages numeric not null check(qualifying_wages>0), worked_days integer not null check(worked_days between 1 and 31),
 source_fingerprint text not null, reference text not null, reason text not null,
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default clock_timestamp(),
 request_id uuid not null unique, request_fingerprint text not null, unique(profile_id,legal_entity_id,period_start,revision),
 check(period_start=date_trunc('month',period_start)::date and period_end=(period_start+interval '1 month - 1 day')::date));
alter table public.payroll_ph_profile_versions enable row level security;
alter table public.payroll_ph_wage_evidence_versions enable row level security;
revoke all on public.payroll_ph_profile_versions,public.payroll_ph_wage_evidence_versions from public,anon,authenticated;
create trigger ph_profile_append_guard before insert or update or delete on public.payroll_ph_profile_versions for each row execute function public.payroll_ph_evidence_guard();
create trigger ph_wage_append_guard before insert or update or delete on public.payroll_ph_wage_evidence_versions for each row execute function public.payroll_ph_evidence_guard();

create function public.payroll_ph_profile_wage_basis(p_employee uuid,p_date date)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('compensation',(select to_jsonb(c) from payroll_compensation_effective_versions() c join payroll_profiles f on f.id=c.profile_id where f.employee_id=p_employee and c.effective_from<=p_date order by c.effective_from desc limit 1),
 'recurring',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from payroll_recurring_component_versions c join payroll_profiles f on f.id=c.profile_id join payroll_component_definitions d on d.id=c.component_id where f.employee_id=p_employee and d.component_type in ('earning','allowance') and c.is_active and c.effective_from<=p_date and not exists(select 1 from payroll_recurring_component_versions n where n.profile_id=c.profile_id and n.component_id=c.component_id and n.effective_from<=p_date and n.effective_from>c.effective_from)),'[]'),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from payroll_run_component_adjustments c join payroll_runs r on r.id=c.run_id join payroll_periods p on p.id=r.period_id join payroll_component_definitions d on d.id=c.component_id where c.employee_id=p_employee and p_date between p.period_start and p.period_end and d.component_type in ('earning','allowance') and not exists(select 1 from payroll_run_component_adjustments n where n.reverses_id=c.id)),'[]'));
$$;

create function public.payroll_ph_profile_basis(p_employee uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.employee_employment_assignment_revisions%rowtype; c public.payroll_compensation_versions%rowtype; doc public.employee_employment_documents%rowtype; derived jsonb:='{}';
begin
 a:=employee_employment_assignment_at(p_employee,p_date);
 select v.* into c from payroll_compensation_effective_versions() v join payroll_profiles f on f.id=v.profile_id where f.employee_id=p_employee and v.effective_from<=p_date order by v.effective_from desc limit 1;
 if a.id is null or c.id is null or a.legal_entity_id is distinct from c.legal_entity_id then return null; end if;
 -- Only completed, dated, matching contractual evidence can establish hours.
 select * into doc from employee_employment_documents where employee_id=p_employee and legal_entity_id_snapshot=a.legal_entity_id and effective_date<=p_date and status='completed' and creation_source='template' and employment_type_snapshot=a.employment_type and position_snapshot=a.position order by effective_date desc,completed_at desc limit 1;
 if a.employment_type='full_time' then derived:=derived||jsonb_build_object('coverage','full_time'); end if;
 if doc.id is not null then derived:=derived||jsonb_build_object('normal_minutes',(doc.contract_terms_snapshot->>'normal_hours_per_day')::numeric*60,'normal_weekly_minutes',(doc.contract_terms_snapshot->>'normal_hours_per_day')::numeric*(doc.contract_terms_snapshot->>'working_days_per_week')::numeric*60); end if;
 return jsonb_build_object('profile_id',c.profile_id,'employment_type',a.employment_type,'position',a.position,'legal_entity_id',a.legal_entity_id,'pay_basis',c.pay_basis,'contract_id',doc.id,'contract_hash',doc.document_sha256,'company_policy_id',(select id from payroll_ph_policy_versions where legal_entity_id=a.legal_entity_id and effective_from<=p_date order by effective_from desc,created_at desc limit 1),'derived',derived);
end $$;

create function public.payroll_ph_wage_source(p_employee uuid,p_entity uuid,p_month date)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('time',coalesce((select jsonb_agg(jsonb_build_object('date',d::date,'source',payroll_time_evidence(p_employee,d::date),'latest',(select id from payroll_payable_time_versions where employee_id=p_employee and work_date=d::date order by revision desc limit 1)) order by d) from generate_series(p_month,p_month+interval '1 month - 1 day',interval '1 day') d),'[]'),
 'compensation',coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_from) from payroll_compensation_effective_versions() v join payroll_profiles f on f.id=v.profile_id where f.employee_id=p_employee and v.legal_entity_id=p_entity and v.effective_from<p_month+interval '1 month'),'[]'),
 'recurring',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from payroll_recurring_component_versions v join payroll_profiles f on f.id=v.profile_id where f.employee_id=p_employee and v.effective_from<p_month+interval '1 month'),'[]'),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from payroll_run_component_adjustments v join payroll_runs r on r.id=v.run_id join payroll_periods p on p.id=r.period_id where v.employee_id=p_employee and p.legal_entity_id=p_entity and p.period_start=p_month),'[]'),
 'employment',to_jsonb(employee_employment_assignment_at(p_employee,(p_month+interval '1 month - 1 day')::date)));
$$;

create function public.payroll_ph_wage_resolve(p_employee uuid,p_entity uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare src jsonb:=payroll_ph_wage_source(p_employee,p_entity,p_month); v public.payroll_ph_wage_evidence_versions%rowtype; r public.payroll_runs%rowtype; calc jsonb; wages numeric; days integer; complete boolean:=false; fingerprint text:=md5(src::text);
begin
 -- A finalized calculation is frozen evidence. An open calculation is usable
 -- only with fully resolved earning inputs and unchanged dated source identities.
 select x.* into r from payroll_runs x join payroll_periods p on p.id=x.period_id where p.legal_entity_id=p_entity and p.period_start=p_month and p.period_end=(p_month+interval '1 month - 1 day')::date order by case when x.status in ('finalized','paid') then 0 else 1 end,x.created_at desc limit 1;
 if r.status in ('finalized','paid') then select calculation into calc from payroll_run_calculation_snapshots where run_id=r.id and employee_id=p_employee;
 else select to_jsonb(c) into calc from payroll_run_calculation_versions c where run_id=r.id and employee_id=p_employee order by revision desc limit 1; end if;
 if calc is not null and calc->>'status'='ready' and jsonb_array_length(coalesce(calc->'issues','[]'))=0 and jsonb_array_length(coalesce(calc#>'{inputs,components}','[]'))=0
 and not exists(select 1 from jsonb_array_elements(calc->'lines') x where x->>'kind'='earning' and x->>'code' not in ('regular','overtime','rest_day','rest_day_ot','public_holiday','public_holiday_ot','company_ph_benefit')) then
  complete:=r.status in ('finalized','paid') or calc->>'input_fingerprint'=payroll_calculation_project(r.id,p_employee)->>'input_fingerprint';
  if complete then
   select sum((x->>'amount')::numeric),count(distinct x#>>'{source,work_date}') into wages,days from jsonb_array_elements(calc->'lines') x where x->>'kind'='earning' and x->>'code'='regular' and (x->>'minutes')::numeric>0;
   if wages>0 and days between 1 and 31 then return jsonb_build_object('status','verified','origin','payroll','run_id',r.id,'qualifying_wages',wages,'worked_days',days,'period_start',p_month,'period_end',(p_month+interval '1 month - 1 day')::date,'source_fingerprint',fingerprint); end if;
  end if;
 end if;
 select w.* into v from payroll_ph_wage_evidence_versions w join payroll_profiles f on f.id=w.profile_id where f.employee_id=p_employee and w.legal_entity_id=p_entity and w.period_start=p_month order by revision desc limit 1;
 if v.id is not null and v.source_fingerprint=fingerprint then return jsonb_build_object('status','verified','origin','reviewed_history','revision_id',v.id,'qualifying_wages',v.qualifying_wages,'worked_days',v.worked_days,'period_start',v.period_start,'period_end',v.period_end,'source_fingerprint',fingerprint); end if;
 return jsonb_build_object('status','review_required','issue','ph_historical_wage_evidence_required','period_start',p_month,'period_end',(p_month+interval '1 month - 1 day')::date,'source_fingerprint',fingerprint,'previous_revision',v.id);
end $$;

create function public.payroll_ph_profile_resolve(p_employee uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_basis jsonb:=payroll_ph_profile_basis(p_employee,p_date); v public.payroll_ph_profile_versions%rowtype; c public.payroll_compensation_versions%rowtype; evidence jsonb; wages jsonb; wage_basis jsonb:=payroll_ph_profile_wage_basis(p_employee,p_date); issues text[]:='{}';
begin
 if v_basis is null then return jsonb_build_object('status','review_required','issues',jsonb_build_array('ph_employment_or_pay_evidence_required')); end if;
 select * into v from payroll_ph_profile_versions where profile_id=(v_basis->>'profile_id')::uuid and effective_from<=p_date order by effective_from desc,revision desc limit 1;
 evidence:=coalesce(v.evidence,'{}')||coalesce(v_basis->'derived','{}');
 if v.id is null or v.basis_fingerprint<>md5(v_basis::text) then issues:=array_append(issues,'ph_pay_profile_required'); end if;
 select x.* into c from payroll_compensation_effective_versions() x where profile_id=(v_basis->>'profile_id')::uuid and effective_from<=p_date order by effective_from desc limit 1;
 -- Pure Basic salary establishes the wage basis; other remuneration is not
 -- silently excluded. Explicit wage confirmation is reusable until pay changes.
 if v.evidence->>'wage_fingerprint'=md5(wage_basis::text) and (v.evidence->>'schedule_monthly_wages')::numeric>0 and (c.pay_basis<>'monthly' or (v.evidence->>'monthly_ordinary_wages')::numeric>=c.basic_salary) then null;
 elsif c.pay_basis='monthly' and jsonb_array_length(wage_basis->'recurring')=0 and jsonb_array_length(wage_basis->'adjustments')=0 then
  evidence:=evidence||jsonb_build_object('monthly_ordinary_wages',c.basic_salary,'schedule_monthly_wages',c.basic_salary);
 else
  evidence:=evidence-'schedule_monthly_wages'-'monthly_ordinary_wages'; issues:=array_append(issues,'ph_schedule_wages_required');
 end if;
 if coalesce((evidence->>'schedule_monthly_wages')::numeric,0)<=0 then issues:=array_append(issues,'ph_schedule_wages_required'); end if;
 if c.pay_basis='hourly' then
  wages:=payroll_ph_wage_resolve(p_employee,(v_basis->>'legal_entity_id')::uuid,(date_trunc('month',p_date)-interval '1 month')::date);
  if wages->>'status'='verified' then evidence:=evidence||jsonb_build_object('preceding_qualifying_wages',wages->'qualifying_wages','preceding_worked_days',wages->'worked_days','preceding_period_start',wages->'period_start','preceding_period_end',wages->'period_end'); else issues:=array_append(issues,'ph_historical_wage_evidence_required'); end if;
 end if;
 return jsonb_build_object('status',case when cardinality(issues)=0 then 'verified' else 'review_required' end,'issues',to_jsonb(issues),'profile_status',case when v.id is not null and v.basis_fingerprint=md5(v_basis::text) then 'verified' else 'review_required' end,'basis',v_basis,'basis_fingerprint',md5(v_basis::text),'evidence',evidence,'revision',to_jsonb(v),'wages',wages,'compensation',to_jsonb(c));
end $$;

create function public.payroll_ph_profile_read(p_employee uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform payroll_admin_actor(); if not payroll_can_access_employee(p_employee,'payroll.view') then raise insufficient_privilege using message='PH Pay Profile visibility denied'; end if;
 return payroll_ph_profile_resolve(p_employee,p_date)||jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(v) order by effective_from desc,revision desc) from payroll_ph_profile_versions v join payroll_profiles f on f.id=v.profile_id where f.employee_id=p_employee),'[]'));
end $$;

create function public.payroll_ph_profile_save(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); emp uuid:=(p_input->>'employee_id')::uuid; day date:=(p_input->>'effective_from')::date; basis jsonb; evidence jsonb:=p_input->'evidence'; profile uuid; previous public.payroll_ph_profile_versions%rowtype; next_date date; result uuid; r record; request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text);
begin
 if not payroll_can_access_employee(emp,'payroll.manage') then raise insufficient_privilege using message='PH Pay Profile authority denied'; end if;
 select id into profile from payroll_profiles where employee_id=emp for update;
 if profile is null or day is null or request is null or length(btrim(coalesce(p_input->>'reference','')))<8 or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'Effective date, profile, evidence reference and reason are required'; end if;
 select * into previous from payroll_ph_profile_versions where request_id=request;
 if previous.id is not null then if previous.request_fingerprint<>fingerprint or previous.actor_employee_id<>actor then raise exception 'PH profile request changed'; end if; return jsonb_build_object('id',previous.id,'retry',true); end if;
 basis:=payroll_ph_profile_basis(emp,day);
 if basis is null or p_input->>'basis_fingerprint' is distinct from md5(basis::text) then raise serialization_failure using message='Employment or contract evidence changed. Reopen PH Pay Profile.'; end if;
 evidence:=coalesce(evidence,'{}')||coalesce(basis->'derived','{}');
 if evidence->>'coverage'='part_time' then evidence:=evidence||jsonb_build_object('part_time_weekly_minutes',evidence->'normal_weekly_minutes'); end if;
 if coalesce(evidence->>'coverage','') not in ('full_time','part_time') or coalesce(evidence->>'schedule_category','') not in ('general','manual','vehicle','manual_supervisor','vessel') or coalesce((evidence->>'normal_minutes')::integer,0) not between 1 and 540 or coalesce((evidence->>'normal_weekly_minutes')::integer,0)<=0 then raise exception 'Confirm statutory category and contractual daily/weekly hours'; end if;
 if evidence->>'coverage'='part_time' and (coalesce((evidence->>'comparable_full_time_minutes')::integer,0)<(evidence->>'normal_minutes')::integer or coalesce((evidence->>'comparable_full_time_minutes')::integer,0)>540 or coalesce((evidence->>'part_time_weekly_minutes')::numeric,0)<=0 or coalesce((evidence->>'comparable_weekly_minutes')::numeric,0)<=0 or (evidence->>'part_time_weekly_minutes')::numeric/nullif((evidence->>'comparable_weekly_minutes')::numeric,0) not between 0.300001 and 0.7 or evidence->>'regular_contract_not_home_or_casual' is distinct from 'true') then raise exception 'Verify regular part-time contract and comparable hours'; end if;
 if (basis->>'employment_type'='part_time' and evidence->>'coverage'<>'part_time') or (basis->>'employment_type'='full_time' and evidence->>'coverage'<>'full_time') then raise exception 'PH statutory category conflicts with dated employment'; end if;
 select min(effective_from) into next_date from payroll_ph_profile_versions where profile_id=profile and effective_from>day;
 if exists(select 1 from payroll_run_profile_snapshots s join payroll_runs x on x.id=s.run_id join payroll_periods p on p.id=x.period_id where s.profile_id=profile and x.status in ('finalized','paid') and p.period_end>=day and (next_date is null or p.period_start<next_date)) then raise exception 'Use governed Payroll correction for finalized periods'; end if;
 evidence:=evidence||jsonb_build_object('wage_fingerprint',md5(payroll_ph_profile_wage_basis(emp,day)::text),'compensation_id',(select id from payroll_compensation_effective_versions() where profile_id=profile and effective_from<=day order by effective_from desc limit 1));
 select * into previous from payroll_ph_profile_versions where profile_id=profile and effective_from=day order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_ph_profile_versions(profile_id,effective_from,revision,supersedes_id,evidence,basis,basis_fingerprint,reference,reason,actor_employee_id,request_id,request_fingerprint) values(profile,day,coalesce(previous.revision,0)+1,previous.id,evidence,basis,md5(basis::text),btrim(p_input->>'reference'),btrim(p_input->>'reason'),actor,request,fingerprint) returning id into result;
 insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_pay_profile_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',result,'supersedes_id',previous.id,'effective_from',day));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_end>=day and (next_date is null or p.period_start<next_date) and payroll_can_access_run_employee(x.id,emp,'payroll.manage') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
 return jsonb_build_object('id',result);
end $$;

create function public.payroll_ph_wage_evidence_save(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); emp uuid:=(p_input->>'employee_id')::uuid; month date:=(p_input->>'period_start')::date; entity uuid:=(p_input->>'legal_entity_id')::uuid; profile uuid; src jsonb; v public.payroll_ph_wage_evidence_versions%rowtype; previous public.payroll_ph_wage_evidence_versions%rowtype; request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text); r record;
begin
 if not payroll_can_access_employee(emp,'payroll.manage') or not payroll_can_manage_entity(entity,'payroll.manage') then raise insufficient_privilege using message='Historical PH wage authority denied'; end if;
 select id into profile from payroll_profiles where employee_id=emp for update;
 if profile is null or month is null or month<>date_trunc('month',month)::date or request is null or length(btrim(coalesce(p_input->>'reference','')))<8 or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'Payroll month, evidence reference and reason are required'; end if;
 if (employee_employment_assignment_at(emp,(month+interval '1 month - 1 day')::date)).legal_entity_id is distinct from entity then raise exception 'Historical employer evidence is unresolved'; end if;
 select * into v from payroll_ph_wage_evidence_versions where request_id=request;
 if v.id is not null then if v.request_fingerprint<>fingerprint or v.actor_employee_id<>actor then raise exception 'Historical wage request changed'; end if; return jsonb_build_object('id',v.id,'retry',true); end if;
 src:=payroll_ph_wage_source(emp,entity,month);
 if p_input->>'source_fingerprint' is distinct from md5(src::text) then raise serialization_failure using message='Historical wage source changed. Reopen the setup.'; end if;
 if exists(select 1 from payroll_run_profile_snapshots s join payroll_runs x on x.id=s.run_id join payroll_periods p on p.id=x.period_id where s.profile_id=profile and x.status in ('finalized','paid') and p.period_start=(month+interval '1 month')::date) then raise exception 'Use governed Payroll correction for finalized periods'; end if;
 select * into previous from payroll_ph_wage_evidence_versions where profile_id=profile and legal_entity_id=entity and period_start=month order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_ph_wage_evidence_versions(profile_id,legal_entity_id,period_start,period_end,revision,supersedes_id,qualifying_wages,worked_days,source_fingerprint,reference,reason,actor_employee_id,request_id,request_fingerprint) values(profile,entity,month,(month+interval '1 month - 1 day')::date,coalesce(previous.revision,0)+1,previous.id,(p_input->>'qualifying_wages')::numeric,(p_input->>'worked_days')::integer,md5(src::text),p_input->>'reference',p_input->>'reason',actor,request,fingerprint) returning * into v;
 insert into payroll_events(event_type,profile_id,actor_employee_id,reason,details) values('ph_historical_wages_confirmed',profile,actor,p_input->>'reason',jsonb_build_object('revision_id',v.id,'supersedes_id',previous.id,'period_start',month));
 for r in select x.id from payroll_runs x join payroll_periods p on p.id=x.period_id where x.status in ('draft','review_required') and p.period_start=(month+interval '1 month')::date and payroll_can_access_run_employee(x.id,emp,'payroll.manage') order by x.id for update of x loop perform payroll_employee_recalculate(r.id,emp); end loop;
 return jsonb_build_object('id',v.id);
end $$;

-- Existing day reviews keep their original evidence semantics. New reviews bind
-- occurrence facts separately and consume the dated Profile/wage authorities.
create or replace function public.payroll_ph_statutory_project(p_run uuid,p_employee uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare context jsonb:=payroll_ph_statutory_context(p_run,p_employee,p_day); review public.payroll_ph_eligibility_reviews%rowtype; result jsonb; profile jsonb; evidence jsonb;
begin
 if context is null then return null; end if;
 profile:=payroll_ph_profile_resolve(p_employee,p_day);
 select * into review from payroll_ph_eligibility_reviews where run_id=p_run and employee_id=p_employee and work_date=p_day order by revision desc limit 1;
 if review.id is null then result:=jsonb_build_object('issues',coalesce(profile->'issues','[]')||jsonb_build_array('ph_occurrence_review_required'),'lines','[]'::jsonb);
 elsif review.context_fingerprint is distinct from md5(context::text) then result:=jsonb_build_object('issues',jsonb_build_array('ph_eligibility_evidence_changed'),'lines','[]'::jsonb);
 elsif review.evidence->>'workflow'='profile_occurrence_v1' then
  evidence:=profile->'evidence'||jsonb_build_object('holiday_eligibility',review.evidence->>'holiday_eligibility');
  if profile->>'status'<>'verified' then result:=jsonb_build_object('issues',profile->'issues','lines','[]'::jsonb);
  else result:=payroll_ph_statutory_price(context,evidence); end if;
 else result:=payroll_ph_statutory_price(context,review.evidence); end if;
 return result||jsonb_build_object('date',p_day,'context',context,'context_fingerprint',md5(context::text),'profile',profile,'review',to_jsonb(review),'history',coalesce((select jsonb_agg(to_jsonb(v) order by revision desc) from payroll_ph_eligibility_reviews v where run_id=p_run and employee_id=p_employee and work_date=p_day),'[]'::jsonb));
end $$;

create or replace function public.payroll_ph_statutory_confirm(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); r public.payroll_runs%rowtype; emp uuid:=(p_input->>'employee_id')::uuid; day date:=(p_input->>'date')::date;
 context jsonb; profile jsonb; evidence jsonb; review public.payroll_ph_eligibility_reviews%rowtype; prior public.payroll_ph_eligibility_reviews%rowtype;
 request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text); action text:=p_input->>'decision'; t public.payroll_payable_time_versions%rowtype; normal integer; extra integer; ref text;
begin
 select * into r from payroll_runs where id=(p_input->>'run_id')::uuid for update;
 if r.id is null or not payroll_can_access_run_employee(r.id,emp,'payroll.manage') then raise insufficient_privilege using message='Payroll PH review authority denied.'; end if;
 if r.status not in ('draft','review_required') or r.foundation_only then raise exception 'PH review requires an open Payroll Run.'; end if;
 if request is null or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'A decision/correction reason is required.'; end if;
 select * into review from payroll_ph_eligibility_reviews where request_id=request;
 if review.id is not null then
  if review.request_fingerprint<>fingerprint or review.actor_employee_id<>actor then raise exception using errcode='22023',message='Request identity belongs to another PH review.'; end if;
  return jsonb_build_object('review_id',review.id,'retry',true);
 end if;
 if coalesce(action,'') not in ('keep_approved','approve_roster','adjust','paid_not_worked','absence_review','substitution_review') or p_input ? 'evidence' then raise exception 'Submit an occurrence decision; reusable statutory evidence belongs to PH Pay Profile.'; end if;
 context:=payroll_ph_statutory_context(r.id,emp,day);
 if context is null or p_input->>'context_fingerprint' is distinct from md5(context::text) then raise serialization_failure using message='PH evidence changed. Reopen and review the current evidence.'; end if;
 profile:=payroll_ph_profile_resolve(emp,day);
 if profile->>'status'<>'verified' then raise exception 'Complete PH Pay Profile or historical wage evidence first: %',profile->'issues'; end if;
 select * into t from payroll_payable_time_versions where employee_id=emp and work_date=day order by revision desc limit 1 for update;
 if action='keep_approved' and (t.id is null or t.status='review_required') then raise exception 'Approved payable-time evidence is required.'; end if;
 if action in ('approve_roster','adjust','paid_not_worked') then
  if action='approve_roster' then
   if coalesce(t.scheduled_minutes,0)<=0 then raise exception 'Published roster hours are unavailable.'; end if;
   normal:=least(t.scheduled_minutes,(profile#>>'{evidence,normal_minutes}')::integer); extra:=greatest(0,t.scheduled_minutes-normal);
  elsif action='paid_not_worked' then normal:=0;extra:=0;
  else normal:=(p_input->>'approved_minutes')::integer;extra:=coalesce((p_input->>'extra_minutes')::integer,0); end if;
  if t.id is not null then
   perform payroll_time_decision_save(jsonb_build_object('run_id',r.id,'time_version_id',t.id,'request_id',gen_random_uuid(),'correction',t.status<>'review_required','action','adjust','approved_minutes',normal,'extra_minutes',extra,'classification',case when extra>0 then 'public_holiday_ot' else 'public_holiday' end,'reason',p_input->>'reason'));
  elsif action<>'paid_not_worked' then raise exception 'Canonical payable-time evidence is required.'; end if;
 end if;
 -- The retained source, Leave and pricing guards still enforce independent
 -- substitution/forfeiture/coverage blockers. No absence is priced as zero here.
 context:=payroll_ph_statutory_context(r.id,emp,day);
 evidence:=jsonb_build_object('workflow','profile_occurrence_v1','decision',action,'holiday_eligibility',case when action='absence_review' then 'forfeited' when action='substitution_review' then 'substitution_required' else 'eligible' end,
 'profile_revision_id',profile#>>'{revision,id}','profile_evidence',profile->'evidence','wage_evidence',profile->'wages');
 ref:=coalesce(nullif(btrim(p_input->>'reference'),''),context#>>'{paid_holiday,source_reference}','Published calendar and canonical day evidence');
 select * into prior from payroll_ph_eligibility_reviews where run_id=r.id and employee_id=emp and work_date=day order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_ph_eligibility_reviews(run_id,employee_id,work_date,revision,supersedes_id,evidence,context,context_fingerprint,official_reference,reason,actor_employee_id,request_id,request_fingerprint)
 values(r.id,emp,day,coalesce(prior.revision,0)+1,prior.id,evidence,context,md5(context::text),ref,btrim(p_input->>'reason'),actor,request,fingerprint) returning * into review;
 insert into payroll_events(event_type,run_id,actor_employee_id,reason,details) values('ph_statutory_review_confirmed',r.id,actor,review.reason,jsonb_build_object('review_id',review.id,'supersedes_id',prior.id,'employee_id',emp,'date',day,'profile_revision_id',profile#>>'{revision,id}','decision',action));
 perform payroll_employee_recalculate(r.id,emp);
 return jsonb_build_object('review_id',review.id);
end $$;

revoke all on function public.payroll_ph_profile_wage_basis(uuid,date),public.payroll_ph_profile_basis(uuid,date),public.payroll_ph_wage_source(uuid,uuid,date),public.payroll_ph_wage_resolve(uuid,uuid,date),public.payroll_ph_profile_resolve(uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_ph_profile_read(uuid,date),public.payroll_ph_profile_save(jsonb),public.payroll_ph_wage_evidence_save(jsonb) from public,anon;
grant execute on function public.payroll_ph_profile_read(uuid,date),public.payroll_ph_profile_save(jsonb),public.payroll_ph_wage_evidence_save(jsonb) to authenticated;
