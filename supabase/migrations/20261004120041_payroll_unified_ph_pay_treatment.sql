-- One operational PH treatment; all historical company/Leave evidence retained.
alter table public.payroll_ph_policy_versions drop constraint payroll_ph_policy_versions_treatment_check;
alter table public.payroll_ph_policy_versions add constraint payroll_ph_policy_versions_treatment_check check(treatment in ('additional_pay','replacement_leave','statutory','no_default'));
-- Extract the existing company calculator once; its amounts/formula version do not change.
create function public.payroll_ph_company_allowance(p_compensation jsonb,p_time jsonb)
returns numeric language sql immutable set search_path=public as $$
 select case p_compensation->>'pay_basis' when 'monthly' then round((p_compensation->>'basic_salary')::numeric/26,2)
 when 'hourly' then round((p_compensation->>'hourly_rate')::numeric*(p_time->>'approved_minutes')::numeric/60,2) end;
$$;
revoke all on function public.payroll_ph_company_allowance(jsonb,jsonb) from public,anon,authenticated;
do $$ declare d text; a text; begin
 d:=pg_get_functiondef('public.payroll_ph_work_project(uuid,uuid,date)'::regprocedure);
 a:='case c.pay_basis when ''monthly'' then round(c.basic_salary/26,2) when ''hourly'' then round(c.hourly_rate*t.approved_minutes/60,2) end';
 if strpos(d,a)=0 then raise exception 'Existing company formula anchor changed';end if;
 d:=replace(d,a,'public.payroll_ph_company_allowance(to_jsonb(c),to_jsonb(t))');
 -- New cash defaults do not supersede the retained Leave/substitution policy.
 a:='where legal_entity_id=p.legal_entity_id and effective_from<=p_work_date';
 if strpos(d,a)=0 then raise exception 'Legacy Leave policy anchor changed';end if;
 execute replace(d,a,a||' and treatment in (''additional_pay'',''replacement_leave'')');
 d:=pg_get_functiondef('public.payroll_ph_policy_save(uuid,date,text,text)'::regprocedure);
 execute replace(d,'p_treatment not in (''additional_pay'',''replacement_leave'')','p_treatment not in (''additional_pay'',''replacement_leave'',''statutory'',''no_default'')');
 -- Retain exact legacy projections for historical intents and existing integrations.
 d:=pg_get_functiondef('public.payroll_ph_treatment_quote(uuid,uuid,date,jsonb)'::regprocedure);
 execute replace(d,'FUNCTION public.payroll_ph_treatment_quote(','FUNCTION public.payroll_ph_treatment_quote_legacy(');
end $$;
revoke all on function public.payroll_ph_treatment_quote_legacy(uuid,uuid,date,jsonb) from public,anon,authenticated;

create or replace function public.payroll_ph_treatment_quote(p_run uuid,p_employee uuid,p_day date,p_intent jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare q jsonb; c jsonb; t jsonb; default_treatment text; amount numeric; line jsonb; regular jsonb; policy jsonb; lines jsonb:='[]'; issues jsonb; grant_evidence jsonb;
begin
 if p_intent->>'treatment_model' is distinct from 'unified_v1' then
  q:=payroll_ph_treatment_quote_legacy(p_run,p_employee,p_day,p_intent);
 else
  -- Normal decisions never layer an extra company payment over a PH treatment.
  q:=payroll_ph_treatment_quote_legacy(p_run,p_employee,p_day,p_intent||jsonb_build_object('treatment',case when p_intent->>'treatment'='company' then '' else p_intent->>'treatment' end,'company_overlap','not_applicable'));
 end if;
 c:=q->'context'; t:=c->'time'; policy:=c->'company_policy';
 default_treatment:=case policy->>'treatment' when 'additional_pay' then 'company' when 'statutory' then 'statutory' else '' end;
 q:=q||jsonb_build_object('default_treatment',default_treatment,'company_available',policy->>'id' is not null and policy->>'treatment'<>'replacement_leave' and coalesce((t->>'approved_minutes')::integer,0)>0);
 if p_intent->>'treatment_model' is distinct from 'unified_v1' then return q;end if;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]') into grant_evidence from crew_replacement_leave_grants g
 where g.employee_id=p_employee and g.work_date=p_day and not exists(select 1 from crew_replacement_leave_revocations v where v.grant_id=g.id);
 if p_intent->>'treatment'='company' then
  select coalesce(jsonb_agg(x),'[]') into issues from jsonb_array_elements(q->'issues') x where x#>>'{}'<>'ph_pay_treatment_required';
  amount:=payroll_ph_company_allowance(c->'compensation',t);
  if q->>'company_available'<>'true' or amount is null then issues:=issues||jsonb_build_array('ph_company_allowance_unavailable');end if;
  if coalesce((t->>'approved_extra_minutes')::integer,0)>0 then
   if q->>'statutory_available'<>'true' then issues:=issues||jsonb_build_array('ph_ot_statutory_evidence_required');
   else select coalesce(jsonb_agg(x),'[]') into lines from jsonb_array_elements(q#>'{comparison,lines}') x where x->>'code'='public_holiday_ot';end if;
  end if;
  if c#>>'{compensation,pay_basis}'='hourly' then
   regular:=payroll_price_time((c#>>'{compensation,id}')::uuid,(t->>'id')::uuid,'regular',(t->>'approved_minutes')::integer,p_day);
   if regular is null then issues:=issues||jsonb_build_array('missing_regular_rule');else lines:=lines||jsonb_build_array(regular);end if;
  end if;
  line:=jsonb_build_object('kind','earning','code','company_ph_benefit','label','Public Holiday Allowance','quantity',1,'unit','company allowance','rate',amount,'multiplier',1,'amount',amount,
   'source',jsonb_build_object('formula_version','company_ph_v1','treatment_model','unified_v1','policy_version_id',policy->>'id','compensation_version_id',c#>>'{compensation,id}','time_version_id',t->>'id','work_date',p_day,'compliance_warnings',q#>'{comparison,issues}'));
  if amount is not null then lines:=lines||jsonb_build_array(line);end if;
  q:=q||jsonb_build_object('lines',lines,'issues',issues,'warnings',coalesce(q#>'{comparison,issues}','[]')||jsonb_build_array('ph_company_allowance_not_statutory_compliance'));
 end if;
 if jsonb_array_length(grant_evidence)>0 then q:=q||jsonb_build_object('issues',(q->'issues')||jsonb_build_array('ph_replacement_leave_resolution_required'));end if;
 return q||jsonb_build_object('quote_fingerprint',md5(jsonb_build_array(q->>'quote_fingerprint',p_intent->>'treatment',amount,grant_evidence,'unified_v1')::text));
end $$;
revoke all on function public.payroll_ph_treatment_quote(uuid,uuid,date,jsonb) from public,anon,authenticated;

-- Keep a single audited atomic save. Explicit confirmation records the warning
-- internally; no separate compliance checkbox or client-created legal evidence.
do $$ declare d text; a text; begin
 d:=pg_get_functiondef('public.payroll_ph_statutory_confirm(jsonb)'::regprocedure);
 a:='if request is null or length(btrim(coalesce(p_input->>''reason'','''')))<3 then';
 if strpos(d,a)=0 then raise exception 'PH reason authority anchor changed';end if;
 d:=replace(d,a,$patch$if p_input->>'treatment_model'='unified_v1' and coalesce(length(btrim(p_input->>'reason')),0)<3
 and p_input->>'treatment' in ('statutory','company') and action='keep_approved'
 and not exists(select 1 from payroll_ph_eligibility_reviews where run_id=r.id and employee_id=emp and work_date=day)
 then p_input:=p_input||jsonb_build_object('reason','Confirmed '||(p_input->>'treatment')||' PH Pay Treatment');end if;
 if request is null or length(btrim(coalesce(p_input->>'reason','')))<3 then$patch$);
 d:=replace(d,$a$if request is null or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'A decision/correction reason is required.'; end if;$a$,'');
 d:=replace(d,$a$if coalesce(action,'') not in$a$,$b$if request is null or length(btrim(coalesce(p_input->>'reason','')))<3 then raise exception 'A decision/correction reason is required.'; end if;
 if p_input->>'treatment'='company' and p_input->>'treatment_model' is distinct from 'unified_v1' then raise exception 'Company treatment requires the unified occurrence workflow.';end if;
 if coalesce(action,'') not in$b$);
 d:=replace(d,'p_input->>''treatment'' not in (''statutory'',''custom'',''none'')','p_input->>''treatment'' not in (''statutory'',''custom'',''none'',''company'')');
 d:=replace(d,'if p_input->>''treatment'' in (''custom'',''none'') and','if p_input->>''treatment_model'' is distinct from ''unified_v1'' and p_input->>''treatment'' in (''custom'',''none'') and');
 a:='if quote->''issues'' ? ''ph_approved_time_required'' then';
 d:=replace(d,a,$patch$if p_input->>'treatment_model'='unified_v1' and jsonb_array_length(quote->'issues')>0 then raise exception 'PH treatment remains unresolved: %',quote->'issues';end if;
 if quote->'issues' ? 'ph_approved_time_required' then$patch$);
 d:=replace(d,'''workflow'',''pay_treatment_v1'',''intent''','''workflow'',''pay_treatment_v1'',''warning_handling'',case when p_input->>''treatment_model''=''unified_v1'' then ''visible_explicit_confirmation'' else ''legacy_acknowledgement'' end,''intent''');
 execute d;
end $$;
-- Project the exact existing earning lines, including regular hourly PH wages.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.payroll_ph_treatment_preview(jsonb)'::regprocedure);
 d:=replace(d,'normal numeric;','normal numeric; regular numeric;');
 d:=replace(d,$a$x->>'code'='public_holiday'$a$,$b$(x->>'code'='public_holiday' or (p_input->>'treatment_model'='unified_v1' and x->>'code'='company_ph_benefit'))$b$);
 
 d:=replace(d,'determinate:=',$p$select coalesce(sum((x->>'amount')::numeric),0) into regular from jsonb_array_elements(q->'lines') x where x->>'code'='regular';
 determinate:=$p$);
 d:=replace(d,$a$in ('statutory','custom','none')$a$,$b$in ('statutory','custom','none','company')$b$);
 d:=replace(d,$a$'regular_pay',0$a$,$b$'regular_pay',regular$b$);
 d:=replace(d,'then company end',$p$then case when p_input->>'treatment_model'='unified_v1' then 0 else company end end$p$);
 execute d;
end $$;
-- Unified company cash keeps its legacy contribution classification/code while
-- sharing the exact operational Payroll/Payslip label. Old snapshots stay untouched.
do $$ declare d text; a text:='when ''company_ph_benefit'' then ''Company Public Holiday Benefit''';begin
 d:=pg_get_functiondef('public.payroll_earning_groups(jsonb)'::regprocedure);
 if strpos(d,a)=0 then raise exception 'Earning presentation anchor changed';end if;
 execute replace(d,a,'when ''company_ph_benefit'' then case when x#>>''{source,treatment_model}''=''unified_v1'' then ''Public Holiday Allowance'' else ''Company Public Holiday Benefit'' end');
end $$;
