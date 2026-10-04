-- Daily decisions commit independently of expensive month calculation. The new
-- time-version ID already invalidates the canonical calculation fingerprint.
create or replace function public.payroll_time_decision_result(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(t)||jsonb_build_object('employee_name',e.full_name,'history',
 coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'revision',h.revision,
 'status',h.status,'approved_minutes',h.approved_minutes,'approved_extra_minutes',h.approved_extra_minutes,
 'reason',h.decision_reason,'actor_employee_id',h.actor_employee_id,'at',h.decided_at) order by h.revision desc)
 from payroll_payable_time_versions h where h.profile_id=t.profile_id and h.work_date=t.work_date),'[]'::jsonb))
 from payroll_payable_time_versions t join employees e on e.id=t.employee_id where t.id=p_id;
$$;
revoke all on function public.payroll_time_decision_result(uuid) from public,anon,authenticated;

do $$ declare d text; anchor text; begin
 d:=pg_get_functiondef('public.payroll_time_decision_save(jsonb)'::regprocedure);
 anchor:='calculation:=public.payroll_employee_recalculate(r.id,t.employee_id);';
 if strpos(d,anchor)=0 then raise exception 'Decision calculation anchor changed'; end if;
 d:=replace(d,anchor,'-- Recalculation is automatically coalesced outside this decision transaction.');
 d:=replace(d,'return saved||jsonb_build_object(''calculation'',calculation);',
 'return saved||jsonb_build_object(''row'',payroll_time_decision_result((saved->>''id'')::uuid),''calculation_stale'',true);');
 d:=replace(d,'return jsonb_build_object(''id'',prior.details->>''time_version_id'',''retried'',true);',
 'return jsonb_build_object(''id'',prior.details->>''time_version_id'',''retried'',true,''row'',payroll_time_decision_result((prior.details->>''time_version_id'')::uuid),''calculation_stale'',true);');
 execute d;
end $$;

-- Resolve ambiguous transport outcomes using exactly the audited request and
-- actor/payload binding. A null result is not permission to change retry intent.
create or replace function public.payroll_time_decision_status(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=payroll_admin_actor(); t payroll_payable_time_versions%rowtype; prior payroll_events%rowtype;
begin
 select * into t from payroll_payable_time_versions where id=(p_input->>'time_version_id')::uuid;
 if t.id is null or not payroll_can_access_run_employee((p_input->>'run_id')::uuid,t.employee_id,'payroll.manage') then
  raise insufficient_privilege using message='Payroll time decision scope denied.';
 end if;
 select * into prior from payroll_events where details->>'request_id'=p_input->>'request_id'
 and event_type in ('time_approve','time_adjust','time_reject','time_corrected');
 if not found then return null;end if;
 if prior.actor_employee_id<>actor or prior.details->>'request_fingerprint'<>md5(p_input::text) then raise exception 'Decision request changed.';end if;
 return jsonb_build_object('id',prior.details->>'time_version_id','retried',true,'row',payroll_time_decision_result((prior.details->>'time_version_id')::uuid),'calculation_stale',true);
end $$;
revoke all on function public.payroll_time_decision_status(jsonb) from public,anon;
grant execute on function public.payroll_time_decision_status(jsonb) to authenticated;

-- Filter before DISTINCT ON: the global SECURITY DEFINER set function cannot
-- push the employee/profile predicate into its scan. Latest date then revision
-- is identical to the existing effective-version/date selection.
do $$ declare d text; n text; begin
 foreach n in array array['payroll_time_evidence_base(uuid,date)','payroll_calculation_project(uuid,uuid)'] loop
  d:=pg_get_functiondef(('public.'||n)::regprocedure);
  d:=replace(d,'public.payroll_compensation_effective_versions()','public.payroll_compensation_versions');
  d:=replace(d,'order by effective_from desc limit 1','order by effective_from desc,revision desc limit 1');
  execute d;
 end loop;
 foreach n in array array['payroll_ph_statutory_context(uuid,uuid,date)','payroll_ph_profile_basis(uuid,date)'] loop
  d:=pg_get_functiondef(('public.'||n)::regprocedure);
  d:=replace(d,'payroll_compensation_effective_versions() v','payroll_compensation_versions v');
  d:=replace(d,'order by v.effective_from desc limit 1','order by v.effective_from desc,v.revision desc limit 1');
  execute d;
 end loop;
end $$;
