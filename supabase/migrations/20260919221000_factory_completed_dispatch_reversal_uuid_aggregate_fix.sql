-- PostgreSQL does not provide min(uuid) on every supported project version.
-- Correct the deployed function without replaying its schema migration.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.factory_reverse_finished_good_dispatch(uuid,text,uuid)'::regprocedure)
  into v_definition;
  if position('min(movement.id)' in v_definition) = 0 then
    raise exception 'Dispatch reversal UUID aggregate correction target was not found.';
  end if;
  execute replace(
    v_definition,
    'min(movement.id)',
    '(array_agg(movement.id order by movement.id))[1]'
  );
end;
$$;
