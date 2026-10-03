-- Independent LINDUNG 24 Jam (SKBBK) authority. No employee participation backfill.
-- Official schedule and participation rules: PERKESO current August 2026 FAQ.
-- Ordinary EPF/SOCSO/EIS/PCB authorities and finalized evidence remain unchanged.
create table public.payroll_lindung_participation_versions (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
 effective_month date not null check(effective_month=date_trunc('month',effective_month)::date and effective_month>='2026-06-01'),
 coverage_from timestamptz not null,
 status text not null check(status in ('mandatory','participating','valid_opt_out','another_designated_employer','unresolved')),
 worker_category text not null check(worker_category in ('local','local_resident','foreign','unresolved')),
 designated_legal_entity_id uuid references public.legal_entities(id) on delete restrict,
 designated_employer_name text,
 participation_basis text not null,
 employee_evidence jsonb not null,
 supporting_evidence jsonb not null,
 source_reference text not null check(length(btrim(source_reference)) between 8 and 1000),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 revision integer not null check(revision>0),
 supersedes_id uuid references public.payroll_lindung_participation_versions(id) on delete restrict,
 request_id uuid not null unique,
 payload_fingerprint text not null,
 confirmed_by_employee_id uuid not null references public.employees(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 unique(profile_id,effective_month,revision),
 check(date_trunc('month',coverage_from at time zone 'Asia/Kuala_Lumpur')::date=effective_month)
);
create index payroll_lindung_participation_effective_idx on public.payroll_lindung_participation_versions(profile_id,effective_month desc,revision desc);
alter table public.payroll_lindung_participation_versions enable row level security;
revoke all on public.payroll_lindung_participation_versions from public,anon,authenticated;
create trigger payroll_command_guard before insert or update or delete on public.payroll_lindung_participation_versions for each row execute function public.payroll_command_guard();
-- Unconditional immutability also applies to privileged clients.
create function public.payroll_lindung_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception using errcode='55000',message='LINDUNG participation history is immutable. Append a sourced revision.'; end $$;
revoke all on function public.payroll_lindung_immutable() from public,anon,authenticated;
create trigger payroll_lindung_immutable before update or delete on public.payroll_lindung_participation_versions for each row execute function public.payroll_lindung_immutable();

alter table public.payroll_statutory_schedule_versions drop constraint payroll_statutory_schedule_versions_scheme_check;
alter table public.payroll_statutory_schedule_versions add constraint payroll_statutory_schedule_versions_scheme_check check(scheme in ('epf','socso','eis','lindung'));
select set_config('feedx.payroll_command','yes',true);
with schedule as (
 insert into public.payroll_statutory_schedule_versions(scheme,category,effective_from,effective_to,source_url,source_version,reconciliation_note)
 values('lindung','phase1','2026-06-01','2028-05-31',
 'https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf',
 'PERKESO Act 4 SKBBK Phase 1 official table, rows 1–65',
 'Exact employee non-employment injury column, identical First/Second Category; employee funded, employer zero. RM6,000 ceiling. No percentage approximation or future phase tables.') returning id
)
insert into public.payroll_statutory_schedule_bands(schedule_version_id,wage_above,wage_through,employee_amount,employer_amount,source_row)
select schedule.id,b.lo,b.hi,b.amount,0,'PERKESO SKBBK row '||b.row from schedule cross join (values
 (0,30,0.20,1),
 (30,50,0.30,2),
 (50,70,0.50,3),
 (70,100,0.65,4),
 (100,140,0.90,5),
 (140,200,1.25,6),
 (200,300,1.85,7),
 (300,400,2.65,8),
 (400,500,3.35,9),
 (500,600,4.15,10),
 (600,700,4.85,11),
 (700,800,5.65,12),
 (800,900,6.35,13),
 (900,1000,7.15,14),
 (1000,1100,7.85,15),
 (1100,1200,8.65,16),
 (1200,1300,9.35,17),
 (1300,1400,10.15,18),
 (1400,1500,10.85,19),
 (1500,1600,11.65,20),
 (1600,1700,12.35,21),
 (1700,1800,13.15,22),
 (1800,1900,13.85,23),
 (1900,2000,14.65,24),
 (2000,2100,15.35,25),
 (2100,2200,16.15,26),
 (2200,2300,16.85,27),
 (2300,2400,17.65,28),
 (2400,2500,18.35,29),
 (2500,2600,19.15,30),
 (2600,2700,19.85,31),
 (2700,2800,20.65,32),
 (2800,2900,21.35,33),
 (2900,3000,22.15,34),
 (3000,3100,22.85,35),
 (3100,3200,23.65,36),
 (3200,3300,24.35,37),
 (3300,3400,25.15,38),
 (3400,3500,25.85,39),
 (3500,3600,26.65,40),
 (3600,3700,27.35,41),
 (3700,3800,28.15,42),
 (3800,3900,28.85,43),
 (3900,4000,29.65,44),
 (4000,4100,30.35,45),
 (4100,4200,31.15,46),
 (4200,4300,31.85,47),
 (4300,4400,32.65,48),
 (4400,4500,33.35,49),
 (4500,4600,34.15,50),
 (4600,4700,34.85,51),
 (4700,4800,35.65,52),
 (4800,4900,36.35,53),
 (4900,5000,37.15,54),
 (5000,5100,37.85,55),
 (5100,5200,38.65,56),
 (5200,5300,39.35,57),
 (5300,5400,40.15,58),
 (5400,5500,40.85,59),
 (5500,5600,41.65,60),
 (5600,5700,42.35,61),
 (5700,5800,43.15,62),
 (5800,5900,43.85,63),
 (5900,6000,44.65,64),
 (6000,null::numeric,44.65,65)
) b(lo,hi,amount,row);

-- Internal resolution has no side effects and never consults SOCSO applicability.
create function public.payroll_lindung_resolve(p_profile_id uuid,p_date date,p_legal_entity_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v public.payroll_lindung_participation_versions%rowtype; e public.employees%rowtype;
 m date:=date_trunc('month',p_date)::date; issue text; applicable boolean; status text; entity uuid;
begin
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 entity:=coalesce(p_legal_entity_id,(public.employee_employment_assignment_at(e.id,greatest(p_date,e.joined_date))).legal_entity_id);
 if m<'2026-06-01' then
  return jsonb_build_object('state','not_applicable','status','before_scheme','applicable',false,'effective_month',m,'issue',null);
 end if;
 select * into v from public.payroll_lindung_participation_versions
 where profile_id=p_profile_id and effective_month<=m order by effective_month desc,revision desc limit 1;
 status:=coalesce(v.status,'unresolved');
 if v.id is null or status='unresolved' then issue:='lindung_participation_unconfirmed:'||m;
 elsif v.employee_evidence->>'nationality' is distinct from e.nationality then issue:='lindung_employee_evidence_changed';
 elsif v.status='mandatory' and v.worker_category in ('local','local_resident') and m>'2026-06-01' then
  issue:='lindung_participation_unconfirmed:'||m; -- June mandatory evidence is not a later local election.
 elsif m='2026-06-01' and status not in ('mandatory','another_designated_employer') then issue:='lindung_june_mandatory_evidence_required';
 elsif status in ('mandatory','participating','another_designated_employer') and
   v.designated_legal_entity_id is null and nullif(btrim(v.designated_employer_name),'') is null then issue:='lindung_designated_employer_missing';
 elsif status in ('mandatory','participating') and v.designated_legal_entity_id is distinct from entity then issue:='lindung_designated_employer_mismatch';
 elsif status='another_designated_employer' and v.designated_legal_entity_id=entity then issue:='lindung_designated_employer_mismatch';
 end if;
 if issue is null and status in ('mandatory','participating') and not exists(select 1 from public.payroll_statutory_schedule_versions pack where pack.scheme='lindung' and pack.effective_from<=m and (pack.effective_to is null or pack.effective_to>=(m+interval '1 month - 1 day')::date)) then issue:='lindung_rate_pack_unavailable'; end if;
 applicable:=case when issue is not null then null else status in ('mandatory','participating') end;
 return jsonb_build_object('state',case when issue is not null then 'setup_required' when applicable then 'confirmed' else 'not_applicable' end,
  'status',status,'applicable',applicable,'category',case when applicable then (select pack.category from public.payroll_statutory_schedule_versions pack where pack.scheme='lindung' and pack.effective_from<=m and (pack.effective_to is null or pack.effective_to>=(m+interval '1 month - 1 day')::date) order by pack.effective_from desc limit 1) else null end,
  'effective_month',m,'effective_from',v.effective_month,'coverage_from',v.coverage_from,
  'issue',issue,'evidence',case when v.id is null then null else to_jsonb(v) end);
end $$;
revoke all on function public.payroll_lindung_resolve(uuid,date,uuid) from public,anon,authenticated;

create function public.payroll_lindung_setup_read(p_profile_id uuid,p_month date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; h jsonb; r jsonb; entities jsonb;
 m date:=date_trunc('month',coalesce(p_month,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date))::date;
begin
 perform public.payroll_admin_actor();
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.view') then
  raise exception using errcode='42501',message='Payroll LINDUNG view scope denied.'; end if;
 select coalesce(jsonb_agg(to_jsonb(v) order by effective_month desc,revision desc),'[]') into h
 from public.payroll_lindung_participation_versions v where profile_id=p_profile_id;
 r:=public.payroll_lindung_resolve(p_profile_id,m);
 select coalesce(jsonb_agg(jsonb_build_object('id',le.id,'name',le.legal_company_name) order by le.legal_company_name),'[]') into entities
 from public.legal_entities le where public.payroll_can_manage_entity(le.id,'payroll.view') or le.id=e.legal_entity_id;
 return jsonb_build_object('current',r,'history',h,'month',m,'legal_entities',entities,
  'employee',jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id,
   'dated_legal_entity_id',(public.employee_employment_assignment_at(e.id,greatest(m,e.joined_date))).legal_entity_id),
  'fingerprint',md5(h::text||jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id)::text));
end $$;
revoke all on function public.payroll_lindung_setup_read(uuid,date) from public,anon;
grant execute on function public.payroll_lindung_setup_read(uuid,date) to authenticated;

create function public.payroll_lindung_setup_confirm(p_profile_id uuid,p_intent jsonb,p_fingerprint text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payroll_admin_actor(); e public.employees%rowtype;
 prior public.payroll_lindung_participation_versions%rowtype; retry public.payroll_lindung_participation_versions%rowtype;
 current_read jsonb; m date:=(p_intent->>'effective_month')::date; t timestamptz:=(p_intent->>'coverage_from')::timestamptz;
 d date:=(t at time zone 'Asia/Kuala_Lumpur')::date; status text:=p_intent->>'status'; worker text:=p_intent->>'worker_category';
 entity uuid:=nullif(p_intent->>'designated_legal_entity_id','')::uuid; external_name text:=nullif(btrim(p_intent->>'designated_employer_name'),'');
 basis text:=p_intent->>'participation_basis'; registration date:=nullif(p_intent->>'registration_date','')::date;
 reference text:=btrim(p_intent->>'source_reference'); reason text:=btrim(p_intent->>'reason');
 employment_entity uuid; rev integer; v_id uuid; fingerprint text:=md5(p_intent::text);
begin
 perform 1 from public.payroll_profiles where id=p_profile_id for update;
 select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
 if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.manage') then
  raise exception using errcode='42501',message='Payroll LINDUNG setup scope denied.'; end if;
 select * into retry from public.payroll_lindung_participation_versions where request_id=p_request_id;
 if retry.id is not null then
  if retry.profile_id<>p_profile_id or retry.payload_fingerprint<>fingerprint then
   raise exception using errcode='22023',message='A materially changed LINDUNG confirmation requires a new request.'; end if;
  return public.payroll_lindung_setup_read(p_profile_id,m);
 end if;
 employment_entity:=(public.employee_employment_assignment_at(e.id,d)).legal_entity_id;
 current_read:=public.payroll_lindung_setup_read(p_profile_id,m);
 if current_read->>'fingerprint' is distinct from p_fingerprint then
  raise exception using errcode='PT409',message='LINDUNG information was updated. Refresh setup.'; end if;
 if m is null or m<>date_trunc('month',m)::date or m<'2026-06-01' or t is null
  or date_trunc('month',d)::date<>m or t>clock_timestamp()
  or p_request_id is null or length(coalesce(reference,'')) not between 8 and 1000
  or length(coalesce(reason,'')) not between 3 and 1000
  or status is null or status not in ('mandatory','participating','valid_opt_out','another_designated_employer','unresolved')
  or worker is null or worker not in ('local','local_resident','foreign','unresolved') then
  raise exception using errcode='22023',message='Confirm the contribution month, effective date/time, status, evidence/reference and reason.'; end if;
 if status<>'unresolved' then
  if e.joined_date is null or d<e.joined_date then
   raise exception using errcode='22023',message='Verify Joined Date; LINDUNG evidence cannot precede employment.'; end if;
  if coalesce((p_intent->>'act4_covered')::boolean,false) is not true or worker='unresolved'
   or nullif(btrim(e.nationality),'') is null then
   raise exception using errcode='22023',message='Confirm Act 4-covered employment and worker category using evidence.'; end if;
  if (worker='local' and lower(e.nationality) not in ('malaysia','malaysian'))
   or (worker='foreign' and lower(e.nationality) in ('malaysia','malaysian')) then
   raise exception using errcode='22023',message='Worker category conflicts with canonical employee nationality.'; end if;
  if worker='local_resident' and coalesce((p_intent->>'residency_verified')::boolean,false) is not true then
   raise exception using errcode='22023',message='Permanent/temporary resident evidence is required.'; end if;
 end if;
 if worker='foreign' and status in ('participating','valid_opt_out') then
  raise exception using errcode='22023',message='Foreign workers require Mandatory participation or another designated employer.'; end if;
 if m='2026-06-01' and status not in ('mandatory','another_designated_employer','unresolved') then
  raise exception using errcode='22023',message='June 2026 contributions are mandatory; a later opt-out does not cancel June.'; end if;
 if status='mandatory' and worker in ('local','local_resident') and m<>'2026-06-01' then
  raise exception using errcode='22023',message='Confirm the local employee participation status for July onward.'; end if;
 if status in ('mandatory','participating') and entity is null then
  raise exception using errcode='22023',message='Designated contributing employer is missing.'; end if;
 if entity is not null and not public.payroll_can_manage_entity(entity,'payroll.manage') then
  raise exception using errcode='42501',message='Designated employer is outside Payroll manage scope.'; end if;
 if status='another_designated_employer' and (entity=employment_entity or (entity is null and external_name is null)) then
  raise exception using errcode='22023',message='Identify the other designated contributing employer using PERKESO evidence.'; end if;
 if status in ('mandatory','participating') and entity<>employment_entity then
  raise exception using errcode='22023',message='Use Another Designated Employer when this employer does not remit LINDUNG.'; end if;
 if status='valid_opt_out' then
  if worker not in ('local','local_resident') or d<'2026-07-08' or basis is distinct from 'opt_out' then
   raise exception using errcode='22023',message='A valid local PERKESO opt-out notice is required.'; end if;
  if d>'2026-08-31' and (registration is null or registration<='2026-07-08' or registration>d
   or nullif(p_intent->>'first_contribution_month','')::date is distinct from m or coalesce((p_intent->>'before_first_deduction')::boolean,false) is not true) then
   raise exception using errcode='22023',message='After August, opt-out requires new-registration evidence and notice before the first deduction.'; end if;
  if coalesce((p_intent->>'not_receiving_lindung_benefit')::boolean,false) is not true then
   raise exception using errcode='22023',message='Employees receiving LINDUNG benefits cannot opt out.'; end if;
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from<=t and v.status='participating'
    and (v.effective_month>='2026-09-01' or v.participation_basis='rejoin')) then
   raise exception using errcode='22023',message='Once In, Always In: this employee cannot opt out after confirmed continuing participation or rejoin.'; end if;
  -- Do not insert an opt-out before an already-confirmed continuing election.
  if exists(select 1 from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id
    and v.coverage_from>t and v.status='participating' and v.participation_basis<>'rejoin') then
   raise exception using errcode='22023',message='Historical opt-out conflicts with later participation evidence. Review the evidence chronology.'; end if;
 end if;
 select * into prior from public.payroll_lindung_participation_versions where profile_id=p_profile_id and coverage_from<=t
 order by effective_month desc,revision desc limit 1;
 if prior.status in ('mandatory','participating','another_designated_employer') and status in ('mandatory','participating','another_designated_employer')
  and (prior.designated_legal_entity_id is distinct from entity or coalesce(prior.designated_employer_name,'') is distinct from coalesce(external_name,''))
  and coalesce(p_intent->>'designation_change_reason','') not in ('resignation','business_ceased','dormant_no_salary','higher_salary') then
  raise exception using errcode='22023',message='Changing the designated employer requires PERKESO evidence of resignation, business cessation, no-salary dormancy or higher salary.'; end if;
 if status='participating' then
  if basis is null or basis not in ('default_enrolment','rejoin','new_registration') then
   raise exception using errcode='22023',message='Confirm default enrollment, new registration or PERKESO rejoin evidence.'; end if;
  if prior.status='valid_opt_out' and basis<>'rejoin' then
   raise exception using errcode='22023',message='Rejoining after opt-out requires the PERKESO submission date/time.'; end if;
  if basis='rejoin' and (prior.status is distinct from 'valid_opt_out' or
    nullif(p_intent->>'submission_at','')::timestamptz is distinct from t) then
   raise exception using errcode='22023',message='Record the prior valid opt-out and the exact PERKESO rejoin submission date/time.'; end if;
 end if;
 if basis is null or basis not in ('mandatory','default_enrolment','rejoin','new_registration','opt_out','employer_designation','unresolved') then
  raise exception using errcode='22023',message='Participation evidence basis is required.'; end if;
 if (status='mandatory' and basis<>'mandatory') or (status='another_designated_employer' and basis<>'employer_designation')
  or (status='unresolved' and basis<>'unresolved') then
  raise exception using errcode='22023',message='Participation evidence basis must match the confirmed status.'; end if;
 -- Serialize against Finalize; append-only setup never rewrites frozen results.
 perform 1 from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id
 where period.period_end>=m and exists(select 1 from public.payroll_run_profile_snapshots s where s.profile_id=p_profile_id and s.run_id=r.id)
 order by r.id for update of r;
 if exists(select 1 from public.payroll_run_statutory_snapshots s join public.payroll_runs r on r.id=s.run_id
   join public.payroll_periods period on period.id=r.period_id where s.employee_id=e.id and period.period_end>=m
   and not exists(select 1 from public.payroll_runs correction where correction.supersedes_run_id=r.id and correction.status not in ('finalized','paid'))) then
  raise exception using errcode='55000',message='Open a governed Payroll correction before confirming setup affecting finalized periods.'; end if;
 select coalesce(max(revision),0)+1 into rev from public.payroll_lindung_participation_versions where profile_id=p_profile_id and effective_month=m;
 select v.id into v_id from public.payroll_lindung_participation_versions v where v.profile_id=p_profile_id and v.effective_month=m order by v.revision desc limit 1;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_lindung_participation_versions(profile_id,effective_month,coverage_from,status,worker_category,
 designated_legal_entity_id,designated_employer_name,participation_basis,employee_evidence,supporting_evidence,source_reference,reason,
 revision,supersedes_id,request_id,payload_fingerprint,confirmed_by_employee_id)
 values(p_profile_id,m,t,status,worker,entity,external_name,basis,
 jsonb_build_object('nationality',e.nationality,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id),p_intent,
 reference,reason,rev,v_id,p_request_id,fingerprint,actor) returning payroll_lindung_participation_versions.id into v_id;
 insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
 values('lindung_participation_confirmed',p_profile_id,actor,reason,jsonb_build_object('participation_version_id',v_id,
 'effective_month',m,'status',status,'coverage_from',t,'designated_legal_entity_id',entity,'source_reference',reference));
 return public.payroll_lindung_setup_read(p_profile_id,m);
end $$;
revoke all on function public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid) to authenticated;

-- One Act 4 wage policy, independently assessed from the pinned earnings.
-- socso_treatment is the existing shared Act 4 remuneration inclusion policy,
-- not the SOCSO deduction or applicability. Pin each treatment as LINDUNG evidence.
create function public.payroll_lindung_wages(p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare line jsonb; component public.payroll_component_definitions%rowtype;
 treatment text; base numeric:=0; inputs jsonb:='[]'; issues text[]:='{}';
begin
 for line in select value from jsonb_array_elements(coalesce(p_lines,'[]')) loop
  treatment:=null; component:=null;
  if line->>'kind'='reimbursement' then treatment:='excluded';
  elsif line->>'kind'='deduction' and line->>'code'<>'unpaid_time' then treatment:='excluded';
  elsif line->>'code' in ('monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','unpaid_time') then treatment:='included';
  elsif line->'source'->>'component_definition_id' is not null then
   select * into component from public.payroll_component_definitions where id=(line->'source'->>'component_definition_id')::uuid;
   treatment:=component.socso_treatment;
  end if;
  if treatment is null or treatment='undetermined' then issues:=array_append(issues,'lindung_wage_treatment_unresolved:'||coalesce(line->>'code','unknown'));
  elsif treatment='included' then base:=base+case when line->>'kind'='deduction' then -1 else 1 end*(line->>'amount')::numeric;
  end if;
  inputs:=inputs||jsonb_build_array(jsonb_build_object('scheme','lindung','line_code',line->>'code','amount',line->'amount',
   'treatment',coalesce(treatment,'undetermined'),'source',line->'source','act4_component_policy',to_jsonb(component)));
 end loop;
 if base<0 then issues:=array_append(issues,'lindung_negative_wage_base'); end if;
 return jsonb_build_object('wage_base',base,'wage_base_lines',inputs,'issues',to_jsonb(issues),'policy','Act 4 section 2(24)');
end $$;
revoke all on function public.payroll_lindung_wages(jsonb) from public,anon,authenticated;

alter function public.payroll_statutory_project(uuid,uuid) rename to payroll_statutory_project_pre_lindung;
revoke all on function public.payroll_statutory_project_pre_lindung(uuid,uuid) from public,anon,authenticated;
create function public.payroll_statutory_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare project jsonb; inputs jsonb; state jsonb; wages jsonb; line jsonb; lines jsonb:='[]';
 issues text[]; profile uuid; period public.payroll_periods%rowtype; run public.payroll_runs%rowtype;
 calc public.payroll_run_calculation_versions%rowtype; pack public.payroll_statutory_schedule_versions%rowtype;
 band public.payroll_statutory_schedule_bands%rowtype; base numeric; employee_total numeric:=0; employer_total numeric:=0;
 employee_amount numeric; applicable boolean; lindung_line jsonb; frozen jsonb; status text;
begin
 select * into run from public.payroll_runs where id=p_run_id;
 if run.status in ('finalized','paid') then
  select s.result into frozen from public.payroll_run_statutory_snapshots s where s.run_id=p_run_id and s.employee_id=p_employee_id;
  if frozen is not null then return frozen; end if;
 end if;
 project:=public.payroll_statutory_project_pre_lindung(p_run_id,p_employee_id);
 inputs:=project->'inputs';
 select coalesce(array_agg(value),'{}') into issues from jsonb_array_elements_text(project->'issues');
 select id into profile from public.payroll_profiles where employee_id=p_employee_id;
 select * into period from public.payroll_periods where id=run.period_id;
 select * into calc from public.payroll_run_calculation_versions where id=(project->>'calculation_version_id')::uuid;
 state:=public.payroll_lindung_resolve(profile,period.period_start,period.legal_entity_id);
 applicable:=(state->>'applicable')::boolean;
 if state->>'issue' is not null then issues:=array_append(issues,state->>'issue'); end if;
 if applicable then
  wages:=public.payroll_lindung_wages(calc.lines); base:=(wages->>'wage_base')::numeric;
  issues:=issues||array(select jsonb_array_elements_text(wages->'issues'));
  select * into pack from public.payroll_statutory_schedule_versions where scheme='lindung'
   and effective_from<=period.period_start and (effective_to is null or effective_to>=period.period_end) order by effective_from desc limit 1;
  if pack.id is null then issues:=array_append(issues,'lindung_rate_pack_unavailable');
  elsif base=0 then employee_amount:=0;
  else
   select * into band from public.payroll_statutory_schedule_bands where schedule_version_id=pack.id
    and base>wage_above and (wage_through is null or base<=wage_through) order by wage_above limit 1;
   if band.id is null then issues:=array_append(issues,'lindung_official_band_unavailable');
   else employee_amount:=band.employee_amount; end if;
  end if;
 elsif applicable=false then employee_amount:=0;
 end if;
 lindung_line:=jsonb_build_object('scheme','lindung','applicable',applicable,'category',case when applicable then pack.category else null end,
  'participation_status',state->>'status','participation_version_id',state->'evidence'->>'id','coverage_from',state->'coverage_from',
  'designated_legal_entity_id',state->'evidence'->'designated_legal_entity_id','wage_base',base,
  'employee_amount',employee_amount,'employer_amount',0,'schedule_version_id',pack.id,'source_version',pack.source_version,
  'source_row',band.source_row,'band_id',band.id,'method','official_schedule');
 for line in select value from jsonb_array_elements(project->'lines') loop
  lines:=lines||jsonb_build_array(line);
  if line->>'scheme'='socso' then lines:=lines||jsonb_build_array(lindung_line); end if;
 end loop;
 inputs:=inputs||jsonb_build_object('lindung_participation',state,'lindung_wages',wages,'lindung_schedule',to_jsonb(pack),'lindung_band',to_jsonb(band));
 for line in select value from jsonb_array_elements(lines) loop
  if line->>'applicable'='true' then
   employee_total:=employee_total+coalesce((line->>'employee_amount')::numeric,0);
   employer_total:=employer_total+coalesce((line->>'employer_amount')::numeric,0)+coalesce((line->>'remittance_rounding')::numeric,0);
  end if;
 end loop;
 status:=case when cardinality(issues)=0 then 'ready' else 'review_required' end;
 return project||jsonb_build_object('inputs',inputs,'input_fingerprint',md5(inputs::text),'lines',lines,'issues',to_jsonb(issues),'status',status,
  'net_pay',case when status='ready' then calc.pre_statutory_pay-employee_total else null end,
  'employer_statutory_cost',case when status='ready' then employer_total else null end,
  'total_employer_cost',case when status='ready' then calc.gross_earnings+calc.reimbursements+employer_total else null end);
end $$;
revoke all on function public.payroll_statutory_project(uuid,uuid) from public,anon,authenticated;

-- Existing setup consumers, Profile summary and Run preparation receive one authority.
alter function public.payroll_statutory_setup_core(uuid,uuid,date,jsonb) rename to payroll_statutory_setup_core_pre_lindung;
revoke all on function public.payroll_statutory_setup_core_pre_lindung(uuid,uuid,date,jsonb) from public,anon,authenticated;
create function public.payroll_statutory_setup_core(p_employee_id uuid,p_profile_id uuid,p_date date,p_applicability jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; l jsonb;
begin
 r:=public.payroll_statutory_setup_core_pre_lindung(p_employee_id,p_profile_id,p_date,p_applicability);
 l:=public.payroll_lindung_resolve(p_profile_id,p_date);
 return r||jsonb_build_object('schemes',(r->'schemes')||jsonb_build_object('lindung',l),
  'complete',(r->>'complete')::boolean and l->>'issue' is null);
end $$;
revoke all on function public.payroll_statutory_setup_core(uuid,uuid,date,jsonb) from public,anon,authenticated;

create or replace function public.payroll_statutory_setup_summary(p_profile_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare current_result jsonb; display_schemes jsonb; future_result jsonb; s text; d date; state jsonb;
  scheduled boolean:=false; needs_setup boolean:=false; needs_confirmation boolean:=false;
begin
  current_result:=public.payroll_statutory_setup_resolve(p_profile_id,p_date,null);
  display_schemes:=current_result->'schemes';
  foreach s in array array['epf','socso','lindung','eis','pcb'] loop
    state:=display_schemes->s;
    for d in select effective_from from (
      select effective_from from public.payroll_statutory_profile_versions where profile_id=p_profile_id
      union select effective_from from public.payroll_statutory_input_versions where profile_id=p_profile_id
    ) dates where effective_from>p_date order by effective_from loop
      future_result:=public.payroll_statutory_setup_resolve(p_profile_id,d,null);
      if future_result->'schemes'->s->>'state' in ('confirmed','not_applicable')
        and (future_result->'schemes'->s->>'category' is distinct from state->>'category'
          or future_result->'schemes'->s->>'applicable' is distinct from state->>'applicable'
          or state->>'state' not in ('confirmed','not_applicable')) then
        state:=(future_result->'schemes'->s)||jsonb_build_object('state','scheduled','effective_from',d,'current',current_result->'schemes'->s);
        scheduled:=true;
        exit;
      end if;
    end loop;
    needs_setup:=needs_setup or state->>'state'='setup_required';
    needs_confirmation:=needs_confirmation or state->>'state'='confirmation_required';
    display_schemes:=jsonb_set(display_schemes,array[s],state);
  end loop;
  return current_result||jsonb_build_object('display_schemes',display_schemes,'status',
    case when needs_setup then 'Setup Required' when needs_confirmation then 'Confirmation Required'
      when scheduled then 'Scheduled Change' else 'Complete' end);
end; $$;
revoke all on function public.payroll_statutory_setup_summary(uuid,date) from public,anon,authenticated;

