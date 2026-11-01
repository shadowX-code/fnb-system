CREATE OR REPLACE FUNCTION feedx_integrations.record_resource_access(p_tool text, p_token_hash text, p_outcome text, p_reason text, p_source text, p_resource_actions jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_credential feedx_integrations.machine_credentials%rowtype;v_operations jsonb;begin
 if p_tool not in ('query_factory_resources','query_restaurant_resources') then raise exception 'Unsupported telemetry tool';end if;
 select * into v_credential from feedx_integrations.machine_credentials where token_hash=p_token_hash;
 if not found or p_outcome not in ('success','denied','failed') or p_source not in ('external','admin_probe') then return;end if;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('resource',r.slug,'action',q.value->>'action','business_module',n.id))),'[]') into v_operations
 from (select value from jsonb_array_elements(case when jsonb_typeof(p_resource_actions)='array' then p_resource_actions else '[]'::jsonb end) limit 5)q
 join feedx_integrations.resources r on r.slug=q.value->>'resource'
 left join feedx_integrations.navigation_modules n on n.id=q.value->>'business_module'
 where r.workspace=case when p_tool='query_restaurant_resources' then 'Restaurant' else 'Factory' end and q.value->>'action' in ('list','read','search','filter') and (not q.value ? 'business_module' or (n.id is not null and exists(select 1 from feedx_integrations.navigation_resources b where b.module_id=n.id and b.resource_key=r.key)));
 insert into feedx_integrations.access_events(identity_id,credential_id,method,tool,outcome,failure_reason,source,resource_actions) values(v_credential.identity_id,v_credential.id,'tools/call',p_tool,p_outcome,case when p_reason in ('credential_denied','capability_denied','tool_denied','invalid_request','evidence_unavailable','origin_denied') then p_reason else null end,p_source,v_operations);end $function$
;
revoke all on function feedx_integrations.record_resource_access(text,text,text,text,text,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.external_agents_record_resource_access(p_token_hash text, p_outcome text, p_reason text, p_source text, p_resource_actions jsonb)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $function$ select feedx_integrations.record_resource_access('query_factory_resources',p_token_hash,p_outcome,p_reason,p_source,p_resource_actions);$function$;
create function public.external_agents_record_scoped_resource_access(p_tool text,p_token_hash text,p_outcome text,p_reason text,p_source text,p_resource_actions jsonb) returns void language sql security definer set search_path=public,pg_temp as $$ select feedx_integrations.record_resource_access(p_tool,p_token_hash,p_outcome,p_reason,p_source,p_resource_actions);$$;
revoke all on function public.external_agents_record_scoped_resource_access(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.external_agents_record_scoped_resource_access(text,text,text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';

set check_function_bodies=on;
