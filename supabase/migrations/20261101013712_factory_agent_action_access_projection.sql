CREATE OR REPLACE FUNCTION feedx_integrations.factory_read_effective_paths(p_names text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with selected as(select c.* from feedx_integrations.capabilities c where c.tool_id=any(p_names) and c.implemented and c.mcp_tool='query_factory_resources' and not c.requires_human_approval), modules as(select c.navigation_module_id id from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id where n.coverage<>'unavailable' and c.action_type='view'),paths as (
 select jsonb_build_object('key',n.id||':'||r.slug,'grant_name',c.tool_id,'owner',n.label,'module_id',n.id,'resource',r.slug,'label',r.label,'actions',jsonb_build_array('list','read','search','filter'),'row_scope',b.row_scope,
 'fields',(select coalesce(jsonb_agg(f order by f),'[]') from jsonb_array_elements_text(b.allowed_fields)f where not b.relationship_modules ? f or exists(select 1 from modules m where m.id=b.relationship_modules->>f)),
 'audit_modules',case when r.slug='audit_trail' then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',nm.label) order by m.id),'[]') from modules m join feedx_integrations.navigation_modules nm on nm.id=m.id where feedx_integrations.audit_navigation_owner(case m.id when 'factory_raw_inventory' then 'factory_raw_material' when 'factory_batch_traceability' then 'factory_historical_dispatch_batch_reconciled' when 'factory_finished_goods_dispatch' then 'factory_finished_good_dispatch' else m.id end)=m.id) else '[]'::jsonb end) v
 from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key where r.implemented and exists(select 1 from modules m where m.id=n.id) and not exists(select 1 from jsonb_array_elements_text(b.required_modules)dep where not exists(select 1 from modules m where m.id=dep))
 union all
 select jsonb_build_object('key','saved:'||c.tool_id,'grant_name',c.tool_id,'owner',r.label,'module_id',null,'resource',r.slug,'label',r.label,'actions',case when c.action_type='view' then jsonb_build_array('list','read','search','filter') else jsonb_build_array(c.action_type) end,'row_scope','{}'::jsonb,'field_policy',r.field_policy,
 'relationship_fields',(select coalesce(jsonb_agg(f.key order by f.key),'[]') from jsonb_each_text(r.relationship_fields)f where feedx_integrations.review_has_resource(p_names,f.value,'list')),'audit_modules','[]'::jsonb) from selected c join feedx_integrations.resources r on r.key=c.resource_key where c.navigation_module_id is null and feedx_integrations.review_has_resource(p_names,r.slug,case when c.action_type='view' then 'list' else c.action_type end)
 ) select coalesce(jsonb_agg(v order by v->>'key'),'[]') from paths;
$function$
;
CREATE OR REPLACE FUNCTION feedx_integrations.review_effective_paths(p_names text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select feedx_integrations.factory_read_effective_paths(p_names)||coalesce((select jsonb_agg(jsonb_build_object(
 'key','action:'||a.key,'grant_name',c.tool_id,'owner',a.label,'label',a.action,'module_id',a.module_id,'resource','action:'||a.key,
 'actions',jsonb_build_array(a.action),'row_scope','{}'::jsonb,'requires_human_confirmation',a.requires_confirmation,
 'required_view_permission','factory_agent_nav_'||a.module_id||'.view','audit_modules','[]'::jsonb))
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key where c.tool_id=any(p_names) and exists(select 1 from feedx_integrations.capabilities view_cap where view_cap.navigation_module_id=a.module_id and view_cap.action_type='view' and view_cap.tool_id=any(p_names))),'[]');
$function$
;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_action_catalog(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('name',c.tool_id,'label',a.label,'description',a.description,'workspace','Factory',
 'domain',n.section,'module_id',a.module_id,'capability',a.action,'permission',c.permission_code,'mcp_tool','execute_factory_action',
 'implemented',true,'retained_only',false,'read_only',false,'requires_human_approval',a.requires_confirmation,
 'execution_requirement',case when a.requires_confirmation then 'Authorized human confirmation of the exact intent and physical/business evidence is required.' else 'Autonomous with explicit action and module View grants.' end,
 'required_view_permission','factory_agent_nav_'||a.module_id||'.view',
 'view_granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id join public.permissions vp on vp.id=rp.permission_id where m.id=p_identity and vp.code='factory_agent_nav_'||a.module_id||'.view'),
 'granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id where m.id=p_identity and rp.permission_id=p.id),
 'can_assign',public.current_user_can_assign_permission(p.id),
 'scope',jsonb_build_array(jsonb_build_object('label',a.label,'scope_note',a.description||' Module View access is required. Existing lifecycle and evidence validation remain enforced.')))
 order by c.sort_order),'[]')
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key
 join public.permissions p on p.code=c.permission_code join feedx_integrations.navigation_modules n on n.id=a.module_id;
$function$
;
notify pgrst,'reload schema';
