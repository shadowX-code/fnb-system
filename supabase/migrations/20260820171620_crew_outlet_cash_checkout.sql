-- FeedX Crew Operations: outlet-level Cash Checkout and Cash Deposit ledger.
-- Cash calculations and ledger mutations are server authoritative. Browser roles
-- receive no direct table privileges; Admin and Crew access is RPC-only.

insert into public.permissions(code,module,description) values
 ('crew_cash_checkout.view','Crew Cash Checkout','View outlet-scoped daily cash checkout.'),
 ('crew_cash_checkout.perform','Crew Cash Checkout','Perform an outlet daily cash checkout.'),
 ('crew_cash_checkout.review','Crew Cash Checkout','Review cash variances and float shortfalls.'),
 ('crew_cash_checkout.manage','Crew Cash Checkout','Manage outlet cash settings and audited corrections.'),
 ('crew_cash_deposit.view','Crew Cash Deposit','View the outlet cash deposit ledger.'),
 ('crew_cash_deposit.record_collection','Crew Cash Deposit','Record and confirm cash collections.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code=any(array[
 'crew_cash_checkout.view','crew_cash_checkout.perform','crew_cash_checkout.review',
 'crew_cash_checkout.manage','crew_cash_deposit.view','crew_cash_deposit.record_collection'
]) on conflict do nothing;

-- Roles already trusted for Crew Operations retain the corresponding minimum
-- Cash Checkout access. Outlet/position checks still run inside every authority.
insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id
from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code in ('crew_operations.view','crew_operations.manage')
  and p.code in ('crew_cash_checkout.view','crew_cash_checkout.perform','crew_cash_deposit.view')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id
from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code='crew_operations.manage'
  and p.code in ('crew_cash_checkout.review','crew_cash_checkout.manage','crew_cash_deposit.record_collection')
on conflict do nothing;

create table public.crew_cash_settings(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null unique references public.outlets(id) on delete restrict,
 floating_cash numeric(14,2) not null default 0 check(floating_cash>=0),
 variance_tolerance numeric(14,2) not null default 0 check(variance_tolerance>=0),
 required_positions text[] not null default array['Cashier','Supervisor','Outlet Manager']::text[],
 closing_deadline time,
 require_receiver_confirmation boolean not null default true,
 require_manager_review_over_tolerance boolean not null default true,
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);

create table public.crew_cash_float_adjustments(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 previous_amount numeric(14,2) not null check(previous_amount>=0),
 new_amount numeric(14,2) not null check(new_amount>=0),
 effective_date date not null,
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 adjusted_by uuid not null references auth.users(id),
 adjusted_at timestamptz not null default now()
);

create table public.crew_cash_checkouts(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 business_date date not null,
 cash_register_id uuid,
 till_id uuid,
 checked_out_by_employee_id uuid not null references public.employees(id) on delete restrict,
 floating_cash numeric(14,2) not null check(floating_cash>=0),
 previous_carry_forward numeric(14,2) not null default 0 check(previous_carry_forward>=0),
 expected_opening_cash numeric(14,2) not null check(expected_opening_cash>=0),
 actual_opening_cash numeric(14,2) check(actual_opening_cash>=0),
 opening_variance numeric(14,2),
 opening_variance_reason text,
 denomination_counts jsonb not null default '{}'::jsonb,
 counted_cash numeric(14,2) not null default 0 check(counted_cash>=0),
 pos_expected_cash numeric(14,2) check(pos_expected_cash>=0),
 variance numeric(14,2),
 reconciliation_status text check(reconciliation_status in ('balanced','over','short')),
 carry_forward numeric(14,2) not null default 0 check(carry_forward>=0),
 amount_for_deposit numeric(14,2) not null default 0 check(amount_for_deposit>=0),
 float_shortfall numeric(14,2) not null default 0 check(float_shortfall>=0),
 variance_tolerance numeric(14,2) not null default 0 check(variance_tolerance>=0),
 review_required boolean not null default false,
 variance_reason text,
 review_status text not null default 'not_required' check(review_status in ('not_required','pending','approved','rejected')),
 review_note text,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 status text not null default 'draft' check(status in ('draft','reconciled','submitted','completed')),
 reconciled_at timestamptz,
 submitted_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(outlet_id,business_date),
 check(denomination_counts is not null and jsonb_typeof(denomination_counts)='object')
);

create table public.crew_cash_checkout_adjustments(
 id uuid primary key default gen_random_uuid(),
 checkout_id uuid not null references public.crew_cash_checkouts(id) on delete restrict,
 action text not null check(action in ('adjustment','reversal')),
 signed_amount numeric(14,2) not null check(signed_amount<>0),
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 actor_user_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create unique index crew_cash_checkout_one_reversal_idx
on public.crew_cash_checkout_adjustments(checkout_id) where action='reversal';

create table public.crew_cash_collections(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 receiver_type text not null check(receiver_type in ('internal','external')),
 receiver_employee_id uuid references public.employees(id) on delete restrict,
 external_receiver_name text,
 amount numeric(14,2) not null check(amount>0),
 received_amount numeric(14,2) check(received_amount>0),
 difference numeric(14,2),
 purpose text not null check(char_length(btrim(purpose)) between 2 and 160),
 note text,
 status text not null check(status in ('pending_receipt','review_required','completed','cancelled')),
 handed_over_by_employee_id uuid references public.employees(id) on delete restrict,
 handed_over_by_user_id uuid references auth.users(id),
 submitted_at timestamptz not null default now(),
 received_by_employee_id uuid references public.employees(id) on delete restrict,
 confirmed_at timestamptz,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz not null default now(),
 check((receiver_type='internal' and receiver_employee_id is not null and external_receiver_name is null)
    or (receiver_type='external' and receiver_employee_id is null and char_length(btrim(external_receiver_name))>=2)),
 check(handed_over_by_employee_id is not null or handed_over_by_user_id is not null)
);

create table public.crew_cash_ledger_entries(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 entry_type text not null check(entry_type in ('checkout_due','collection','checkout_adjustment','checkout_reversal')),
 signed_amount numeric(14,2) not null check(signed_amount<>0),
 checkout_id uuid references public.crew_cash_checkouts(id) on delete restrict,
 collection_id uuid references public.crew_cash_collections(id) on delete restrict,
 checkout_adjustment_id uuid references public.crew_cash_checkout_adjustments(id) on delete restrict,
 activity text not null,
 receiver_name text,
 occurred_at timestamptz not null,
 recorded_by_employee_id uuid references public.employees(id) on delete restrict,
 recorded_by_user_id uuid references auth.users(id),
 created_at timestamptz not null default now()
);

create unique index crew_cash_ledger_checkout_due_idx on public.crew_cash_ledger_entries(checkout_id) where entry_type='checkout_due';
create unique index crew_cash_ledger_collection_idx on public.crew_cash_ledger_entries(collection_id) where collection_id is not null;
create unique index crew_cash_ledger_adjustment_idx on public.crew_cash_ledger_entries(checkout_adjustment_id) where checkout_adjustment_id is not null;
create index crew_cash_checkouts_outlet_date_idx on public.crew_cash_checkouts(outlet_id,business_date desc);
create index crew_cash_float_adjustments_outlet_date_idx on public.crew_cash_float_adjustments(outlet_id,effective_date desc,adjusted_at desc);
create index crew_cash_collections_outlet_created_idx on public.crew_cash_collections(outlet_id,created_at desc);
create index crew_cash_ledger_outlet_occurred_idx on public.crew_cash_ledger_entries(outlet_id,occurred_at,id);

alter table public.crew_cash_settings enable row level security;
alter table public.crew_cash_float_adjustments enable row level security;
alter table public.crew_cash_checkouts enable row level security;
alter table public.crew_cash_checkout_adjustments enable row level security;
alter table public.crew_cash_collections enable row level security;
alter table public.crew_cash_ledger_entries enable row level security;
revoke all on public.crew_cash_settings,public.crew_cash_float_adjustments,public.crew_cash_checkouts,
 public.crew_cash_checkout_adjustments,public.crew_cash_collections,public.crew_cash_ledger_entries
from public,anon,authenticated;

create or replace function public.crew_cash_protect_completed_checkout()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.status='completed' then raise exception using errcode='22023',message='Completed Cash Checkout is immutable.'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function public.crew_cash_protect_completed_checkout() from public,anon,authenticated;
create trigger crew_cash_protect_completed_checkout_trigger before update or delete on public.crew_cash_checkouts for each row execute function public.crew_cash_protect_completed_checkout();

create or replace function public.crew_cash_protect_append_only_record()
returns trigger language plpgsql set search_path=public as $$
begin
 raise exception using errcode='22023',message='Cash audit records are append-only.';
end; $$;
revoke all on function public.crew_cash_protect_append_only_record() from public,anon,authenticated;
create trigger crew_cash_float_adjustments_append_only before update or delete on public.crew_cash_float_adjustments for each row execute function public.crew_cash_protect_append_only_record();
create trigger crew_cash_checkout_adjustments_append_only before update or delete on public.crew_cash_checkout_adjustments for each row execute function public.crew_cash_protect_append_only_record();
create trigger crew_cash_ledger_entries_append_only before update or delete on public.crew_cash_ledger_entries for each row execute function public.crew_cash_protect_append_only_record();

create or replace function public.crew_cash_employee_has_permission(p_employee_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.employees e
  join public.role_permissions rp on rp.role_id=e.role_id
  join public.permissions p on p.id=rp.permission_id
  where e.id=p_employee_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
    and p.code=p_permission
 );
$$;
revoke all on function public.crew_cash_employee_has_permission(uuid,text) from public,anon,authenticated;

create or replace function public.crew_cash_float_at(p_outlet_id uuid,p_date date)
returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(
  (select a.new_amount from public.crew_cash_float_adjustments a where a.outlet_id=p_outlet_id and a.effective_date<=p_date order by a.effective_date desc,a.adjusted_at desc limit 1),
  (select s.floating_cash from public.crew_cash_settings s where s.outlet_id=p_outlet_id),0
 )::numeric(14,2);
$$;
revoke all on function public.crew_cash_float_at(uuid,date) from public,anon,authenticated;

create or replace function public.crew_cash_previous_carry(p_outlet_id uuid,p_date date)
returns numeric language sql stable security definer set search_path=public as $$
 select coalesce((select c.carry_forward from public.crew_cash_checkouts c
  where c.outlet_id=p_outlet_id and c.business_date<p_date and c.status='completed'
  order by c.business_date desc limit 1),0)::numeric(14,2);
$$;
revoke all on function public.crew_cash_previous_carry(uuid,date) from public,anon,authenticated;

create or replace function public.crew_cash_count_denominations(p_counts jsonb)
returns numeric language plpgsql immutable security definer set search_path=public as $$
declare total numeric:=0; item record; value numeric;
begin
 if p_counts is null or jsonb_typeof(p_counts)<>'object' then raise exception using errcode='22023',message='Denomination counts must be an object.'; end if;
 if exists(select 1 from jsonb_object_keys(p_counts) k where k<>all(array['100','50','20','10','5','1','0.50','0.20','0.10','0.05'])) then
  raise exception using errcode='22023',message='Denomination counts contain an unsupported MYR value.';
 end if;
 for item in select key,value #>> '{}' as qty from jsonb_each(p_counts) loop
  if item.qty is null or item.qty!~'^\d+$' or item.qty::numeric>100000 then raise exception using errcode='22023',message='Each denomination quantity must be a non-negative whole number.'; end if;
  value:=item.key::numeric;
  total:=total+(value*item.qty::numeric);
 end loop;
 return round(total,2);
end; $$;
revoke all on function public.crew_cash_count_denominations(jsonb) from public,anon,authenticated;

create or replace function public.crew_cash_balance(p_outlet_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(sum(l.signed_amount),0)::numeric(14,2) from public.crew_cash_ledger_entries l where l.outlet_id=p_outlet_id;
$$;
revoke all on function public.crew_cash_balance(uuid) from public,anon,authenticated;

create or replace function public.crew_cash_available_balance(p_outlet_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select greatest(public.crew_cash_balance(p_outlet_id)-coalesce((select sum(c.amount) from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.status='pending_receipt'),0),0)::numeric(14,2);
$$;
revoke all on function public.crew_cash_available_balance(uuid) from public,anon,authenticated;

create or replace function public.crew_cash_assert_admin(p_outlet_id uuid,p_permission text)
returns void language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.current_user_has_permission(p_permission) or not public.current_user_can_access_outlet(p_outlet_id) then
  raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.';
 end if;
end; $$;
revoke all on function public.crew_cash_assert_admin(uuid,text) from public,anon,authenticated;

create or replace function public.crew_cash_append_checkout_ledger(p_checkout_id uuid,p_actor_user uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare c public.crew_cash_checkouts%rowtype; employee_name text;
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id and status='completed';
 if c.id is null or c.amount_for_deposit<=0 then return; end if;
 select e.full_name into employee_name from public.employees e where e.id=c.checked_out_by_employee_id;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,checkout_id,activity,occurred_at,recorded_by_employee_id,recorded_by_user_id)
 values(c.outlet_id,'checkout_due',c.amount_for_deposit,c.id,'Cash Checkout · '||coalesce(employee_name,'Crew'),coalesce(c.completed_at,now()),c.checked_out_by_employee_id,p_actor_user)
 on conflict do nothing;
end; $$;
revoke all on function public.crew_cash_append_checkout_ledger(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; checkout jsonb; can_perform boolean; can_collect boolean;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position';
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 can_perform:=public.crew_cash_employee_has_permission(employee,'crew_cash_checkout.perform')
  and (settings.id is null or cardinality(settings.required_positions)=0 or position=any(settings.required_positions));
 can_collect:=public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection');
 select jsonb_build_object('id',c.id,'business_date',c.business_date,'status',c.status,'checked_out_by',e.full_name,
  'floating_cash',c.floating_cash,'previous_carry_forward',c.previous_carry_forward,'expected_opening_cash',c.expected_opening_cash,
  'actual_opening_cash',c.actual_opening_cash,'opening_variance',c.opening_variance,'opening_variance_reason',c.opening_variance_reason,
  'denomination_counts',c.denomination_counts,'counted_cash',c.counted_cash,'pos_expected_cash',c.pos_expected_cash,
  'variance',c.variance,'reconciliation_status',c.reconciliation_status,'carry_forward',c.carry_forward,
  'amount_for_deposit',c.amount_for_deposit,'float_shortfall',c.float_shortfall,'review_required',c.review_required,
  'review_status',c.review_status,'variance_reason',c.variance_reason,'completed_at',c.completed_at)
 into checkout from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id
 where c.outlet_id=outlet and c.business_date=p_business_date;
 return jsonb_build_object('outlet',jsonb_build_object('id',outlet,'name',coalesce((select o.name from public.outlets o where o.id=outlet),ctx->>'outlet_name')),
  'business_date',p_business_date,'can_perform',can_perform,'can_record_collection',can_collect,
  'settings',jsonb_build_object('floating_cash',public.crew_cash_float_at(outlet,p_business_date),'variance_tolerance',coalesce(settings.variance_tolerance,0),'closing_deadline',settings.closing_deadline),
  'checkout',checkout,'deposit',jsonb_build_object('current_balance',public.crew_cash_balance(outlet),'available_balance',public.crew_cash_available_balance(outlet),
   'recent',coalesce((select jsonb_agg(x order by x.occurred_at desc) from (select l.id,l.occurred_at,l.activity,l.signed_amount,l.receiver_name from public.crew_cash_ledger_entries l where l.outlet_id=outlet order by l.occurred_at desc limit 20)x),'[]'::jsonb)),
  'receivers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name)
   from public.employees e join public.crew_access ca on ca.employee_id=e.id
   where ca.primary_outlet_id=outlet and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb),
  'pending_receipts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'sender',coalesce(se.full_name,'Admin'),'submitted_at',c.submitted_at) order by c.submitted_at desc)
   from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt'),'[]'::jsonb));
end; $$;
revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;

create or replace function public.crew_cash_save_checkout(p_token text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; position text; settings public.crew_cash_settings%rowtype; c public.crew_cash_checkouts%rowtype;
 counts jsonb; counted numeric; float_amount numeric; previous_carry numeric; expected_open numeric; actual_open numeric; pos_expected numeric; carry numeric;
 variance_amount numeric; deposit_amount numeric; shortfall numeric; needs_review boolean; action text;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid; position:=ctx->>'position'; action:=lower(btrim(p_action));
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_checkout.perform') then raise exception using errcode='42501',message='You do not have permission to perform Cash Checkout.'; end if;
 select * into settings from public.crew_cash_settings s where s.outlet_id=outlet;
 if settings.id is not null and cardinality(settings.required_positions)>0 and not position=any(settings.required_positions) then raise exception using errcode='42501',message='Cash Checkout is not assigned to your position.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['checked_out_by','checked_out_by_employee_id','counted_cash','variance','amount_for_deposit','status','review_status','completed_at'] then
  raise exception using errcode='22023',message='Cash Checkout payload contains server-controlled fields.';
 end if;
 if action<>all(array['draft','reconcile','submit','complete']) then raise exception using errcode='22023',message='Unsupported Cash Checkout action.'; end if;
 select * into c from public.crew_cash_checkouts x where x.outlet_id=outlet and x.business_date=timezone('Asia/Kuala_Lumpur',now())::date for update;
 if c.id is not null and c.status='completed' then raise exception using errcode='22023',message='Completed Cash Checkout is immutable.'; end if;
 if c.id is not null and c.checked_out_by_employee_id<>employee then raise exception using errcode='42501',message='Today''s Cash Checkout is already owned by another Crew member.'; end if;
 if action in ('submit','complete') and (c.id is null or c.status<>'reconciled') then raise exception using errcode='22023',message='Reconcile Cash Checkout before submitting it.'; end if;
 if action='reconcile' and c.id is not null and c.status not in ('draft','reconciled') then raise exception using errcode='22023',message='This Cash Checkout cannot be reconciled in its current state.'; end if;
 float_amount:=public.crew_cash_float_at(outlet,timezone('Asia/Kuala_Lumpur',now())::date);
 previous_carry:=public.crew_cash_previous_carry(outlet,timezone('Asia/Kuala_Lumpur',now())::date);
 expected_open:=float_amount+previous_carry;
 counts:=coalesce(p_payload->'denomination_counts',c.denomination_counts,'{}'::jsonb);
 counted:=public.crew_cash_count_denominations(counts);
 actual_open:=case when p_payload ? 'actual_opening_cash' then (p_payload->>'actual_opening_cash')::numeric else c.actual_opening_cash end;
 pos_expected:=case when p_payload ? 'pos_expected_cash' then (p_payload->>'pos_expected_cash')::numeric else c.pos_expected_cash end;
 carry:=coalesce(case when p_payload ? 'carry_forward' then (p_payload->>'carry_forward')::numeric else c.carry_forward end,0);
 if actual_open is not null and actual_open<0 or pos_expected is not null and pos_expected<0 or carry<0 then raise exception using errcode='22023',message='Cash values cannot be negative.'; end if;
 if actual_open is not null and actual_open is distinct from expected_open and nullif(btrim(coalesce(p_payload->>'opening_variance_reason',c.opening_variance_reason,'')),'') is null then raise exception using errcode='22023',message='Explain the opening cash variance.'; end if;
 variance_amount:=case when pos_expected is null then null else counted-pos_expected end;
 shortfall:=greatest(float_amount-counted,0);
 if shortfall>0 then carry:=0; deposit_amount:=0;
 else
  if carry>counted-float_amount then raise exception using errcode='22023',message='Carry Forward cannot exceed cash remaining after Floating Cash.'; end if;
  deposit_amount:=counted-float_amount-carry;
 end if;
 needs_review:=shortfall>0 or (coalesce(settings.require_manager_review_over_tolerance,true) and variance_amount is not null and abs(variance_amount)>coalesce(settings.variance_tolerance,0));
 if action in ('reconcile','submit','complete') and pos_expected is null then raise exception using errcode='22023',message='POS Expected Cash is required to reconcile.'; end if;
 if needs_review and action in ('submit','complete') and nullif(btrim(coalesce(p_payload->>'variance_reason',c.variance_reason,'')),'') is null then raise exception using errcode='22023',message='Explain the cash variance before submitting.'; end if;
 if c.id is null then
  insert into public.crew_cash_checkouts(outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,opening_variance_reason,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,variance_reason,review_status,status,reconciled_at,submitted_at)
  values(outlet,timezone('Asia/Kuala_Lumpur',now())::date,employee,float_amount,previous_carry,expected_open,actual_open,case when actual_open is null then null else actual_open-expected_open end,nullif(btrim(p_payload->>'opening_variance_reason'),''),counts,counted,pos_expected,variance_amount,case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,carry,deposit_amount,shortfall,coalesce(settings.variance_tolerance,0),needs_review,nullif(btrim(p_payload->>'variance_reason'),''),case when needs_review then 'pending' else 'not_required' end,case action when 'draft' then 'draft' when 'reconcile' then 'reconciled' else 'submitted' end,case when action<>'draft' then now() end,case when action in('submit','complete') then now() end)
  returning * into c;
 else
  update public.crew_cash_checkouts set actual_opening_cash=actual_open,opening_variance=case when actual_open is null then null else actual_open-expected_open end,
   opening_variance_reason=coalesce(nullif(btrim(p_payload->>'opening_variance_reason'),''),opening_variance_reason),denomination_counts=counts,counted_cash=counted,
   pos_expected_cash=pos_expected,variance=variance_amount,reconciliation_status=case when variance_amount is null then null when variance_amount=0 then 'balanced' when variance_amount>0 then 'over' else 'short' end,
   carry_forward=carry,amount_for_deposit=deposit_amount,float_shortfall=shortfall,variance_tolerance=coalesce(settings.variance_tolerance,0),review_required=needs_review,
   variance_reason=coalesce(nullif(btrim(p_payload->>'variance_reason'),''),variance_reason),review_status=case when needs_review then 'pending' else 'not_required' end,
   status=case action when 'draft' then status when 'reconcile' then 'reconciled' else 'submitted' end,
   reconciled_at=case when action<>'draft' then coalesce(reconciled_at,now()) else reconciled_at end,submitted_at=case when action in('submit','complete') then coalesce(submitted_at,now()) else submitted_at end,updated_at=now()
  where id=c.id returning * into c;
 end if;
 if action='complete' then
  if c.review_required then raise exception using errcode='22023',message='Cash Checkout requires manager review before completion.'; end if;
  update public.crew_cash_checkouts set status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,null);
 end if;
 return jsonb_build_object('checkout',to_jsonb(c),'deposit_balance',public.crew_cash_balance(outlet));
end; $$;
revoke all on function public.crew_cash_save_checkout(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_save_checkout(text,text,jsonb) to anon,authenticated;

create or replace function public.crew_cash_admin_data(p_outlet_id uuid,p_from date default current_date-30,p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare settings jsonb; ledger jsonb; total_in numeric; total_out numeric;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then
  raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.';
 end if;
 if p_to<p_from or p_to-p_from>366 then raise exception using errcode='22023',message='Cash Checkout date range must be 367 days or fewer.'; end if;
 select coalesce(to_jsonb(s),'{}'::jsonb) into settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select coalesce(sum(greatest(l.signed_amount,0)),0),coalesce(sum(greatest(-l.signed_amount,0)),0) into total_in,total_out from public.crew_cash_ledger_entries l where l.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into ledger from (
  select l.id,l.occurred_at,l.entry_type,l.activity,greatest(l.signed_amount,0) amount_in,greatest(-l.signed_amount,0) amount_out,
   sum(l.signed_amount) over(order by l.occurred_at,l.id rows between unbounded preceding and current row) balance,l.receiver_name,
   coalesce(e.full_name,u.email,'System') recorded_by
  from public.crew_cash_ledger_entries l left join public.employees e on e.id=l.recorded_by_employee_id left join auth.users u on u.id=l.recorded_by_user_id
  where l.outlet_id=p_outlet_id
 )x;
 return jsonb_build_object('settings',settings,'summary',jsonb_build_object('current_balance',total_in-total_out,'available_balance',public.crew_cash_available_balance(p_outlet_id),'total_added',total_in,'total_collected',total_out),
  'checkouts',coalesce((select jsonb_agg(to_jsonb(x) order by x.business_date desc) from (select c.*,e.full_name checked_out_by from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet_id and c.business_date between p_from and p_to)x),'[]'::jsonb),
  'ledger',ledger,
  'collections',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select c.*,coalesce(r.full_name,c.external_receiver_name) receiver_name,coalesce(h.full_name,u.email,'Admin') handed_over_by from public.crew_cash_collections c left join public.employees r on r.id=c.receiver_employee_id left join public.employees h on h.id=c.handed_over_by_employee_id left join auth.users u on u.id=c.handed_over_by_user_id where c.outlet_id=p_outlet_id)x),'[]'::jsonb),
  'float_history',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'previous_amount',a.previous_amount,'new_amount',a.new_amount,'effective_date',a.effective_date,'reason',a.reason,'adjusted_at',a.adjusted_at,'adjusted_by',coalesce(u.email,'Admin')) order by a.effective_date desc,a.adjusted_at desc) from public.crew_cash_float_adjustments a left join auth.users u on u.id=a.adjusted_by where a.outlet_id=p_outlet_id),'[]'::jsonb),
  'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name) from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')),'[]'::jsonb));
end; $$;
revoke all on function public.crew_cash_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_cash_save_settings(p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_row public.crew_cash_settings%rowtype; next_float numeric; effective date; reason text;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_checkout.manage');
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception using errcode='22023',message='Cash settings payload is invalid.'; end if;
 if p_payload ? 'required_positions' and jsonb_typeof(p_payload->'required_positions')<>'array' then raise exception using errcode='22023',message='Checkout positions must be an array.'; end if;
 select * into current_row from public.crew_cash_settings where outlet_id=p_outlet_id for update;
 next_float:=coalesce((p_payload->>'floating_cash')::numeric,current_row.floating_cash,0); effective:=coalesce((p_payload->>'effective_date')::date,current_date); reason:=nullif(btrim(p_payload->>'reason'),'');
 if next_float<0 or coalesce((p_payload->>'variance_tolerance')::numeric,current_row.variance_tolerance,0)<0 then raise exception using errcode='22023',message='Cash settings amounts cannot be negative.'; end if;
 if (current_row.id is null or next_float is distinct from current_row.floating_cash) and reason is null then raise exception using errcode='22023',message='A reason is required when Floating Cash changes.'; end if;
 if current_row.id is null then
  insert into public.crew_cash_settings(outlet_id,floating_cash,variance_tolerance,required_positions,closing_deadline,require_receiver_confirmation,require_manager_review_over_tolerance,created_by,updated_by)
  values(p_outlet_id,next_float,coalesce((p_payload->>'variance_tolerance')::numeric,0),case when p_payload ? 'required_positions' then array(select jsonb_array_elements_text(p_payload->'required_positions')) else array['Cashier','Supervisor','Outlet Manager']::text[] end,nullif(p_payload->>'closing_deadline','')::time,coalesce((p_payload->>'require_receiver_confirmation')::boolean,true),coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,true),auth.uid(),auth.uid()) returning * into current_row;
  insert into public.crew_cash_float_adjustments(outlet_id,previous_amount,new_amount,effective_date,reason,adjusted_by) values(p_outlet_id,0,next_float,effective,reason,auth.uid());
 else
  if next_float is distinct from current_row.floating_cash then insert into public.crew_cash_float_adjustments(outlet_id,previous_amount,new_amount,effective_date,reason,adjusted_by) values(p_outlet_id,current_row.floating_cash,next_float,effective,reason,auth.uid()); end if;
  update public.crew_cash_settings set floating_cash=next_float,variance_tolerance=coalesce((p_payload->>'variance_tolerance')::numeric,variance_tolerance),
   required_positions=case when p_payload ? 'required_positions' then array(select jsonb_array_elements_text(p_payload->'required_positions')) else required_positions end,
   closing_deadline=case when p_payload ? 'closing_deadline' then nullif(p_payload->>'closing_deadline','')::time else closing_deadline end,
   require_receiver_confirmation=coalesce((p_payload->>'require_receiver_confirmation')::boolean,require_receiver_confirmation),
   require_manager_review_over_tolerance=coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,require_manager_review_over_tolerance),updated_at=now(),updated_by=auth.uid()
  where id=current_row.id returning * into current_row;
 end if;
 return to_jsonb(current_row);
end; $$;
revoke all on function public.crew_cash_save_settings(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_save_settings(uuid,jsonb) to authenticated;

create or replace function public.crew_cash_review_checkout(p_checkout_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.crew_cash_checkouts%rowtype; decision text:=lower(btrim(p_decision));
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id for update;
 if c.id is null then raise exception using errcode='P0002',message='Cash Checkout was not found.'; end if;
 perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.review');
 if c.status<>'submitted' or not c.review_required or c.review_status<>'pending' then raise exception using errcode='22023',message='This Cash Checkout is not awaiting review.'; end if;
 if decision='approve' then
  update public.crew_cash_checkouts set review_status='approved',review_note=nullif(btrim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now(),status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,auth.uid());
 elsif decision='reject' then
  if nullif(btrim(p_note),'') is null then raise exception using errcode='22023',message='A rejection reason is required.'; end if;
  update public.crew_cash_checkouts set review_status='rejected',review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),status='reconciled',updated_at=now() where id=c.id returning * into c;
 else raise exception using errcode='22023',message='Review decision must be approve or reject.'; end if;
 return to_jsonb(c);
end; $$;
revoke all on function public.crew_cash_review_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_cash_review_checkout(uuid,text,text) to authenticated;

create or replace function public.crew_cash_record_collection(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; receiver_type text; receiver uuid; receiver_name text; amount numeric; row public.crew_cash_collections%rowtype; require_confirm boolean;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection') then raise exception using errcode='42501',message='You do not have permission to record a Cash Collection.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['outlet_id','handed_over_by','status','difference','confirmed_at'] then raise exception using errcode='22023',message='Cash Collection payload contains server-controlled fields.'; end if;
 receiver_type:=lower(btrim(p_payload->>'receiver_type')); receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; receiver_name:=nullif(btrim(p_payload->>'receiver_name'),''); amount:=(p_payload->>'amount')::numeric;
 perform pg_advisory_xact_lock(hashtextextended(outlet::text,0));
 if nullif(btrim(p_payload->>'purpose'),'') is null then raise exception using errcode='22023',message='Collection purpose is required.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_available_balance(outlet) then raise exception using errcode='22023',message='Collection amount must be positive and cannot exceed the available deposit balance.'; end if;
 if receiver_type='internal' and not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=receiver and e.is_active and ca.access_state='active' and ca.primary_outlet_id=outlet) then raise exception using errcode='22023',message='Internal receiver must be an active Crew member in this outlet.'; end if;
 if receiver_type='external' and receiver_name is null then raise exception using errcode='22023',message='External receiver name is required.'; end if;
 if receiver_type<>all(array['internal','external']) then raise exception using errcode='22023',message='Receiver type must be internal or external.'; end if;
 select coalesce((select s.require_receiver_confirmation from public.crew_cash_settings s where s.outlet_id=outlet),true) into require_confirm;
 insert into public.crew_cash_collections(outlet_id,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_employee_id,confirmed_at)
 values(outlet,receiver_type,case when receiver_type='internal' then receiver end,case when receiver_type='external' then receiver_name end,amount,case when receiver_type='external' or not require_confirm then amount end,0,btrim(p_payload->>'purpose'),nullif(btrim(p_payload->>'note'),''),case when receiver_type='internal' and require_confirm then 'pending_receipt' else 'completed' end,employee,case when receiver_type='external' or not require_confirm then now() end)
 returning * into row;
 if row.status='completed' then insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id) values(outlet,'collection',-amount,row.id,'Cash Collection',coalesce(receiver_name,(select full_name from public.employees where id=receiver)),now(),employee); end if;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_record_collection(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_record_collection(text,jsonb) to anon,authenticated;

create or replace function public.crew_cash_admin_record_collection(p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receiver_type text; receiver uuid; receiver_name text; amount numeric; row public.crew_cash_collections%rowtype;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload ?| array['outlet_id','handed_over_by','status','difference','confirmed_at'] then raise exception using errcode='22023',message='Cash Collection payload contains server-controlled fields.'; end if;
 receiver_type:=lower(btrim(p_payload->>'receiver_type')); receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; receiver_name:=nullif(btrim(p_payload->>'receiver_name'),''); amount:=(p_payload->>'amount')::numeric;
 perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
 if nullif(btrim(p_payload->>'purpose'),'') is null then raise exception using errcode='22023',message='Collection purpose is required.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_available_balance(p_outlet_id) then raise exception using errcode='22023',message='Collection amount must be positive and cannot exceed the available deposit balance.'; end if;
 if receiver_type='internal' and not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=receiver and e.is_active and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id) then raise exception using errcode='22023',message='Internal receiver must be an active Crew member in this outlet.'; end if;
 if receiver_type='external' and receiver_name is null then raise exception using errcode='22023',message='External receiver name is required.'; end if;
 if receiver_type<>all(array['internal','external']) then raise exception using errcode='22023',message='Receiver type must be internal or external.'; end if;
 insert into public.crew_cash_collections(outlet_id,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_user_id,confirmed_at)
 values(p_outlet_id,receiver_type,case when receiver_type='internal' then receiver end,case when receiver_type='external' then receiver_name end,amount,case when receiver_type='external' then amount end,0,btrim(p_payload->>'purpose'),nullif(btrim(p_payload->>'note'),''),case when receiver_type='internal' then 'pending_receipt' else 'completed' end,auth.uid(),case when receiver_type='external' then now() end) returning * into row;
 if row.status='completed' then insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id) values(p_outlet_id,'collection',-amount,row.id,'Cash Collection',receiver_name,now(),auth.uid()); end if;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_admin_record_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_record_collection(uuid,jsonb) to authenticated;

create or replace function public.crew_cash_confirm_collection(p_token text,p_collection_id uuid,p_received_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; row public.crew_cash_collections%rowtype;
begin
 employee:=public.crew_session_employee(p_token); select * into row from public.crew_cash_collections where id=p_collection_id for update;
 if row.id is null or row.receiver_employee_id<>employee then raise exception using errcode='42501',message='This Cash Collection is not assigned to you.'; end if;
 if row.status<>'pending_receipt' then raise exception using errcode='22023',message='This Cash Collection is no longer awaiting receipt.'; end if;
 if p_received_amount is null or p_received_amount<=0 then raise exception using errcode='22023',message='Received amount must be positive.'; end if;
 update public.crew_cash_collections set received_amount=p_received_amount,difference=p_received_amount-amount,received_by_employee_id=employee,confirmed_at=now(),status=case when p_received_amount=amount then 'completed' else 'review_required' end where id=row.id returning * into row;
 if row.status='completed' then insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id) values(row.outlet_id,'collection',-row.received_amount,row.id,'Cash Collection',(select full_name from public.employees where id=employee),row.confirmed_at,employee); end if;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_confirm_collection(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.crew_cash_confirm_collection(text,uuid,numeric) to anon,authenticated;

create or replace function public.crew_cash_review_collection(p_collection_id uuid,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crew_cash_collections%rowtype; decision text:=lower(btrim(p_decision)); receiver_name text;
begin
 select * into row from public.crew_cash_collections where id=p_collection_id for update;
 if row.id is null then raise exception using errcode='P0002',message='Cash Collection was not found.'; end if;
 perform public.crew_cash_assert_admin(row.outlet_id,'crew_cash_checkout.review');
 if row.status<>'review_required' then raise exception using errcode='22023',message='This Cash Collection is not awaiting review.'; end if;
 if nullif(btrim(p_note),'') is null then raise exception using errcode='22023',message='A review note is required.'; end if;
 if decision='approve' then
  perform pg_advisory_xact_lock(hashtextextended(row.outlet_id::text,0));
  if row.received_amount>public.crew_cash_balance(row.outlet_id) then raise exception using errcode='22023',message='Received amount exceeds the current deposit balance.'; end if;
  update public.crew_cash_collections set status='completed',reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=row.id returning * into row;
  select full_name into receiver_name from public.employees where id=row.receiver_employee_id;
  insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id) values(row.outlet_id,'collection',-row.received_amount,row.id,'Cash Collection · reviewed difference',receiver_name,coalesce(row.confirmed_at,now()),auth.uid());
 elsif decision='reject' then update public.crew_cash_collections set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=row.id returning * into row;
 else raise exception using errcode='22023',message='Review decision must be approve or reject.'; end if;
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_review_collection(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_cash_review_collection(uuid,text,text) to authenticated;

create or replace function public.crew_cash_adjust_checkout(p_checkout_id uuid,p_action text,p_amount numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.crew_cash_checkouts%rowtype; row public.crew_cash_checkout_adjustments%rowtype; signed numeric; action text:=lower(btrim(p_action));
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id and status='completed';
 if c.id is null then raise exception using errcode='22023',message='Only a completed Cash Checkout can be corrected.'; end if;
 perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.manage');
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='A correction reason is required.'; end if;
 if action='reversal' then signed:=-c.amount_for_deposit; if signed=0 then raise exception using errcode='22023',message='This Cash Checkout has no deposit amount to reverse.'; end if;
 elsif action='adjustment' then signed:=p_amount; if signed is null or signed=0 then raise exception using errcode='22023',message='Adjustment amount cannot be zero.'; end if;
 else raise exception using errcode='22023',message='Correction action must be adjustment or reversal.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(c.outlet_id::text,0));
 if signed<0 and abs(signed)>public.crew_cash_balance(c.outlet_id) then raise exception using errcode='22023',message='Correction cannot reduce the deposit ledger below zero.'; end if;
 insert into public.crew_cash_checkout_adjustments(checkout_id,action,signed_amount,reason,actor_user_id) values(c.id,action,signed,btrim(p_reason),auth.uid()) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,checkout_id,checkout_adjustment_id,activity,occurred_at,recorded_by_user_id) values(c.outlet_id,case when action='reversal' then 'checkout_reversal' else 'checkout_adjustment' end,signed,c.id,row.id,case when action='reversal' then 'Cash Checkout reversal' else 'Cash Checkout adjustment' end,now(),auth.uid());
 return jsonb_build_object('adjustment',to_jsonb(row),'current_balance',public.crew_cash_balance(c.outlet_id));
end; $$;
revoke all on function public.crew_cash_adjust_checkout(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.crew_cash_adjust_checkout(uuid,text,numeric,text) to authenticated;
