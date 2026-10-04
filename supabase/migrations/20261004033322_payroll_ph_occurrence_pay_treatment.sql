-- Explicit operational PH treatment is distinct from statutory evidence.
-- Existing legal pricing and append-only occurrence/finalization authorities remain.
create or replace function public.payroll_ph_treatment_quote(p_run uuid,p_employee uuid,p_day date,p_intent jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c jsonb:=payroll_ph_statutory_context(p_run,p_employee,p_day); original jsonb:=c; f jsonb:=payroll_ph_profile_resolve(p_employee,p_day); e jsonb:=f->'evidence'; t jsonb:=c->'time';
 action text:=p_intent->>'decision'; treatment text:=p_intent->>'treatment'; comparison jsonb; lines jsonb:='[]'; issues jsonb:='[]'; warnings jsonb:='[]'; stat_issues jsonb; amount numeric; ot numeric; total numeric; normal integer; extra integer; source jsonb; overlap text; company numeric; prior public.payroll_ph_eligibility_reviews%rowtype;
begin
 if c is null then raise exception 'Published paid holiday, dated employment and compensation are required.'; end if;
 if action in ('approve_roster','adjust','paid_not_worked') then
  if action='approve_roster' then
   if coalesce((t->>'scheduled_minutes')::integer,0)<=0 then raise exception 'Published roster hours are unavailable.'; end if;
   normal:=coalesce((f#>>'{evidence,normal_minutes}')::integer,(t->>'scheduled_minutes')::integer);
   extra:=greatest(0,(t->>'scheduled_minutes')::integer-normal);normal:=least(normal,(t->>'scheduled_minutes')::integer);
  elsif action='paid_not_worked' then normal:=0;extra:=0;
  else normal:=(p_intent->>'approved_minutes')::integer;extra:=coalesce((p_intent->>'extra_minutes')::integer,0);end if;
  if normal is null or normal<0 or extra<0 or normal+extra>1440 then raise exception 'Valid approved payable minutes are required.';end if;
  if t->>'id' is null and action<>'paid_not_worked' then raise exception 'Canonical payable-time evidence is required.';end if;
  t:=coalesce(nullif(t,'null'::jsonb),'{}')||jsonb_build_object('status','approved_manual','approved_minutes',normal,'approved_extra_minutes',extra,'classification',case when extra>0 then 'public_holiday_ot' else 'public_holiday' end);
  c:=jsonb_set(c,'{time}',t);
 elsif action='keep_approved' then
  if t->>'id' is null or t->>'status'='review_required' then raise exception 'Approve payable time or explicitly confirm a paid day not worked.';end if;
 else issues:=issues||jsonb_build_array('ph_occurrence_review_required');end if;
 -- Legacy verified reviews remain usable evidence; never promote or rewrite them.
 select * into prior from payroll_ph_eligibility_reviews where run_id=p_run and employee_id=p_employee and work_date=p_day order by revision desc limit 1;
 if f->>'status'<>'verified' and prior.id is not null and prior.evidence->>'workflow' is null and prior.context_fingerprint=md5(original::text) then e:=prior.evidence;end if;
 e:=coalesce(nullif(e,'null'::jsonb),'{}')||jsonb_build_object('holiday_eligibility','eligible');
 overlap:=coalesce(nullif(p_intent->>'company_overlap',''),e->>'company_overlap');
 if overlap is not null then e:=e||jsonb_build_object('company_overlap',overlap);end if;
 comparison:=payroll_ph_statutory_price(c,e);
 if f->>'status'<>'verified' and not (prior.id is not null and prior.evidence->>'workflow' is null and prior.context_fingerprint=md5(original::text)) then comparison:=comparison||jsonb_build_object('issues',coalesce(f->'issues','[]')||(comparison->'issues'),'lines','[]'::jsonb);end if;
 select coalesce(jsonb_agg(x),'[]') into stat_issues from jsonb_array_elements(comparison->'issues') x where x#>>'{}' not in ('ph_company_overlap_review_required','ph_company_treatment_confirmation_required');
 select coalesce(sum((x->>'amount')::numeric),0) into total from jsonb_array_elements(comparison->'lines') x where x->>'code' in ('public_holiday','public_holiday_ot');
 if treatment='statutory' then issues:=issues||(comparison->'issues');lines:=comparison->'lines';
 elsif treatment in ('custom','none') then
  warnings:=comparison->'issues';
  if jsonb_array_length(stat_issues)>0 then warnings:=warnings||jsonb_build_array('ph_statutory_amount_undetermined');end if;
  amount:=case when treatment='none' then 0 else (p_intent->>'amount')::numeric end;
  ot:=case when treatment='none' then 0 else coalesce((p_intent->>'ot_amount')::numeric,0) end;
  if amount is null or amount<0 or amount<>round(amount,2) or ot<0 or ot<>round(ot,2) or amount+ot>99999999 then raise exception 'Enter a non-negative allowance in RM and sen.';end if;
  if coalesce((t->>'approved_extra_minutes')::integer,0)>0 and treatment='custom' and not p_intent ? 'ot_amount' then raise exception 'Confirm the separate PH overtime allowance.';end if;
  if coalesce((t->>'approved_extra_minutes')::integer,0)=0 and ot<>0 then raise exception 'PH overtime requires approved overtime evidence.';end if;
  warnings:=warnings||jsonb_build_array('ph_explicit_override_not_statutory_compliance');
  if total>amount+ot then warnings:=warnings||jsonb_build_array('ph_allowance_below_statutory_comparison');end if;
  if treatment='none' then warnings:=warnings||jsonb_build_array('ph_no_additional_pay_entitlement_may_be_due');end if;
  source:=jsonb_build_object('work_date',p_day,'compensation_version_id',c#>>'{compensation,id}','time_version_id',t->>'id','formula_version','ph_occurrence_override_v1','treatment',treatment,'statutory_comparison',comparison,'compliance_warnings',warnings,'company_overlap',overlap);
  if amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','public_holiday','label','Public Holiday Allowance','quantity',1,'unit','allowance','rate',amount,'multiplier',1,'amount',amount,'source',source||jsonb_build_object('statutory_treatments',jsonb_build_object('epf','included','socso','included','eis','included','pcb','undetermined'))));end if;
  if ot>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','public_holiday_ot','label','Public Holiday Allowance','quantity',1,'unit','allowance','rate',ot,'multiplier',1,'amount',ot,'source',source||jsonb_build_object('statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','undetermined'))));end if;
  -- Company authority remains separate. An inclusive benefit adds only its
  -- excess over the confirmed normal-work PH cash, never the same payment twice.
  if coalesce((t->>'approved_minutes')::integer,0)+coalesce((t->>'approved_extra_minutes')::integer,0)>0 and c->'company_policy'<>'null'::jsonb then
   if overlap not in ('not_applicable','inclusive_top_up','additional_to_statutory') or overlap is null then issues:=issues||jsonb_build_array('ph_company_overlap_review_required');
   elsif overlap<>'not_applicable' then
    if c#>>'{company_benefit,issue}' is not null or c#>>'{company_benefit,decision,id}' is null then issues:=issues||jsonb_build_array('ph_company_treatment_confirmation_required');
    elsif c#>>'{company_benefit,decision,treatment}'='additional_pay' then
     company:=(c#>>'{company_benefit,additional_amount}')::numeric;
     if overlap='inclusive_top_up' then company:=greatest(0,company-amount);end if;
     if company>0 then lines:=lines||jsonb_build_array(jsonb_build_object('kind','earning','code','company_ph_benefit','label','Company Public Holiday Benefit','units','Explicit company benefit treatment','amount',company,'source',source||jsonb_build_object('ph_work',c->'company_benefit','statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','undetermined'))));end if;
    end if;
   end if;
  end if;
 else issues:=issues||jsonb_build_array('ph_pay_treatment_required');end if;
 -- Explicit money overrides do not silently approve an unresolved time record.
 if c->'source'<>'null'::jsonb and (t->>'id' is null or t->>'status'='review_required' or t->>'source_fingerprint' is distinct from c#>>'{source,source_fingerprint}') then issues:=issues||jsonb_build_array('ph_approved_time_required');end if;
 return jsonb_build_object('context',c,'context_fingerprint',md5(original::text),'quote_fingerprint',md5(jsonb_build_array(original,f,comparison,p_intent->>'decision',p_intent->>'treatment',p_intent->'amount',p_intent->'ot_amount',p_intent->'approved_minutes',p_intent->'extra_minutes',overlap)::text),'profile',f,'comparison',comparison,'statutory_available',jsonb_array_length(stat_issues)=0,'statutory_amount',case when jsonb_array_length(stat_issues)=0 then total else null end,'issues',issues,'warnings',warnings,'lines',lines);
end $$;

create or replace function public.payroll_ph_treatment_preview(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform payroll_admin_actor();
 if not payroll_can_access_run_employee((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,'payroll.view') then raise insufficient_privilege using message='Payroll PH visibility denied.';end if;
 return payroll_ph_treatment_quote((p_input->>'run_id')::uuid,(p_input->>'employee_id')::uuid,(p_input->>'date')::date,p_input);
end $$;

create or replace function public.payroll_ph_statutory_project(p_run uuid,p_employee uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare context jsonb:=payroll_ph_statutory_context(p_run,p_employee,p_day); review public.payroll_ph_eligibility_reviews%rowtype; result jsonb; profile jsonb; evidence jsonb;
begin
 if context is null then return null; end if;
 profile:=payroll_ph_profile_resolve(p_employee,p_day);
 select * into review from payroll_ph_eligibility_reviews where run_id=p_run and employee_id=p_employee and work_date=p_day order by revision desc limit 1;
 if review.id is null then result:=jsonb_build_object('issues',jsonb_build_array('ph_occurrence_review_required'),'lines','[]'::jsonb);
 elsif review.context_fingerprint is distinct from md5(context::text) then result:=jsonb_build_object('issues',jsonb_build_array('ph_eligibility_evidence_changed'),'lines','[]'::jsonb);
 elsif review.evidence->>'workflow'='pay_treatment_v1' then
  result:=payroll_ph_treatment_quote(p_run,p_employee,p_day,review.evidence->'intent');
 elsif review.evidence->>'workflow'='profile_occurrence_v1' then
  evidence:=profile->'evidence'||jsonb_build_object('holiday_eligibility',review.evidence->>'holiday_eligibility');
  if profile->>'status'<>'verified' then result:=jsonb_build_object('issues',profile->'issues','lines','[]'::jsonb);
  else result:=payroll_ph_statutory_price(context,evidence); end if;
 else result:=payroll_ph_statutory_price(context,review.evidence); end if;
 return result||jsonb_build_object('date',p_day,'context',context,'context_fingerprint',md5(context::text),'preview',payroll_ph_treatment_quote(p_run,p_employee,p_day,jsonb_build_object('decision',case when context#>>'{time,id}' is not null and context#>>'{time,status}'<>'review_required' then 'keep_approved' else 'paid_not_worked' end)),'profile',profile,'review',to_jsonb(review),'history',coalesce((select jsonb_agg(to_jsonb(v) order by revision desc) from payroll_ph_eligibility_reviews v where run_id=p_run and employee_id=p_employee and work_date=p_day),'[]'::jsonb));
end $$;


create or replace function public.payroll_ph_statutory_confirm(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); r public.payroll_runs%rowtype; emp uuid:=(p_input->>'employee_id')::uuid; day date:=(p_input->>'date')::date;
 context jsonb; profile jsonb; evidence jsonb; review public.payroll_ph_eligibility_reviews%rowtype; prior public.payroll_ph_eligibility_reviews%rowtype;
 request uuid:=(p_input->>'request_id')::uuid; fingerprint text:=md5(p_input::text); action text:=p_input->>'decision'; t public.payroll_payable_time_versions%rowtype; normal integer; extra integer; ref text; quote jsonb;
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
 if coalesce(action,'') not in ('keep_approved','approve_roster','adjust','paid_not_worked') or p_input ? 'evidence' then raise exception 'Submit an occurrence decision; reusable statutory evidence belongs to PH Pay Profile.'; end if;
 context:=payroll_ph_statutory_context(r.id,emp,day);
 if context is null or p_input->>'context_fingerprint' is distinct from md5(context::text) then raise serialization_failure using message='PH evidence changed. Reopen and review the current evidence.'; end if;
 profile:=payroll_ph_profile_resolve(emp,day);
 quote:=payroll_ph_treatment_quote(r.id,emp,day,p_input);
 if p_input->>'quote_fingerprint' is distinct from quote->>'quote_fingerprint' then raise serialization_failure using message='PH quote changed. Review the current allowance before confirming.';end if;
 if p_input->>'treatment' not in ('statutory','custom','none') or p_input->>'treatment' is null then raise exception 'Select PH Pay Treatment.';end if;
 if p_input->>'treatment'='statutory' and quote->>'statutory_available'<>'true' then raise exception 'Statutory amount cannot be determined automatically.';end if;
 if p_input->>'treatment' in ('custom','none') and p_input->>'acknowledge_warning' is distinct from 'true' then raise exception 'Acknowledge the compliance warning before confirming this override.';end if;
 select * into t from payroll_payable_time_versions where employee_id=emp and work_date=day order by revision desc limit 1 for update;
 if action='keep_approved' and (t.id is null or t.status='review_required') then raise exception 'Approved payable-time evidence is required.'; end if;
 if action in ('approve_roster','adjust','paid_not_worked') then
  if action='approve_roster' then
   if coalesce(t.scheduled_minutes,0)<=0 then raise exception 'Published roster hours are unavailable.'; end if;
   normal:=least(t.scheduled_minutes,coalesce((profile#>>'{evidence,normal_minutes}')::integer,t.scheduled_minutes)); extra:=greatest(0,t.scheduled_minutes-normal);
  elsif action='paid_not_worked' then normal:=0;extra:=0;
  else normal:=(p_input->>'approved_minutes')::integer;extra:=coalesce((p_input->>'extra_minutes')::integer,0); end if;
  if t.id is not null then
   perform payroll_time_decision_save(jsonb_build_object('run_id',r.id,'time_version_id',t.id,'request_id',gen_random_uuid(),'correction',t.status<>'review_required','action','adjust','approved_minutes',normal,'extra_minutes',extra,'classification',case when extra>0 then 'public_holiday_ot' else 'public_holiday' end,'reason',p_input->>'reason'));
  elsif action<>'paid_not_worked' then raise exception 'Canonical payable-time evidence is required.'; end if;
 end if;
 -- The retained source, Leave and pricing guards still enforce independent
 -- substitution/forfeiture/coverage blockers. No absence is priced as zero here.
 context:=payroll_ph_statutory_context(r.id,emp,day);
 quote:=payroll_ph_treatment_quote(r.id,emp,day,p_input);
 if quote->'issues' ? 'ph_approved_time_required' then raise exception 'Approved payable-time evidence is required.';end if;
 evidence:=jsonb_build_object('workflow','pay_treatment_v1','intent',p_input-'context_fingerprint'-'request_id','comparison',quote->'comparison','warnings',quote->'warnings','profile_revision_id',profile#>>'{revision,id}','wage_evidence',profile->'wages');
 ref:=coalesce(nullif(btrim(p_input->>'reference'),''),context#>>'{paid_holiday,source_reference}','Published calendar and canonical day evidence');
 select * into prior from payroll_ph_eligibility_reviews where run_id=r.id and employee_id=emp and work_date=day order by revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into payroll_ph_eligibility_reviews(run_id,employee_id,work_date,revision,supersedes_id,evidence,context,context_fingerprint,official_reference,reason,actor_employee_id,request_id,request_fingerprint)
 values(r.id,emp,day,coalesce(prior.revision,0)+1,prior.id,evidence,context,md5(context::text),ref,btrim(p_input->>'reason'),actor,request,fingerprint) returning * into review;
 insert into payroll_events(event_type,run_id,actor_employee_id,reason,details) values('ph_statutory_review_confirmed',r.id,actor,review.reason,jsonb_build_object('review_id',review.id,'supersedes_id',prior.id,'employee_id',emp,'date',day,'profile_revision_id',profile#>>'{revision,id}','decision',action,'treatment',p_input->>'treatment','warnings',quote->'warnings','comparison',quote->'comparison')); 
 perform payroll_employee_recalculate(r.id,emp);
 return jsonb_build_object('review_id',review.id);
end $$;


revoke all on function public.payroll_ph_treatment_quote(uuid,uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.payroll_ph_treatment_preview(jsonb) from public,anon;
grant execute on function public.payroll_ph_treatment_preview(jsonb) to authenticated;
-- Custom allowance is ordinary contributable remuneration; explicit PH OT keeps
-- the existing overtime contribution classification. No statutory amount is inferred.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)'::regprocedure);
 if strpos(d,$anchor$v_line#>>'{source,formula_version}'='my_ph_2023_v1'$anchor$)=0 then raise exception 'Statutory contribution anchor changed';end if;
 d:=replace(d,$anchor$v_line#>>'{source,formula_version}'='my_ph_2023_v1'$anchor$,$patch$v_line#>>'{source,formula_version}' in ('my_ph_2023_v1','ph_occurrence_override_v1')$patch$);execute d;
end $$;
