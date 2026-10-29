-- Review-only projections of canonical policies. These helpers never authorize a request or mutate grants.
create function feedx_integrations.review_has_resource(p_names text[],p_resource text,p_action text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 with recursive required(slug,action) as (
 select p_resource,p_action union select dep,'list' from required q join feedx_integrations.resources r on r.slug=q.slug cross join lateral jsonb_array_elements_text(r.dependencies)dep
 ) select not exists(select 1 from required q where not exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.resources r on r.key=c.resource_key where r.slug=q.slug and r.implemented and c.implemented and not c.requires_human_approval and c.tool_id=any(p_names) and (c.action_type='view' or (c.action_type=q.action and c.mcp_tool='query_mesti_resources'))));
$$;
revoke all on function feedx_integrations.review_has_resource(text[],text,text) from public,anon,authenticated;
create function feedx_integrations.review_effective_paths(p_names text[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with selected as(select c.* from feedx_integrations.capabilities c where c.tool_id=any(p_names) and c.implemented and not c.requires_human_approval), modules as(select c.navigation_module_id id from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id where n.coverage<>'unavailable' and c.action_type='view'),paths as (
 select jsonb_build_object('key',n.id||':'||r.slug,'grant_name',c.tool_id,'owner',n.label,'module_id',n.id,'resource',r.slug,'label',r.label,'actions',jsonb_build_array('list','read','search','filter'),'row_scope',b.row_scope,
 'fields',(select coalesce(jsonb_agg(f order by f),'[]') from jsonb_array_elements_text(b.allowed_fields)f where not b.relationship_modules ? f or exists(select 1 from modules m where m.id=b.relationship_modules->>f)),
 'audit_modules',case when r.slug='audit_trail' then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',nm.label) order by m.id),'[]') from modules m join feedx_integrations.navigation_modules nm on nm.id=m.id where feedx_integrations.audit_navigation_owner(case m.id when 'factory_raw_inventory' then 'factory_raw_material' when 'factory_batch_traceability' then 'factory_historical_dispatch_batch_reconciled' when 'factory_finished_goods_dispatch' then 'factory_finished_good_dispatch' else m.id end)=m.id) else '[]'::jsonb end) v
 from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key where r.implemented and exists(select 1 from modules m where m.id=n.id) and not exists(select 1 from jsonb_array_elements_text(b.required_modules)dep where not exists(select 1 from modules m where m.id=dep))
 union all
 select jsonb_build_object('key','saved:'||c.tool_id,'grant_name',c.tool_id,'owner',r.label,'module_id',null,'resource',r.slug,'label',r.label,'actions',case when c.action_type='view' then jsonb_build_array('list','read','search','filter') else jsonb_build_array(c.action_type) end,'row_scope','{}'::jsonb,'field_policy',r.field_policy,
 'relationship_fields',(select coalesce(jsonb_agg(f.key order by f.key),'[]') from jsonb_each_text(r.relationship_fields)f where feedx_integrations.review_has_resource(p_names,f.value,'list')),'audit_modules','[]'::jsonb) from selected c join feedx_integrations.resources r on r.key=c.resource_key where c.navigation_module_id is null and feedx_integrations.review_has_resource(p_names,r.slug,case when c.action_type='view' then 'list' else c.action_type end)
 ) select coalesce(jsonb_agg(v order by v->>'key'),'[]') from paths;
$$;
revoke all on function feedx_integrations.review_effective_paths(text[]) from public,anon,authenticated;
create function feedx_integrations.review_effective_diff(p_catalog jsonb,p_desired text[],p_changes jsonb,p_dependencies jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare before_names text[];changed_names text[];before_paths jsonb;after_paths jsonb;material jsonb;blockers jsonb:='[]';shared jsonb:='[]';r jsonb;c jsonb;a jsonb;missing_before jsonb;missing_after jsonb;kind text;begin
 select coalesce(array_agg(v->>'name'),'{}') into before_names from jsonb_array_elements(p_catalog)v where (v->>'granted')::boolean;
 select coalesce(array_agg(v->>'name'),'{}') into changed_names from jsonb_array_elements(p_changes)v;
 before_paths:=feedx_integrations.review_effective_paths(before_names);after_paths:=feedx_integrations.review_effective_paths(p_desired);
 -- Include changes to retained capabilities, not only newly added/removed grant names.
 select coalesce(jsonb_agg(jsonb_build_object('effect',case when b.v is null then 'added' when a.v is null then 'removed' else 'changed' end,'owner',coalesce(a.v,b.v)->>'owner','label',coalesce(a.v,b.v)->>'label','before',b.v,'after',a.v) order by coalesce(a.v,b.v)->>'key'),'[]') into material
 from jsonb_array_elements(before_paths)b(v) full join jsonb_array_elements(after_paths)a(v) on a.v->>'key'=b.v->>'key'
 where a.v is distinct from b.v and not coalesce(a.v,b.v)->>'grant_name'=any(changed_names);
 for r in select v from jsonb_array_elements(p_dependencies)v where (v->>'grant_name')=any(p_desired) and exists(select 1 from jsonb_array_elements(v->'required')d where (d->>'name')=any(changed_names)) loop
  select coalesce(jsonb_agg(d order by d->>'name'),'[]') into missing_before from jsonb_array_elements(r->'required')d where not (d->>'name')=any(before_names);
  select coalesce(jsonb_agg(d order by d->>'name'),'[]') into missing_after from jsonb_array_elements(r->'required')d where not (d->>'name')=any(p_desired);
  if missing_after='[]' then continue;end if;
  kind:=case when not (r->>'grant_name')=any(before_names) then 'added_capability' when exists(select 1 from jsonb_array_elements(missing_after)d where not exists(select 1 from jsonb_array_elements(missing_before)b where b->>'name'=d->>'name')) then 'new_blocker' else 'pre_existing' end;
  if kind='pre_existing' and missing_before=missing_after then continue;end if;
  blockers:=blockers||jsonb_build_array(jsonb_build_object('kind',kind,'owner',r->>'owner','label',r->>'label','missing',missing_after,'before_missing',missing_before));
 end loop;
 -- Only overlapping data paths remain relevant after revocation. Different MeSTI row scopes are not equivalent.
 for c in select v from jsonb_array_elements(p_changes)v where not (v->>'granted')::boolean loop
  for a in select v from jsonb_array_elements(p_catalog)v where (v->>'name')=any(p_desired) loop
   if exists(select 1 from jsonb_array_elements(before_paths)b cross join jsonb_array_elements(after_paths)af where b->>'grant_name'=c->>'name' and af->>'grant_name'=a->>'name' and b->>'resource'=af->>'resource' and (b->'row_scope' @> af->'row_scope' or af->'row_scope' @> b->'row_scope')) then kind:='shared_records';
   elsif ((a->>'resource_key'='factory.mesti_review' and (c->>'limited_access')::boolean) or (c->>'resource_key'='factory.mesti_review' and (a->>'limited_access')::boolean)) then kind:='redacted_review_overlap';
   else continue;end if;
   shared:=shared||jsonb_build_array(jsonb_build_object('removed',c->>'label','via',a->>'label','kind',kind,'remaining_scope',a->'scope','note',case when kind='redacted_review_overlap' then 'Some redacted MeSTI findings and evidence remain accessible. Full module records and compliance-review records are different scopes.' else 'Overlapping records remain through this separate grant, with its own field and row restrictions.' end));
  end loop;
 end loop;
 return jsonb_build_object('before',before_paths,'after',after_paths,'material_changes',material,'blockers',blockers,'remaining_shared_access',shared);
end $$;
revoke all on function feedx_integrations.review_effective_diff(jsonb,text[],jsonb,jsonb) from public,anon,authenticated;
-- Keep the original fingerprint and all confirmation authorities intact; enrich only the read-only review response.
do $$declare d text;anchor text:='''dependencies'',feedx_integrations.resource_access_projection(p_identity_id),';begin
 select pg_get_functiondef('public.external_agents_review_access(uuid,text[])'::regprocedure) into d;
 if strpos(d,anchor)=0 then raise exception 'Review response changed; re-audit';end if;
 execute replace(d,anchor,anchor||'''effective_diff'',feedx_integrations.review_effective_diff(catalog,p_desired,changes,feedx_integrations.resource_access_projection(p_identity_id)),');
end $$;
