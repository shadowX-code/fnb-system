-- Store a deployment-neutral adapter path. Trusted clients resolve only the fixed current project.
-- No identities, credentials, roles, grants or business records change.
do $$
begin
 if (select count(*) from feedx_integrations.adapters where key='factory_mesti' and endpoint in (
  'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp',
  '/functions/v1/factory-mesti-mcp')) <> 1 then
  raise exception 'Unexpected Factory Gateway adapter endpoint; inspect the environment binding.';
 end if;
 update feedx_integrations.adapters set endpoint='/functions/v1/factory-mesti-mcp' where key='factory_mesti';
end $$;
