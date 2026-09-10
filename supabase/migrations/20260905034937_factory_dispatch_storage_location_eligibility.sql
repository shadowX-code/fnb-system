-- Finished Goods Dispatch consumes canonical storage-enabled Location state.
-- This is a contract-only repair: it rewrites no Finished Goods, batch, Dispatch,
-- allocation, or movement data. The exact source checks make an unexpected
-- deployed Dispatch contract fail loudly instead of broadening eligibility.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_updated_definition text;
begin
  foreach v_function in array array[
    'public.factory_replace_finished_good_dispatch_draft_items(uuid,date,jsonb)'::regprocedure,
    'public.factory_complete_finished_good_dispatch_locked(uuid)'::regprocedure,
    'public.factory_get_finished_good_dispatch_result(uuid)'::regprocedure,
    'public.factory_get_finished_good_batch_availability(uuid,uuid,date)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;

    if position('finished goods area' in lower(v_definition)) = 0 then
      raise exception 'Factory Dispatch storage eligibility contract was not found in %.', v_function;
    end if;

    v_updated_definition := replace(
      v_definition,
      'lower(coalesce(location.location_type, '''')) = ''finished goods area''',
      'coalesce(location.is_storage_location, false)'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'lower(coalesce(location.location_type, '''')) <> ''finished goods area''',
      'coalesce(location.is_storage_location, false) is not true'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'Storage location is not a Finished Goods Area',
      'Storage location is not storage-enabled'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'Not a Finished Goods Area',
      'Storage Location Is Not Storage Enabled'
    );
    v_updated_definition := replace(
      v_updated_definition,
      'active Finished Goods storage location',
      'active storage-enabled location'
    );

    if v_updated_definition = v_definition then
      raise exception 'Factory Dispatch storage eligibility contract could not be updated in %.', v_function;
    end if;

    execute v_updated_definition;
  end loop;
end;
$$;
