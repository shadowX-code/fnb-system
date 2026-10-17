-- Staging rollback-only canonical authority verification. Never changes live credentials.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare c public.marketing_connections; actor uuid; material jsonb; original_subject text; v boolean;
begin
 select x.* into strict c from public.marketing_connections x join public.brands b on b.id=x.brand_id where b.name='Hola Hola Kopitiam' and x.channel='facebook';
 select auth_user_id into strict actor from public.employees where id=c.connected_by;
 assert marketing_private.oauth_accounts_generation_verified(c.id),'Expected current retained OAuth epoch';
 material:=public.marketing_meta_diagnostic_material(c.id,actor);
 assert material->>'oauth_accounts_generation_verified'='true','Scoped diagnostic projection missing proof';
 assert public.marketing_meta_connection_material(c.id)->>'oauth_accounts_generation_verified'='true','Worker projection missing proof';
 assert position('oauth_accounts_generation_verified' in pg_get_functiondef('public.marketing_inbox_send_material(uuid,uuid)'::regprocedure))>0,'Reply projection missing proof';
 -- Canonical replacement, identity and epoch drift cannot retain task authority.
 update public.marketing_connections set credential_generation=c.credential_generation+1 where id=c.id;
 assert not marketing_private.oauth_accounts_generation_verified(c.id),'Stale generation accepted';
 update public.marketing_connections set credential_generation=c.credential_generation,connected_at=c.connected_at+interval '1 second' where id=c.id;
 assert not marketing_private.oauth_accounts_generation_verified(c.id),'Wrong OAuth epoch accepted';
 update public.marketing_connections set connected_at=c.connected_at where id=c.id;
 select meta_user_id into original_subject from marketing_private.credentials where connection_id=c.id;
 update marketing_private.credentials set meta_user_id='987654321' where connection_id=c.id;
 assert not marketing_private.oauth_accounts_generation_verified(c.id),'Wrong retained subject accepted';
 update marketing_private.credentials set meta_user_id=original_subject where connection_id=c.id;
 update public.marketing_connections set expires_at=now()-interval '1 second' where id=c.id;
 assert not marketing_private.oauth_accounts_generation_verified(c.id),'Expired connection accepted';
 update public.marketing_connections set expires_at=c.expires_at where id=c.id;
 assert marketing_private.oauth_accounts_generation_verified(c.id),'Restored fixture must verify';
 begin perform public.marketing_meta_diagnostic_material(c.id,gen_random_uuid());raise exception 'Foreign actor accepted';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('authenticated','marketing_private.oauth_accounts_generation_verified(uuid)','EXECUTE'),'Private proof exposed';
 assert not has_function_privilege('anon','public.marketing_meta_connection_material(uuid)','EXECUTE'),'Worker material exposed';
 assert not has_function_privilege('authenticated','public.marketing_meta_diagnostic_material(uuid,uuid)','EXECUTE'),'Diagnostic secret exposed';
 assert not has_function_privilege('authenticated','public.marketing_inbox_send_material(uuid,uuid)','EXECUTE'),'Reply secret exposed';
 assert (select credential_generation=c.credential_generation and capabilities=c.capabilities from public.marketing_connections where id=c.id),'Unrelated authority changed';
end;$$;
rollback;
