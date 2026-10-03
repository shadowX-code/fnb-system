-- One presentation projection over canonical priced lines. No repricing or
-- mutation of daily financial evidence, calculation versions or frozen records.
create function public.payroll_earning_groups(p_calculation jsonb)
returns jsonb language sql immutable set search_path=public as $$
 with normalized as (
  select x, n, case x->>'code' when 'regular' then 'Regular Pay'
    when 'company_ph_benefit' then 'Company Public Holiday Benefit'
    when 'public_holiday' then 'Public Holiday Allowance' else x->>'label' end label,
   coalesce((x->>'rate')::numeric,(x->>'rate_per_minute')::numeric*60,
    case when x->>'code'='company_ph_benefit' then (x#>>'{source,ph_work,compensation,hourly_rate}')::numeric end) rate,
   coalesce((x->>'minutes')::numeric,case when x->>'code'='company_ph_benefit'
     and x#>>'{source,ph_work,compensation,pay_basis}'='hourly' then (x#>>'{source,ph_work,time,approved_minutes}')::numeric end) minutes
  from jsonb_array_elements(coalesce(p_calculation->'lines','[]')) with ordinality a(x,n) where x->>'kind'='earning'
 ), keyed as (
  select *, case when minutes is null then jsonb_build_array('individual',n) else
   jsonb_build_array(x->>'kind',x->>'code',rate,x->'rate_per_minute',x->'multiplier',
    x#>'{source,rule_version_id}',x#>'{source,compensation_version_id}',
    x#>'{source,formula}',x#>'{source,formula_version}',x#>'{source,statutory_treatment}',
    x#>'{source,ph_work,compensation,id}',x#>'{source,ph_work,policy,id}',x->'units') end basis
  from normalized
 ), grouped as (
  select min(n) ordinal,min(label) label,sum((x->>'amount')::numeric) amount,sum(minutes) minutes,
   min(rate) rate, (array_agg(x order by n))[1] first_line,jsonb_agg(x order by n) details
  from keyed group by basis
 ) select coalesce(jsonb_agg(first_line||jsonb_build_object('label',label,'amount',amount,'minutes',minutes,
    'rate',rate,'calculation_details',details,'day_count',jsonb_array_length(details)) order by ordinal),'[]') from grouped;
$$;
revoke all on function public.payroll_earning_groups(jsonb) from public,anon,authenticated;

-- The existing decision core remains the sole append authority. Reviewed time
-- is accepted only inside the authorized, locked Run correction command below.
do $$ declare d text; a text; begin
 d:=pg_get_functiondef('public.payroll_time_decide(uuid,text,integer,integer,text,text)'::regprocedure);
 a:='if v_current.status<>''review_required'' then';
 if strpos(d,a)=0 then raise exception 'Time decision status anchor changed'; end if;
 d:=replace(d,a,'if v_current.status<>''review_required'' and current_setting(''feedx.payroll_correct_time'',true) is distinct from v_current.id::text then');
 d:=replace(d,'''time_''||p_action','case when v_current.status<>''review_required'' then ''time_corrected'' else ''time_''||p_action end');
 d:=replace(d,'''work_date'',v_current.work_date,''approved_minutes'',v_minutes,','''run_id'',nullif(current_setting(''feedx.payroll_time_run'',true),''''),''request_id'',nullif(current_setting(''feedx.payroll_time_request'',true),''''),''request_fingerprint'',nullif(current_setting(''feedx.payroll_time_fingerprint'',true),''''),''action'',p_action,''work_date'',v_current.work_date,''approved_minutes'',v_minutes,');
 execute d;
end $$;

create unique index payroll_time_decision_request_idx on public.payroll_events ((details->>'request_id'))
 where event_type in ('time_approve','time_adjust','time_reject','time_corrected') and details->>'request_id' is not null;

create function public.payroll_time_decision_save(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; t public.payroll_payable_time_versions%rowtype;
 actor uuid:=public.payroll_admin_actor(); saved jsonb; calculation jsonb; prior public.payroll_events%rowtype;
 request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text);
begin
 select * into r from payroll_runs where id=(p_input->>'run_id')::uuid for update;
 select * into p from payroll_periods where id=r.period_id;
 select * into t from payroll_payable_time_versions where id=(p_input->>'time_version_id')::uuid for update;
 if r.id is null or t.id is null or t.work_date not between p.period_start and p.period_end
  or t.evidence->>'legal_entity_id' is distinct from p.legal_entity_id::text
  or not public.payroll_can_access_run_employee(r.id,t.employee_id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll time decision scope denied.'; end if;
 if r.status not in ('draft','review_required') then raise exception 'Only an open Payroll review can change payable time.'; end if;
 if request is null then raise exception 'A decision request identity is required.'; end if;
 select * into prior from payroll_events where details->>'request_id'=request::text
  and event_type in ('time_approve','time_adjust','time_reject','time_corrected');
 if found then
  if prior.actor_employee_id<>actor or prior.details->>'request_fingerprint'<>fingerprint then raise exception 'Decision request changed.'; end if;
  return jsonb_build_object('id',prior.details->>'time_version_id','retried',true);
 end if;
 if coalesce((p_input->>'correction')::boolean,false) is distinct from (t.status<>'review_required') then raise exception 'Review the current decision before correcting it.'; end if;
 if nullif(btrim(p_input->>'reason'),'') is null then raise exception 'A decision or correction reason is required.'; end if;
 if t.status<>'review_required' then perform set_config('feedx.payroll_correct_time',t.id::text,true); end if;
 perform set_config('feedx.payroll_time_run',r.id::text,true);
 perform set_config('feedx.payroll_time_request',request::text,true);
 perform set_config('feedx.payroll_time_fingerprint',fingerprint,true);
 saved:=public.payroll_time_decide(t.id,p_input->>'action',(p_input->>'approved_minutes')::integer,
   (p_input->>'extra_minutes')::integer,p_input->>'classification',p_input->>'reason');
 perform set_config('feedx.payroll_correct_time','',true);
 perform set_config('feedx.payroll_time_run','',true);
 perform set_config('feedx.payroll_time_request','',true);
 perform set_config('feedx.payroll_time_fingerprint','',true);
 -- Changed time-version identity is already a canonical fingerprint dependency.
 -- Recalculate earnings + statutory results atomically; unresolved gates stay.
 calculation:=public.payroll_employee_recalculate(r.id,t.employee_id);
 return saved||jsonb_build_object('calculation',calculation);
end $$;
revoke all on function public.payroll_time_decision_save(jsonb) from public,anon;
grant execute on function public.payroll_time_decision_save(jsonb) to authenticated;

-- A company benefit is not Malaysia's statutory PH authority. The existing
-- generic multiplier registry has no verified normal-day/ORP/eligibility PH
-- contract. Retain paid-calendar/time evidence and block PH money rather than
-- treating company Additional Pay as statutory entitlement or paying both.
do $$ declare d text; a integer; b integer; boundary text; begin
 d:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
 a:=strpos(d,' if v_time.classification=''public_holiday'' then');
 b:=strpos(d,' -- Regular Monthly time is already covered');
 if a=0 or b<=a then raise exception 'PH authority boundary anchor changed'; end if;
 boundary:=$boundary$
 if v_time.classification in ('public_holiday','public_holiday_ot') or v_source#>>'{paid_holiday_policy,status}'='paid_holiday' then
  v_ph:=public.payroll_ph_work_project(p_run_id,p_employee_id,v_day);
  v_inputs:=jsonb_set(v_inputs,'{ph_work}',coalesce(v_inputs->'ph_work','[]'::jsonb)||jsonb_build_array(v_ph),true);
  -- No work has no work premium. Monthly Basic retains its separate authority;
  -- Hourly holiday-without-work entitlement is not inferred from roster minutes.
  if coalesce(v_time.approved_minutes,0)>0 or coalesce(v_time.approved_extra_minutes,0)>0 then
   if v_time.classification not in ('public_holiday','public_holiday_ot') then v_issues:=array_append(v_issues,'ph_payable_classification_requires_review:'||v_day); end if;
   v_issues:=array_append(v_issues,'ph_statutory_rule_unverified:'||v_basis||':'||v_day);
   if v_time.classification='public_holiday_ot' or coalesce(v_time.approved_extra_minutes,0)>0 then
    v_issues:=array_append(v_issues,'ph_ot_statutory_rule_unverified:'||v_basis||':'||v_day);
   end if;
  elsif v_basis='hourly' then
   v_issues:=array_append(v_issues,'ph_paid_day_entitlement_unverified:hourly:'||v_day);
  end if;
  if v_ph->>'issue' is not null then v_issues:=array_append(v_issues,(v_ph->>'issue')||':'||v_day); end if;
  continue;
 end if;
$boundary$;
 d:=substr(d,1,a-1)||substr(d,b);
 -- Paid-holiday eligibility precedes leave/non-payable pricing too: a rejected
 -- shift is not evidence that statutory holiday entitlement was forfeited.
 if strpos(d,'      if v_time.classification=''leave'' then')=0 then raise exception 'Time classification anchor changed'; end if;
 d:=replace(d,'      if v_time.classification=''leave'' then',boundary||'      if v_time.classification=''leave'' then');
 -- A published paid day cannot disappear for Hourly employees just because
 -- no working roster/clock record exists. Eligibility/ORP remains explicit.
 d:=replace(d,'      if v_source is null or v_source->>''legal_entity_id'' is distinct from v_period.legal_entity_id::text then',
  '      if v_source is null and v_basis=''hourly'' then
        v_ph:=public.payroll_paid_holiday_resolve(v_period.legal_entity_id,v_first.default_cost_outlet_id,v_day);
        v_inputs:=jsonb_set(v_inputs,''{paid_holidays}'',coalesce(v_inputs->''paid_holidays'',''[]''::jsonb)||jsonb_build_array(jsonb_build_object(''date'',v_day,''policy'',v_ph)),true);
        if v_ph->>''status''=''paid_holiday'' then v_issues:=array_append(v_issues,''ph_paid_day_entitlement_unverified:hourly:''||v_day); end if;
      end if;
      if v_source is null or v_source->>''legal_entity_id'' is distinct from v_period.legal_entity_id::text then');
 d:=replace(d,'v_status:=case when cardinality(v_issues)=0', 'v_inputs:=v_inputs||jsonb_build_object(''calculation_contract'',''payroll_ph_boundary_v2''); v_status:=case when cardinality(v_issues)=0');
 execute d;
end $$;

-- Authorized reads compose aggregates over existing daily evidence, including
-- frozen calculations. Neither a read nor this migration rewrites snapshots.
do $$ declare d text; a text; begin
 d:=pg_get_functiondef('public.payroll_run_calculation_read(uuid)'::regprocedure);
 a:='return jsonb_build_object(''results'',v_rows';
 if strpos(d,a)=0 then raise exception 'Calculation read anchor changed'; end if;
 d:=replace(d,a,'select coalesce(jsonb_agg(x||jsonb_build_object(''earning_groups'',public.payroll_earning_groups(x))),''[]'') into v_rows from jsonb_array_elements(v_rows) x; '||a);
 execute d;
 d:=pg_get_functiondef('public.payroll_finalized_record_read(uuid)'::regprocedure);
 a:='''calculation'',c.calculation';
 if strpos(d,a)=0 then raise exception 'Finalized read anchor changed'; end if;
 execute replace(d,a,'''calculation'',case when c.calculation is null then null else c.calculation||jsonb_build_object(''earning_groups'',public.payroll_earning_groups(c.calculation)) end');
 d:=pg_get_functiondef('public.payroll_payslip_document(jsonb,date,date,timestamptz,jsonb,jsonb,boolean)'::regprocedure);
 a:=substring(d from '''earnings'',coalesce\([\s\S]*?''\[\]''::jsonb\),');
 if a is null then raise exception 'Payslip earnings anchor changed'; end if;
 execute replace(d,a,$projection$'earnings',coalesce((select jsonb_agg(jsonb_build_object('label',x->'label','amount',x->'amount','minutes',x->'minutes','rate',x->'rate','multiplier',x->'multiplier','units',x->'units')) from jsonb_array_elements(public.payroll_earning_groups(p_calculation)) x),'[]'::jsonb),$projection$);
end $$;
