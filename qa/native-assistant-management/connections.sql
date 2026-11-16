-- Run in a rollback transaction after the migration. No lasting setting changes.
do $test$
declare actor uuid; original jsonb; result jsonb; rev bigint;
begin
 select updated_by,capability_connections,revision into actor,original,rev from feedx_integrations.native_assistant_config;
 if actor is null then raise exception 'test_requires_existing_settings_actor'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'configuration','{}');
 if result->>'can_edit' <> 'true' then raise exception 'test_requires_existing_settings_editor'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','read_factory_finished_goods','enabled',false,'expected_revision',rev));
 if result->'config'->'capability_connections'->>'read_factory_finished_goods' <> 'false' then raise exception 'disconnect_not_saved'; end if;
 rev:=(result->'config'->>'revision')::bigint;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'status','{}');
 if result->'config'->'capability_connections'->>'read_factory_finished_goods' <> 'false' then raise exception 'disconnect_not_restored'; end if;
 if result->'config' ? 'factory_reads_enabled' then raise exception 'legacy_flag_exposed'; end if;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','read_factory_finished_goods','enabled',true,'expected_revision',rev-1));
  raise exception 'stale_revision_accepted';
 exception when serialization_failure then null; end;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','unregistered_action','enabled',true,'expected_revision',rev));
  raise exception 'unknown_operation_accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','read_factory_finished_goods','enabled',true,'expected_revision',rev));
  raise exception 'direct_client_accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','read_factory_finished_goods','enabled',true,'expected_revision',rev));
 if result->'config'->'capability_connections'->>'read_factory_finished_goods' <> 'true' then raise exception 'connect_not_saved'; end if;
 rev:=(result->'config'->>'revision')::bigint;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'capability_connection',jsonb_build_object('operation','read_factory_finished_goods','enabled',true,'expected_revision',rev));
 if (result->'config'->>'revision')::bigint <> rev then raise exception 'idempotent_connect_changed_revision'; end if;
end $test$;
select 'connection persistence, revision conflicts, unknown operation, direct-client denial and idempotency passed' as verification;
