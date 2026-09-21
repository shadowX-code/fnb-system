-- Correct the V1 date pattern without changing any contract record or template.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.employment_contract_terms_valid(jsonb)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, '''^\\d{4}-\\d{2}-\\d{2}$''', '''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''');
  execute v_definition;
end $$;

revoke all on function public.employment_contract_terms_valid(jsonb) from public,anon,authenticated;
