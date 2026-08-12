-- Real Staging Growth verification. Read-only except transaction-local claims.
begin;
do $$
declare qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741'; outlet uuid; result jsonb; passed integer:=0; total constant integer:=12;
begin
  select id into outlet from public.outlets where name='Friends Corner';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  result:=public.crew_growth_admin_data(outlet);
  if jsonb_array_length(result->'skills')=8 then passed:=passed+1; else raise exception 'Expected 8 Growth skills'; end if;
  if jsonb_array_length(result->'crew')>=3 then passed:=passed+1; else raise exception 'Expected three QA Crew profiles'; end if;
  if exists(select 1 from jsonb_array_elements(result->'skills') s where s->>'name'='Customer Greeting') then passed:=passed+1; end if;
  if exists(select 1 from jsonb_array_elements(result->'skills') s where s->>'name'='Cash Handling' and s->'positions' ? 'Cashier') then passed:=passed+1; end if;
  if exists(select 1 from jsonb_array_elements(result->'crew') c cross join lateral jsonb_array_elements(c->'skills') st where c#>>'{employee,employee_code}'='QA-CREW-CO-01' and st->>'status'='certified') then passed:=passed+1; end if;
  if exists(select 1 from jsonb_array_elements(result->'crew') c cross join lateral jsonb_array_elements(c->'skills') st where c#>>'{employee,employee_code}'='QA-CREW-IP-01' and st->>'status'='in_progress') then passed:=passed+1; end if;
  if exists(select 1 from jsonb_array_elements(result->'crew') c cross join lateral jsonb_array_elements(c->'skills') st where st->>'status'='ready_for_review') then passed:=passed+1; end if;
  if exists(select 1 from jsonb_array_elements(result->'crew') c cross join lateral jsonb_array_elements(c->'skills') st where st->>'status'='not_applicable') then passed:=passed+1; end if;
  if exists(select 1 from public.crew_skill_certifications where evidence_snapshot ? 'requirements') then passed:=passed+1; end if;
  if exists(select 1 from public.crew_practical_assessments where checklist<> '[]'::jsonb) then passed:=passed+1; end if;
  if not exists(select 1 from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name in ('crew_practical_assessments','crew_skill_certifications') and privilege_type in ('INSERT','UPDATE','DELETE')) then passed:=passed+1; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='crew_growth_admin_data' and p.prosecdef and p.proconfig @> array['search_path=public']) then passed:=passed+1; end if;
  execute 'reset role';
  if passed<>total then raise exception 'Growth verification expected %/% but got %/%',total,total,passed,total; end if;
  raise notice 'Crew Growth Staging behavior/security: %/% passed',passed,total;
end $$;
rollback;
