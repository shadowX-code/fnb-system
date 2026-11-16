-- Connection configuration is not a permission or an AI grant registry.
-- Preserve the prior enablement; the legacy column remains for migration compatibility only.
alter table feedx_integrations.native_assistant_config
 add column capability_connections jsonb not null default '{}'::jsonb
 check (jsonb_typeof(capability_connections)='object');
update feedx_integrations.native_assistant_config
 set capability_connections=jsonb_build_object('read_factory_finished_goods',factory_reads_enabled);

-- Patch the canonical service without replacing its later History/Memory behavior.
do $migration$
declare definition text:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure); old text; replacement text;
begin
 old:=substring(definition from ' if p_action=''features'' then[\s\S]*? end if;\n if p_action=''voice_test_record''');
 if old is null then raise exception 'native_assistant_configuration_contract_changed'; end if;
 replacement:=$branch$ if p_action='capability_connection' then
  if (p_payload->>'expected_revision')::bigint is distinct from c.revision then raise exception 'configuration_changed' using errcode='40001'; end if;
  -- Only the implemented READ is connectable. New code contracts require an explicit migration.
  if p_payload->>'operation' is distinct from 'read_factory_finished_goods'
    or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean'
    or (p_payload - array['operation','enabled','expected_revision']) <> '{}'::jsonb
  then raise exception 'configuration_invalid' using errcode='22023'; end if;
  if c.capability_connections->(p_payload->>'operation') is distinct from p_payload->'enabled' then
   update feedx_integrations.native_assistant_config
    set capability_connections=jsonb_set(capability_connections,array[p_payload->>'operation'],p_payload->'enabled'),
        revision=revision+1,updated_by=p_actor,updated_at=now()
    where singleton returning * into c;
  end if;
  return jsonb_build_object('config',to_jsonb(c)-'updated_by','can_edit',can_edit);
 end if;
 if p_action='voice_test_record'$branch$;
 definition:=replace(definition,old,replacement);
 definition:=replace(definition,'''features''','''capability_connection''');
 definition:=replace(definition,$old$to_jsonb(c)-'updated_by'$old$,$new$to_jsonb(c)-'updated_by'-'factory_reads_enabled'$new$);
 execute definition;
end $migration$;
revoke all on function public.native_assistant_service(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.native_assistant_service(uuid,text,jsonb) to service_role;
