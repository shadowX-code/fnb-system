-- The active human report route remains; only its duplicate Gateway permission retires.
do $$declare before_actions jsonb;after_actions jsonb;begin
 if exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where p.code='factory_agent_nav_factory_production_reports.view') then raise exception 'Report module grants require explicit review before retirement';end if;
 select coalesce(jsonb_agg(jsonb_build_object('identity',m.id,'actions',(select jsonb_agg(v order by v::text) from jsonb_array_elements(feedx_integrations.discovery(m.id)->'resource_actions')v)) order by m.id),'[]') into before_actions from feedx_integrations.machine_identities m;
 update feedx_integrations.navigation_resources set module_id='factory_job_orders' where module_id='factory_production_reports';
 delete from feedx_integrations.capabilities where navigation_module_id='factory_production_reports';
 delete from feedx_integrations.navigation_modules where id='factory_production_reports';
 delete from public.permissions where code='factory_agent_nav_factory_production_reports.view';
 update feedx_integrations.navigation_modules set coverage='limited',capability_limitation='Calculated costing, yield and cost-trend report summaries are not exposed; saved source records are supported.',explanation='Monthly performance plus the canonical daily pipeline, saved lifecycle states and output totals. Pipeline requires Job Order and Production Records access; monthly performance requires its contributing modules. Requests never release or change Job Orders. Saved reporting inputs also require their source modules; calculated report totals are not exposed.' where id='factory_job_orders';

 select coalesce(jsonb_agg(jsonb_build_object('identity',m.id,'actions',(select jsonb_agg(v order by v::text) from jsonb_array_elements(feedx_integrations.discovery(m.id)->'resource_actions')v)) order by m.id),'[]') into after_actions from feedx_integrations.machine_identities m;
 if before_actions is distinct from after_actions then raise exception 'Existing machine effective resource access would change';end if;
end $$;
