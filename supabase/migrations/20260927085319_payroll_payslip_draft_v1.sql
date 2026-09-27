-- Payment is deferred in V1. Keep append-only evidence, remove client commands.
revoke all on function public.payroll_payment_read(uuid,uuid),
 public.payroll_payment_record(uuid,uuid,uuid,text,numeric,date,text,text,uuid) from public,anon,authenticated;

-- One employee-facing document contract, from current calculation or frozen snapshots.
create function public.payroll_payslip_document(p_identity jsonb,p_start date,p_end date,p_at timestamptz,p_calculation jsonb,p_statutory jsonb,p_draft boolean)
returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('identity',p_identity,'period_start',p_start,'period_end',p_end,
 'finalized_at',p_at,'draft',p_draft,'pay_basis',p_calculation->'pay_basis',
 'earnings',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount',
   'minutes',x->'minutes','rate',x->'rate','multiplier',x->'multiplier','units',x->'units'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='earning'),'[]'::jsonb),
 'reimbursements',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='reimbursement'),'[]'::jsonb),
 'deductions',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
   from jsonb_array_elements(p_calculation->'lines') x where x->>'kind'='deduction'),'[]'::jsonb),
 'statutory',coalesce((select jsonb_agg(jsonb_build_object('scheme',x->>'scheme','applicable',x->'applicable',
   'amount',x->'employee_amount','employer_amount',x->'employer_amount'))
   from jsonb_array_elements(p_statutory->'lines') x),'[]'::jsonb),
 'gross_earnings',p_calculation->'gross_earnings','net_pay',p_statutory->'net_pay',
 'total_deductions',case when p_statutory->>'net_pay' is not null then
   (p_calculation->>'non_statutory_deductions')::numeric + coalesce((select sum((x->>'employee_amount')::numeric)
     from jsonb_array_elements(p_statutory->'lines') x),0) else null end);
$$;

-- New finalizations freeze Position as well; no backfill from mutable identity.
create or replace function public.payroll_payslip_identity_pin() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.payroll_payslip_identity_snapshots(run_id,employee_id,identity)
 select new.run_id,new.employee_id,jsonb_build_object('employee_name',new.employee_name_snapshot,
  'employee_code',e.employee_code,'employer',le.legal_company_name,'registration',le.company_registration_no,
  'workplace',e.workplace,'position',e.position)
 from public.employees e join public.legal_entities le on le.id=new.legal_entity_id_snapshot where e.id=new.employee_id;
 return new;
end $$;

create or replace function public.payroll_payslip_manifest(p_run uuid,p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v jsonb;
begin
 select public.payroll_payslip_document(i.identity,p.period_start,p.period_end,r.finalized_at,c.calculation,s.result,false) into v
 from public.payroll_runs r join public.payroll_periods p on p.id=r.period_id
 join public.payroll_payslip_identity_snapshots i on i.run_id=r.id and i.employee_id=p_employee
 join public.payroll_run_calculation_snapshots c on c.run_id=r.id and c.employee_id=i.employee_id
 join public.payroll_run_statutory_snapshots s on s.run_id=r.id and s.employee_id=i.employee_id
 where r.id=p_run and r.status in ('finalized','paid') and s.result->>'net_pay' is not null;
 if v is null then raise exception using errcode='55000',message='Frozen payslip identity or financial evidence unavailable for this revision.'; end if;
 return v;
end $$;
alter table public.payroll_payslip_jobs alter column renderer_version set default 'a4_v2';

-- Read only: no job, artifact, storage object, event or calculation is written.
create function public.payroll_draft_payslip_read(p_run_id uuid,p_employee_id uuid) returns jsonb
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
  'workplace',e.workplace,'employer',le.legal_company_name,'registration',le.company_registration_no) into identity
 from public.employees e join public.legal_entities le on le.id=p.legal_entity_id where e.id=p_employee_id;
 return public.payroll_payslip_document(identity,p.period_start,p.period_end,(c->>'calculated_at')::timestamptz,c,s,true);
end $$;
revoke all on function public.payroll_payslip_document(jsonb,date,date,timestamptz,jsonb,jsonb,boolean),public.payroll_draft_payslip_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.payroll_draft_payslip_read(uuid,uuid) to authenticated;
