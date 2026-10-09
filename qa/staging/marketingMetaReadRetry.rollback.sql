-- Retained test connection read retry; all state and audit changes roll back. No provider calls.
begin;
do $$
declare c public.marketing_connections; after_row public.marketing_connections; actor_auth uuid; sealed_before jsonb; denied boolean; generation integer;
begin
 select * into c from public.marketing_connections where provider_account_id='622626120924115' and brand_id='88718f61-2915-42ef-b62f-5e6e2fe5b3eb';
 if c.status<>'error' or c.error_code is distinct from 'meta_permission_or_token_invalid' then raise exception 'Expected failed retained test read';end if;
 select auth_user_id into actor_auth from public.employees where id=c.connected_by;
 select sealed_token into sealed_before from marketing_private.credentials where connection_id=c.id;
 if has_function_privilege('anon','public.marketing_meta_retry_sync_verified(uuid,uuid,integer)','execute') or has_function_privilege('authenticated','public.marketing_meta_retry_sync_verified(uuid,uuid,integer)','execute')
 or not has_function_privilege('service_role','public.marketing_meta_retry_sync_verified(uuid,uuid,integer)','execute') then raise exception 'Retry privilege boundary failed';end if;
 denied:=false;begin perform public.marketing_meta_retry_sync_verified(c.id,'00000000-0000-0000-0000-000000000000',c.credential_generation);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unknown actor accepted';end if;
 foreach generation in array array[null::integer,c.credential_generation+1] loop
  denied:=false;begin perform public.marketing_meta_retry_sync_verified(c.id,actor_auth,generation);exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Invalid generation accepted';end if;
 end loop;
 perform public.marketing_meta_retry_sync_verified(c.id,actor_auth,c.credential_generation);
 select * into after_row from public.marketing_connections where id=c.id;
 if after_row.status<>'test_authorized' or after_row.sync_requested_at is null or after_row.error_code is not null or after_row.sync_error_code is not null then raise exception 'Read retry did not queue verified synchronization';end if;
 if after_row.capabilities is distinct from c.capabilities or after_row.credential_generation<>c.credential_generation or after_row.connected_by<>c.connected_by or after_row.provider_account_id<>c.provider_account_id
 or (select sealed_token from marketing_private.credentials where connection_id=c.id) is distinct from sealed_before then raise exception 'Read retry changed binding or execution authority';end if;
end;$$;
rollback;
