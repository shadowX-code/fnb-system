-- Presentation evidence only. Existing identities/artifacts remain untouched.
create or replace function public.payroll_payslip_identity_pin() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.payroll_payslip_identity_snapshots(run_id,employee_id,identity)
 select new.run_id,new.employee_id,jsonb_build_object('employee_name',new.employee_name_snapshot,
  'employee_code',e.employee_code,'employer',le.legal_company_name,'registration',le.company_registration_no,
  'workplace',e.workplace,'position',e.position,'ic_passport',e.ic_no,'employer_address',le.registered_address)
 from public.employees e join public.legal_entities le on le.id=new.legal_entity_id_snapshot where e.id=new.employee_id;
 return new;
end $$;

-- Preserve the same Admin scope, current-calculation gates and read-only contract.
create or replace function public.payroll_draft_payslip_read(p_run_id uuid,p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r public.payroll_runs%rowtype; p public.payroll_periods%rowtype; c jsonb; s jsonb; identity jsonb;
begin
 perform public.payroll_admin_actor();
 select * into r from public.payroll_runs where id=p_run_id;
 select * into p from public.payroll_periods where id=r.period_id;
 if not coalesce(public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view'),false) then
  raise exception using errcode='42501',message='Draft payslip access denied.';
 end if;
 if r.status in ('finalized','paid') then raise exception 'Use the Final Payslip for this revision.'; end if;
 select x into c from jsonb_array_elements(public.payroll_run_calculation_read(p_run_id)->'results') x where x->>'employee_id'=p_employee_id::text;
 select x into s from jsonb_array_elements(public.payroll_run_statutory_read(p_run_id)->'results') x where x->>'employee_id'=p_employee_id::text;
 if c is null or coalesce((c->>'is_stale')::boolean,true) then raise exception 'Refresh Employee Calculation before previewing a Draft Payslip.'; end if;
 if s is null or coalesce((s->>'is_stale')::boolean,true) then s:=jsonb_build_object('lines','[]'::jsonb,'net_pay',null); end if;
 select jsonb_build_object('employee_name',e.full_name,'employee_code',e.employee_code,'position',e.position,
  'workplace',e.workplace,'employer',le.legal_company_name,'registration',le.company_registration_no,
  'ic_passport',e.ic_no,'employer_address',le.registered_address) into identity
 from public.employees e join public.legal_entities le on le.id=p.legal_entity_id where e.id=p_employee_id;
 return public.payroll_payslip_document(identity,p.period_start,p.period_end,(c->>'calculated_at')::timestamptz,c,s,true);
end $$;
revoke all on function public.payroll_payslip_identity_pin(),public.payroll_draft_payslip_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.payroll_draft_payslip_read(uuid,uuid) to authenticated;

-- Version new artifacts only. Never update existing jobs or frozen PDFs.
alter table public.payroll_payslip_jobs alter column renderer_version set default 'a4_v4';
