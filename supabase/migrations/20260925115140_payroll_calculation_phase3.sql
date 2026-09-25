-- Payroll Phase 3: pre-statutory RM calculation. No statutory amounts, net pay,
-- payslip, settlement, or Finance posting is produced by this authority.
-- Premium and proration policies are deliberately not guessed or seeded.

create table public.payroll_pay_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null check (rule_code in
    ('monthly_basic','regular','overtime','rest_day','public_holiday',
     'public_holiday_ot','unpaid_time','non_payable')),
  pay_basis text not null check (pay_basis in ('monthly','hourly')),
  effective_from date not null,
  multiplier numeric(10,4) not null check (multiplier >= 0 and multiplier <= 10),
  monthly_divisor_minutes integer check (monthly_divisor_minutes > 0),
  source_note text not null check (char_length(btrim(source_note)) between 8 and 1000),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (rule_code,pay_basis,effective_from),
  check ((pay_basis='hourly' and monthly_divisor_minutes is null)
    or (pay_basis='monthly' and
      ((rule_code in ('monthly_basic','non_payable') and monthly_divisor_minutes is null)
       or (rule_code not in ('monthly_basic','non_payable') and monthly_divisor_minutes is not null))))
);
create index payroll_rules_effective_idx on public.payroll_pay_rule_versions
  (rule_code,pay_basis,effective_from desc);

alter table public.payroll_events
  add column rule_version_id uuid references public.payroll_pay_rule_versions(id) on delete restrict;
alter table public.payroll_events drop constraint payroll_events_check;
alter table public.payroll_events add constraint payroll_events_check
  check (num_nonnulls(profile_id,run_id,holiday_id,component_id,rule_version_id)=1);

-- Only identity arithmetic is pre-approved. A premium or monthly deduction
-- requires a separately sourced and published rule before any RM is computed.
insert into public.payroll_pay_rule_versions
  (rule_code,pay_basis,effective_from,multiplier,source_note,reason,approved_by_employee_id)
select seed.rule_code,seed.pay_basis,date '2000-01-01',seed.multiplier,
  'Arithmetic identity only; no Malaysian premium or proration rate is asserted.',
  'Phase 3 canonical baseline',actor.id
from (values ('monthly_basic','monthly',1::numeric),('regular','hourly',1::numeric),
  ('non_payable','monthly',0::numeric),('non_payable','hourly',0::numeric))
  as seed(rule_code,pay_basis,multiplier)
cross join lateral (
  select e.id from public.employees e join public.roles r on r.id=e.role_id
  where lower(r.name)='owner' and e.is_active order by e.created_at limit 1
) actor;

create table public.payroll_run_component_adjustments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  component_id uuid references public.payroll_component_definitions(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  reverses_id uuid unique references public.payroll_run_component_adjustments(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check ((reverses_id is null and component_id is not null and amount > 0)
    or (reverses_id is not null and component_id is null and amount = 0))
);
create index payroll_adjustments_run_employee_idx on public.payroll_run_component_adjustments(run_id,employee_id);

create table public.payroll_run_calculation_versions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  revision integer not null check (revision > 0),
  supersedes_id uuid references public.payroll_run_calculation_versions(id) on delete restrict,
  input_fingerprint text not null,
  status text not null check (status in ('ready','review_required')),
  pay_basis text check (pay_basis in ('monthly','hourly')),
  currency text not null default 'MYR' check (currency='MYR'),
  basic_or_hours text,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines)='array'),
  issues text[] not null default '{}',
  inputs jsonb not null,
  gross_earnings numeric(14,2) not null default 0,
  non_statutory_deductions numeric(14,2) not null default 0,
  reimbursements numeric(14,2) not null default 0,
  pre_statutory_pay numeric(14,2) not null default 0,
  calculated_by_employee_id uuid not null references public.employees(id) on delete restrict,
  calculated_at timestamptz not null default clock_timestamp(),
  unique (run_id,employee_id,revision),
  check ((status='ready')=(cardinality(issues)=0))
);
create index payroll_calc_run_latest_idx on public.payroll_run_calculation_versions
  (run_id,employee_id,revision desc);

create table public.payroll_run_calculation_snapshots (
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  calculation_version_id uuid not null unique references public.payroll_run_calculation_versions(id) on delete restrict,
  calculation jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id,employee_id)
);

do $$ declare t text; begin
  foreach t in array array[
    'payroll_pay_rule_versions','payroll_run_component_adjustments',
    'payroll_run_calculation_versions','payroll_run_calculation_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create trigger payroll_command_guard before insert or update or delete on public.%I for each row execute function public.payroll_command_guard()',t);
  end loop;
end $$;

create or replace function public.payroll_command_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Payroll records require the canonical command authority.';
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Payroll history cannot be deleted.';
  end if;
  if tg_op='UPDATE' and tg_table_name in
    ('payroll_compensation_versions','payroll_recurring_component_versions',
     'payroll_statutory_profile_versions','payroll_run_profile_snapshots','payroll_events',
     'payroll_payable_time_versions','payroll_run_time_snapshots',
     'payroll_pay_rule_versions','payroll_run_component_adjustments',
     'payroll_run_calculation_versions','payroll_run_calculation_snapshots') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
    raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_run_employee_ids(p_run_id uuid)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select e.id from public.employees e join public.payroll_runs r on r.id=p_run_id
    join public.payroll_periods period on period.id=r.period_id
    where e.legal_entity_id=period.legal_entity_id
  union
  select p.employee_id from public.payroll_profiles p
    join public.payroll_compensation_versions c on c.profile_id=p.id
    join public.payroll_runs r on r.id=p_run_id
    join public.payroll_periods period on period.id=r.period_id
    where c.legal_entity_id=period.legal_entity_id
      and c.effective_from<=period.period_end;
$$;

create or replace function public.payroll_run_calculate(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_projection jsonb;
  v_latest public.payroll_run_calculation_versions%rowtype;
  v_created integer:=0; v_unchanged integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open calculation Run can be recalculated.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) order by employee_id loop
    v_projection:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    if v_latest.id is not null and v_latest.input_fingerprint=v_projection->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_calculation_versions
      (run_id,employee_id,revision,supersedes_id,input_fingerprint,status,pay_basis,
       basic_or_hours,lines,issues,inputs,gross_earnings,non_statutory_deductions,
       reimbursements,pre_statutory_pay,calculated_by_employee_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      v_projection->>'input_fingerprint',v_projection->>'status',v_projection->>'pay_basis',
      v_projection->>'basic_or_hours',v_projection->'lines',
      array(select jsonb_array_elements_text(v_projection->'issues')),
      v_projection->'inputs',(v_projection->>'gross_earnings')::numeric,
      (v_projection->>'non_statutory_deductions')::numeric,
      (v_projection->>'reimbursements')::numeric,
      (v_projection->>'pre_statutory_pay')::numeric,v_actor);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
    values('run_calculated',p_run_id,v_actor,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
end; $$;

create or replace function public.payroll_run_calculation_readiness(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee_id uuid; v_project jsonb; v_latest public.payroll_run_calculation_versions%rowtype;
  v_count integer:=0; v_missing integer:=0; v_review integer:=0; v_stale integer:=0;
  v_in_progress boolean;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) loop
    v_count:=v_count+1;
    v_project:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1;
    if v_latest.id is null then v_missing:=v_missing+1;
    elsif v_latest.input_fingerprint is distinct from v_project->>'input_fingerprint' then v_stale:=v_stale+1;
    elsif v_latest.status='review_required' then v_review:=v_review+1;
    end if;
  end loop;
  v_in_progress:=v_period.period_end>=timezone('Asia/Kuala_Lumpur',now())::date;
  return jsonb_build_object('ready',v_count>0 and v_missing=0 and v_review=0
      and v_stale=0 and not v_in_progress,
    'employees',v_count,'uncalculated',v_missing,'review_required',v_review,
    'stale',v_stale,'period_in_progress',v_in_progress);
end; $$;

create or replace function public.payroll_run_calculation_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_rows jsonb; v_adjustments jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'employee_id',e.id,'employee_name',e.full_name,'employee_code',e.employee_code,
    'revision',c.revision,'pay_basis',c.pay_basis,'basic_or_hours',c.basic_or_hours,
    'status',c.status,'issues',to_jsonb(c.issues),'lines',c.lines,'inputs',c.inputs,
    'is_stale',c.input_fingerprint is distinct from
      (public.payroll_calculation_project(p_run_id,c.employee_id)->>'input_fingerprint'),
    'gross_earnings',c.gross_earnings,'non_statutory_deductions',c.non_statutory_deductions,
    'reimbursements',c.reimbursements,'pre_statutory_pay',c.pre_statutory_pay,
    'calculated_at',c.calculated_at) order by e.full_name),'[]'::jsonb) into v_rows
  from public.payroll_run_calculation_versions c join public.employees e on e.id=c.employee_id
  where c.run_id=p_run_id and not exists(select 1 from public.payroll_run_calculation_versions newer
    where newer.run_id=c.run_id and newer.employee_id=c.employee_id and newer.revision>c.revision);
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,
    'component_id',a.component_id,'component_name',d.name,'component_type',d.component_type,
    'amount',a.amount,'reason',a.reason,'created_at',a.created_at) order by a.created_at),'[]'::jsonb)
    into v_adjustments
  from public.payroll_run_component_adjustments a
    join public.payroll_component_definitions d on d.id=a.component_id
  where a.run_id=p_run_id and a.reverses_id is null
    and not exists(select 1 from public.payroll_run_component_adjustments reverse where reverse.reverses_id=a.id);
  return jsonb_build_object('results',v_rows,'adjustments',v_adjustments,
    'readiness',public.payroll_run_calculation_readiness(p_run_id));
end; $$;

create or replace function public.payroll_rule_read()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rule_code,r.pay_basis,r.effective_from desc),'[]'::jsonb)
    into v_rows from public.payroll_pay_rule_versions r;
  return v_rows;
end; $$;

create or replace function public.payroll_calculation_run_gate()
returns trigger language plpgsql set search_path=public as $$
declare v_readiness jsonb;
begin
  if new.status in ('ready','finalized') and old.status is distinct from new.status
    and not new.foundation_only then
    v_readiness:=public.payroll_run_calculation_readiness(new.id);
    if not (v_readiness->>'ready')::boolean then
      raise exception using errcode='55000',message='Payroll calculation requires review or recalculation.',
        detail=v_readiness::text;
    end if;
  end if;
  return new;
end; $$;
create trigger payroll_calculation_run_gate before update on public.payroll_runs
  for each row execute function public.payroll_calculation_run_gate();

create or replace function public.payroll_calculation_snapshot_finalized_run()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='finalized' and old.status is distinct from new.status and not new.foundation_only then
    insert into public.payroll_run_calculation_snapshots
      (run_id,employee_id,calculation_version_id,calculation)
    select new.id,c.employee_id,c.id,to_jsonb(c)
    from public.payroll_run_calculation_versions c
    join public.payroll_run_employee_ids(new.id) member on member.employee_id=c.employee_id
    where c.run_id=new.id and c.status='ready'
      and not exists(select 1 from public.payroll_run_calculation_versions later
        where later.run_id=c.run_id and later.employee_id=c.employee_id and later.revision>c.revision);
  end if;
  return new;
end; $$;
create trigger payroll_calculation_snapshot_finalized_run after update on public.payroll_runs
  for each row execute function public.payroll_calculation_snapshot_finalized_run();

create or replace function public.payroll_run_component_add(
  p_request_id uuid,p_run_id uuid,p_employee_id uuid,p_component_id uuid,
  p_amount numeric,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_component public.payroll_component_definitions%rowtype;
  v_existing public.payroll_run_component_adjustments%rowtype;
begin
  if p_request_id is null then raise exception using errcode='22023',message='Request identity is required.'; end if;
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll adjustment authority denied.';
  end if;
  select * into v_existing from public.payroll_run_component_adjustments where id=p_request_id;
  if v_existing.id is not null then
    if v_existing.run_id=p_run_id and v_existing.employee_id=p_employee_id
      and v_existing.component_id=p_component_id and v_existing.amount=p_amount
      and v_existing.reason=btrim(p_reason) and v_existing.reverses_id is null then
      return v_existing.id;
    end if;
    raise exception using errcode='23505',message='Request identity was already used for another adjustment.';
  end if;
  if v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Adjustments require an open Draft or Review Required Run.';
  end if;
  select * into v_component from public.payroll_component_definitions where id=p_component_id and is_active;
  if v_component.id is null or v_component.component_type not in
    ('earning','allowance','deduction','reimbursement') or coalesce(p_amount,0)<=0
    or char_length(btrim(coalesce(p_reason,'')))<3
    or (not exists(select 1 from public.employees e where e.id=p_employee_id
      and e.legal_entity_id=v_period.legal_entity_id)
      and not exists(select 1 from public.payroll_profiles p
        join public.payroll_compensation_versions c on c.profile_id=p.id
        where p.employee_id=p_employee_id and c.legal_entity_id=v_period.legal_entity_id
          and c.effective_from<=v_period.period_end)) then
    raise exception using errcode='22023',message='Reviewed component, amount, employee and reason are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_component_adjustments
    (id,run_id,employee_id,component_id,amount,reason,actor_employee_id)
  values(p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,btrim(p_reason),v_actor);
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('run_component_added',p_run_id,v_actor,btrim(p_reason),
    jsonb_build_object('adjustment_id',p_request_id,'employee_id',p_employee_id,
      'component_id',p_component_id,'amount',p_amount));
  return p_request_id;
end; $$;

create or replace function public.payroll_run_component_reverse(
  p_request_id uuid,p_adjustment_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_source public.payroll_run_component_adjustments%rowtype;
  v_existing public.payroll_run_component_adjustments%rowtype;
  v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
begin
  if p_request_id is null then raise exception using errcode='22023',message='Request identity is required.'; end if;
  select * into v_source from public.payroll_run_component_adjustments
    where id=p_adjustment_id and reverses_id is null for update;
  if v_source.id is null then raise exception using errcode='P0002',message='Payroll adjustment not found.'; end if;
  select * into v_run from public.payroll_runs where id=v_source.run_id for update;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_employee(v_source.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll adjustment authority denied.';
  end if;
  select * into v_existing from public.payroll_run_component_adjustments where id=p_request_id;
  if v_existing.id is not null then
    if v_existing.reverses_id=p_adjustment_id and v_existing.reason=btrim(p_reason) then
      return v_existing.id;
    end if;
    raise exception using errcode='23505',message='Request identity was already used.';
  end if;
  if v_run.status not in ('draft','review_required')
    or char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='55000',message='Only an open Run adjustment may be reversed with a reason.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_component_adjustments
    (id,run_id,employee_id,amount,reverses_id,reason,actor_employee_id)
  values(p_request_id,v_source.run_id,v_source.employee_id,0,p_adjustment_id,btrim(p_reason),v_actor);
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('run_component_reversed',v_source.run_id,v_actor,btrim(p_reason),
    jsonb_build_object('adjustment_id',p_adjustment_id,'reversal_id',p_request_id));
  return p_request_id;
end; $$;

-- Existing finalized foundation runs stay readable and unchanged. Open runs
-- are drafts/review evidence and are upgraded to the calculation contract.
alter table public.payroll_runs drop constraint payroll_runs_foundation_only_check;
alter table public.payroll_runs alter column foundation_only set default false;
select set_config('feedx.payroll_command','yes',false);
update public.payroll_runs set foundation_only=false
  where status in ('draft','review_required','ready') and foundation_only;
select set_config('feedx.payroll_command','',false);

create or replace function public.payroll_rule_publish(
  p_rule_code text,p_pay_basis text,p_effective_from date,p_multiplier numeric,
  p_monthly_divisor_minutes integer,p_source_note text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_id uuid; v_latest date;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Payroll rule authority required.';
  end if;
  select max(effective_from) into v_latest from public.payroll_pay_rule_versions
    where rule_code=p_rule_code and pay_basis=p_pay_basis;
  if p_effective_from is null or (v_latest is not null and p_effective_from<=v_latest)
    or p_rule_code not in ('monthly_basic','regular','overtime','rest_day',
      'public_holiday','public_holiday_ot','unpaid_time','non_payable')
    or p_pay_basis not in ('monthly','hourly')
    or coalesce(p_multiplier,-1)<0 or p_multiplier>10
    or char_length(btrim(coalesce(p_source_note,'')))<8
    or char_length(btrim(coalesce(p_reason,'')))<3
    or (p_pay_basis='hourly' and p_monthly_divisor_minutes is not null)
    or (p_rule_code in ('monthly_basic','regular') and p_multiplier<>1)
    or (p_rule_code='non_payable' and p_multiplier<>0)
    or (p_pay_basis='monthly' and ((p_rule_code in ('monthly_basic','non_payable') and p_monthly_divisor_minutes is not null)
      or (p_rule_code not in ('monthly_basic','non_payable') and coalesce(p_monthly_divisor_minutes,0)<=0))) then
    raise exception using errcode='22023',message='A later effective date and sourced, reviewed rule are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_pay_rule_versions
    (rule_code,pay_basis,effective_from,multiplier,monthly_divisor_minutes,
     source_note,reason,approved_by_employee_id)
  values(p_rule_code,p_pay_basis,p_effective_from,p_multiplier,p_monthly_divisor_minutes,
    btrim(p_source_note),btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,rule_version_id,actor_employee_id,reason,details)
    values('pay_rule_published',v_id,v_actor,btrim(p_reason),
      jsonb_build_object('rule_version_id',v_id,'rule_code',p_rule_code,'pay_basis',p_pay_basis));
  return v_id;
end; $$;

-- Pure pricing helper. A missing rule returns NULL and the caller records
-- Review Required. Amounts are rounded per source time line, never in UI.
create or replace function public.payroll_price_time(
  p_compensation_version_id uuid,p_time_version_id uuid,p_rule_code text,
  p_minutes integer,p_work_date date
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_comp public.payroll_compensation_versions%rowtype;
  v_rule public.payroll_pay_rule_versions%rowtype; v_amount numeric(14,2);
  v_rate numeric; v_kind text;
begin
  if p_minutes is null or p_minutes<0 or p_work_date is null then return null; end if;
  select * into v_comp from public.payroll_compensation_versions where id=p_compensation_version_id;
  if v_comp.id is null or v_comp.currency<>'MYR' then return null; end if;
  select * into v_rule from public.payroll_pay_rule_versions
    where rule_code=p_rule_code and pay_basis=v_comp.pay_basis and effective_from<=p_work_date
    order by effective_from desc limit 1;
  if v_rule.id is null or (v_comp.pay_basis='monthly' and v_rule.monthly_divisor_minutes is null) then
    return null;
  end if;
  v_rate:=case when v_comp.pay_basis='hourly' then v_comp.hourly_rate/60
    else v_comp.basic_salary/v_rule.monthly_divisor_minutes end;
  v_amount:=round(p_minutes*v_rate*v_rule.multiplier,2);
  v_kind:=case when p_rule_code='unpaid_time' then 'deduction' else 'earning' end;
  return jsonb_build_object('kind',v_kind,'code',p_rule_code,
    'label',replace(initcap(replace(p_rule_code,'_',' ')),' Ot',' OT'),
    'minutes',p_minutes,'rate_per_minute',round(v_rate,8),
    'multiplier',v_rule.multiplier,'amount',v_amount,
    'source',jsonb_build_object('compensation_version_id',v_comp.id,
      'time_version_id',p_time_version_id,'rule_version_id',v_rule.id,
      'rule_effective_from',v_rule.effective_from,'rule_source',v_rule.source_note,
      'work_date',p_work_date));
end; $$;

create or replace function public.payroll_calculation_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee public.employees%rowtype; v_profile public.payroll_profiles%rowtype;
  v_first public.payroll_compensation_versions%rowtype;
  v_last public.payroll_compensation_versions%rowtype;
  v_day_comp public.payroll_compensation_versions%rowtype;
  v_time public.payroll_payable_time_versions%rowtype;
  v_component public.payroll_component_definitions%rowtype;
  v_recurring public.payroll_recurring_component_versions%rowtype;
  v_rule public.payroll_pay_rule_versions%rowtype;
  v_day date; v_source jsonb; v_line jsonb; v_lines jsonb:='[]'::jsonb;
  v_inputs jsonb; v_issues text[]:='{}'; v_gross numeric(14,2):=0;
  v_deductions numeric(14,2):=0; v_reimbursements numeric(14,2):=0;
  v_regular_minutes integer:=0; v_billable_minutes integer; v_rule_code text;
  v_component_id uuid; v_change_count integer; v_status text; v_basis text;
  v_detail text; v_adjustment record;
begin
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_run.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll Run or employee not found.';
  end if;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  v_inputs:=jsonb_build_object('period_id',v_period.id,'employee_id',p_employee_id,
    'legal_entity_id',v_period.legal_entity_id,'joined_date',v_employee.joined_date,
    'resigned_date',v_employee.resigned_date,'employment_status',v_employee.employment_status,
    'time',jsonb_build_array(),'components',jsonb_build_array(),'rules',jsonb_build_array(),
    'rule_catalog',coalesce((select jsonb_agg(to_jsonb(rule) order by rule.rule_code,rule.pay_basis,rule.effective_from)
      from public.payroll_pay_rule_versions rule where rule.effective_from<=v_period.period_end),'[]'::jsonb));
  if v_profile.id is null then
    v_issues:=array_append(v_issues,'missing_payroll_profile');
  else
    select * into v_first from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_start
      order by effective_from desc limit 1;
    select * into v_last from public.payroll_compensation_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end
      order by effective_from desc limit 1;
    v_inputs:=v_inputs || jsonb_build_object('profile_id',v_profile.id,
      'compensation_start',to_jsonb(v_first),'compensation_end',to_jsonb(v_last));
    if v_first.id is null or v_last.id is null then
      v_issues:=array_append(v_issues,'missing_effective_compensation_or_proration_policy');
    elsif v_first.legal_entity_id<>v_period.legal_entity_id or v_last.legal_entity_id<>v_period.legal_entity_id then
      v_issues:=array_append(v_issues,'legal_employer_change_requires_review');
    end if;
    if v_first.id is not null then
      v_basis:=v_first.pay_basis;
      if v_first.currency<>'MYR' then v_issues:=array_append(v_issues,'non_myr_currency_requires_review'); end if;
      if v_first.id is distinct from v_last.id and v_first.pay_basis='monthly' then
        v_issues:=array_append(v_issues,'monthly_rate_change_requires_proration_policy');
      end if;
      if v_first.pay_basis='monthly' then
        if v_employee.joined_date is null or v_employee.joined_date>v_period.period_start
          or (v_employee.resigned_date is not null and v_employee.resigned_date<=v_period.period_end) then
          v_issues:=array_append(v_issues,'partial_month_requires_approved_proration');
        end if;
        select * into v_rule from public.payroll_pay_rule_versions
          where rule_code='monthly_basic' and pay_basis='monthly'
            and effective_from<=v_period.period_start order by effective_from desc limit 1;
        if v_rule.id is null then v_issues:=array_append(v_issues,'missing_monthly_basic_rule');
        elsif v_first.id=v_last.id and v_first.currency='MYR'
          and v_employee.joined_date<=v_period.period_start
          and (v_employee.resigned_date is null or v_employee.resigned_date>v_period.period_end) then
          v_line:=jsonb_build_object('kind','earning','code','monthly_basic',
            'label','Basic Salary','amount',v_first.basic_salary,
            'source',jsonb_build_object('compensation_version_id',v_first.id,
              'rule_version_id',v_rule.id,'rule_source',v_rule.source_note,
              'period_start',v_period.period_start,'period_end',v_period.period_end));
          v_lines:=v_lines||jsonb_build_array(v_line); v_gross:=v_gross+v_first.basic_salary;
          v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||to_jsonb(v_rule.id));
        end if;
      end if;
    end if;
  end if;

  -- A time result is counted only when it is the latest approved decision for
  -- the same current source fingerprint. A changed source never stays payable.
  if v_profile.id is not null then
    for v_day in select generate_series(v_period.period_start,v_period.period_end,interval '1 day')::date loop
      v_source:=public.payroll_time_evidence(p_employee_id,v_day);
      if v_source is null or v_source->>'legal_entity_id' is distinct from v_period.legal_entity_id::text then
        continue;
      end if;
      select * into v_day_comp from public.payroll_compensation_versions
        where profile_id=v_profile.id and effective_from<=v_day order by effective_from desc limit 1;
      select * into v_time from public.payroll_payable_time_versions
        where profile_id=v_profile.id and work_date=v_day order by revision desc limit 1;
      v_inputs:=jsonb_set(v_inputs,'{time}',v_inputs->'time'||jsonb_build_array(
        jsonb_build_object('date',v_day,'source_fingerprint',v_source->>'source_fingerprint',
          'time_version_id',v_time.id,'time_status',v_time.status,
          'compensation_version_id',v_day_comp.id)));
      if v_day_comp.id is null or v_day_comp.legal_entity_id<>v_period.legal_entity_id
        or v_first.id is null or v_day_comp.pay_basis<>v_first.pay_basis
        or v_day_comp.currency<>'MYR' then
        v_issues:=array_append(v_issues,'missing_or_changed_daily_compensation:'||v_day);
        continue;
      end if;
      if v_time.id is null then
        v_issues:=array_append(v_issues,'unreconciled_time:'||v_day); continue;
      end if;
      if v_time.source_fingerprint is distinct from v_source->>'source_fingerprint' then
        v_issues:=array_append(v_issues,'stale_time_evidence:'||v_day); continue;
      end if;
      if v_time.status='review_required' then
        v_issues:=array_append(v_issues,'unresolved_time_exception:'||v_day); continue;
      end if;
      if v_time.classification='leave' then
        if v_basis='hourly' then v_issues:=array_append(v_issues,'paid_leave_pay_rule_required:'||v_day); end if;
        continue;
      end if;
      if v_time.classification='non_payable' then
        select * into v_rule from public.payroll_pay_rule_versions
          where rule_code='non_payable' and pay_basis=v_basis and effective_from<=v_day
          order by effective_from desc limit 1;
        if v_rule.id is null then v_issues:=array_append(v_issues,'missing_non_payable_rule:'||v_day);
        else v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||to_jsonb(v_rule.id)); end if;
        if v_basis='monthly' and coalesce(v_time.scheduled_minutes,0)>0 then
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'unpaid_time',v_time.scheduled_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_unpaid_time_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_deductions:=v_deductions+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
        continue;
      end if;

      -- Regular Monthly time is already covered by Basic Salary, but an
      -- approved deficit needs a sourced unpaid-time rule and approved extra
      -- minutes need a sourced premium rule.
      if v_basis='monthly' and v_time.classification='regular' then
        v_billable_minutes:=greatest(0,coalesce(v_time.scheduled_minutes,0)-coalesce(v_time.approved_minutes,0));
        if v_billable_minutes>0 then
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,'unpaid_time',v_billable_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_unpaid_time_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_deductions:=v_deductions+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
      else
        v_rule_code:=case when v_time.classification='regular' then 'regular'
          else v_time.classification end;
        v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,v_rule_code,
          coalesce(v_time.approved_minutes,0),v_day);
        if v_line is null then v_issues:=array_append(v_issues,'missing_'||v_rule_code||'_rule:'||v_day);
        else v_lines:=v_lines||jsonb_build_array(v_line);
          v_gross:=v_gross+(v_line->>'amount')::numeric;
          v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          if v_rule_code='regular' then v_regular_minutes:=v_regular_minutes+coalesce(v_time.approved_minutes,0); end if;
        end if;
      end if;
      if coalesce(v_time.approved_extra_minutes,0)>0 then
        v_rule_code:=case v_time.classification when 'regular' then 'overtime'
          when 'public_holiday' then 'public_holiday_ot' else null end;
        if v_rule_code is null then v_issues:=array_append(v_issues,'extra_time_policy_required:'||v_day);
        else
          v_line:=public.payroll_price_time(v_day_comp.id,v_time.id,v_rule_code,
            v_time.approved_extra_minutes,v_day);
          if v_line is null then v_issues:=array_append(v_issues,'missing_'||v_rule_code||'_rule:'||v_day);
          else v_lines:=v_lines||jsonb_build_array(v_line);
            v_gross:=v_gross+(v_line->>'amount')::numeric;
            v_inputs:=jsonb_set(v_inputs,'{rules}',v_inputs->'rules'||jsonb_build_array(v_line->'source'->>'rule_version_id'));
          end if;
        end if;
      end if;
    end loop;

    -- Fixed recurring components are only unambiguous if one assignment
    -- applies for the whole period. Mid-period changes need a reviewed policy.
    for v_component_id in select distinct component_id from public.payroll_recurring_component_versions
      where profile_id=v_profile.id and effective_from<=v_period.period_end loop
      select * into v_recurring from public.payroll_recurring_component_versions
        where profile_id=v_profile.id and component_id=v_component_id
          and effective_from<=v_period.period_start order by effective_from desc limit 1;
      select count(*) into v_change_count from public.payroll_recurring_component_versions
        where profile_id=v_profile.id and component_id=v_component_id
          and effective_from>v_period.period_start and effective_from<=v_period.period_end;
      if v_change_count>0 then
        v_issues:=array_append(v_issues,'mid_period_component_change:'||v_component_id); continue;
      end if;
      if v_recurring.id is null or not v_recurring.is_active then continue; end if;
      select * into v_component from public.payroll_component_definitions where id=v_component_id;
      v_line:=jsonb_build_object('kind',case v_component.component_type
          when 'deduction' then 'deduction' when 'reimbursement' then 'reimbursement' else 'earning' end,
        'code',v_component.code,'label',v_component.name,'amount',v_recurring.amount,
        'source',jsonb_build_object('component_definition_id',v_component.id,
          'component_version_id',v_recurring.id,'effective_from',v_recurring.effective_from));
      v_lines:=v_lines||jsonb_build_array(v_line);
      if v_component.component_type='deduction' then v_deductions:=v_deductions+v_recurring.amount;
      elsif v_component.component_type='reimbursement' then v_reimbursements:=v_reimbursements+v_recurring.amount;
      else v_gross:=v_gross+v_recurring.amount; end if;
      v_inputs:=jsonb_set(v_inputs,'{components}',v_inputs->'components'||jsonb_build_array(
        jsonb_build_object('version_id',v_recurring.id,'definition',to_jsonb(v_component))));
    end loop;
  end if;

  for v_adjustment in select a.id,a.component_id,a.amount from public.payroll_run_component_adjustments a
    where a.run_id=p_run_id and a.employee_id=p_employee_id and a.reverses_id is null
      and not exists(select 1 from public.payroll_run_component_adjustments reversal
        where reversal.reverses_id=a.id) order by a.created_at,a.id loop
    select * into v_component from public.payroll_component_definitions where id=v_adjustment.component_id;
    v_line:=jsonb_build_object('kind',case v_component.component_type
        when 'deduction' then 'deduction' when 'reimbursement' then 'reimbursement' else 'earning' end,
      'code',v_component.code,'label',v_component.name,'amount',v_adjustment.amount,
      'source',jsonb_build_object('run_adjustment_id',v_adjustment.id,
        'component_definition_id',v_component.id));
    v_lines:=v_lines||jsonb_build_array(v_line);
    if v_component.component_type='deduction' then v_deductions:=v_deductions+v_adjustment.amount;
    elsif v_component.component_type='reimbursement' then v_reimbursements:=v_reimbursements+v_adjustment.amount;
    else v_gross:=v_gross+v_adjustment.amount; end if;
    v_inputs:=jsonb_set(v_inputs,'{components}',v_inputs->'components'||jsonb_build_array(
      jsonb_build_object('adjustment_id',v_adjustment.id,'definition',to_jsonb(v_component))));
  end loop;
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  v_detail:=case when v_basis='monthly' then 'Basic '||coalesce(v_first.basic_salary::text,'—')
    when v_basis='hourly' then round(v_regular_minutes::numeric/60,2)::text||' regular hours'
    else null end;
  return jsonb_build_object('employee_id',p_employee_id,'profile_id',v_profile.id,
    'employee_name',v_employee.full_name,'employee_code',v_employee.employee_code,
    'pay_basis',v_basis,'basic_or_hours',v_detail,'currency','MYR',
    'status',v_status,'issues',to_jsonb(v_issues),'lines',v_lines,
    'gross_earnings',v_gross,'non_statutory_deductions',v_deductions,
    'reimbursements',v_reimbursements,'pre_statutory_pay',v_gross-v_deductions+v_reimbursements,
    'inputs',v_inputs,'input_fingerprint',md5(v_inputs::text));
end; $$;

revoke all on function public.payroll_run_employee_ids(uuid) from public,anon,authenticated;
revoke all on function public.payroll_price_time(uuid,uuid,text,integer,date) from public,anon,authenticated;
revoke all on function public.payroll_calculation_project(uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_calculation_run_gate() from public,anon,authenticated;
revoke all on function public.payroll_calculation_snapshot_finalized_run() from public,anon,authenticated;
revoke all on function public.payroll_run_component_add(uuid,uuid,uuid,uuid,numeric,text) from public,anon;
revoke all on function public.payroll_run_component_reverse(uuid,uuid,text) from public,anon;
revoke all on function public.payroll_rule_publish(text,text,date,numeric,integer,text,text) from public,anon;
revoke all on function public.payroll_run_calculate(uuid) from public,anon;
revoke all on function public.payroll_run_calculation_readiness(uuid) from public,anon;
revoke all on function public.payroll_run_calculation_read(uuid) from public,anon;
revoke all on function public.payroll_rule_read() from public,anon;
grant execute on function public.payroll_run_component_add(uuid,uuid,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.payroll_run_component_reverse(uuid,uuid,text) to authenticated;
grant execute on function public.payroll_rule_publish(text,text,date,numeric,integer,text,text) to authenticated;
grant execute on function public.payroll_run_calculate(uuid) to authenticated;
grant execute on function public.payroll_run_calculation_readiness(uuid) to authenticated;
grant execute on function public.payroll_run_calculation_read(uuid) to authenticated;
grant execute on function public.payroll_rule_read() to authenticated;

-- Preserve the Phase 1 transition/snapshot contract while truthfully tagging
-- new calculated runs; the Phase 2/3 trigger gates and snapshots run in the
-- same transaction as the existing profile snapshot and audit event.
create or replace function public.payroll_run_transition(p_run_id uuid,p_next_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_count integer;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id for update;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,
    case when p_next_status='finalized' then 'payroll.finalize' else 'payroll.manage' end) then
    raise exception using errcode='42501',message='Payroll Run transition authority denied.';
  end if;
  if nullif(btrim(p_reason),'') is null or not (
    (v_run.status='draft' and p_next_status='review_required')
    or (v_run.status='review_required' and p_next_status='ready')
    or (v_run.status='ready' and p_next_status='finalized')
    or (v_run.status='ready' and p_next_status='review_required')
  ) then
    raise exception using errcode='55000',message='Invalid Payroll Run transition or missing reason.';
  end if;
  if p_next_status='finalized' then
    if v_run.supersedes_run_id is not null and v_period.current_finalized_run_id is distinct from v_run.supersedes_run_id then
      raise exception using errcode='55000',message='Current finalized run changed; recreate this correction.';
    end if;
    if v_run.supersedes_run_id is null and v_period.current_finalized_run_id is not null then
      raise exception using errcode='55000',message='Use a correction run instead.';
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_profile_snapshots(
      run_id,employee_id,profile_id,compensation_versions,statutory_versions,recurring_versions,
      employee_name_snapshot,legal_entity_id_snapshot)
    select v_run.id,e.id,p.id,
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.effective_from), '[]'::jsonb)
        from public.payroll_compensation_versions c where c.profile_id=p.id and c.effective_from<=v_period.period_end
          and c.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_compensation_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(s) order by s.effective_from), '[]'::jsonb)
        from public.payroll_statutory_profile_versions s where s.profile_id=p.id and s.effective_from<=v_period.period_end
          and s.effective_from>=coalesce((select max(prior.effective_from) from public.payroll_statutory_profile_versions prior
            where prior.profile_id=p.id and prior.effective_from<v_period.period_start),v_period.period_start)),
      (select coalesce(jsonb_agg(to_jsonb(rc) order by rc.effective_from), '[]'::jsonb)
        from public.payroll_recurring_component_versions rc where rc.profile_id=p.id and rc.effective_from<=v_period.period_end),
      e.full_name,v_period.legal_entity_id
    from public.payroll_profiles p join public.employees e on e.id=p.employee_id
    where exists(select 1 from public.payroll_compensation_versions c
      where c.profile_id=p.id and c.legal_entity_id=v_period.legal_entity_id and c.effective_from<=v_period.period_end
        and not exists(select 1 from public.payroll_compensation_versions later
          where later.profile_id=p.id and later.effective_from<=v_period.period_end and later.effective_from>c.effective_from));
    get diagnostics v_count=row_count;
    if v_count=0 then raise exception using errcode='22023',message='No effective Payroll Profiles exist for this run.'; end if;
    update public.payroll_runs set status='finalized',finalized_by_employee_id=v_actor,finalized_at=clock_timestamp()
      where id=v_run.id;
    update public.payroll_periods set current_finalized_run_id=v_run.id where id=v_period.id;
  else
    perform set_config('feedx.payroll_command','yes',true);
    update public.payroll_runs set status=p_next_status where id=v_run.id;
  end if;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('run_'||p_next_status,v_run.id,v_actor,btrim(p_reason),
    jsonb_build_object('from_status',v_run.status,'to_status',p_next_status,
      'foundation_only',v_run.foundation_only,'profile_count',v_count));
  return jsonb_build_object('id',v_run.id,'status',p_next_status,
    'foundation_only',v_run.foundation_only,'profile_count',v_count);
end; $$;
