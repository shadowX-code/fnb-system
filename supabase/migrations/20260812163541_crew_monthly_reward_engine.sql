-- FeedX Crew Phase D: versioned monthly Reward engine.
-- All monetary calculations are server authoritative. Public tables are deny-all;
-- Admin and Crew access is exposed only through scoped RPCs.

insert into public.permissions(code,module,description) values
 ('crew_reward.view','Crew Reward','View outlet-scoped monthly Reward cycles.'),
 ('crew_reward.manage','Crew Reward','Create and calculate outlet Reward cycles.'),
 ('crew_reward.finalize','Crew Reward','Finalize immutable monthly Reward results.'),
 ('crew_reward.mark_paid','Crew Reward','Mark a finalized Reward cycle as paid.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in
 ('crew_reward.view','crew_reward.manage','crew_reward.finalize','crew_reward.mark_paid')
on conflict do nothing;

create table public.crew_reward_cycles (
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id),
 period_start date not null,
 configured_pool numeric(12,2) not null check(configured_pool>=0),
 minimum_performance numeric(5,2) not null default 60 check(minimum_performance between 0 and 100),
 status text not null default 'draft' check(status in ('draft','review','finalized','paid')),
 calculation_version text not null default 'reward-v1',
 team_average_performance numeric(5,2),
 pool_unlock_rate numeric(5,4),
 unlocked_pool numeric(12,2),
 estimated_payout numeric(12,2),
 actual_payout numeric(12,2),
 unused_amount numeric(12,2),
 calculated_at timestamptz,
 finalized_at timestamptz,
 finalized_by uuid references auth.users(id),
 paid_at timestamptz,
 paid_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 unique(outlet_id,period_start),
 check(extract(day from period_start)=1),
 check(unlocked_pool is null or unlocked_pool<=configured_pool),
 check(actual_payout is null or actual_payout<=configured_pool)
);

create table public.crew_reward_entries (
 id uuid primary key default gen_random_uuid(),
 cycle_id uuid not null references public.crew_reward_cycles(id) on delete cascade,
 employee_id uuid not null references public.employees(id),
 employee_name text not null,
 position text,
 performance_result_id uuid references public.crew_performance_results(id),
 performance_score numeric(5,2),
 eligible_hours numeric(10,2) not null default 0 check(eligible_hours>=0),
 contribution_share numeric(10,8) not null default 0 check(contribution_share between 0 and 1),
 performance_factor numeric(6,4) not null default 0 check(performance_factor between 0 and 1.1),
 base_reward numeric(12,2) not null default 0 check(base_reward>=0),
 calculated_reward numeric(12,2) not null default 0 check(calculated_reward>=0),
 adjustment_amount numeric(12,2) not null default 0,
 final_payout numeric(12,2) not null default 0 check(final_payout>=0),
 status text not null check(status in ('awaiting_performance','not_eligible','estimated','qualified','finalized','paid')),
 eligibility_reason text not null,
 source_snapshot jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(cycle_id,employee_id)
);

create table public.crew_reward_adjustments (
 id uuid primary key default gen_random_uuid(),
 cycle_id uuid not null references public.crew_reward_cycles(id),
 reward_entry_id uuid not null references public.crew_reward_entries(id),
 previous_amount numeric(12,2) not null,
 adjustment_amount numeric(12,2) not null check(adjustment_amount<>0),
 next_amount numeric(12,2) not null check(next_amount>=0),
 reason text not null check(char_length(btrim(reason)) between 5 and 500),
 adjusted_by uuid not null references auth.users(id),
 adjusted_at timestamptz not null default now()
);

create index crew_reward_cycles_outlet_period_idx on public.crew_reward_cycles(outlet_id,period_start desc);
create index crew_reward_entries_employee_period_idx on public.crew_reward_entries(employee_id,cycle_id);
create index crew_reward_adjustments_entry_idx on public.crew_reward_adjustments(reward_entry_id,adjusted_at desc);

alter table public.crew_reward_cycles enable row level security;
alter table public.crew_reward_entries enable row level security;
alter table public.crew_reward_adjustments enable row level security;
revoke all on public.crew_reward_cycles,public.crew_reward_entries,public.crew_reward_adjustments from public,anon,authenticated;

create or replace function public.crew_reward_performance_factor(p_score numeric,p_minimum numeric default 60)
returns numeric language sql immutable security definer set search_path=public as $$
 select case when p_score is null or p_score<p_minimum then 0 when p_score<70 then .5 when p_score<80 then .75 when p_score<90 then 1 else 1.1 end::numeric;
$$;
revoke all on function public.crew_reward_performance_factor(numeric,numeric) from public,anon,authenticated;

create or replace function public.crew_reward_pool_unlock(p_average numeric)
returns numeric language sql immutable security definer set search_path=public as $$
 select case when p_average is null or p_average<60 then 0 when p_average<70 then .5 when p_average<80 then .75 else 1 end::numeric;
$$;
revoke all on function public.crew_reward_pool_unlock(numeric) from public,anon,authenticated;

create or replace function public.crew_reward_eligible_hours(p_employee_id uuid,p_outlet_id uuid,p_period date)
returns numeric language sql stable security definer set search_path=public as $$
 select round(coalesce(sum(extract(epoch from (clock_out_at-clock_in_at))/3600.0),0)::numeric,2)
 from public.crew_attendance_records
 where employee_id=p_employee_id and outlet_id=p_outlet_id and status='completed'
   and clock_in_at>=date_trunc('month',p_period)
   and clock_in_at<date_trunc('month',p_period)+interval '1 month'
   and clock_out_at is not null and clock_out_at>=clock_in_at;
$$;
revoke all on function public.crew_reward_eligible_hours(uuid,uuid,date) from public,anon,authenticated;

create or replace function public.crew_reward_guard_finalized()
returns trigger language plpgsql security definer set search_path=public as $$
declare cycle_status text;
begin
 if tg_table_name='crew_reward_cycles' then
   if old.status in ('finalized','paid') then
     if tg_op='DELETE' then raise exception using errcode='55000',message='Finalized Reward cycles are immutable.'; end if;
     if old.status='finalized' and new.status='paid'
        and new.configured_pool=old.configured_pool and new.calculation_version=old.calculation_version
        and new.unlocked_pool=old.unlocked_pool and new.actual_payout=old.actual_payout then return new; end if;
     raise exception using errcode='55000',message='Finalized Reward cycles are immutable.';
   end if;
   if tg_op='DELETE' then return old; end if; return new;
 end if;
 select status into cycle_status from public.crew_reward_cycles where id=old.cycle_id;
 if cycle_status in ('finalized','paid') then
   if tg_op='UPDATE' and cycle_status='finalized' and old.status='finalized' and new.status='paid'
      and new.final_payout=old.final_payout and new.performance_result_id is not distinct from old.performance_result_id
      and new.eligible_hours=old.eligible_hours and new.performance_score is not distinct from old.performance_score then return new; end if;
   raise exception using errcode='55000',message='Finalized Reward entries are immutable.';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function public.crew_reward_guard_finalized() from public,anon,authenticated;
create trigger crew_reward_cycle_immutable before update or delete on public.crew_reward_cycles for each row execute function public.crew_reward_guard_finalized();
create trigger crew_reward_entry_immutable before update or delete on public.crew_reward_entries for each row execute function public.crew_reward_guard_finalized();

create or replace function public.crew_reward_create_cycle(p_outlet_id uuid,p_period date,p_configured_pool numeric,p_minimum_performance numeric default 60)
returns uuid language plpgsql security definer set search_path=public as $$
declare cycle_id uuid; period date:=date_trunc('month',p_period)::date;
begin
 if not public.current_user_has_permission('crew_reward.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Reward management is unavailable for this outlet.'; end if;
 if p_configured_pool<0 or p_configured_pool>10000000 then raise exception using errcode='22023',message='Reward Pool must be between RM0 and RM10,000,000.'; end if;
 if p_minimum_performance<0 or p_minimum_performance>100 then raise exception using errcode='22023',message='Minimum Performance must be between 0 and 100.'; end if;
 insert into public.crew_reward_cycles(outlet_id,period_start,configured_pool,minimum_performance,created_by)
 values(p_outlet_id,period,round(p_configured_pool,2),p_minimum_performance,auth.uid()) returning id into cycle_id;
 return cycle_id;
end; $$;
revoke all on function public.crew_reward_create_cycle(uuid,date,numeric,numeric) from public,anon,authenticated;
grant execute on function public.crew_reward_create_cycle(uuid,date,numeric,numeric) to authenticated;

create or replace function public.crew_reward_calculate(p_cycle_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cycle public.crew_reward_cycles%rowtype; average_score numeric; unlock_rate numeric; unlocked numeric; total_hours numeric; provisional_total numeric; payout_scale numeric; estimated numeric;
begin
 select * into cycle from public.crew_reward_cycles where id=p_cycle_id for update;
 if cycle.id is null then raise exception using errcode='P0002',message='Reward cycle was not found.'; end if;
 if not public.current_user_has_permission('crew_reward.manage') or not public.current_user_can_access_outlet(cycle.outlet_id) then raise exception using errcode='42501',message='Reward management is unavailable for this outlet.'; end if;
 if cycle.status<>'draft' then raise exception using errcode='55000',message='Only a Draft Reward cycle can be calculated.'; end if;

 select round(avg(r.total_score),2) into average_score
 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
 join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=cycle.outlet_id
 where r.outlet_id=cycle.outlet_id and r.period_start=cycle.period_start and r.status='finalized'
   and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 unlock_rate:=public.crew_reward_pool_unlock(average_score); unlocked:=round(cycle.configured_pool*unlock_rate,2);
 delete from public.crew_reward_entries where cycle_id=cycle.id;

 insert into public.crew_reward_entries(cycle_id,employee_id,employee_name,position,performance_result_id,performance_score,eligible_hours,performance_factor,status,eligibility_reason,source_snapshot)
 select cycle.id,e.id,e.full_name,e.position,r.id,r.total_score,
   public.crew_reward_eligible_hours(e.id,cycle.outlet_id,cycle.period_start),
   public.crew_reward_performance_factor(r.total_score,cycle.minimum_performance),
   case when r.id is null then 'awaiting_performance'
        when public.crew_reward_eligible_hours(e.id,cycle.outlet_id,cycle.period_start)<=0 then 'not_eligible'
        when r.total_score<cycle.minimum_performance then 'not_eligible' else 'estimated' end,
   case when r.id is null then 'Finalized Performance is required.'
        when public.crew_reward_eligible_hours(e.id,cycle.outlet_id,cycle.period_start)<=0 then 'No completed eligible working hours were recorded.'
        when r.total_score<cycle.minimum_performance then format('Performance %s is below the required %s.',round(r.total_score),round(cycle.minimum_performance))
        else 'Eligible from finalized Performance and completed attendance.' end,
   jsonb_build_object('performance_result_id',r.id,'performance_score',r.total_score,'performance_finalized_at',r.finalized_at,'eligible_hours',public.crew_reward_eligible_hours(e.id,cycle.outlet_id,cycle.period_start),'calculation_version','reward-v1')
 from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=cycle.outlet_id and ca.access_state='active'
 left join public.crew_performance_results r on r.employee_id=e.id and r.outlet_id=cycle.outlet_id and r.period_start=cycle.period_start and r.status='finalized'
 where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');

 select coalesce(sum(eligible_hours),0) into total_hours from public.crew_reward_entries where cycle_id=cycle.id and status='estimated';
 update public.crew_reward_entries set contribution_share=case when total_hours>0 then eligible_hours/total_hours else 0 end,
   base_reward=case when total_hours>0 then round(unlocked*(eligible_hours/total_hours),2) else 0 end,
   calculated_reward=case when total_hours>0 then round(unlocked*(eligible_hours/total_hours)*performance_factor,2) else 0 end
 where cycle_id=cycle.id and status='estimated';
 select coalesce(sum(calculated_reward),0) into provisional_total from public.crew_reward_entries where cycle_id=cycle.id and status='estimated';
 payout_scale:=case when provisional_total>unlocked and provisional_total>0 then unlocked/provisional_total else 1 end;
 update public.crew_reward_entries set calculated_reward=round(calculated_reward*payout_scale,2),final_payout=round(calculated_reward*payout_scale,2),status='qualified',
   source_snapshot=source_snapshot||jsonb_build_object('contribution_share',contribution_share,'performance_factor',performance_factor,'pool_unlock_rate',unlock_rate,'unlocked_pool',unlocked,'payout_scale',payout_scale)
 where cycle_id=cycle.id and status='estimated';
 select coalesce(sum(final_payout),0) into estimated from public.crew_reward_entries where cycle_id=cycle.id;
 if estimated>unlocked+.01 or estimated>cycle.configured_pool+.01 then raise exception using errcode='22003',message='Reward calculation exceeded the authorized pool.'; end if;
 update public.crew_reward_cycles set status='review',team_average_performance=average_score,pool_unlock_rate=unlock_rate,unlocked_pool=unlocked,estimated_payout=estimated,actual_payout=estimated,unused_amount=round(unlocked-estimated,2),calculated_at=now(),updated_at=now() where id=cycle.id;
 return jsonb_build_object('cycle_id',cycle.id,'unlocked_pool',unlocked,'estimated_payout',estimated,'status','review');
end; $$;

create or replace function public.crew_reward_adjust(p_entry_id uuid,p_adjustment numeric,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entry public.crew_reward_entries%rowtype; cycle public.crew_reward_cycles%rowtype; next_amount numeric; next_total numeric;
begin
 select * into entry from public.crew_reward_entries where id=p_entry_id for update; select * into cycle from public.crew_reward_cycles where id=entry.cycle_id for update;
 if entry.id is null or cycle.id is null then raise exception using errcode='P0002',message='Reward entry was not found.'; end if;
 if not public.current_user_has_permission('crew_reward.manage') or not public.current_user_can_access_outlet(cycle.outlet_id) then raise exception using errcode='42501',message='Reward adjustment is unavailable.'; end if;
 if cycle.status<>'review' then raise exception using errcode='55000',message='Adjustments are only available during Reward review.'; end if;
 if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='Adjustment reason is required.'; end if;
 next_amount:=round(entry.final_payout+p_adjustment,2);
 if next_amount<0 then raise exception using errcode='22003',message='Adjustment cannot make a payout negative.'; end if;
 select coalesce(sum(final_payout),0)-entry.final_payout+next_amount into next_total from public.crew_reward_entries where cycle_id=cycle.id;
 if next_total>cycle.unlocked_pool+.01 then raise exception using errcode='22003',message='Adjustment would exceed the unlocked Reward Pool.'; end if;
 update public.crew_reward_entries set adjustment_amount=adjustment_amount+p_adjustment,final_payout=next_amount,updated_at=now() where id=entry.id;
 insert into public.crew_reward_adjustments(cycle_id,reward_entry_id,previous_amount,adjustment_amount,next_amount,reason,adjusted_by) values(cycle.id,entry.id,entry.final_payout,p_adjustment,next_amount,btrim(p_reason),auth.uid());
 update public.crew_reward_cycles set actual_payout=round(next_total,2),unused_amount=round(unlocked_pool-next_total,2),updated_at=now() where id=cycle.id;
 return jsonb_build_object('entry_id',entry.id,'final_payout',next_amount,'cycle_total',round(next_total,2));
end; $$;

create or replace function public.crew_reward_finalize(p_cycle_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cycle public.crew_reward_cycles%rowtype; payout numeric;
begin
 select * into cycle from public.crew_reward_cycles where id=p_cycle_id for update;
 if cycle.id is null then raise exception using errcode='P0002',message='Reward cycle was not found.'; end if;
 if not public.current_user_has_permission('crew_reward.finalize') or not public.current_user_can_access_outlet(cycle.outlet_id) then raise exception using errcode='42501',message='Reward finalization is unavailable.'; end if;
 if cycle.status<>'review' then raise exception using errcode='55000',message='Only a reviewed Reward cycle can be finalized.'; end if;
 select coalesce(sum(final_payout),0) into payout from public.crew_reward_entries where cycle_id=cycle.id;
 if payout>cycle.unlocked_pool+.01 or payout>cycle.configured_pool+.01 then raise exception using errcode='22003',message='Reward payout exceeds the authorized pool.'; end if;
 update public.crew_reward_entries set status=case when status='qualified' then 'finalized' else status end,updated_at=now() where cycle_id=cycle.id;
 update public.crew_reward_cycles set status='finalized',actual_payout=round(payout,2),unused_amount=round(unlocked_pool-payout,2),finalized_at=now(),finalized_by=auth.uid(),updated_at=now() where id=cycle.id returning * into cycle;
 return to_jsonb(cycle);
end; $$;

create or replace function public.crew_reward_mark_paid(p_cycle_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cycle public.crew_reward_cycles%rowtype;
begin
 select * into cycle from public.crew_reward_cycles where id=p_cycle_id for update;
 if cycle.id is null then raise exception using errcode='P0002',message='Reward cycle was not found.'; end if;
 if not public.current_user_has_permission('crew_reward.mark_paid') or not public.current_user_can_access_outlet(cycle.outlet_id) then raise exception using errcode='42501',message='Reward payment authority is required.'; end if;
 if cycle.status<>'finalized' then raise exception using errcode='55000',message='Only a finalized Reward cycle can be marked paid.'; end if;
 update public.crew_reward_entries set status=case when status='finalized' then 'paid' else status end,updated_at=now() where cycle_id=cycle.id;
 update public.crew_reward_cycles set status='paid',paid_at=now(),paid_by=auth.uid(),updated_at=now() where id=cycle.id returning * into cycle;
 return to_jsonb(cycle);
end; $$;

create or replace function public.crew_reward_admin_data(p_outlet_id uuid,p_period date default current_date,p_cycle_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare period date:=date_trunc('month',p_period)::date; cycles jsonb; selected public.crew_reward_cycles%rowtype; entries jsonb; adjustments jsonb;
begin
 if not public.current_user_has_permission('crew_reward.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Rewards are unavailable for this outlet.'; end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.period_start desc),'[]'::jsonb) into cycles from public.crew_reward_cycles c where c.outlet_id=p_outlet_id;
 if p_cycle_id is null then select * into selected from public.crew_reward_cycles where outlet_id=p_outlet_id and period_start=period;
 else select * into selected from public.crew_reward_cycles where id=p_cycle_id and outlet_id=p_outlet_id; end if;
 if selected.id is null then return jsonb_build_object('cycles',cycles,'cycle',null,'entries','[]'::jsonb,'adjustments','[]'::jsonb); end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_name),'[]'::jsonb) into entries from public.crew_reward_entries e where e.cycle_id=selected.id;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.adjusted_at desc),'[]'::jsonb) into adjustments from public.crew_reward_adjustments a where a.cycle_id=selected.id;
 return jsonb_build_object('cycles',cycles,'cycle',to_jsonb(selected),'entries',entries,'adjustments',adjustments);
end; $$;

create or replace function public.crew_reward_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare employee uuid; period date:=date_trunc('month',p_period)::date; current_row record; history jsonb;
begin
 employee:=public.crew_session_employee(p_token);
 select c.*,e.performance_score,e.eligible_hours,e.contribution_share,e.performance_factor,e.calculated_reward,e.final_payout,e.status entry_status,e.eligibility_reason
 into current_row from public.crew_reward_entries e join public.crew_reward_cycles c on c.id=e.cycle_id
 where e.employee_id=employee and c.period_start=period order by c.created_at desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('period_start',x.period_start,'amount',x.final_payout,'status',x.entry_status,'paid_at',x.paid_at) order by x.period_start desc),'[]'::jsonb) into history
 from (select c.period_start,e.final_payout,e.status entry_status,c.paid_at from public.crew_reward_entries e join public.crew_reward_cycles c on c.id=e.cycle_id where e.employee_id=employee and c.period_start<period and c.status in ('finalized','paid') order by c.period_start desc limit 12) x;
 if current_row.id is null then return jsonb_build_object('period_start',period,'status','not_available','explanation','No Reward cycle is available for this month.','history',history); end if;
 return jsonb_build_object('period_start',current_row.period_start,'status',current_row.entry_status,'cycle_status',current_row.status,'estimated_reward',current_row.final_payout,'performance_score',current_row.performance_score,'minimum_performance',current_row.minimum_performance,'eligible_hours',current_row.eligible_hours,'contribution_share',current_row.contribution_share,'performance_factor',current_row.performance_factor,'configured_pool',current_row.configured_pool,'unlocked_pool',current_row.unlocked_pool,'pool_unlock_rate',current_row.pool_unlock_rate,'calculation_version',current_row.calculation_version,'eligibility_reason',current_row.eligibility_reason,'history',history);
end; $$;

revoke all on function public.crew_reward_calculate(uuid) from public,anon,authenticated;
revoke all on function public.crew_reward_adjust(uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.crew_reward_finalize(uuid) from public,anon,authenticated;
revoke all on function public.crew_reward_mark_paid(uuid) from public,anon,authenticated;
revoke all on function public.crew_reward_admin_data(uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.crew_reward_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_reward_calculate(uuid),public.crew_reward_adjust(uuid,numeric,text) to authenticated;
grant execute on function public.crew_reward_finalize(uuid),public.crew_reward_mark_paid(uuid),public.crew_reward_admin_data(uuid,date,uuid) to authenticated;
grant execute on function public.crew_reward_mobile(text,date) to anon,authenticated;
grant select,insert,update,delete on public.crew_reward_cycles,public.crew_reward_entries,public.crew_reward_adjustments to service_role;
