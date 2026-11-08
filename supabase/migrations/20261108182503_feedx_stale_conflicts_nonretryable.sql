-- Deterministic application conflicts must not be retried as serialization failures.
do $migration$
declare
  definition text;
  updated text;
  stale_turn constant text := 'raise exception ''turn_no_longer_active'' using errcode=''40001''';
  creator_revision constant text := 'raise exception using errcode=''40001'',message=';
begin
  definition := pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
  if cardinality(string_to_array(definition, stale_turn)) <> 3 then
    raise exception 'Unexpected Native Assistant stale-turn definition';
  end if;
  -- The Native Assistant Edge Function already maps 55000 to HTTP 409.
  updated := replace(definition, stale_turn, replace(stale_turn, '40001', '55000'));
  execute updated;

  definition := pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
  if cardinality(string_to_array(definition, creator_revision)) <> 5 then
    raise exception 'Unexpected Creator revision-check definition';
  end if;
  -- PostgREST returns HTTP 409 directly for PT409.
  updated := replace(definition, creator_revision, replace(creator_revision, '40001', 'PT409'));
  execute updated;
end
$migration$;
