-- Only eligible finalized entries transition to Paid. Ineligible and awaiting
-- entries remain immutable and are not touched by the payment transition.
create or replace function public.crew_reward_mark_paid(p_cycle_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cycle public.crew_reward_cycles%rowtype;
begin
 select * into cycle from public.crew_reward_cycles where id=p_cycle_id for update;
 if cycle.id is null then raise exception using errcode='P0002',message='Reward cycle was not found.'; end if;
 if not public.current_user_has_permission('crew_reward.mark_paid') or not public.current_user_can_access_outlet(cycle.outlet_id) then raise exception using errcode='42501',message='Reward payment authority is required.'; end if;
 if cycle.status<>'finalized' then raise exception using errcode='55000',message='Only a finalized Reward cycle can be marked paid.'; end if;
 update public.crew_reward_entries set status='paid',updated_at=now() where cycle_id=cycle.id and status='finalized';
 update public.crew_reward_cycles set status='paid',paid_at=now(),paid_by=auth.uid(),updated_at=now() where id=cycle.id returning * into cycle;
 return to_jsonb(cycle);
end; $$;
revoke all on function public.crew_reward_mark_paid(uuid) from public,anon,authenticated;
grant execute on function public.crew_reward_mark_paid(uuid) to authenticated;
