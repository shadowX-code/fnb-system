-- Restore Production completion fingerprinting when pgcrypto is installed in
-- Supabase's extensions schema. Keep the applied completion function otherwise
-- byte-for-byte equivalent to its current definition.

do $migration$
declare
  v_function regprocedure := to_regprocedure(
    'public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb)'
  );
  v_definition text;
  v_unqualified_digest text := 'digest(v_canonical::text, ''sha256'')';
  v_qualified_digest text := 'extensions.digest(v_canonical::text, ''sha256''::text)';
begin
  if v_function is null then
    raise exception 'Required Production completion function is missing.';
  end if;

  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'Required extensions.digest(text,text) function is missing.';
  end if;

  select pg_get_functiondef(v_function::oid)
  into v_definition;

  if position(v_qualified_digest in v_definition) > 0 then
    return;
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_unqualified_digest, ''))
  ) / length(v_unqualified_digest) <> 1 then
    raise exception 'Expected exactly one unqualified Production fingerprint digest call.';
  end if;

  execute replace(v_definition, v_unqualified_digest, v_qualified_digest);
end;
$migration$;

revoke execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid, jsonb)
to authenticated;

