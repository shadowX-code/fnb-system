-- Private authorizer is available only to the existing service authority.
create or replace function public.marketing_meta_diagnostic_material(p_connection uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_connections; actor uuid; material jsonb;
begin
 select * into c from public.marketing_connections where id=p_connection;
 select e.id into actor from public.employees e where e.auth_user_id=p_auth_user;
 if c.id is null or actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.configure') then
  raise exception using errcode='42501',message='Marketing connection scope denied.';
 end if;
 select to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id) into material
 from marketing_private.credentials s where s.connection_id=c.id and s.sealed_token is not null;
 if material is null then raise exception 'Retained credential unavailable.';end if;
 return material;
end;$$;
revoke all on function public.marketing_meta_diagnostic_material(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_diagnostic_material(uuid,uuid) to service_role;

-- Only the scoped Edge resolver can persist revalidated evidence. Execution is never enabled.
create function public.marketing_meta_record_eligibility(p_connection uuid,p_auth_user uuid,p_generation integer,p_sealed jsonb,p_verified boolean) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation<>p_generation or c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() then raise exception 'Connection authority changed.';end if;
 if p_sealed is not null then
  if coalesce(p_sealed->>'version','')<>'1' or not (p_sealed ? 'ciphertext') then raise exception 'Invalid encrypted evidence.';end if;
  update marketing_private.credentials set sealed_token=p_sealed where connection_id=c.id;
 end if;
 update public.marketing_connections set capabilities=capabilities||jsonb_build_object('publishing',coalesce(p_verified,false),'execution_enabled',false),last_checked_at=now() where id=c.id;
end;$$;
revoke all on function public.marketing_meta_record_eligibility(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.marketing_meta_record_eligibility(uuid,uuid,integer,jsonb,boolean) to service_role;
