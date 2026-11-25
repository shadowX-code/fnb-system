-- Compare decision evidence without changing its immutable snapshot or the live calculation inputs.
create function public.payroll_compensation_evidence_matches(p_saved jsonb,p_current jsonb,p_day date)
returns boolean language sql immutable set search_path=public as $$
 select coalesce(p_saved=p_current or (
   p_saved->>'id' is not null and p_current->>'id' is not null
   and p_saved->>'profile_id' is not null
   and (p_saved->>'effective_from')::date<=p_day and (p_current->>'effective_from')::date<=p_day
   and p_saved-array['id','revision','effective_from','created_at','approved_by_employee_id','reason']
       =p_current-array['id','revision','effective_from','created_at','approved_by_employee_id','reason']),false);
$$;
revoke all on function public.payroll_compensation_evidence_matches(jsonb,jsonb,date) from public,anon,authenticated;

create function public.payroll_source_evidence_matches(p_saved jsonb,p_fingerprint text,p_current jsonb)
returns boolean language sql stable set search_path=public as $$
 select case
   when p_fingerprint=p_current->>'source_fingerprint' then true
   when p_fingerprint is null or p_fingerprint is distinct from p_saved->>'source_fingerprint'
     or p_fingerprint is distinct from md5((p_saved-'source_fingerprint')::text)
     or p_current->>'source_fingerprint' is distinct from md5((p_current-'source_fingerprint')::text)
     or p_saved->>'compensation_version_id' is null or p_current->>'compensation_version_id' is null
     or p_saved->>'compensation_version_id'=p_current->>'compensation_version_id'
     or p_saved-array['source_fingerprint','compensation_version_id']
        is distinct from p_current-array['source_fingerprint','compensation_version_id']
     then false
   else exists(
     select 1 from public.payroll_compensation_versions saved
     join public.payroll_compensation_versions current
       on current.id=(p_current->>'compensation_version_id')::uuid and current.profile_id=saved.profile_id
     where saved.id=(p_saved->>'compensation_version_id')::uuid
       and saved.profile_id=(p_saved->>'profile_id')::uuid
       and public.payroll_compensation_evidence_matches(to_jsonb(saved),to_jsonb(current),(p_current->>'work_date')::date)
   ) end;
$$;
revoke all on function public.payroll_source_evidence_matches(jsonb,text,jsonb) from public,anon,authenticated;

create function public.payroll_time_evidence_matches(p_time jsonb,p_source jsonb)
returns boolean language sql stable set search_path=public as $$
 select p_time->>'id' is not null
   and public.payroll_source_evidence_matches(p_time->'evidence',p_time->>'source_fingerprint',p_source);
$$;
revoke all on function public.payroll_time_evidence_matches(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.payroll_ph_review_context_matches(p_saved jsonb,p_fingerprint text,p_current jsonb)
returns boolean language plpgsql stable set search_path=public as $$
declare
 saved jsonb:=p_saved;
 current jsonb:=p_current;
 field text[];
begin
 if p_fingerprint is null or p_fingerprint is distinct from md5(saved::text) or jsonb_typeof(current) is distinct from 'object' then return false; end if;
 if saved=current then return true; end if;
 -- Historical row projections omitted nullable fields. A populated value remains evidence.
 foreach field slice 1 in array array[
   array['employment','employment_jurisdiction'],
   array['employment','recorded_by_machine_id'],
   array['time','actor_machine_id']
 ] loop
   if coalesce(saved#>field,'null')='null'::jsonb and coalesce(current#>field,'null')='null'::jsonb then
     saved:=saved#-field;
     current:=current#-field;
   end if;
 end loop;
 if saved->'source' is distinct from current->'source' and not public.payroll_source_evidence_matches(
    saved->'source',saved#>>'{source,source_fingerprint}',current->'source') then return false; end if;
 if saved->'compensation' is distinct from current->'compensation' and not public.payroll_compensation_evidence_matches(
    saved->'compensation',current->'compensation',coalesce(current->>'date',current->>'work_date')::date) then return false; end if;
 if saved->'company_benefit' is distinct from current->'company_benefit' then
   if not public.payroll_ph_review_context_matches(
      (saved->'company_benefit')-'source_fingerprint'::text,md5(((saved->'company_benefit')-'source_fingerprint'::text)::text),
      (current->'company_benefit')-'source_fingerprint'::text) then return false; end if;
 end if;
 return saved-array['source','compensation','company_benefit']=current-array['source','compensation','company_benefit'];
end;
$$;

-- Keep the currently deployed function signatures, grants, calculation inputs and exact write guards.
do $migration$
declare
 patch record;
 definition text;
begin
 for patch in select * from (values
  ('public.payroll_time_requirement(jsonb,jsonb)', 'IMMUTABLE', 'STABLE'),
  ('public.payroll_time_requirement(jsonb,jsonb)', $old$p_time->>'id' is not null and p_time->>'source_fingerprint'=p_source->>'source_fingerprint'$old$, $new$public.payroll_time_evidence_matches(p_time,p_source)$new$),
  ('public.payroll_time_source_state(uuid)', $old$source->>'source_fingerprint' is distinct from t.source_fingerprint$old$, $new$not public.payroll_time_evidence_matches(to_jsonb(t),source)$new$),
  ('public.payroll_time_source_reconcile(uuid,uuid,text)', $old$if latest.source_fingerprint=p_source_fingerprint then$old$, $new$if latest.source_fingerprint=p_source_fingerprint or
    (latest.id=old.id and public.payroll_time_evidence_matches(to_jsonb(latest),source)) then$new$),
  ('public.payroll_time_decide(uuid,text,integer,integer,text,text)', $old$v_evidence is null or v_evidence->>'source_fingerprint'<>v_current.source_fingerprint$old$, $new$not public.payroll_time_evidence_matches(to_jsonb(v_current),v_evidence)$new$),
  ('feedx_integrations.hr_payroll_time_reconcile(uuid,uuid,date,date,uuid)', $old$v_latest.id is not null and v_latest.source_fingerprint=v_evidence->>'source_fingerprint'$old$, $new$public.payroll_time_evidence_matches(to_jsonb(v_latest),v_evidence)$new$),
  ('public.payroll_calculation_project(uuid,uuid)', $old$v_time.source_fingerprint is distinct from v_source->>'source_fingerprint'$old$, $new$not public.payroll_time_evidence_matches(to_jsonb(v_time),v_source)$new$),
  ('public.payroll_monthly_entitlement(uuid,uuid,uuid)', $old$v_source is null or v_time.source_fingerprint is distinct from v_source->>'source_fingerprint'$old$, $new$not public.payroll_time_evidence_matches(to_jsonb(v_time),v_source)$new$),
  ('public.payroll_ph_statutory_price(jsonb,jsonb)', 'IMMUTABLE', 'STABLE'),
  ('public.payroll_ph_statutory_price(jsonb,jsonb)', $old$t->>'source_fingerprint' is distinct from p_context#>>'{source,source_fingerprint}'$old$, $new$not public.payroll_time_evidence_matches(t,p_context->'source')$new$),
  ('public.payroll_ph_treatment_quote_legacy(uuid,uuid,date,jsonb)', $old$t->>'source_fingerprint' is distinct from c#>>'{source,source_fingerprint}'$old$, $new$not public.payroll_time_evidence_matches(t,c->'source')$new$),
  ('public.payroll_ph_work_project(uuid,uuid,date)', $old$t.source_fingerprint is distinct from source->>'source_fingerprint'$old$, $new$not public.payroll_time_evidence_matches(to_jsonb(t),source)$new$),
  ('public.payroll_ph_work_project(uuid,uuid,date)', $old$decision.source_fingerprint<>fingerprint$old$, $new$decision.source_fingerprint<>fingerprint and not public.payroll_ph_review_context_matches(
     decision.evidence-array['source_fingerprint','recommended_treatment'],decision.source_fingerprint,evidence)$new$)
 ) as replacements(signature,before_text,after_text) loop
   definition:=pg_get_functiondef(patch.signature::regprocedure);
   if (length(definition)-length(replace(definition,patch.before_text,'')))/length(patch.before_text)<>1 then
     raise exception 'Unexpected Payroll evidence definition for %',patch.signature;
   end if;
   execute replace(definition,patch.before_text,patch.after_text);
 end loop;
end;
$migration$;
