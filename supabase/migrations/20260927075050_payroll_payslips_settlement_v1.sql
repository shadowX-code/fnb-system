-- Payroll owns payslips and settlement. No calculation or Run transition changes.
create table public.payroll_payslip_identity_snapshots (
 run_id uuid not null, employee_id uuid not null, identity jsonb not null,
 primary key(run_id,employee_id),
 foreign key(run_id,employee_id) references public.payroll_run_profile_snapshots(run_id,employee_id)
);
create table public.payroll_payslip_jobs (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, employee_id uuid not null,
 manifest jsonb not null, manifest_sha256 text not null, renderer_version text not null default 'a4_v1',
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default clock_timestamp(),
 unique(run_id,employee_id), foreign key(run_id,employee_id) references public.payroll_run_profile_snapshots(run_id,employee_id)
);
create table public.payroll_payslip_artifacts (
 job_id uuid primary key references public.payroll_payslip_jobs(id),
 object_path text not null unique, pdf_sha256 text not null check(pdf_sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 created_at timestamptz not null default clock_timestamp()
);
create table public.payroll_settlement_entries (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique, fingerprint text not null,
 period_id uuid not null references public.payroll_periods(id), employee_id uuid not null references public.employees(id),
 run_id uuid not null, kind text not null check(kind in ('payment','recovery','reversal')),
 amount numeric(14,2) not null check(amount<>0), payment_date date not null,
 reference text, remark text, reverses_id uuid unique references public.payroll_settlement_entries(id),
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(run_id,employee_id) references public.payroll_run_statutory_snapshots(run_id,employee_id),
 check((kind='payment' and amount>0 and reverses_id is null)
   or (kind='recovery' and amount<0 and reverses_id is null)
   or (kind='reversal' and reverses_id is not null))
);
create index payroll_settlement_employee_period_idx on public.payroll_settlement_entries(period_id,employee_id);

create function public.payroll_phase5_immutable_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op<>'INSERT' or current_setting('feedx.payroll_command',true) is distinct from 'yes' then
  raise exception using errcode='42501',message='Payroll evidence requires append-only canonical commands.';
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['payroll_payslip_identity_snapshots','payroll_payslip_jobs','payroll_payslip_artifacts','payroll_settlement_entries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('create trigger payroll_phase5_immutable before insert or update or delete on public.%I for each row execute function public.payroll_phase5_immutable_guard()',t);
 end loop;
end $$;

-- Capture at Finalize, not when a PDF is opened. Do not backfill from live masters.
create function public.payroll_payslip_identity_pin() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.payroll_payslip_identity_snapshots(run_id,employee_id,identity)
 select new.run_id,new.employee_id,jsonb_build_object('employee_name',new.employee_name_snapshot,
  'employee_code',e.employee_code,'employer',le.legal_company_name,'registration',le.company_registration_no,
  'workplace',e.workplace) from public.employees e join public.legal_entities le on le.id=new.legal_entity_id_snapshot
 where e.id=new.employee_id;
 return new;
end $$;
create trigger payroll_payslip_identity_pin after insert on public.payroll_run_profile_snapshots
 for each row execute function public.payroll_payslip_identity_pin();

create function public.payroll_payslip_manifest(p_run uuid,p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v jsonb;
begin
 select jsonb_build_object('identity',i.identity,'period_start',p.period_start,'period_end',p.period_end,
  'finalized_at',r.finalized_at,'earnings',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
    from jsonb_array_elements(c.calculation->'lines') x where x->>'kind'='earning'),'[]'::jsonb),
  'reimbursements',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
    from jsonb_array_elements(c.calculation->'lines') x where x->>'kind'='reimbursement'),'[]'::jsonb),
  'deductions',coalesce((select jsonb_agg(jsonb_build_object('label',x->>'label','amount',x->'amount'))
    from jsonb_array_elements(c.calculation->'lines') x where x->>'kind'='deduction'),'[]'::jsonb),
  'statutory',coalesce((select jsonb_agg(jsonb_build_object('scheme',x->>'scheme','applicable',x->'applicable','amount',x->'employee_amount'))
    from jsonb_array_elements(s.result->'lines') x),'[]'::jsonb),
  'gross_earnings',c.calculation->'gross_earnings','net_pay',s.result->'net_pay') into v
 from public.payroll_runs r join public.payroll_periods p on p.id=r.period_id
 join public.payroll_payslip_identity_snapshots i on i.run_id=r.id and i.employee_id=p_employee
 join public.payroll_run_calculation_snapshots c on c.run_id=r.id and c.employee_id=i.employee_id
 join public.payroll_run_statutory_snapshots s on s.run_id=r.id and s.employee_id=i.employee_id
 where r.id=p_run and r.status in ('finalized','paid') and s.result->>'net_pay' is not null;
 if v is null then raise exception using errcode='55000',message='Frozen payslip identity or financial evidence unavailable for this revision.'; end if;
 return v;
end $$;

create function public.payroll_payslip_prepare_core(p_run uuid,p_employee uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare m jsonb; j public.payroll_payslip_jobs%rowtype; a public.payroll_payslip_artifacts%rowtype;
begin
 m:=public.payroll_payslip_manifest(p_run,p_employee);
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_payslip_jobs(run_id,employee_id,manifest,manifest_sha256,actor_employee_id)
 values(p_run,p_employee,m,encode(extensions.digest(m::text,'sha256'),'hex'),p_actor)
 on conflict(run_id,employee_id) do nothing;
 select * into j from public.payroll_payslip_jobs where run_id=p_run and employee_id=p_employee;
 select * into a from public.payroll_payslip_artifacts where job_id=j.id;
 return jsonb_build_object('job_id',j.id,'manifest',j.manifest,'manifest_sha256',j.manifest_sha256,
  'bucket','payroll-payslips','object_path',j.id::text||'/final.pdf','ready',a.job_id is not null);
end $$;

create function public.payroll_payslip_admin_prepare(p_run_id uuid,p_employee_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payroll_admin_actor(); entity uuid;
begin
 select p.legal_entity_id into entity from public.payroll_runs r join public.payroll_periods p on p.id=r.period_id where r.id=p_run_id;
 if not coalesce(public.payroll_can_manage_entity(entity,'payroll.view'),false) then
  raise exception using errcode='42501',message='Payslip access denied.';
 end if;
 return public.payroll_payslip_prepare_core(p_run_id,p_employee_id,actor);
end $$;

create function public.crew_payroll_payslip_prepare(p_token text,p_period_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare employee uuid:=public.crew_session_employee(p_token); run uuid;
begin
 select current_finalized_run_id into run from public.payroll_periods where id=p_period_id;
 if not exists(select 1 from public.payroll_run_statutory_snapshots where run_id=run and employee_id=employee) then
  raise exception using errcode='42501',message='Payslip unavailable.';
 end if;
 return public.payroll_payslip_prepare_core(run,employee,employee);
end $$;

create function public.payroll_payslip_finalize_service(p_job_id uuid,p_manifest_sha256 text,p_pdf_sha256 text,p_size_bytes integer)
returns void language plpgsql security definer set search_path=public as $$
declare j public.payroll_payslip_jobs%rowtype; a public.payroll_payslip_artifacts%rowtype;
begin
 select * into j from public.payroll_payslip_jobs where id=p_job_id for update;
 if j.id is null or j.manifest_sha256 is distinct from p_manifest_sha256 then raise exception 'Payslip source mismatch.'; end if;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_payslip_artifacts(job_id,object_path,pdf_sha256,size_bytes)
 values(j.id,j.id::text||'/final.pdf',p_pdf_sha256,p_size_bytes) on conflict(job_id) do nothing;
 select * into a from public.payroll_payslip_artifacts where job_id=j.id;
 if a.pdf_sha256 is distinct from p_pdf_sha256 or a.size_bytes<>p_size_bytes then raise exception 'Immutable payslip artifact mismatch.'; end if;
 if not exists(select 1 from public.payroll_events where event_type='payslip_generated' and details->>'job_id'=j.id::text) then
  insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
  values('payslip_generated',j.run_id,j.actor_employee_id,jsonb_build_object('job_id',j.id,'manifest_sha256',j.manifest_sha256,'pdf_sha256',a.pdf_sha256));
 end if;
end $$;

create function public.crew_payroll_payslips(p_token text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare employee uuid:=public.crew_session_employee(p_token);
begin
 return jsonb_build_object('payslips',coalesce((select jsonb_agg(jsonb_build_object('period_id',p.id,
  'period_start',p.period_start,'period_end',p.period_end,'net_pay',s.result->'net_pay',
  'available',exists(select 1 from public.payroll_payslip_identity_snapshots i where i.run_id=s.run_id and i.employee_id=employee)) order by p.period_start desc)
 from public.payroll_periods p join public.payroll_run_statutory_snapshots s on s.run_id=p.current_finalized_run_id and s.employee_id=employee),'[]'::jsonb));
end $$;

create function public.payroll_settlement_projection(p_period uuid,p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare due numeric; paid numeric; original numeric;
begin
 select (s.result->>'net_pay')::numeric into due from public.payroll_periods p
 join public.payroll_run_statutory_snapshots s on s.run_id=p.current_finalized_run_id and s.employee_id=p_employee where p.id=p_period;
 if due is null then raise exception 'Current finalized entitlement unavailable.'; end if;
 select coalesce(sum(amount),0) into paid from public.payroll_settlement_entries where period_id=p_period and employee_id=p_employee;
 select (s.result->>'net_pay')::numeric into original from public.payroll_runs r
 join public.payroll_run_statutory_snapshots s on s.run_id=r.id and s.employee_id=p_employee
 where r.period_id=p_period and r.status in ('finalized','paid') order by r.revision limit 1;
 return jsonb_build_object('amount_due',due,'paid_amount',paid,'outstanding_amount',greatest(due-paid,0),
  'overpaid_amount',greatest(paid-due,0),'settlement_difference',due-paid,'entitlement_change',due-original,
  'status',case when paid>due then 'recovery_required' when paid=due then 'paid' when paid<=0 then 'unpaid' else 'partially_paid' end,
  'entries',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,id) from public.payroll_settlement_entries e where period_id=p_period and employee_id=p_employee),'[]'::jsonb));
end $$;

create function public.payroll_payment_read(p_run_id uuid,p_employee_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.payroll_periods%rowtype; j public.payroll_payslip_jobs%rowtype;
begin
 perform public.payroll_admin_actor();
 select period.* into p from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id where r.id=p_run_id;
 if not coalesce(public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view'),false)
 or not exists(select 1 from public.payroll_run_statutory_snapshots where run_id=p_run_id and employee_id=p_employee_id) then raise exception using errcode='42501',message='Payroll payment access denied.'; end if;
 select * into j from public.payroll_payslip_jobs where run_id=p_run_id and employee_id=p_employee_id;
 return jsonb_build_object('current',p.current_finalized_run_id=p_run_id,
  'can_record',p.current_finalized_run_id=p_run_id and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage'),
  'payslip_available',exists(select 1 from public.payroll_payslip_identity_snapshots where run_id=p_run_id and employee_id=p_employee_id),
  'artifact', (select jsonb_build_object('sha256',pdf_sha256,'created_at',created_at) from public.payroll_payslip_artifacts where job_id=j.id),
  'settlement',public.payroll_settlement_projection(p.id,p_employee_id));
end $$;

create function public.payroll_payment_record(p_request_id uuid,p_run_id uuid,p_employee_id uuid,p_kind text,p_amount numeric,p_date date,p_reference text default null,p_remark text default null,p_reverses_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payroll_admin_actor(); p public.payroll_periods%rowtype; e public.payroll_settlement_entries%rowtype;
 old_entry public.payroll_settlement_entries%rowtype; fp text; amount numeric;
begin
 select period.* into p from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id where r.id=p_run_id for update of period;
 if not coalesce(public.payroll_can_manage_entity(p.legal_entity_id,'payroll.manage'),false) then raise exception using errcode='42501',message='Payroll settlement permission required.'; end if;
 fp:=encode(extensions.digest(jsonb_build_array(p_run_id,p_employee_id,p_kind,p_amount,p_date,p_reference,p_remark,p_reverses_id)::text,'sha256'),'hex');
 select * into e from public.payroll_settlement_entries where request_id=p_request_id;
 if e.id is not null then
  if e.fingerprint<>fp then raise exception 'Settlement retry payload changed.'; end if;
  return public.payroll_settlement_projection(p.id,p_employee_id);
 end if;
 if p.current_finalized_run_id is distinct from p_run_id then raise exception using errcode='55000',message='Record settlement against the current finalized revision.'; end if;
 if p_request_id is null or p_date is null or p_date>current_date or p_kind not in ('payment','recovery','reversal')
 or char_length(coalesce(p_reference,''))>300 or char_length(coalesce(p_remark,''))>1000 then raise exception 'Invalid payment evidence.'; end if;
 if p_kind='reversal' then
  select * into old_entry from public.payroll_settlement_entries where id=p_reverses_id and period_id=p.id and employee_id=p_employee_id;
  if old_entry.id is null or old_entry.kind='reversal' or nullif(btrim(p_remark),'') is null then raise exception 'Choose an unreversed entry and provide a reversal remark.'; end if;
  amount:=-old_entry.amount;
 else
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or p_reverses_id is not null then raise exception 'Enter a positive amount with at most two decimals.'; end if;
  amount:=case when p_kind='recovery' then -p_amount else p_amount end;
  if p_kind='recovery' and p_amount>greatest((public.payroll_settlement_projection(p.id,p_employee_id)->>'overpaid_amount')::numeric,0) then raise exception 'Recovery exceeds recorded overpayment.'; end if;
 end if;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_settlement_entries(request_id,fingerprint,period_id,employee_id,run_id,kind,amount,payment_date,reference,remark,reverses_id,actor_employee_id)
 values(p_request_id,fp,p.id,p_employee_id,p_run_id,p_kind,amount,p_date,nullif(btrim(p_reference),''),nullif(btrim(p_remark),''),p_reverses_id,actor) returning * into e;
 insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
 values('payment_recorded',p_run_id,actor,jsonb_build_object('entry_id',e.id,'employee_id',p_employee_id,'kind',p_kind,'amount',amount));
 return public.payroll_settlement_projection(p.id,p_employee_id);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payroll-payslips','payroll-payslips',false,5242880,array['application/pdf']) on conflict(id) do nothing;
-- No client Storage policies: only the authorized Edge gateway can read/write.
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('payroll_phase5_immutable_guard','payroll_payslip_identity_pin','payroll_payslip_manifest','payroll_payslip_prepare_core','payroll_payslip_admin_prepare','crew_payroll_payslip_prepare','payroll_payslip_finalize_service','crew_payroll_payslips','payroll_settlement_projection','payroll_payment_read','payroll_payment_record') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
 end loop;
end $$;
grant execute on function public.payroll_payslip_admin_prepare(uuid,uuid),public.payroll_payment_read(uuid,uuid),public.payroll_payment_record(uuid,uuid,uuid,text,numeric,date,text,text,uuid) to authenticated;
grant execute on function public.crew_payroll_payslip_prepare(text,uuid),public.crew_payroll_payslips(text) to anon,authenticated;
grant execute on function public.payroll_payslip_finalize_service(uuid,text,text,integer) to service_role;
