begin;
do $test$ declare statement text; begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 foreach statement in array array[
 'select public.factory_delete_product_stock_check_draft(gen_random_uuid())',
 'select public.factory_verify_production_record(gen_random_uuid())',
 'select public.factory_verify_raw_material_receiving(gen_random_uuid())',
 'select public.factory_approve_product_stock_check(gen_random_uuid(),gen_random_uuid())',
 'select public.factory_approve_raw_material_stock_check(gen_random_uuid(),gen_random_uuid())',
 'select public.external_agents_confirm_access(gen_random_uuid(),''{}''::text[],''invalid'')'
 ] loop
  begin execute statement; raise exception 'Unauthorized call unexpectedly succeeded: %',statement;
  exception when insufficient_privilege then null; end;
 end loop;
 if has_function_privilege('anon','public.factory_delete_product_stock_check_draft(uuid)','execute') then raise exception 'Anonymous execute remains';end if;
 if not has_function_privilege('authenticated','public.factory_delete_product_stock_check_draft(uuid)','execute') then raise exception 'Authenticated execute lost';end if;
end $test$;
rollback;
