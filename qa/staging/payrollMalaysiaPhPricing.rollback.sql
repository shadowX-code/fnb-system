-- Staging rollback contracts: official legal formulas use explicit wage evidence.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare c jsonb; e jsonb; r jsonb; x jsonb; groups jsonb; basis text; expected numeric; total numeric;
begin
 c:=jsonb_build_object('date','2026-09-16','preceding_employer_verified',true,'employee_age_verified',true,'period_start','2026-09-01','period_end','2026-09-30','paid_holiday',jsonb_build_object('outlet_state_code','MY-08'),
 'compensation',jsonb_build_object('id',gen_random_uuid(),'pay_basis','monthly','basic_salary',2600),
 'source',null,'time',null,'company_policy',null,
 'rules',(select jsonb_agg(to_jsonb(v)) from payroll_pay_rule_versions v where formula_version='my_ph_2023_v1' and pay_basis='monthly'));
 e:=jsonb_build_object('coverage','full_time','schedule_category','general','schedule_monthly_wages',2600,'monthly_ordinary_wages',2600,'normal_minutes',480,'holiday_eligibility','eligible');
 r:=payroll_ph_statutory_price(c,e);
 if jsonb_array_length(r->'issues')<>0 or jsonb_array_length(r->'lines')<>0 then raise exception 'Monthly holiday double paid: %',r; end if;
 c:=c||jsonb_build_object('source',jsonb_build_object('source_fingerprint','QA'),'time',jsonb_build_object('id',gen_random_uuid(),'status','approved_manual','classification','public_holiday','source_fingerprint','QA','approved_minutes',240,'approved_extra_minutes',0));
 r:=payroll_ph_statutory_price(c,e);
 if (r#>>'{lines,0,amount}')::numeric<>200 then raise exception 'Short full-time PH work must receive two full ordinary days'; end if;
 c:=jsonb_set(c,'{time,approved_minutes}','480'); c:=jsonb_set(c,'{time,approved_extra_minutes}','60');
 r:=payroll_ph_statutory_price(c,e);
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>237.5 then raise exception 'Monthly PH OT: %',r; end if;
 -- Ordinary hourly wages are preceding qualifying wages / days, never current
 -- hourly rate × roster duration (the two evidence bases intentionally differ).
 c:=jsonb_set(c,'{compensation,pay_basis}','"hourly"');
 c:=jsonb_set(c,'{rules}',(select jsonb_agg(to_jsonb(v)) from payroll_pay_rule_versions v where formula_version='my_ph_2023_v1' and pay_basis='hourly'));
 e:=e||jsonb_build_object('preceding_period_start','2026-08-01','preceding_period_end','2026-08-31','preceding_qualifying_wages',1600,'preceding_worked_days',20);
 c:=jsonb_set(c,'{time,approved_minutes}','0'); c:=jsonb_set(c,'{time,approved_extra_minutes}','0');
 r:=payroll_ph_statutory_price(c,e); if (r#>>'{lines,0,amount}')::numeric<>80 then raise exception 'Hourly PH no work failed: %',r; end if;
 c:=jsonb_set(c,'{time,approved_minutes}','480'); r:=payroll_ph_statutory_price(c,e);
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>240 then raise exception 'Hourly holiday plus two ordinary days'; end if;
 c:=jsonb_set(c,'{time,approved_extra_minutes}','60'); r:=payroll_ph_statutory_price(c,e);
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>270 then raise exception 'Hourly PH OT failed: %',r; end if;
 e:=e||jsonb_build_object('coverage','part_time','normal_minutes',300,'comparable_full_time_minutes',480,'part_time_weekly_minutes',1500,'comparable_weekly_minutes',2400,'regular_contract_not_home_or_casual',true);
 c:=jsonb_set(c,'{time,approved_minutes}','300'); c:=jsonb_set(c,'{time,approved_extra_minutes}','240'); r:=payroll_ph_statutory_price(c,e);
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>384 or jsonb_array_length(r->'lines')<>4 then raise exception 'Part-time PH OT split 2x/3x failed: %',r; end if;
 if not (payroll_ph_statutory_price(c,e||jsonb_build_object('regular_contract_not_home_or_casual',false))->'issues' ? 'ph_part_time_contract_category_required') then raise exception 'Excluded part-time category guessed'; end if;
 e:=e||jsonb_build_object('coverage','full_time','normal_minutes',480,'schedule_monthly_wages',4000); c:=jsonb_set(c,'{time,approved_minutes}','480');c:=jsonb_set(c,'{time,approved_extra_minutes}','0');
 if jsonb_array_length(payroll_ph_statutory_price(c,e)->'issues')<>0 then raise exception 'RM4000 covered boundary failed'; end if;
 if not (payroll_ph_statutory_price(c,e||jsonb_build_object('schedule_monthly_wages',4000.01))->'issues' ? 'ph_over_4000_contract_work_rule_required') then raise exception 'Excluded general category got premium'; end if;
 if jsonb_array_length(payroll_ph_statutory_price(c,e||jsonb_build_object('schedule_monthly_wages',6000,'schedule_category','manual'))->'issues')<>0 then raise exception 'Manual coverage boundary failed'; end if;
 if not (payroll_ph_statutory_price(c,e||jsonb_build_object('holiday_eligibility','substitution_required'))->'issues' ? 'ph_absence_or_substitution_requires_review') then raise exception 'Substitute holiday inferred'; end if;
 if not (payroll_ph_statutory_price(c,e-'preceding_qualifying_wages')->'issues' ? 'ph_preceding_wage_period_evidence_required') then raise exception 'Historical wage evidence guessed'; end if;
 c:=c||jsonb_build_object('company_policy',jsonb_build_object('id',gen_random_uuid()),'company_benefit',jsonb_build_object('issue',null,'decision',jsonb_build_object('id',gen_random_uuid(),'treatment','additional_pay'),'additional_amount',200));
 r:=payroll_ph_statutory_price(c,e||jsonb_build_object('company_overlap','inclusive_top_up'));
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>280 then raise exception 'Top-up duplicate: %',r; end if; -- 240 statutory + (200 - 160)
 r:=payroll_ph_statutory_price(c,e||jsonb_build_object('company_overlap','not_applicable'));
 if exists(select 1 from jsonb_array_elements(r->'lines') v where v->>'code'='company_ph_benefit') then raise exception 'Benefit off emitted amount'; end if;
 r:=payroll_ph_statutory_price(c,e||jsonb_build_object('company_overlap','additional_to_statutory'));
 select sum((v->>'amount')::numeric) into total from jsonb_array_elements(r->'lines') v;
 if total<>440 then raise exception 'Explicit additional contract failed'; end if;
 if not (payroll_ph_statutory_price(c,e)->'issues' ? 'ph_company_overlap_review_required') then raise exception 'Company contract interpretation inferred'; end if;
 -- Two legally priced days combine only when full pricing bases match.
 r:=payroll_ph_statutory_price(c,e||jsonb_build_object('company_overlap','not_applicable'));
 groups:=payroll_earning_groups(jsonb_build_object('lines',(r->'lines')||(r->'lines')));
 if jsonb_array_length(groups)<>2 or (groups#>>'{0,quantity}')::numeric<>2 then raise exception 'Day aggregation failed: %',groups; end if;
 if (select sum((v->>'amount')::numeric) from jsonb_array_elements(groups) v)<>480 then raise exception 'Exact gross reconciliation failed'; end if;
 if exists(select 1 from jsonb_array_elements(groups) v where v->>'label'<>'Public Holiday Allowance') then raise exception 'Canonical PH label drift'; end if;
 if has_function_privilege('anon','public.payroll_ph_statutory_confirm(jsonb)','execute') or has_function_privilege('authenticated','public.payroll_ph_statutory_price(jsonb,jsonb)','execute') then raise exception 'Private authority exposed'; end if;
end $$;
rollback;
