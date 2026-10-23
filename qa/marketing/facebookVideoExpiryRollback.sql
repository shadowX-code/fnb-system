begin;
set local statement_timeout='8s';
-- Only synthetic, uncommitted rows are authorized. No real channel lease or provider call.
do $$
declare org uuid; actor uuid; brand uuid:=gen_random_uuid(); conn uuid:=gen_random_uuid(); ig uuid:=gen_random_uuid();
 content uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid(); expiry timestamptz; result jsonb;
 fmt text; channel_name text; ordinary_content uuid; ordinary_job uuid;
begin
 select organization_id,connected_by into org,actor from marketing_connections where channel='facebook' limit 1;
 if org is null or actor is null then raise exception 'Missing authorized Staging fixture anchor.';end if;
 insert into brands(id,organization_id,name) values(brand,org,'QA rollback-only Facebook Video Expiry');
 if not marketing_private.actor_allowed(actor,org,brand,'marketing_content.execute') then raise exception 'Fixture actor lacks canonical authority.';end if;
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,status,expires_at,credential_generation,capabilities)
 values(conn,org,brand,'facebook','100000000000000001','test_authorized',now()+interval '1 day',1,'{"publishing":true,"execution_enabled":true,"formats":["text","video","reel"]}'),
 (ig,org,brand,'instagram','100000000000000002','test_authorized',now()+interval '1 day',1,'{"publishing":true,"execution_enabled":true,"formats":["image"]}');
 insert into marketing_content(id,organization_id,brand_id,created_by,status) values(content,org,brand,actor,'scheduled');
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id)
 values(content,1,'{"variants":[{"channel":"facebook","format":"video","caption":"Rollback fixture","asset_ids":[]}]}',actor);
 update marketing_content set approved_revision=1 where id=content;
 insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,external_authorized_at,lease_token,lease_expires_at)
 values(job,org,brand,content,1,'facebook','leased',now(),actor,conn,1,now(),lease,now()+interval '3 minutes');

 -- Missing, invalid, expired, unbounded, wrong-generation and wrong-channel grants fail closed.
 if (marketing_job_guard(job,lease)->>'facebook_video_authorized')::boolean then raise exception 'Missing lease accepted.';end if;
 begin perform marketing_job_guard(job,lease,true);raise exception 'Missing lease submitted.';exception when raise_exception then if sqlerrm='Missing lease submitted.' then raise;end if;end;
 foreach expiry in array array[null::timestamptz,'infinity'::timestamptz,'-infinity'::timestamptz,clock_timestamp()-interval '1 second',clock_timestamp()+interval '31 minutes'] loop
  begin perform marketing_meta_execution_policy(conn,1,true,'facebook_video',expiry);raise exception 'Invalid expiry accepted.';exception when raise_exception then if sqlerrm='Invalid expiry accepted.' then raise;end if;end;
 end loop;
 begin perform marketing_meta_execution_policy(conn,2,true,'facebook_video',clock_timestamp()+interval '1 minute');raise exception 'Wrong generation accepted.';exception when raise_exception then if sqlerrm='Wrong generation accepted.' then raise;end if;end;
 begin perform marketing_meta_execution_policy(ig,1,true,'facebook_video',clock_timestamp()+interval '1 minute');raise exception 'Instagram grant accepted.';exception when raise_exception then if sqlerrm='Instagram grant accepted.' then raise;end if;end;
 begin execute format('select marketing_meta_execution_policy(%L,1,true,''facebook_video'',''not-a-date'')',conn);raise exception 'Malformed expiry accepted.';exception when invalid_datetime_format then null;end;

 perform marketing_meta_execution_policy(conn,1,true,'facebook_video',clock_timestamp()+interval '30 minutes');
 if not (marketing_job_guard(job,lease,true)->>'facebook_video_authorized')::boolean then raise exception 'Valid capped lease rejected.';end if;
 -- A stale competing worker cannot use the connection's valid format authorization.
 begin perform marketing_job_guard(job,gen_random_uuid(),true);raise exception 'Concurrent stale lease accepted.';exception when raise_exception then if sqlerrm='Concurrent stale lease accepted.' then raise;end if;end;
 perform marketing_meta_execution_policy(conn,1,false,'facebook_video');
 if (marketing_job_guard(job,lease)->>'facebook_video_authorized')::boolean then raise exception 'Revocation not visible.';end if;
 begin perform marketing_job_guard(job,lease,true);raise exception 'Revoked submission accepted.';exception when raise_exception then if sqlerrm='Revoked submission accepted.' then raise;end if;end;
 -- Read-only checkpoint reconciliation remains authorized after revocation.
 perform marketing_job_checkpoint(job,lease,'{"pending":"fb_publish","objects":{"fb_video":"900"}}');
 perform marketing_job_guard(job,lease);

 -- clock_timestamp(), not transaction-start now(), must enforce expiry.
 perform marketing_meta_execution_policy(conn,1,true,'facebook_video',clock_timestamp()+interval '0.1 seconds');
 perform pg_sleep(0.15);
 begin perform marketing_job_guard(job,lease,true);raise exception 'Expired submission accepted.';exception when raise_exception then if sqlerrm='Expired submission accepted.' then raise;end if;end;
 perform marketing_meta_execution_policy(conn,1,true,'facebook_video',clock_timestamp()+interval '1 minute');
 update marketing_connections set facebook_video_generation=2 where id=conn;
 begin perform marketing_job_guard(job,lease,true);raise exception 'Stale generation authorization accepted.';exception when raise_exception then if sqlerrm='Stale generation authorization accepted.' then raise;end if;end;
 update marketing_connections set facebook_video_generation=1 where id=conn;
 begin update marketing_connections set facebook_video_expires_at=facebook_video_authorized_at+interval '31 minutes' where id=conn;raise exception 'Storage cap bypassed.';exception when check_violation then null;end;
 perform marketing_meta_execution_policy(conn,1,false);
 if (select facebook_video_expires_at is not null from marketing_connections where id=conn) then raise exception 'Base revocation retained format authority.';end if;
 perform marketing_meta_execution_policy(conn,1,true);
 if (select facebook_video_expires_at is not null from marketing_connections where id=conn) then raise exception 'Ordinary policy enabled format.';end if;

 -- Existing ordinary formats retain their canonical authority without any video lease.
 foreach fmt in array array['text','image','carousel','video','reel'] loop
  channel_name:=case when fmt='text' then 'facebook' when fmt in ('video','reel') then 'facebook' else 'instagram' end;
  ordinary_content:=gen_random_uuid();ordinary_job:=gen_random_uuid();
  insert into marketing_content(id,organization_id,brand_id,created_by,status) values(ordinary_content,org,brand,actor,'scheduled');
  insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id)
  values(ordinary_content,1,jsonb_build_object('variants',jsonb_build_array(jsonb_build_object('channel',channel_name,'format',fmt))),actor);
  update marketing_content set approved_revision=1 where id=ordinary_content;
  insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,external_authorized_at,lease_token,lease_expires_at)
  values(ordinary_job,org,brand,ordinary_content,1,channel_name,'leased',now(),actor,case when channel_name='facebook' then conn else ig end,1,now(),lease,now()+interval '3 minutes');
  if fmt in ('video','reel') then
   begin perform marketing_job_guard(ordinary_job,lease,true);raise exception 'Video/Reel missing authorization accepted.';exception when raise_exception then if sqlerrm='Video/Reel missing authorization accepted.' then raise;end if;end;
  else perform marketing_job_guard(ordinary_job,lease,true);end if;
 end loop;
 if has_function_privilege('anon','marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz)','execute')
  or has_function_privilege('authenticated','marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz)','execute')
  or has_function_privilege('anon','marketing_job_guard(uuid,uuid,boolean)','execute')
  or has_function_privilege('authenticated','marketing_job_guard(uuid,uuid,boolean)','execute') then raise exception 'Internal authority exposed.';end if;
end;$$;
select 'PASS: capped explicit expiry, missing/invalid/expired denial, early revocation, generation and lease checks, ordinary format compatibility, checkpoint recovery and ACLs' acceptance;
rollback;
