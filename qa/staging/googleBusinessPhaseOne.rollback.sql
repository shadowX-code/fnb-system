-- Staging only. All configuration/role fixtures and encrypted-cache placeholders roll back.
begin;
do $$
declare u uuid; a uuid; b uuid; original_role uuid; scoped_role uuid:=gen_random_uuid();
 ctx jsonb; session jsonb; mapped jsonb; lease jsonb; result jsonb; basis jsonb; sealed jsonb:='{"version":1,"ciphertext":"rollback-fixture"}';
begin
 if not exists(select 1 from public.outlets where name='QA Demo — Reporting Posters') then raise exception 'Staging fixture marker required.';end if;
 select e.auth_user_id,e.role_id into u,original_role from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' and e.auth_user_id is not null limit 1;
 select id into a from public.outlets where name='JYMT Kopitiam';select id into b from public.outlets where name='Friends Corner';
 if u is null or a is null or b is null then raise exception 'Authorized Staging fixtures unavailable.';end if;
 assert not has_function_privilege('anon','public.crew_google_business_server(text,uuid,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.crew_google_business_server(text,uuid,uuid,jsonb)','EXECUTE');
 assert has_function_privilege('service_role','public.crew_google_business_server(text,uuid,uuid,jsonb)','EXECUTE');
 assert not has_schema_privilege('authenticated','google_business_private','USAGE');
 ctx:=public.crew_google_business_server('context',u,a);
 assert ctx->>'can_manage'='true' and ctx->>'scoring_enabled'='false';
 begin perform public.crew_google_business_server('context',gen_random_uuid(),a);raise exception 'Unknown identity was allowed';exception when insufficient_privilege then null;end;
 delete from google_business_private.inbox_cache where generation>=0;
 update google_business_private.connection set generation=0,status='disconnected',sealed_token=null,accounts='[]',expires_at=null where id=true;
 perform public.crew_google_business_server('begin',u,a,jsonb_build_object('state_hash',repeat('a',64),'sealed_verifier',sealed));
 session:=public.crew_google_business_server('oauth_consume',null,null,jsonb_build_object('state_hash',repeat('a',64)));
 assert session->>'actor'=u::text;
 begin perform public.crew_google_business_server('oauth_consume',null,null,jsonb_build_object('state_hash',repeat('a',64)));raise exception 'OAuth replay allowed';exception when raise_exception then assert sqlerrm='Authorization expired. Connect again.';end;
 perform public.crew_google_business_server('oauth_finish',null,null,jsonb_build_object('state_hash',repeat('a',64),'sealed_token',sealed,'expires_at',now()+interval '1 hour',
  'accounts','[{"name":"accounts/qa","displayName":"Rollback fixture"}]'::jsonb,'locations','[{"name":"accounts/qa/locations/qa","title":"Rollback location","account":"accounts/qa"}]'::jsonb));
 assert (select generation=1 and status='connected' from google_business_private.connection where id=true);
 -- Remove this outlet's prior mapping only inside this transaction to test initial mapping.
 delete from google_business_private.inbox_cache where location_resource_name in(select location_resource_name from public.crew_google_outlet_locations where outlet_id in(a,b));
 delete from public.crew_google_outlet_locations where outlet_id in(a,b);
 perform public.crew_google_business_server('map',u,a,jsonb_build_object('generation',1,'location','accounts/qa/locations/qa','expected_revision',null));
 mapped:=(public.crew_google_business_server('context',u,a))->'mapping';
 begin perform public.crew_google_business_server('map',u,b,jsonb_build_object('generation',1,'location','accounts/qa/locations/qa','expected_revision',null));raise exception 'Duplicate mapping allowed';exception when raise_exception then assert sqlerrm='This Google location is already mapped to another outlet.';end;
 basis:=jsonb_build_object('generation',1,'revision',mapped->>'revision');
 lease:=public.crew_google_business_server('sync_begin',u,a,basis);
 begin perform public.crew_google_business_server('sync_begin',u,a,basis);raise exception 'Concurrent sync allowed';exception when raise_exception then assert sqlerrm='A review sync is already running. Refresh shortly.';end;
 perform public.crew_google_business_server('sync_finish',u,a,basis||jsonb_build_object('lease',lease->>'lease','sealed_reviews',sealed));
 assert (public.crew_google_business_server('context',u,a))->>'sync_status'='complete';
 assert (public.crew_google_business_server('inbox',u,b))->'cache'='null'::jsonb;
 result:=public.crew_google_business_server('refresh',u,a,jsonb_build_object('generation',1,'expected_token',sealed,'sealed_token','{"version":1,"ciphertext":"new-fixture"}'::jsonb,'expires_at',now()+interval '2 hours'));
 assert result->>'updated'='true';
 result:=public.crew_google_business_server('refresh',u,a,jsonb_build_object('generation',1,'expected_token',sealed,'sealed_token',sealed,'expires_at',now()+interval '2 hours'));
 assert result->>'updated'='false';
 -- Reconnect the same authorized inventory: preserve its mapping, rotate its basis,
 -- clear the old content cache, and reject work bound to the prior generation.
 perform public.crew_google_business_server('begin',u,a,jsonb_build_object('state_hash',repeat('b',64),'sealed_verifier',sealed));
 perform public.crew_google_business_server('oauth_consume',null,null,jsonb_build_object('state_hash',repeat('b',64)));
 perform public.crew_google_business_server('oauth_finish',null,null,jsonb_build_object('state_hash',repeat('b',64),'sealed_token',sealed,'expires_at',now()+interval '1 hour',
  'accounts','[{"name":"accounts/qa","displayName":"Rollback fixture"}]'::jsonb,'locations','[{"name":"accounts/qa/locations/qa","title":"Rollback location","account":"accounts/qa"}]'::jsonb));
 assert (select generation=2 and status='connected' from google_business_private.connection where id=true);
 assert not exists(select 1 from google_business_private.inbox_cache);
 ctx:=public.crew_google_business_server('context',u,a);assert ctx->'mapping'->>'name'=mapped->>'name' and ctx->'mapping'->>'revision'<>mapped->>'revision';
 begin perform public.crew_google_business_server('guard',u,a,basis);raise exception 'Prior generation was accepted';exception when raise_exception then assert sqlerrm='Google connection or outlet mapping changed. Refresh the inbox.';end;
 -- Canonical permissions and outlet isolation under a transaction-local restricted role.
 insert into public.roles(id,name,outlet_access_type) values(scoped_role,'QA GBP rollback scoped reader','selected');
 insert into public.role_permissions(role_id,permission_id) select scoped_role,id from public.permissions where code='crew_performance.view';
 insert into public.role_outlets(role_id,outlet_id) values(scoped_role,a);
 update public.employees set role_id=scoped_role where auth_user_id=u;
 ctx:=public.crew_google_business_server('context',u,a);assert ctx->>'can_manage'='false' and ctx->'locations'='[]'::jsonb and ctx->'accounts'='[]'::jsonb;
 begin perform public.crew_google_business_server('context',u,b);raise exception 'Other outlet allowed';exception when insufficient_privilege then null;end;
 begin perform public.crew_google_business_server('disconnect_begin',u,a);raise exception 'Scoped reader managed connection';exception when insufficient_privilege then null;end;
 update public.employees set role_id=original_role where auth_user_id=u;
 result:=public.crew_google_business_server('disconnect_begin',u,a);assert (select status='revocation_pending' and generation=3 from google_business_private.connection where id=true);
 assert not exists(select 1 from google_business_private.inbox_cache);
 begin perform public.crew_google_business_server('material',u,a);raise exception 'Revoking grant still readable';exception when raise_exception then assert sqlerrm='Connect or reconnect Google Business Profile in Settings.';end;
 perform public.crew_google_business_server('disconnect_finish',u,a,jsonb_build_object('generation',result->'generation'));
 assert (select status='disconnected' and sealed_token is null from google_business_private.connection where id=true);
 begin perform public.crew_google_business_server('guard',u,a,basis);raise exception 'Old generation accepted';exception when raise_exception then assert sqlerrm='Connect or reconnect Google Business Profile in Settings.';end;
 -- Expired content is never readable and independent purge removes it.
 insert into google_business_private.inbox_cache(location_resource_name,generation,mapping_revision,sealed_reviews,expires_at,status)
 values('accounts/qa/locations/qa',1,(mapped->>'revision')::uuid,sealed,now()-interval '1 second','complete');
 perform google_business_private.purge();assert not exists(select 1 from google_business_private.inbox_cache);
end;$$;
rollback;
