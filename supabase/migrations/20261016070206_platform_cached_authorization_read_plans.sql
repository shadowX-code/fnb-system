-- SQL SECURITY DEFINER helpers re-plan their nested authorization queries per row.
-- Keep their exact predicates and metadata, using PL/pgSQL's cached static plans.
do $migration$
declare
  f record;
  definition text;
  body text;
begin
  for f in
    select p.oid, p.proname, p.prosrc, l.lanname, expected.definition_md5
    from (values
      ('public.current_user_role_id()', '3b46eb77c0498b1b2634f897f9042109'),
      ('public.current_user_has_direct_permission(text)', '8e97cd95bb20b42db370fc73480a92f7'),
      ('public.current_user_has_permission(text)', '351f2ce83180d81a5866f73eb8b7ca65'),
      ('public.current_user_has_all_outlet_access()', '9e3d4f534a37a60bf4c5775219856444'),
      ('public.current_user_can_access_outlet(uuid)', '80ed0023c1a2da37284f9c9a9cfd8323')
    ) expected(signature, definition_md5)
    join pg_proc p on p.oid=expected.signature::regprocedure
    join pg_language l on l.oid=p.prolang
  loop
    definition := pg_get_functiondef(f.oid);
    if f.lanname <> 'sql' or md5(definition) <> f.definition_md5 then
      raise exception 'Authorization helper % differs from the verified contract', f.proname;
    end if;
    body := E'\nbegin\n  return (\n' || rtrim(f.prosrc, E' \t\n\r;') || E'\n  );\nend;\n';
    definition := replace(definition, 'LANGUAGE sql', 'LANGUAGE plpgsql');
    execute replace(definition, f.prosrc, body);
  end loop;
end;
$migration$;
