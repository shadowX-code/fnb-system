-- Execute after the operational migration, inside BEGIN/ROLLBACK only. No Google requests commit.
do $$
declare u uuid;a uuid;b uuid;v_role uuid:=gen_random_uuid();r uuid:=gen_random_uuid();lease jsonb;basis jsonb;ctx jsonb;w google_business_private.sync_worker;n bigint;before_count bigint;
begin
 select e.auth_user_id into u from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 select outlet_id into a from public.crew_google_outlet_locations order by outlet_id limit 1;
 select outlet_id into b from public.crew_google_outlet_locations where outlet_id<>a order by outlet_id limit 1;
 assert u is not null and a is not null and b is not null,'Existing Staging fixture basis missing';
 assert not has_function_privilege('anon','public.crew_google_business_sync_worker(text,uuid,text,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.crew_google_business_sync_worker(text,uuid,text,jsonb)','execute');
 assert not has_schema_privilege('authenticated','google_business_private','usage');
 assert not has_table_privilege('service_role','google_business_private.sync_worker','select');
 assert not has_function_privilege('service_role','google_business_private.sync_tick()','execute');
 assert (select schedule='*/30 * * * *' and active from cron.job where jobname='crew-google-business-review-sync');
 ctx:=public.crew_google_business_server('context',u,a);
 assert (ctx->>'can_sync')::boolean and (ctx->>'can_manage_connection')::boolean and (ctx->>'can_manage_mapping')::boolean;
 assert ctx->>'scoring_enabled'='false';
 -- Existing role/identity authorities are used; all fixture changes roll back.
 insert into public.roles(id,name,outlet_access_type) values(v_role,'QA Google operational rollback','selected');
 insert into public.role_outlets(role_id,outlet_id) values(v_role,a);
 insert into public.role_permissions(role_id,permission_id) select v_role,id from public.permissions where code='crew_google_reviews.view';
 update public.employees set role_id=v_role where auth_user_id=u;
 ctx:=public.crew_google_business_server('context',u,a);
 assert ctx->>'can_sync'='false' and ctx->>'can_manage_connection'='false' and ctx->>'can_manage_mapping'='false';
 begin perform public.crew_google_business_server('context',u,b);raise exception 'Cross-outlet read allowed';exception when insufficient_privilege then null;end;
 begin perform public.crew_google_business_server('sync_begin',u,a);raise exception 'Reader sync allowed';exception when insufficient_privilege then null;end;
 begin perform public.crew_google_business_server('discover',u,a);raise exception 'Reader discover allowed';exception when insufficient_privilege then null;end;
 begin perform public.crew_google_business_reply_server('prepare',u,a);raise exception 'Reader reply allowed';exception when insufficient_privilege then null;end;
 insert into public.role_permissions(role_id,permission_id) select v_role,id from public.permissions where code in ('crew_google_reviews.sync','crew_google_reviews.publish_reply','crew_google_reviews.manage_connection','crew_google_reviews.manage_mapping');
 assert not google_business_private.permitted(u,a,'manage_connection') and not google_business_private.permitted(u,a,'manage_mapping'),'Selected outlet role obtained global administration';
 ctx:=public.crew_google_business_reply_server('access',u,a,jsonb_build_object('review',(select location_resource_name from public.crew_google_outlet_locations where outlet_id=a)||'/reviews/rollback_operational'));
 assert ctx->>'can_publish_reply'='true' and ctx->>'can_edit_reply'='false';
 begin perform public.crew_google_business_reply_server('prepare',u,a,jsonb_build_object('id',r,'review',(select location_resource_name from public.crew_google_outlet_locations where outlet_id=a)||'/reviews/rollback_operational','operation','update','generation',(select generation from google_business_private.connection),'revision',(select revision from public.crew_google_outlet_locations where outlet_id=a),'confirmed',true,'sealed_intent','{"fixture":true}'::jsonb,'payload_hash',repeat('a',64),'desired_hash',repeat('b',64)));raise exception 'Publisher obtained Edit Reply';exception when insufficient_privilege then null;end;
 -- Capability is created only by cron/server; repeating the same HTTP delivery cannot claim twice.
 update google_business_private.sync_worker set lease_until=null,cooldown_until=null where id=true;
 select count(*) into before_count from net.http_request_queue;
 n:=google_business_private.sync_tick();assert n is not null;
 select * into w from google_business_private.sync_worker where id=true;
 assert w.proof_hash is not null and w.claimed_at is null;
 assert google_business_private.sync_tick() is null,'Overlapping scheduled dispatch';
 ctx:=public.crew_google_business_sync_worker('claim',w.run_id,w.proof_hash);assert ctx->>'claimed'='true' and jsonb_array_length(ctx->'outlets')>=2;
 assert (public.crew_google_business_sync_worker('claim',w.run_id,w.proof_hash))->>'claimed'='false';
 begin perform public.crew_google_business_sync_worker('claim',w.run_id,repeat('0',64));raise exception 'Invalid worker proof allowed';exception when insufficient_privilege then null;end;
 begin perform public.crew_google_business_server('context',null,a,jsonb_build_object('worker_run',w.run_id,'worker_proof',w.proof_hash));raise exception 'Worker impersonated Admin read';exception when insufficient_privilege then null;end;
 -- Per-location lease shared between scheduled and manual sync.
 update google_business_private.inbox_cache set lease_until=now()-interval '1 second' where location_resource_name in(select location_resource_name from public.crew_google_outlet_locations where outlet_id in(a,b));
 basis:=jsonb_build_object('generation',(select generation from google_business_private.connection),'revision',(select revision from public.crew_google_outlet_locations where outlet_id=a));
 lease:=public.crew_google_business_server('sync_begin',u,a,basis);
 begin perform public.crew_google_business_server('sync_begin',null,a,basis||jsonb_build_object('worker_run',w.run_id,'worker_proof',w.proof_hash));raise exception 'Manual/worker overlap allowed';exception when raise_exception then assert sqlerrm='A review sync is already running. Refresh shortly.';end;
 perform public.crew_google_business_server('sync_finish',u,a,basis||jsonb_build_object('lease',lease->>'lease','sealed_reviews','{"fixture":true}'::jsonb));
 ctx:=public.crew_google_business_server('context',u,a);assert ctx->>'sync_status'='complete' and ctx->'sync_health'->>'last_success_at' is not null;
 lease:=public.crew_google_business_server('sync_begin',u,a,basis);
 perform public.crew_google_business_server('sync_error',u,a,basis||jsonb_build_object('lease',lease->>'lease','error_code','google_rate_limited','error_service','mybusiness.googleapis.com','error_request','GET /v4/reviews'));
 ctx:=public.crew_google_business_server('context',u,a);assert ctx->>'sync_status'='error' and ctx->'sync_health'->>'last_success_at' is not null and ctx->'sync_health'->>'error_code'='google_rate_limited';
 begin perform public.crew_google_business_server('sync_begin',u,a,basis);raise exception 'Quota cooldown ignored';exception when raise_exception then assert sqlerrm='Google rate limit cooldown is active. Try after the next automatic sync interval.';end;
 update google_business_private.sync_worker set cooldown_until=null where id=true;
 lease:=public.crew_google_business_server('sync_begin',u,a,basis);
 -- Editing a mapping while the remote GET is in flight cannot publish its old cache.
 update public.crew_google_outlet_locations set revision=gen_random_uuid() where outlet_id=a;
 begin perform public.crew_google_business_server('sync_finish',u,a,basis||jsonb_build_object('lease',lease->>'lease','sealed_reviews','{"fixture":true}'::jsonb));raise exception 'Stale mapping committed';exception when raise_exception then assert sqlerrm='Sync authority changed. Refresh the inbox.';end;
 assert (public.crew_google_business_server('context',u,a))->'sync_health'='null'::jsonb;
 basis:=jsonb_build_object('generation',(select generation from google_business_private.connection),'revision',(select revision from public.crew_google_outlet_locations where outlet_id=b),'worker_run',w.run_id,'worker_proof',w.proof_hash);
 lease:=public.crew_google_business_server('sync_begin',null,b,basis);
 perform public.crew_google_business_server('sync_finish',null,b,basis||jsonb_build_object('lease',lease->>'lease','sealed_reviews','{"fixture":true}'::jsonb));
 update google_business_private.inbox_cache set status='complete',lease=null,lease_until=null,expires_at=now()-interval '1 second' where location_resource_name in(select location_resource_name from public.crew_google_outlet_locations where outlet_id=b);
 assert (public.crew_google_business_server('inbox',null,b,jsonb_build_object('worker_run',w.run_id,'worker_proof',w.proof_hash)))->'cache'='null'::jsonb;
 perform public.crew_google_business_sync_worker('finish',w.run_id,w.proof_hash);
 assert not google_business_private.worker_valid(w.run_id,w.proof_hash,a);
 raise notice 'Google operational permission/scheduler/lease/quota/cache checks passed; transaction must roll back.';
end;$$;
