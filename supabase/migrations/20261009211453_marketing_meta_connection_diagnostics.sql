-- Read-only credential inspection is service-only and revalidates the authenticated actor.
create function public.marketing_meta_diagnostic_material(p_connection uuid,p_auth_user uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.marketing_connections; actor uuid; material jsonb;
begin
 select * into c from public.marketing_connections where id=p_connection;
 select e.id into actor from public.employees e where e.auth_user_id=p_auth_user;
 if c.id is null or actor is null or not marketing_private.actor_allowed(actor,c.organization_id,c.brand_id,'marketing_settings.configure') then
  raise exception using errcode='42501',message='Marketing connection scope denied.';
 end if;
 select to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token) into material
 from marketing_private.credentials s where s.connection_id=c.id and s.sealed_token is not null;
 if material is null then raise exception 'Retained credential unavailable.';end if;
 return material;
end;$$;
revoke all on function public.marketing_meta_diagnostic_material(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_diagnostic_material(uuid,uuid) to service_role;
