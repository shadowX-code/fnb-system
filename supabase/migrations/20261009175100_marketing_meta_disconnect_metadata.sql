-- Remove Meta account identity when credentials are disconnected; historical
-- subject hashes/grants still allow later signed privacy erasure of projections.
create or replace function public.marketing_meta_disconnect(p_connection uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; actor uuid;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found then raise exception 'Connection unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_settings.configure');
 delete from marketing_private.credentials where connection_id=c.id;
 update public.marketing_connections set provider_account_id=null,account_name=null,connected_by=null,status='not_connected',capabilities='{}',expires_at=null,error_code='disconnected',credential_generation=credential_generation+1 where id=c.id;
 update public.marketing_jobs set state=case when state='leased' then 'reconciling' else state end,error_code='connection_disconnected',updated_at=now() where connection_id=c.id and state not in ('succeeded','failed','cancelled');
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'meta_disconnected',actor,jsonb_build_object('connection_id',c.id));
end;$$;
