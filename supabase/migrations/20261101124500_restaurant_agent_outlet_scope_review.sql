-- Scope is the existing canonical Role + role_outlets authority, never an Agent-owned copy.
create function public.external_agents_outlet_scope(p_identity_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare role_value public.roles%rowtype;
begin
 if auth.uid() is null or not public.current_user_has_role_management_permission('view') then raise exception using errcode='42501',message='Role Settings view authority is required';end if;
 if p_identity_id is not null then select r.* into strict role_value from public.roles r join feedx_integrations.machine_identities m on m.role_id=r.id where m.id=p_identity_id;end if;
 return jsonb_build_object('scope',jsonb_build_object('type',coalesce(role_value.outlet_access_type,'none'),'outlet_ids',coalesce((select jsonb_agg(outlet_id order by outlet_id) from public.role_outlets where role_id=role_value.id),'[]')),
 'can_assign_all',public.current_user_is_protected_role() or exists(select 1 from public.roles where id=public.current_user_role_id() and outlet_access_type='all'),
 'outlets',coalesce((select jsonb_agg(jsonb_build_object('value',id,'label',name) order by name,id) from public.outlets where public.current_user_can_access_outlet(id)),'[]'));
end $$;
revoke all on function public.external_agents_outlet_scope(uuid) from public;
grant execute on function public.external_agents_outlet_scope(uuid) to authenticated;

create function feedx_integrations.agent_scope_intent(p_scope jsonb,p_desired text[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare needs_scope boolean; kind text:=p_scope->>'type';ids uuid[];
begin
 select exists(select 1 from feedx_integrations.capabilities where tool_id=any(p_desired) and workspace='Restaurant') into needs_scope;
 if not needs_scope then return jsonb_build_object('type','none','outlet_ids','[]'::jsonb);end if;
 if p_scope is null or jsonb_typeof(p_scope)<>'object' or exists(select 1 from jsonb_object_keys(p_scope) k where k not in ('type','outlet_ids')) or jsonb_typeof(p_scope->'outlet_ids') is distinct from 'array' or kind not in ('all','selected') then raise exception using errcode='22023',message='Choose explicit Restaurant outlet access';end if;
 select coalesce(array_agg(v::uuid order by v::uuid),'{}') into ids from jsonb_array_elements_text(p_scope->'outlet_ids') v;
 if cardinality(ids)>200 or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) or (kind='selected' and cardinality(ids)=0) or (kind='all' and cardinality(ids)>0) then raise exception using errcode='22023',message='Choose a valid nonempty selected-outlet scope or All Outlets';end if;
 if kind='all' and not (public.current_user_is_protected_role() or exists(select 1 from public.roles where id=public.current_user_role_id() and outlet_access_type='all')) then raise exception using errcode='42501',message='All Outlets cannot be delegated from a restricted outlet scope';end if;
 if exists(select 1 from unnest(ids) id where not exists(select 1 from public.outlets o where o.id=id) or not public.current_user_can_access_outlet(id)) then raise exception using errcode='42501',message='An outlet is outside your assignable scope';end if;
 return jsonb_build_object('type',kind,'outlet_ids',to_jsonb(ids));
end $$;
revoke all on function feedx_integrations.agent_scope_intent(jsonb,text[]) from public,anon,authenticated;

create function public.external_agents_review_scoped_access(p_identity_id uuid,p_desired text[],p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare plan jsonb;scope_value jsonb;current_scope jsonb;context jsonb;hash_value text;
begin
 plan:=public.external_agents_review_access(p_identity_id,p_desired);
 scope_value:=feedx_integrations.agent_scope_intent(p_scope,p_desired);
 context:=public.external_agents_outlet_scope(p_identity_id);current_scope:=context->'scope';
 hash_value:=md5(jsonb_build_array(plan->>'review_hash',scope_value,current_scope,context)::text);
 return plan||jsonb_build_object('review_hash',hash_value,'outlet_scope',jsonb_build_object('before',current_scope,'after',scope_value,'changed',current_scope is distinct from scope_value),'scope_intent',scope_value,'effective_diff',plan->'effective_diff');
end $$;
revoke all on function public.external_agents_review_scoped_access(uuid,text[],jsonb) from public;
grant execute on function public.external_agents_review_scoped_access(uuid,text[],jsonb) to authenticated;

create function public.external_agents_confirm_scoped_access(p_identity_id uuid,p_desired text[],p_scope jsonb,p_review_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan jsonb;base_plan jsonb;r public.roles%rowtype;scope_value jsonb;result jsonb;
begin
 if not feedx_integrations.can_manage(p_identity_id) or not feedx_integrations.has_dedicated_role(p_identity_id) then raise exception using errcode='42501',message='Dedicated Agent role management authority is required';end if;
 select role.* into strict r from public.roles role join feedx_integrations.machine_identities m on m.role_id=role.id where m.id=p_identity_id;
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||r.id::text));perform 1 from public.roles where id=r.id for update;
 plan:=public.external_agents_review_scoped_access(p_identity_id,p_desired,p_scope);
 if plan->>'review_hash' is distinct from p_review_hash then raise exception using errcode='PT409',message='Agent access or outlet scope changed. Review the current configuration';end if;
 base_plan:=public.external_agents_review_access(p_identity_id,p_desired);
 result:=public.external_agents_confirm_access(p_identity_id,p_desired,base_plan->>'review_hash');
 scope_value:=plan->'scope_intent';
 perform public.save_role_configuration(gen_random_uuid(),jsonb_build_object('id',r.id,'name',r.name,'description',r.description,'is_active',r.is_active,'permission_changes','[]'::jsonb,'preserve_outlet_scope',false,'outlet_access_type',scope_value->>'type'),null,array(select v::uuid from jsonb_array_elements_text(scope_value->'outlet_ids') v));
 return result||jsonb_build_object('outlet_scope',scope_value);
end $$;
revoke all on function public.external_agents_confirm_scoped_access(uuid,text[],jsonb,text) from public;
grant execute on function public.external_agents_confirm_scoped_access(uuid,text[],jsonb,text) to authenticated;

CREATE OR REPLACE FUNCTION feedx_integrations.register_scoped_agent(p_scope jsonb, p_request_id uuid, p_name text, p_provider text, p_adapter_key text, p_tool_ids text[], p_validity_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_identity uuid;v_role jsonb;v_codes text[];v_base text;v_result jsonb;scope_value jsonb;
begin
 if auth.uid() is null or not public.current_user_has_role_management_permission('create') or not public.current_user_has_role_management_permission('edit') then raise exception using errcode='42501',message='Role Settings create and edit authority is required.';end if;
 if p_request_id is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_provider is null or length(trim(p_provider)) not between 1 and 80
  or coalesce(cardinality(p_tool_ids),0)=0 or cardinality(p_tool_ids)<>cardinality(array(select distinct unnest(p_tool_ids))) then raise exception using errcode='22023',message='Provide agent details and select implemented capabilities.';end if;
 perform pg_advisory_xact_lock(hashtext('external_agent_registration:'||p_request_id::text));
 if exists(select 1 from feedx_integrations.machine_identities where registration_request_id=p_request_id) then raise exception using errcode='55000',message='Agent already connected. Access keys cannot be retrieved again.';end if;
 select permission_code into v_base from feedx_integrations.adapters where key=p_adapter_key;
 if v_base is null or exists(select 1 from unnest(p_tool_ids) tool where not exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.adapters a on a.key=c.adapter_key where c.tool_id=tool and c.adapter_key=p_adapter_key and c.implemented and c.navigation_module_id is not null and (c.action_type='view' or exists(select 1 from feedx_integrations.factory_actions fa where fa.key=c.tool_id)) and (c.resource_key is null or exists(select 1 from feedx_integrations.resources r where r.key=c.resource_key and r.implemented)) and exists(select 1 from jsonb_array_elements(a.tools)t where t->>'name'=c.mcp_tool))) then raise exception using errcode='22023',message='Capability unavailable.';end if;
 scope_value:=feedx_integrations.agent_scope_intent(p_scope,p_tool_ids);
 select array_agg(c.permission_code) into v_codes from feedx_integrations.capabilities c where c.tool_id=any(p_tool_ids);
 v_role:=public.save_role_configuration(p_request_id,jsonb_build_object('name','external_agent_'||replace(p_request_id::text,'-',''),'description','Dedicated external agent role.','is_active',true,'outlet_access_type',scope_value->>'type'),array_append(v_codes,v_base),array(select v::uuid from jsonb_array_elements_text(scope_value->'outlet_ids') v));
 insert into feedx_integrations.machine_identities(name,role_id,enabled,provider,adapter_key,registration_request_id)
  values(trim(p_name),(v_role->'role'->>'id')::uuid,true,trim(p_provider),p_adapter_key,p_request_id) returning id into v_identity;
 v_result:=public.external_agents_rotate_credential(v_identity,null,gen_random_uuid(),p_validity_days);
 return v_result||jsonb_build_object('identity_id',v_identity);
end $function$
;
revoke all on function feedx_integrations.register_scoped_agent(jsonb,uuid,text,text,text,text[],integer) from public,anon,authenticated;

create function public.external_agents_register_scoped_reviewed(p_request_id uuid,p_name text,p_provider text,p_adapter_key text,p_tool_ids text[],p_validity_days integer,p_scope jsonb,p_review_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare plan jsonb;
begin
 plan:=public.external_agents_review_scoped_access(null,p_tool_ids,p_scope);
 if plan->>'review_hash' is distinct from p_review_hash then raise exception using errcode='PT409',message='Capabilities or outlet authority changed. Review the connection again';end if;
 return feedx_integrations.register_scoped_agent(plan->'scope_intent',p_request_id,p_name,p_provider,p_adapter_key,p_tool_ids,p_validity_days);
end $$;
revoke all on function public.external_agents_register_scoped_reviewed(uuid,text,text,text,text[],integer,jsonb,text) from public;
grant execute on function public.external_agents_register_scoped_reviewed(uuid,text,text,text,text[],integer,jsonb,text) to authenticated;
notify pgrst,'reload schema';
