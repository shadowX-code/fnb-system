-- Reward payouts must never exceed the server-authorized unlocked pool, including
-- the cent-level remainder that can be introduced by per-employee rounding.

create or replace function public.crew_reward_reconcile_rounded_pool()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  payout_total numeric(12,2);
  overage numeric(12,2);
  target_entry_id uuid;
  target_amount numeric(12,2);
begin
  if new.status <> 'review' or new.unlocked_pool is null then
    return new;
  end if;

  select coalesce(sum(e.final_payout), 0)::numeric(12,2)
    into payout_total
  from public.crew_reward_entries e
  where e.cycle_id = new.id;

  if payout_total > new.unlocked_pool then
    overage := payout_total - new.unlocked_pool;

    select e.id, e.final_payout
      into target_entry_id, target_amount
    from public.crew_reward_entries e
    where e.cycle_id = new.id
      and e.status = 'qualified'
      and e.final_payout >= overage
    order by e.final_payout desc, e.id
    limit 1;

    if target_entry_id is null then
      raise exception using
        errcode = '22003',
        message = 'Rounded Reward payout cannot be reconciled within the unlocked pool.';
    end if;

    update public.crew_reward_entries
       set calculated_reward = round(greatest(calculated_reward - overage, 0), 2),
           final_payout = round(greatest(final_payout - overage, 0), 2),
           source_snapshot = source_snapshot || jsonb_build_object('rounding_reconciliation', overage),
           updated_at = now()
     where id = target_entry_id;

    payout_total := new.unlocked_pool;
  end if;

  new.estimated_payout := payout_total;
  new.actual_payout := payout_total;
  new.unused_amount := round(new.unlocked_pool - payout_total, 2);
  return new;
end;
$$;

revoke all on function public.crew_reward_reconcile_rounded_pool() from public,anon,authenticated;

drop trigger if exists crew_reward_reconcile_rounded_pool on public.crew_reward_cycles;
create trigger crew_reward_reconcile_rounded_pool
before update of status,unlocked_pool,estimated_payout,actual_payout on public.crew_reward_cycles
for each row
when (new.status = 'review')
execute function public.crew_reward_reconcile_rounded_pool();

create or replace function public.crew_reward_enforce_entry_pool_cap()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  cycle_status text;
  unlocked numeric(12,2);
  next_total numeric(12,2);
begin
  select c.status, c.unlocked_pool
    into cycle_status, unlocked
  from public.crew_reward_cycles c
  where c.id = new.cycle_id;

  if cycle_status = 'review' and unlocked is not null then
    select (coalesce(sum(e.final_payout), 0) + new.final_payout)::numeric(12,2)
      into next_total
    from public.crew_reward_entries e
    where e.cycle_id = new.cycle_id
      and e.id <> new.id;

    if next_total > unlocked then
      raise exception using
        errcode = '22003',
        message = 'Reward payout exceeds the unlocked Reward Pool.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.crew_reward_enforce_entry_pool_cap() from public,anon,authenticated;

drop trigger if exists crew_reward_entry_pool_cap on public.crew_reward_entries;
create trigger crew_reward_entry_pool_cap
before update of final_payout on public.crew_reward_entries
for each row
execute function public.crew_reward_enforce_entry_pool_cap();

alter table public.crew_reward_cycles
  add constraint crew_reward_cycles_actual_within_unlocked_pool
  check (actual_payout is null or unlocked_pool is null or actual_payout <= unlocked_pool);
