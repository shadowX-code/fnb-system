with migrations as (
  select coalesce(jsonb_agg(version order by version), '[]'::jsonb) as value
  from supabase_migrations.schema_migrations
  where version in ('20260812163541','20260812164410','20260812164932','20260812170155')
), functions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'function', p.proname,
    'security_definer', p.prosecdef,
    'volatility', p.provolatile,
    'config', coalesce(array_to_string(p.proconfig, ','), ''),
    'public_execute', has_function_privilege('public', p.oid, 'execute'),
    'anon_execute', has_function_privilege('anon', p.oid, 'execute'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'execute')
  ) order by p.proname), '[]'::jsonb) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'crew_reward_%'
), tables as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'rls_enabled', c.relrowsecurity,
    'anon_direct_dml', has_table_privilege('anon', c.oid, 'select,insert,update,delete'),
    'authenticated_direct_dml', has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
  ) order by c.relname), '[]'::jsonb) as value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('crew_reward_cycles','crew_reward_entries','crew_reward_adjustments')
)
select migrations.value as migrations, functions.value as functions, tables.value as tables
from migrations, functions, tables;
