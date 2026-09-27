-- Retire only the explicitly approved isolated Phase 5 masters/access.
-- Retain all published work, finalized payroll, PDFs, payment and audit evidence.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare emp uuid; before_hash text; after_hash text; profile uuid;
begin
 select md5(jsonb_agg(to_jsonb(s) order by s.run_id,s.employee_id)::text) into before_hash from public.payroll_run_statutory_snapshots s join public.employees e on e.id=s.employee_id where e.employee_code in ('QA-P5-1','QA-P5-2');
 select p.id into profile from public.payroll_profiles p join public.employees e on e.id=p.employee_id where e.employee_code='QA-P5-1';
 perform public.payroll_compensation_adjust(profile,'2026-10-01','monthly',3400,'MYR','QA ONLY later setup proves frozen evidence unchanged');
 for emp in select id from public.employees where employee_code in ('QA-P5-1','QA-P5-2') loop perform public.manage_crew_access(emp,'disable'); end loop;
 update public.employees set is_active=false where employee_code in ('QA-P5-1','QA-P5-2');
 update public.outlets set is_active=false where code='QA-P5-0927';
 update public.legal_entities set is_active=false where company_registration_no='QA-P5-20260927';
 perform public.payroll_component_save((select id from public.payroll_component_definitions where code='qa_p5_corrected_entitlement'),'qa_p5_corrected_entitlement','QA ONLY Phase 5 Correction','earning','included','included','included','included',false,'Retired disposable Phase 5 QA component',null);
 select md5(jsonb_agg(to_jsonb(s) order by s.run_id,s.employee_id)::text) into after_hash from public.payroll_run_statutory_snapshots s join public.employees e on e.id=s.employee_id where e.employee_code in ('QA-P5-1','QA-P5-2');
 if before_hash is distinct from after_hash then raise exception 'Finalized evidence changed'; end if;
 if exists(select 1 from public.crew_sessions s join public.employees e on e.id=s.employee_id where e.employee_code in ('QA-P5-1','QA-P5-2') and s.revoked_at is null and s.expires_at>now()) then raise exception 'Disposable sessions remain'; end if;
end $$;
commit;
