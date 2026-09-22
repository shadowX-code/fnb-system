-- Crew Leave Entitlement / Balance v1.
-- Policies and annual grants are durable; used, pending and available are always
-- derived from authoritative leave evidence and immutable adjustments.

insert into public.permissions(code,module,description) values
 ('crew_leave_balance.view','Crew Leave Balance','View outlet-scoped Crew leave balances.'),
 ('crew_leave_balance.manage','Crew Leave Balance','Generate and manage outlet-scoped Crew leave entitlements.'),
 ('crew_leave_balance.adjust','Crew Leave Balance','Create audited Crew leave balance adjustments.'),
 ('crew_leave_settings.manage','Crew Leave Settings','Manage outlet-scoped Crew leave policies.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in (
 'crew_leave_balance.view','crew_leave_balance.manage','crew_leave_balance.adjust','crew_leave_settings.manage'
) on conflict do nothing;

create table public.crew_leave_policies(
 id uuid primary key default extensions.gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 leave_type text not null check(leave_type in ('annual','medical','unpaid','other')),
 annual_days numeric(7,2) not null default 0 check(annual_days>=0),
 proration_enabled boolean not null default false,
 balance_enforced boolean not null default true,
 carry_forward_enabled boolean not null default false,
 max_carry_forward_days numeric(7,2) not null default 0 check(max_carry_forward_days>=0),
 carry_forward_expiry_month smallint check(carry_forward_expiry_month between 1 and 12),
 carry_forward_expiry_day smallint check(carry_forward_expiry_day between 1 and 31),
 calculation_version text not null default 'calendar-days-half-day-v1',
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(outlet_id,leave_type),
 check(not carry_forward_enabled or (carry_forward_expiry_month is not null and carry_forward_expiry_day is not null))
);

create table public.crew_leave_entitlements(
 id uuid primary key default extensions.gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 leave_type text not null check(leave_type in ('annual','medical','unpaid','other')),
 period_start date not null,
 period_end date not null,
 base_entitlement numeric(7,2) not null check(base_entitlement>=0),
 prorated_entitlement numeric(7,2) not null check(prorated_entitlement>=0),
 carry_forward numeric(7,2) not null default 0 check(carry_forward>=0),
 carry_forward_expires_at date,
 calculation_version text not null,
 calculation_explanation jsonb not null default '{}'::jsonb,
 generated_by uuid references auth.users(id) on delete set null,
 generated_at timestamptz not null default now(),
 unique(employee_id,leave_type,period_start),
 check(period_start=date_trunc('year',period_start)::date),
 check(period_end=(period_start+interval '1 year'-interval '1 day')::date)
);

create table public.crew_leave_adjustments(
 id uuid primary key default extensions.gen_random_uuid(),
 entitlement_id uuid not null references public.crew_leave_entitlements(id) on delete restrict,
 amount numeric(7,2) not null check(amount<>0),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 adjusted_by uuid not null references auth.users(id) on delete restrict,
 adjusted_at timestamptz not null default now()
);

create index crew_leave_entitlements_outlet_period_idx on public.crew_leave_entitlements(outlet_id,period_start,leave_type);
create index crew_leave_adjustments_entitlement_idx on public.crew_leave_adjustments(entitlement_id,adjusted_at);

alter table public.crew_leave_policies enable row level security;
alter table public.crew_leave_entitlements enable row level security;
alter table public.crew_leave_adjustments enable row level security;
revoke all on public.crew_leave_policies,public.crew_leave_entitlements,public.crew_leave_adjustments from public,anon,authenticated;

insert into public.crew_leave_policies(outlet_id,leave_type,annual_days,proration_enabled,balance_enforced,carry_forward_enabled,max_carry_forward_days,carry_forward_expiry_month,carry_forward_expiry_day)
select o.id,v.leave_type,v.annual_days,v.proration,v.enforced,v.carry_enabled,v.carry_cap,v.expiry_month,v.expiry_day
from public.outlets o cross join (values
 ('annual',12::numeric,true,true,true,5::numeric,3::smallint,31::smallint),
 ('medical',14::numeric,false,true,false,0::numeric,null::smallint,null::smallint),
 ('unpaid',0::numeric,false,false,false,0::numeric,null::smallint,null::smallint),
 ('other',0::numeric,false,false,false,0::numeric,null::smallint,null::smallint)
) v(leave_type,annual_days,proration,enforced,carry_enabled,carry_cap,expiry_month,expiry_day)
on conflict(outlet_id,leave_type) do nothing;

create or replace function public.crew_leave_days_in_period(p_start date,p_end date,p_duration text,p_period_start date,p_period_end date)
returns numeric language sql immutable set search_path=public as $$
 select case when p_end<p_period_start or p_start>p_period_end then 0::numeric
   when p_duration='half_day' then 0.5::numeric
   else (least(p_end,p_period_end)-greatest(p_start,p_period_start)+1)::numeric end
$$;
revoke all on function public.crew_leave_days_in_period(date,date,text,date,date) from public,anon,authenticated;

create or replace function public.crew_leave_entitlement_balance(p_entitlement_id uuid,p_as_of date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.crew_leave_entitlements%rowtype; policy public.crew_leave_policies%rowtype; adjusted numeric; used_days numeric; pending_days numeric; active_carry numeric; entitled numeric; available numeric;
begin
 select * into e from public.crew_leave_entitlements where id=p_entitlement_id;
 if e.id is null then return null; end if;
 select * into policy from public.crew_leave_policies where outlet_id=e.outlet_id and leave_type=e.leave_type;
 select coalesce(sum(a.amount),0) into adjusted from public.crew_leave_adjustments a where a.entitlement_id=e.id;
 select coalesce(sum(public.crew_leave_days_in_period(a.start_date,a.end_date,a.duration_type,e.period_start,e.period_end)),0) into used_days
 from public.crew_approved_leaves a where a.employee_id=e.employee_id and a.leave_type=e.leave_type and a.end_date>=e.period_start and a.start_date<=e.period_end;
 select coalesce(sum(public.crew_leave_days_in_period(r.start_date,r.end_date,r.duration_type,e.period_start,e.period_end)),0) into pending_days
 from public.crew_leave_requests r where r.employee_id=e.employee_id and r.leave_type=e.leave_type and r.status='pending' and r.end_date>=e.period_start and r.start_date<=e.period_end;
 active_carry:=case when e.carry_forward_expires_at is null or p_as_of<=e.carry_forward_expires_at then e.carry_forward else 0 end;
 entitled:=e.prorated_entitlement+active_carry+adjusted;
 available:=case when coalesce(policy.balance_enforced,true) then entitled-used_days-pending_days else null end;
 return jsonb_build_object('entitlement_id',e.id,'employee_id',e.employee_id,'outlet_id',e.outlet_id,'leave_type',e.leave_type,'period_start',e.period_start,'period_end',e.period_end,
  'base',e.base_entitlement,'prorated',e.prorated_entitlement,'carry_forward',active_carry,'carry_forward_awarded',e.carry_forward,'carry_forward_expires_at',e.carry_forward_expires_at,
  'adjustment',adjusted,'entitled',entitled,'used',used_days,'pending',pending_days,'available',available,'balance_enforced',coalesce(policy.balance_enforced,true),
  'calculation_version',e.calculation_version,'explanation',e.calculation_explanation);
end $$;
revoke all on function public.crew_leave_entitlement_balance(uuid,date) from public,anon,authenticated;

create or replace function public.crew_leave_ensure_entitlement(p_employee_id uuid,p_leave_type text,p_period_start date,p_outlet_id uuid default null,p_actor uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_period_start date; v_period_end date; employee public.employees%rowtype; outlet uuid; policy public.crew_leave_policies%rowtype; eligible_start date; eligible_days integer; total_days integer; prorated numeric; prior public.crew_leave_entitlements%rowtype; prior_balance jsonb; carry numeric:=0; carry_expiry date; result_id uuid;
begin
 v_period_start:=date_trunc('year',p_period_start)::date; v_period_end:=(v_period_start+interval '1 year'-interval '1 day')::date;
 select * into employee from public.employees where id=p_employee_id;
 if employee.id is null then raise exception using errcode='22023',message='Employee is unavailable.'; end if;
 outlet:=coalesce(p_outlet_id,public.crew_resolve_employee_outlet(employee.id));
 if outlet is null then raise exception using errcode='22023',message='Employee outlet is unavailable.'; end if;
 select * into policy from public.crew_leave_policies where outlet_id=outlet and leave_type=p_leave_type;
 if policy.id is null then raise exception using errcode='22023',message='Leave policy is unavailable.'; end if;
 select ce.id into result_id from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=v_period_start;
 if result_id is not null then return result_id; end if;
 eligible_start:=greatest(v_period_start,coalesce(employee.joined_date,v_period_start)); total_days:=v_period_end-v_period_start+1; eligible_days:=greatest(0,v_period_end-eligible_start+1);
 prorated:=case when policy.proration_enabled then round((policy.annual_days*eligible_days/total_days)*2)/2 else policy.annual_days end;
 if policy.carry_forward_enabled then
   select * into prior from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=(v_period_start-interval '1 year')::date;
   if prior.id is not null then prior_balance:=public.crew_leave_entitlement_balance(prior.id,prior.period_end); carry:=least(policy.max_carry_forward_days,greatest(0,coalesce((prior_balance->>'available')::numeric,0))); end if;
   carry_expiry:=make_date(extract(year from v_period_start)::int,policy.carry_forward_expiry_month,least(policy.carry_forward_expiry_day,extract(day from (make_date(extract(year from v_period_start)::int,policy.carry_forward_expiry_month,1)+interval '1 month'-interval '1 day'))::int));
 end if;
 insert into public.crew_leave_entitlements(employee_id,outlet_id,leave_type,period_start,period_end,base_entitlement,prorated_entitlement,carry_forward,carry_forward_expires_at,calculation_version,calculation_explanation,generated_by)
 values(employee.id,outlet,p_leave_type,v_period_start,v_period_end,policy.annual_days,prorated,carry,carry_expiry,policy.calculation_version,
  jsonb_build_object('formula',case when policy.proration_enabled then 'annual_days × eligible_calendar_days ÷ calendar_year_days, rounded to nearest half day' else 'annual entitlement without proration' end,'joined_date',employee.joined_date,'eligible_from',eligible_start,'eligible_calendar_days',eligible_days,'calendar_year_days',total_days,'weekends_and_public_holidays_excluded',false),p_actor)
 on conflict(employee_id,leave_type,period_start) do nothing returning id into result_id;
 if result_id is null then select ce.id into result_id from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=v_period_start; end if;
 return result_id;
end $$;
revoke all on function public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_leave_submit(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_outlet uuid; v_leave_type text; v_start_date date; v_end_date date; v_duration text; v_half_period text; v_reason text; v_days numeric; v_row public.crew_leave_requests%rowtype; v_year date; v_entitlement uuid; v_balance jsonb; v_requested numeric;
begin
 v_employee:=public.crew_session_employee(p_token);
 if jsonb_typeof(p_payload)<>'object' or p_payload ?| array['employee_id','status','reviewed_by','approved','requested_days','balance','available','used','pending'] then raise exception using errcode='22023',message='Leave request payload is invalid.'; end if;
 v_leave_type:=p_payload->>'leave_type'; v_duration:=coalesce(p_payload->>'duration_type','full_day'); v_half_period:=nullif(p_payload->>'half_day_period',''); v_reason:=btrim(coalesce(p_payload->>'reason',''));
 begin v_start_date:=(p_payload->>'start_date')::date; v_end_date:=(p_payload->>'end_date')::date; exception when others then raise exception using errcode='22023',message='Valid leave dates are required.'; end;
 if v_leave_type not in ('annual','medical','unpaid','other') or v_duration not in ('full_day','half_day') or v_end_date<v_start_date or (v_duration='half_day' and (v_start_date<>v_end_date or v_half_period not in ('am','pm'))) or (v_duration='full_day' and v_half_period is not null) then raise exception using errcode='22023',message='Leave type, dates, or duration are invalid.'; end if;
 if v_start_date<timezone('Asia/Kuala_Lumpur',now())::date then raise exception using errcode='22023',message='Leave requests cannot start in the past.'; end if;
 if length(v_reason)<2 or length(v_reason)>1000 then raise exception using errcode='22023',message='A brief reason is required.'; end if;
 v_outlet:=public.crew_resolve_employee_outlet(v_employee); if v_outlet is null then raise exception using errcode='22023',message='Your employment outlet is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||v_employee::text));
 if exists(select 1 from public.crew_leave_requests r where r.employee_id=v_employee and r.status in ('pending','approved') and daterange(r.start_date,r.end_date,'[]') && daterange(v_start_date,v_end_date,'[]')) then raise exception using errcode='23P01',message='This request overlaps an existing pending or approved leave.'; end if;
 v_year:=date_trunc('year',v_start_date)::date;
 while v_year<=date_trunc('year',v_end_date)::date loop
   v_entitlement:=public.crew_leave_ensure_entitlement(v_employee,v_leave_type,v_year,v_outlet,null); v_balance:=public.crew_leave_entitlement_balance(v_entitlement,v_start_date);
   v_requested:=public.crew_leave_days_in_period(v_start_date,v_end_date,v_duration,v_year,(v_year+interval '1 year'-interval '1 day')::date);
   if coalesce((v_balance->>'balance_enforced')::boolean,true) and coalesce((v_balance->>'available')::numeric,0)<v_requested then raise exception using errcode='22023',message='Insufficient leave balance for this request.'; end if;
   v_year:=(v_year+interval '1 year')::date;
 end loop;
 v_days:=public.crew_leave_requested_days(v_start_date,v_end_date,v_duration);
 insert into public.crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,half_day_period,requested_days,reason,document_status,submitted_by)
 values(v_employee,v_outlet,v_leave_type,v_start_date,v_end_date,v_duration,v_half_period,v_days,v_reason,case when v_leave_type='medical' then 'not_uploaded' else 'not_required' end,v_employee) returning * into v_row;
 insert into public.crew_leave_audit(request_id,action,actor_type,actor_employee_id,detail) values(v_row.id,'submitted','crew',v_employee,jsonb_build_object('balance_reserved',true));
 return jsonb_build_object('id',v_row.id,'status',v_row.status,'leave_type',v_row.leave_type,'start_date',v_row.start_date,'end_date',v_row.end_date,'duration_type',v_row.duration_type,'half_day_period',v_row.half_day_period,'requested_days',v_row.requested_days,'submitted_at',v_row.submitted_at,'document_status',v_row.document_status);
end $$;
revoke all on function public.crew_leave_submit(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_leave_submit(text,jsonb) to anon,authenticated;

create or replace function public.crew_leave_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; outlet uuid; rows jsonb; balances jsonb:='[]'::jsonb; leave_type text; entitlement uuid;
begin
 employee:=public.crew_session_employee(p_token); outlet:=public.crew_resolve_employee_outlet(employee);
 foreach leave_type in array array['annual','medical','unpaid','other'] loop entitlement:=public.crew_leave_ensure_entitlement(employee,leave_type,date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,outlet,null); balances:=balances||jsonb_build_array(public.crew_leave_entitlement_balance(entitlement)); end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',case when r.status='rejected' then r.rejection_reason else null end,'can_cancel',r.status='pending') order by r.start_date desc,r.submitted_at desc),'[]'::jsonb) into rows from public.crew_leave_requests r where r.employee_id=employee;
 return jsonb_build_object('balances',balances,'requests',rows,'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'leave_type',a.leave_type,'start_date',a.start_date,'end_date',a.end_date,'duration_type',a.duration_type,'half_day_period',a.half_day_period) order by a.start_date) from public.crew_approved_leaves a where a.employee_id=employee and a.end_date>=timezone('Asia/Kuala_Lumpur',now())::date),'[]'::jsonb));
end $$;
revoke all on function public.crew_leave_mobile(text) from public,anon,authenticated;
grant execute on function public.crew_leave_mobile(text) to anon,authenticated;

create or replace function public.crew_leave_admin_data(p_outlet_id uuid,p_from date default null,p_to date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rows jsonb; balances jsonb:='[]'::jsonb; policies jsonb; employee_row record; leave_type text; entitlement uuid;
begin
 if auth.uid() is null or not (public.current_user_has_permission('crew_leave.view') or public.current_user_has_permission('crew_leave_balance.view')) or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Leave requests are unavailable for this outlet.'; end if;
 for employee_row in select e.id,coalesce(e.nickname,e.full_name) as name,e.position from public.employees e where public.crew_resolve_employee_outlet(e.id)=p_outlet_id and coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated') loop
  foreach leave_type in array array['annual','medical','unpaid','other'] loop entitlement:=public.crew_leave_ensure_entitlement(employee_row.id,leave_type,date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,p_outlet_id,auth.uid()); balances:=balances||jsonb_build_array(public.crew_leave_entitlement_balance(entitlement)||jsonb_build_object('employee',jsonb_build_object('id',employee_row.id,'name',employee_row.name,'position',employee_row.position))); end loop;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(p)-array['updated_by'] order by p.leave_type),'[]'::jsonb) into policies from public.crew_leave_policies p where p.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee',jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position),'outlet',jsonb_build_object('id',o.id,'name',o.name),'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',r.rejection_reason,'balance_context',(select public.crew_leave_entitlement_balance(x.id,r.start_date) from public.crew_leave_entitlements x where x.employee_id=r.employee_id and x.leave_type=r.leave_type and x.period_start=date_trunc('year',r.start_date)::date),'roster_context',coalesce((select jsonb_agg(jsonb_build_object('date',d.d::date,'schedule',public.crew_roster_employee_day(r.employee_id,d.d::date)) order by d.d) from generate_series(r.start_date,r.end_date,interval '1 day') d(d)),'[]'::jsonb)) order by case r.status when 'pending' then 1 else 2 end,r.submitted_at desc),'[]'::jsonb) into rows
 from public.crew_leave_requests r join public.employees e on e.id=r.employee_id join public.outlets o on o.id=r.employment_outlet_id where r.employment_outlet_id=p_outlet_id and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to);
 return jsonb_build_object('requests',rows,'balances',balances,'policies',policies);
end $$;
revoke all on function public.crew_leave_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_leave_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_leave_policy_save(p_outlet_id uuid,p_leave_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.crew_leave_policies%rowtype; annual_days numeric; carry_cap numeric; expiry_month int; expiry_day int;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave_settings.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Leave settings permission is required.'; end if;
 if jsonb_typeof(p_payload)<>'object' or p_leave_type not in ('annual','medical','unpaid','other') then raise exception using errcode='22023',message='Leave policy payload is invalid.'; end if;
 begin annual_days:=coalesce((p_payload->>'annual_days')::numeric,0); carry_cap:=coalesce((p_payload->>'max_carry_forward_days')::numeric,0); expiry_month:=nullif(p_payload->>'carry_forward_expiry_month','')::int; expiry_day:=nullif(p_payload->>'carry_forward_expiry_day','')::int; exception when others then raise exception using errcode='22023',message='Leave policy values are invalid.'; end;
 if annual_days<0 or carry_cap<0 or (coalesce((p_payload->>'carry_forward_enabled')::boolean,false) and (expiry_month not between 1 and 12 or expiry_day not between 1 and 31)) then raise exception using errcode='22023',message='Leave policy values are invalid.'; end if;
 insert into public.crew_leave_policies(outlet_id,leave_type,annual_days,proration_enabled,balance_enforced,carry_forward_enabled,max_carry_forward_days,carry_forward_expiry_month,carry_forward_expiry_day,updated_by,updated_at)
 values(p_outlet_id,p_leave_type,annual_days,coalesce((p_payload->>'proration_enabled')::boolean,false),coalesce((p_payload->>'balance_enforced')::boolean,true),coalesce((p_payload->>'carry_forward_enabled')::boolean,false),carry_cap,expiry_month,expiry_day,auth.uid(),now())
 on conflict(outlet_id,leave_type) do update set annual_days=excluded.annual_days,proration_enabled=excluded.proration_enabled,balance_enforced=excluded.balance_enforced,carry_forward_enabled=excluded.carry_forward_enabled,max_carry_forward_days=excluded.max_carry_forward_days,carry_forward_expiry_month=excluded.carry_forward_expiry_month,carry_forward_expiry_day=excluded.carry_forward_expiry_day,updated_by=auth.uid(),updated_at=now() returning * into result;
 return to_jsonb(result)-array['updated_by'];
end $$;
revoke all on function public.crew_leave_policy_save(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_leave_policy_save(uuid,text,jsonb) to authenticated;

create or replace function public.crew_leave_adjust(p_entitlement_id uuid,p_amount numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entitlement public.crew_leave_entitlements%rowtype; adjustment public.crew_leave_adjustments%rowtype;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave_balance.adjust') then raise exception using errcode='42501',message='Leave adjustment permission is required.'; end if;
 select * into entitlement from public.crew_leave_entitlements where id=p_entitlement_id for update;
 if entitlement.id is null or not public.current_user_can_access_outlet(entitlement.outlet_id) then raise exception using errcode='42501',message='Leave entitlement is outside your outlet scope.'; end if;
 if p_amount=0 or abs(p_amount)>366 or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception using errcode='22023',message='A valid adjustment and reason are required.'; end if;
 insert into public.crew_leave_adjustments(entitlement_id,amount,reason,adjusted_by) values(entitlement.id,p_amount,btrim(p_reason),auth.uid()) returning * into adjustment;
 return jsonb_build_object('adjustment',jsonb_build_object('id',adjustment.id,'amount',adjustment.amount,'reason',adjustment.reason,'adjusted_at',adjustment.adjusted_at),'balance',public.crew_leave_entitlement_balance(entitlement.id));
end $$;
revoke all on function public.crew_leave_adjust(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.crew_leave_adjust(uuid,numeric,text) to authenticated;

-- Re-check reserved balance under the same employee advisory lock before approval.
create or replace function public.crew_leave_review(p_request_id uuid,p_decision text,p_rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crew_leave_requests%rowtype; approved public.crew_approved_leaves%rowtype; d date; projection_outlet uuid; current_schedule jsonb; template_id uuid; entitlement uuid; balance jsonb; year_start date;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave.review') then raise exception using errcode='42501',message='Leave review permission is required.'; end if;
 select * into row from public.crew_leave_requests where id=p_request_id for update;
 if row.id is null or not public.current_user_can_access_outlet(row.employment_outlet_id) then raise exception using errcode='42501',message='Leave request is outside your outlet scope.'; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||row.employee_id::text));
 if row.status<>'pending' then raise exception using errcode='22023',message='Only a pending leave request can be reviewed.'; end if;
 if p_decision not in ('approve','reject') then raise exception using errcode='22023',message='Review decision is invalid.'; end if;
 if p_decision='reject' then
  if length(btrim(coalesce(p_rejection_reason,'')))<2 then raise exception using errcode='22023',message='A rejection reason is required.'; end if;
  update public.crew_leave_requests set status='rejected',rejection_reason=left(btrim(p_rejection_reason),1000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=row.id returning * into row;
  insert into public.crew_leave_audit(request_id,action,actor_type,actor_user_id,detail) values(row.id,'rejected','admin',auth.uid(),jsonb_build_object('reason',row.rejection_reason));
 else
  year_start:=date_trunc('year',row.start_date)::date;
  while year_start<=date_trunc('year',row.end_date)::date loop entitlement:=public.crew_leave_ensure_entitlement(row.employee_id,row.leave_type,year_start,row.employment_outlet_id,auth.uid()); balance:=public.crew_leave_entitlement_balance(entitlement,row.start_date); if coalesce((balance->>'balance_enforced')::boolean,true) and coalesce((balance->>'available')::numeric,0)<0 then raise exception using errcode='22023',message='Insufficient leave balance. Reject or adjust the entitlement before approval.'; end if; year_start:=(year_start+interval '1 year')::date; end loop;
  if exists(select 1 from public.crew_approved_leaves a where a.employee_id=row.employee_id and daterange(a.start_date,a.end_date,'[]') && daterange(row.start_date,row.end_date,'[]')) then raise exception using errcode='23P01',message='This leave overlaps another approved leave.'; end if;
  update public.crew_leave_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=row.id returning * into row;
  insert into public.crew_approved_leaves(request_id,employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,half_day_period,approved_by) values(row.id,row.employee_id,row.employment_outlet_id,row.leave_type,row.start_date,row.end_date,row.duration_type,row.half_day_period,auth.uid()) returning * into approved;
  for d in select generate_series(row.start_date,row.end_date,interval '1 day')::date loop current_schedule:=public.crew_roster_employee_day(row.employee_id,d); projection_outlet:=coalesce(nullif(current_schedule->>'outlet_id','')::uuid,row.employment_outlet_id); insert into public.crew_leave_roster_projections(approved_leave_id,employee_id,roster_date,outlet_id,leave_type,superseded_roster_entry,source_publication_id,projected_by) values(approved.id,row.employee_id,d,projection_outlet,row.leave_type,nullif(current_schedule,'null'::jsonb),nullif(current_schedule->>'publication_id','')::uuid,auth.uid()); select id into template_id from public.shift_templates where outlet_id=projection_outlet and code=case row.leave_type when 'annual' then 'AL' when 'medical' then 'MC' when 'unpaid' then 'UL' else 'OL' end limit 1; insert into public.duty_rosters(outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,break_minutes,status,remark,created_by,updated_by,source,approved_leave_id) values(projection_outlet,row.employee_id,d,template_id,null,null,0,'draft',public.crew_leave_label(row.leave_type),auth.uid(),auth.uid(),'approved_leave',approved.id) on conflict(outlet_id,employee_id,roster_date) do update set shift_template_id=excluded.shift_template_id,start_time=null,end_time=null,break_minutes=0,status='draft',remark=excluded.remark,updated_by=auth.uid(),updated_at=now(),source='approved_leave',approved_leave_id=approved.id;
  end loop;
  insert into public.crew_leave_audit(request_id,action,actor_type,actor_user_id,detail) values(row.id,'approved','admin',auth.uid(),jsonb_build_object('approved_leave_id',approved.id,'balance_checked',true));
 end if;
 return jsonb_build_object('id',row.id,'status',row.status,'reviewed_at',row.reviewed_at,'rejection_reason',row.rejection_reason,'approved_leave_id',approved.id);
end $$;
revoke all on function public.crew_leave_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_leave_review(uuid,text,text) to authenticated;

-- Backfill current-year grants. Existing requests and approvals remain untouched;
-- their evidence is counted dynamically by the balance authority.
do $$ declare employee_row record; leave_type text; outlet uuid; begin
 for employee_row in select e.id from public.employees e where coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated') loop outlet:=public.crew_resolve_employee_outlet(employee_row.id); if outlet is not null then foreach leave_type in array array['annual','medical','unpaid','other'] loop perform public.crew_leave_ensure_entitlement(employee_row.id,leave_type,date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,outlet,null); end loop; end if; end loop;
end $$;
