-- Reversed Dispatch allocations remain immutable Batch Traceability history,
-- but must not contribute to active completed-dispatch quantity.
do $$
declare
  v_definition text;
  v_target text := $target$filter (where lower(coalesce(dispatch.status, '')) = 'completed'), '[]'::jsonb) as completed_allocations$target$;
  v_replacement text := $replacement$filter (where lower(coalesce(dispatch.status, '')) in ('completed', 'reversed')), '[]'::jsonb) as completed_allocations$replacement$;
begin
  select pg_get_functiondef('public.factory_list_finished_good_batch_traceability(date,date,uuid,text,text,text,uuid,text,text)'::regprocedure)
  into v_definition;
  if position(v_target in v_definition) = 0 then
    raise exception 'Batch Traceability Dispatch history correction target was not found.';
  end if;
  execute replace(v_definition, v_target, v_replacement);
end;
$$;
