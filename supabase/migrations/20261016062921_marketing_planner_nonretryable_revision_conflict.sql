-- Business revision conflicts must not enter PostgREST's serialization retry loop.
-- Patch the installed body so newer Planner workflow changes remain intact.
do $migration$
declare
  target regprocedure := 'public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_clause text := 'errcode=''40001'',message=''Task changed. Reload before continuing.''';
  new_clause text := 'errcode=''PT409'',message=''Task changed. Reload before continuing.''';
begin
  if position(old_clause in definition) = 0 and position(new_clause in definition) > 0 then
    return;
  end if;
  if (length(definition) - length(replace(definition, old_clause, ''))) / length(old_clause) <> 1 then
    raise exception 'Planner conflict guard differs from the verified contract; inspect before applying.';
  end if;
  execute replace(definition, old_clause, new_clause);
end;
$migration$;
