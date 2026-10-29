-- Read-only projection of existing grants and the 97 policies; no new permission store.
create function feedx_integrations.resource_access_projection(p_identity uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
with grants as(select v from jsonb_array_elements(feedx_integrations.navigation_catalog(p_identity))v)
select coalesce(jsonb_agg(jsonb_build_object(
 'workspace',n.workspace,'scope',n.section,'resource',r.slug,'label',r.label,'owner',n.label,'module_id',n.id,'action','view','grant_name',g.v->>'name','granted',g.v->'granted','can_assign',g.v->'can_assign','implemented',g.v->'implemented',
 'required',coalesce((select jsonb_agg(d.v order by d.v->>'label') from grants d where d.v->>'module_id'=n.id or b.required_modules ? (d.v->>'module_id')),'[]'),
 'optional',coalesce((select jsonb_agg(d.v order by d.v->>'label') from grants d where d.v->>'module_id'<>n.id and not b.required_modules ? (d.v->>'module_id') and exists(select 1 from jsonb_each_text(b.relationship_modules)f where f.value=d.v->>'module_id')),'[]'),
 'unsupported',jsonb_build_array('Draft','Execute','Approve'),
 'affected_resources',coalesce((select jsonb_agg(rr.label order by rr.label) from feedx_integrations.navigation_resources bb join feedx_integrations.resources rr on rr.key=bb.resource_key where bb.module_id=n.id),'[]'),
 'data_limitations',n.explanation
) order by n.workspace,n.section,r.label,n.sort_order),'[]')
from feedx_integrations.navigation_resources b join feedx_integrations.navigation_modules n on n.id=b.module_id join feedx_integrations.resources r on r.key=b.resource_key join grants g on g.v->>'module_id'=n.id where r.implemented;
$$;
revoke all on function feedx_integrations.resource_access_projection(uuid) from public,anon,authenticated;
create function public.external_agents_resolve_access(p_identity_id uuid,p_module_id text,p_resource text,p_action text default 'view') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 if auth.uid() is null or not public.current_user_has_role_management_permission('view') then raise exception using errcode='42501',message='Role Settings view authority required.';end if;
 select v into result from jsonb_array_elements(feedx_integrations.resource_access_projection(p_identity_id))v where v->>'module_id'=p_module_id and v->>'resource'=p_resource and p_action='view';
 if result is null then return jsonb_build_object('supported',false,'reason','Resource/action is not implemented for this access scope.');end if;
 return result||jsonb_build_object('supported',true,'missing_required',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(result->'required')v where not (v->>'granted')::boolean),'missing_optional',(select coalesce(jsonb_agg(v),'[]') from jsonb_array_elements(result->'optional')v where not (v->>'granted')::boolean));
end $$;
revoke all on function public.external_agents_resolve_access(uuid,text,text,text) from public,anon;
grant execute on function public.external_agents_resolve_access(uuid,text,text,text) to authenticated;
do $$declare d text;begin
 select pg_get_functiondef('public.external_agents_admin_data(uuid)'::regprocedure) into d;
 if position('''effective_access'',feedx_integrations.effective_access(m.id)' in d)=0 then raise exception 'Admin projection drifted';end if;
 d:=replace(d,'''effective_access'',feedx_integrations.effective_access(m.id)','''resource_access'',feedx_integrations.resource_access_projection(m.id),''effective_access'',feedx_integrations.effective_access(m.id)');
 d:=replace(d,'''capabilities'',feedx_integrations.navigation_catalog(null)','''resource_access'',feedx_integrations.resource_access_projection(null),''capabilities'',feedx_integrations.navigation_catalog(null)');
 execute d;
end $$;
