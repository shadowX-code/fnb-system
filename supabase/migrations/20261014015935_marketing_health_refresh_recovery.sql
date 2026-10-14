-- Explicit refresh uses the existing bounded health/recovery worker, never a Send API job.
create function public.marketing_meta_request_health(p_connection uuid,p_auth_user uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Service only.';end if;
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 update marketing_private.connection_checks j set due_at=least(j.due_at,now()),requested_at=now()
 from public.marketing_connections c where j.connection_id=p_connection and c.id=j.connection_id and j.generation=c.credential_generation;
end;$$;
revoke all on function public.marketing_meta_request_health(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_request_health(uuid,uuid) to service_role;
