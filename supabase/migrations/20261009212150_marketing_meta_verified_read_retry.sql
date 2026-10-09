-- Service-only recovery follows verified fixed Graph reads; never changes binding or execution.
create function public.marketing_meta_retry_sync_verified(p_connection uuid,p_auth_user uuid,p_generation integer) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 perform public.marketing_meta_diagnostic_material(p_connection,p_auth_user);
 select * into c from public.marketing_connections where id=p_connection for update;
 if c.credential_generation is distinct from p_generation or c.channel<>'facebook' or c.status<>'error' or c.error_code is distinct from 'meta_permission_or_token_invalid'
 or c.expires_at is null or c.expires_at<=now() or c.capabilities->>'posts' is distinct from 'true' or c.sync_lease_until>now() then raise exception 'Read retry is unavailable.';end if;
 update public.marketing_connections set status='test_authorized',error_code=null,sync_error_code=null,sync_requested_at=now(),sync_retry_at=null,sync_attempts=0,sync_after=null,sync_pages=0 where id=c.id;
 insert into public.marketing_events(organization_id,brand_id,action,details) values(c.organization_id,c.brand_id,'meta_read_access_verified',jsonb_build_object('connection_id',c.id,'generation',p_generation));
end;$$;
revoke all on function public.marketing_meta_retry_sync_verified(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.marketing_meta_retry_sync_verified(uuid,uuid,integer) to service_role;
