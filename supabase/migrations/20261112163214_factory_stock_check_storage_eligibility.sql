-- Align the compatibility writer with the existing stock-check Submit/Approval policy.
do $migration$
declare
  v_writer constant regprocedure := 'feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(uuid,uuid,date,text,text,uuid,jsonb)'::regprocedure;
  v_definition text;
  v_old constant text := 'or lower(coalesce(v_location.location_type, '''')) <> ''finished goods area'' then';
begin
  if (select md5(prosrc) from pg_proc where oid = v_writer) is distinct from 'e34ef5229d77da044e0c8d17debb6c4b' then
    raise exception 'Unexpected Finished Goods Stock Check compatibility writer. Review its storage validation before applying.';
  end if;
  v_definition := pg_get_functiondef(v_writer);
  if strpos(v_definition, v_old) = 0 then
    raise exception 'Expected Finished Goods Stock Check storage predicate was not found.';
  end if;
  execute replace(v_definition, v_old, 'or v_location.is_storage_location is not true then');
end;
$migration$;
