-- One selectable unit per existing canonical grant, including preserved scopes.
create function feedx_integrations.business_capability_catalog(p_identity uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce(jsonb_agg(v||jsonb_build_object('label',regexp_replace(v->>'label','^Preserved ',''),'workspace',coalesce(v->>'workspace','Factory'),'domain',case when v->>'section'='Factory' then case v->>'module_id' when 'factory_dashboard' then 'Factory Insights' when 'factory_product_feedback' then 'Product Feedback' when 'factory_petty_cash' then 'Petty Cash' else 'Production' end else coalesce(v->>'section',v->>'domain_label','MeSTI') end,'scope',coalesce((select jsonb_agg(jsonb_build_object('resource',r.slug,'label',r.label,'row_scope',b.row_scope,'fields',b.allowed_fields,'relationships',b.relationship_modules,'required_modules',b.required_modules)) from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=v->>'module_id'),jsonb_build_array(jsonb_build_object('resource',v->>'resource_key','label',v->>'label','scope_note',v->>'description'))),'retained_only',v->>'module_id' is null) order by v->>'workspace',v->>'label'),'[]')
from (select value v from jsonb_array_elements(feedx_integrations.navigation_catalog(p_identity)) union all select value from jsonb_array_elements(feedx_integrations.preserved_access(p_identity)))s;
$$;
revoke all on function feedx_integrations.business_capability_catalog(uuid) from public,anon,authenticated;
create function public.external_agents_review_access(p_identity_id uuid,p_desired text[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare catalog jsonb;changes jsonb;remaining jsonb;scope_policy jsonb;fingerprint text;begin
 if auth.uid() is null or not public.current_user_has_role_management_permission('view') then raise exception using errcode='42501',message='Role Settings view authority required.';end if;
 if p_desired is null or cardinality(p_desired)>200 or cardinality(p_desired)<>(select count(distinct v) from unnest(p_desired)v) then raise exception using errcode='22023',message='Invalid selection';end if;
 if p_identity_id is not null and not exists(select 1 from feedx_integrations.machine_identities where id=p_identity_id) then raise exception using errcode='22023',message='Agent unavailable';end if;
 catalog:=feedx_integrations.business_capability_catalog(p_identity_id);
 if exists(select 1 from unnest(p_desired)n where not exists(select 1 from jsonb_array_elements(catalog)c where c->>'name'=n and ((c->>'implemented')::boolean or (c->>'granted')::boolean))) then raise exception using errcode='42501',message='Unsupported capability selection';end if;
 select coalesce(jsonb_agg(c||jsonb_build_object('expected',(c->>'granted')::boolean,'granted',(c->>'name')=any(p_desired))),'[]') into changes from jsonb_array_elements(catalog)c where (c->>'granted')::boolean is distinct from ((c->>'name')=any(p_desired));
 if exists(select 1 from jsonb_array_elements(changes)c where not (c->>'can_assign')::boolean or ((c->>'retained_only')::boolean and (c->>'granted')::boolean)) then raise exception using errcode='42501',message='These changes cannot be delegated';end if;
 select coalesce(jsonb_agg(c),'[]') into remaining from jsonb_array_elements(catalog)c where (c->>'name')=any(p_desired);
 select jsonb_build_object('bindings',(select jsonb_agg(to_jsonb(b) order by module_id,resource_key) from feedx_integrations.navigation_resources b),'resources',(select jsonb_agg(to_jsonb(r) order by key) from feedx_integrations.resources r),'grants',(select jsonb_agg(rp.permission_id order by rp.permission_id) from public.role_permissions rp join feedx_integrations.machine_identities m on m.role_id=rp.role_id where m.id=p_identity_id)) into scope_policy;
 fingerprint:=md5(jsonb_build_object('actor',auth.uid(),'identity',p_identity_id,'desired',(select jsonb_agg(n order by n) from unnest(p_desired)n),'catalog',catalog,'policy',scope_policy)::text);
 return jsonb_build_object('changes',changes,'remaining_access',remaining,'review_hash',fingerprint,'dependencies',feedx_integrations.resource_access_projection(p_identity_id),'note','Each selection controls its complete server-defined scope. Unselected dependencies remain ungranted. Remaining access paths retain their own restrictions and redaction.');
end $$;
revoke all on function public.external_agents_review_access(uuid,text[]) from public,anon;
grant execute on function public.external_agents_review_access(uuid,text[]) to authenticated;
create function public.external_agents_confirm_access(p_identity_id uuid,p_desired text[],p_review_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare plan jsonb;v_role uuid;begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings edit authority required';end if;
 select m.role_id into v_role from feedx_integrations.machine_identities m where id=p_identity_id;
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||v_role::text));
 perform 1 from feedx_integrations.machine_identities where id=p_identity_id and machine_identities.role_id=v_role for update;
 if not found then raise exception using errcode='40001',message='Agent role changed';end if;
 plan:=public.external_agents_review_access(p_identity_id,p_desired);
 if plan->>'review_hash' is distinct from p_review_hash then raise exception using errcode='40001',message='Access or scope changed; review again';end if;
 if plan->'changes'='[]'::jsonb then return jsonb_build_object('updated',false);end if;
 return public.external_agents_set_capabilities(p_identity_id,(select jsonb_agg(jsonb_build_object('name',v->'name','granted',v->'granted','expected',v->'expected')) from jsonb_array_elements(plan->'changes')v));
end $$;
revoke all on function public.external_agents_confirm_access(uuid,text[],text) from public,anon;
grant execute on function public.external_agents_confirm_access(uuid,text[],text) to authenticated;
create function public.external_agents_register_reviewed(p_request_id uuid,p_name text,p_provider text,p_adapter_key text,p_tool_ids text[],p_validity_days integer,p_review_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$declare plan jsonb;begin
 plan:=public.external_agents_review_access(null,p_tool_ids);
 if plan->>'review_hash' is distinct from p_review_hash then raise exception using errcode='40001',message='Scope changed; review again';end if;
 return public.external_agents_register(p_request_id,p_name,p_provider,p_adapter_key,p_tool_ids,p_validity_days);
end $$;
revoke all on function public.external_agents_register_reviewed(uuid,text,text,text,text[],integer,text) from public,anon;
grant execute on function public.external_agents_register_reviewed(uuid,text,text,text,text[],integer,text) to authenticated;
do $$declare d text;begin
 select pg_get_functiondef('public.external_agents_admin_data(uuid)'::regprocedure) into d;
 d:=replace(d,'''effective_access'',feedx_integrations.effective_access(m.id)','''business_capabilities'',feedx_integrations.business_capability_catalog(m.id),''effective_access'',feedx_integrations.effective_access(m.id)');
 d:=replace(d,'''capabilities'',feedx_integrations.navigation_catalog(null)','''business_capabilities'',feedx_integrations.business_capability_catalog(null),''capabilities'',feedx_integrations.navigation_catalog(null)');
 execute d;
end $$;
