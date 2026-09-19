-- Return the committed reversal snapshot from the same trusted transaction.
-- This prevents a successful inventory reversal from being reported as failed
-- when an immediate follow-up REST hydration is interrupted.
create or replace function public.factory_reverse_finished_good_dispatch_result(
  p_dispatch_id uuid,
  p_reason text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_id uuid;
  v_result jsonb;
begin
  v_dispatch_id := public.factory_reverse_finished_good_dispatch(
    p_dispatch_id,
    p_reason,
    p_request_id
  );

  select public.factory_get_finished_good_dispatch_result(v_dispatch_id)
    || jsonb_build_object(
      'reversal_id', dispatch.reversal_id,
      'reversal_request_id', dispatch.reversal_request_id,
      'reversal_reason', dispatch.reversal_reason,
      'reversed_by', dispatch.reversed_by,
      'reversed_by_name', coalesce(reverser.nickname, reverser.full_name),
      'reversed_at', dispatch.reversed_at
    )
  into v_result
  from public.factory_finished_good_dispatches dispatch
  left join public.employees reverser on reverser.id = dispatch.reversed_by
  where dispatch.id = v_dispatch_id;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'Reversed Finished Goods Dispatch snapshot is unavailable.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.factory_reverse_finished_good_dispatch_result(uuid, text, uuid)
from public, anon;
grant execute on function public.factory_reverse_finished_good_dispatch_result(uuid, text, uuid)
to authenticated;

comment on function public.factory_reverse_finished_good_dispatch_result(uuid, text, uuid) is
  'Atomically reverses a completed Finished Goods Dispatch and returns its committed canonical detail snapshot.';
