-- Business workflows select Brands; existing tenant/security authorities remain intact.
create function public.platform_brand_management_read() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; scopes integer;
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Brand management permission is required.';end if;
 result:=public.platform_brands_read();
 scopes:=jsonb_array_length(result->'organizations');
 return (result-'organizations')||jsonb_build_object('can_create',scopes>0,'scope_brand_required',scopes>1);
end;$$;
revoke all on function public.platform_brand_management_read() from public,anon;
grant execute on function public.platform_brand_management_read() to authenticated;

create function public.platform_brand_command(p_command text,p_payload jsonb,p_scope_brand uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); scope_id uuid; target uuid; count_scopes integer;
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Brand management permission is required.';end if;
 if p_command not in ('save_brand','set_brand_status') or p_command is null then raise exception 'Unsupported Brand action.';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid Brand request.';end if;
 target:=nullif(p_payload->>'id','')::uuid;
 if target is not null then
  select organization_id into scope_id from public.brands where id=target and marketing_private.member(organization_id);
  if scope_id is null then raise exception using errcode='42501',message='Brand access is unavailable.';end if;
 elsif p_scope_brand is not null then
  select organization_id into scope_id from public.brands where id=p_scope_brand and marketing_private.member(organization_id);
  if scope_id is null then raise exception using errcode='42501',message='Brand access is unavailable.';end if;
 else
  select count(*),min(organization_id::text)::uuid into count_scopes,scope_id from public.organization_memberships where employee_id=actor;
  if count_scopes<>1 then raise exception using errcode='42501',message='Select an existing Brand access context before adding a Brand. Ask an administrator if none is available.';end if;
 end if;
 if p_scope_brand is not null and not exists(select 1 from public.brands where id=p_scope_brand and organization_id=scope_id and marketing_private.member(organization_id)) then raise exception using errcode='42501',message='Brand access context does not match.';end if;
 return public.platform_organization_command(p_command,scope_id,p_payload);
end;$$;
revoke all on function public.platform_brand_command(text,jsonb,uuid) from public,anon;
grant execute on function public.platform_brand_command(text,jsonb,uuid) to authenticated;

-- Keep the compatibility scope IDs for existing RPCs, but do not expose tenant names as business context.
create function public.marketing_brand_context() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 result:=public.marketing_context();
 return jsonb_set(result,'{organizations}',(select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id')),'[]') from jsonb_array_elements(result->'organizations')));
end;$$;
revoke all on function public.marketing_brand_context() from public,anon;
grant execute on function public.marketing_brand_context() to authenticated;

create function public.platform_team_access_command(p_command text,p_payload jsonb,p_scope_brand uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();scope_id uuid;count_scopes integer;
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Team access management permission is required.';end if;
 if p_command not in ('add_member','remove_member') or p_command is null then raise exception 'Unsupported team access action.';end if;
 if p_scope_brand is not null then
  select organization_id into scope_id from public.brands where id=p_scope_brand and marketing_private.member(organization_id);
  if scope_id is null then raise exception using errcode='42501',message='Brand access is unavailable.';end if;
 else
  select count(*),min(organization_id::text)::uuid into count_scopes,scope_id from public.organization_memberships where employee_id=actor;
  if count_scopes<>1 then raise exception using errcode='42501',message='Select a Brand before changing team access.';end if;
 end if;
 return public.platform_organization_command(p_command,scope_id,p_payload);
end;$$;
revoke all on function public.platform_team_access_command(text,jsonb,uuid) from public,anon;
grant execute on function public.platform_team_access_command(text,jsonb,uuid) to authenticated;
