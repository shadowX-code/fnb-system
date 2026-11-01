-- Read-only workflow identity for distinct action rows under a shared View/page owner.
do $$ begin if md5(pg_get_functiondef('feedx_integrations.factory_action_catalog(uuid)'::regprocedure))<>'cc93e03e88e7426dc14620a38aa0b443' then raise exception 'Agent action catalog changed; review the forward presentation migration';end if;end $$;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_action_catalog(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('name',c.tool_id,'label',a.label,'description',a.description,'workspace',n.workspace,
 'domain',n.section,'module_id',a.module_id,'workflow_id',c.navigation_module_id,'capability',a.action,'permission',c.permission_code,'mcp_tool',c.mcp_tool,
 'implemented',true,'retained_only',false,'read_only',false,'requires_human_approval',a.requires_confirmation,
 'execution_policy',feedx_integrations.factory_execution_policy(a.key)->>'execution_policy','execution_reason',feedx_integrations.factory_execution_policy(a.key)->>'execution_reason','execution_requirement',case when a.requires_confirmation then 'Authorized human confirmation of the exact intent and physical/business evidence is required.' else 'Autonomous with explicit action and module View grants.' end,
 'required_view_permission',(select v.permission_code from feedx_integrations.capabilities v where v.navigation_module_id=a.module_id and v.action_type='view' and v.implemented),
 'view_granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id join public.permissions vp on vp.id=rp.permission_id where m.id=p_identity and vp.code=(select v.permission_code from feedx_integrations.capabilities v where v.navigation_module_id=a.module_id and v.action_type='view' and v.implemented)),
 'granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id where m.id=p_identity and rp.permission_id=p.id),
 'can_assign',public.current_user_can_assign_permission(p.id),
 'scope',jsonb_build_array(jsonb_build_object('label',a.label,'scope_note',a.description||' Module View access is required. Existing lifecycle and evidence validation remain enforced.')))
 order by c.sort_order),'[]')
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key
 join public.permissions p on p.code=c.permission_code join feedx_integrations.navigation_modules n on n.id=a.module_id;
$function$
;
notify pgrst,'reload schema';
