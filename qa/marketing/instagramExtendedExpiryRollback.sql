-- Staging only; isolated uncommitted fixtures, no real authorization or provider call.
begin;
set local statement_timeout='8s';
do $$
declare org uuid;actor uuid;b uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();fb uuid:=gen_random_uuid();
 image uuid:=gen_random_uuid();video uuid:=gen_random_uuid();content uuid:=gen_random_uuid();job uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();
 deadline timestamptz;anchor timestamptz;bad timestamptz;v jsonb;fmt text;ordinary_content uuid;ordinary_job uuid;
begin
 select organization_id,connected_by into org,actor from marketing_connections where channel='facebook' limit 1;
 if org is null or actor is null then raise exception 'Missing authorized Staging fixture anchor.';end if;
 insert into brands(id,organization_id,name) values(b,org,'QA rollback-only Instagram Extended Expiry');
 if not marketing_private.actor_allowed(actor,org,b,'marketing_content.execute') then raise exception 'Fixture authority unavailable.';end if;
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,status,expires_at,credential_generation,capabilities)
 values(ig,org,b,'instagram','100000000000000011','test_authorized',now()+interval '1 day',3,'{"publishing":true,"execution_enabled":true,"formats":["image","carousel","story","reel"]}'),
 (fb,org,b,'facebook','100000000000000012','test_authorized',now()+interval '1 day',3,'{"publishing":true,"execution_enabled":true,"formats":["text","image","video","reel"]}');
 insert into marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by)
 values(image,org,b,'rollback.jpg','image/jpeg',100,'rollback-only/'||image,'ready',actor),(video,org,b,'rollback.mp4','video/mp4',100,'rollback-only/'||video,'ready',actor);
 insert into marketing_content(id,organization_id,brand_id,created_by,status) values(content,org,b,actor,'scheduled');
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id)
 values(content,1,jsonb_build_object('variants',jsonb_build_array(jsonb_build_object('channel','instagram','format','carousel','asset_ids',jsonb_build_array(image,video)))),actor);
 update marketing_content set approved_revision=1 where id=content;
 insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,external_authorized_at,lease_token,lease_expires_at)
 values(job,org,b,content,1,'instagram','leased',now(),actor,ig,3,now(),lease,now()+interval '3 minutes');
 if (marketing_job_guard(job,lease)->>'instagram_extended_authorized')::boolean then raise exception 'Missing grant accepted.';end if;
 begin perform marketing_job_guard(job,lease,true);raise exception 'Missing grant submitted.';exception when raise_exception then if sqlerrm='Missing grant submitted.' then raise;end if;end;
 foreach bad in array array[null::timestamptz,'infinity'::timestamptz,'-infinity'::timestamptz,clock_timestamp()-interval '1 second',clock_timestamp()+interval '21 minutes'] loop
  begin perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',bad);raise exception 'Invalid expiry accepted.';exception when raise_exception then if sqlerrm='Invalid expiry accepted.' then raise;end if;end;
 end loop;
 begin perform marketing_meta_execution_policy(ig,2,true,'instagram_extended',clock_timestamp()+interval '1 minute');raise exception 'Wrong generation accepted.';exception when raise_exception then if sqlerrm='Wrong generation accepted.' then raise;end if;end;
 begin perform marketing_meta_execution_policy(fb,3,true,'instagram_extended',clock_timestamp()+interval '1 minute');raise exception 'Wrong channel accepted.';exception when raise_exception then if sqlerrm='Wrong channel accepted.' then raise;end if;end;
 -- Revoke-before-grant does not burn a never-issued test window.
 perform marketing_meta_execution_policy(ig,3,false,'instagram_extended');
 deadline:=clock_timestamp()+interval '20 minutes';perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',deadline);
 select instagram_extended_authorized_at into anchor from marketing_connections where id=ig;
 if not (marketing_job_guard(job,lease,true)->>'instagram_extended_authorized')::boolean then raise exception 'Valid grant denied.';end if;
 perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',deadline);
 if (select instagram_extended_authorized_at from marketing_connections where id=ig)<>anchor then raise exception 'Idempotent grant moved clock.';end if;
 begin perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',clock_timestamp()+interval '20 minutes');raise exception 'Grant extended.';exception when raise_exception then if sqlerrm='Grant extended.' then raise;end if;end;
 begin perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',deadline-interval '1 second');raise exception 'Grant replaced.';exception when raise_exception then if sqlerrm='Grant replaced.' then raise;end if;end;
 begin perform marketing_job_guard(job,gen_random_uuid(),true);raise exception 'Stale competing worker admitted.';exception when raise_exception then if sqlerrm='Stale competing worker admitted.' then raise;end if;end;
 perform marketing_job_checkpoint(job,lease,'{"objects":{"child_0":"800","child_1":"801","container":"802"},"pending":"publish"}');
 perform marketing_meta_execution_policy(ig,3,false,'instagram_extended');
 if (marketing_job_guard(job,lease)->>'instagram_extended_authorized')::boolean then raise exception 'Revocation not visible.';end if;
 begin perform marketing_job_guard(job,lease,true);raise exception 'Revoked grant submitted.';exception when raise_exception then if sqlerrm='Revoked grant submitted.' then raise;end if;end;
 begin perform marketing_meta_execution_policy(ig,3,true,'instagram_extended',deadline);raise exception 'Revoked grant restarted.';exception when raise_exception then if sqlerrm='Revoked grant restarted.' then raise;end if;end;
 if (select provider_state->'objects'->>'child_0' from marketing_jobs where id=job)<>'800' then raise exception 'Partial evidence lost.';end if;
 -- A dispatched publication can still persist/finish its actual receipt after revocation.
 perform marketing_job_checkpoint(job,lease,'{"objects":{"child_0":"800","child_1":"801","container":"802"},"post_id":"900"}');
 perform marketing_finish_job(job,lease,'published','900');perform marketing_finish_job(job,lease,'published','900');
 if (select count(*) from marketing_events where content_id=content and action='publishing_succeeded')<>1 then raise exception 'Receipt retry duplicated history.';end if;
 -- Ordinary image/image-only carousel/Reel keep working; Story still requires the Extended grant.
 foreach fmt in array array['image','carousel','reel','story'] loop
  ordinary_content:=gen_random_uuid();ordinary_job:=gen_random_uuid();
  insert into marketing_content(id,organization_id,brand_id,created_by,status) values(ordinary_content,org,b,actor,'scheduled');
  insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(ordinary_content,1,jsonb_build_object('variants',jsonb_build_array(jsonb_build_object('channel','instagram','format',fmt,'asset_ids',jsonb_build_array(image)))),actor);
  update marketing_content set approved_revision=1 where id=ordinary_content;
  insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,external_authorized_at,lease_token,lease_expires_at)
  values(ordinary_job,org,b,ordinary_content,1,'instagram','leased',now(),actor,ig,3,now(),lease,now()+interval '3 minutes');
  if fmt='story' then begin perform marketing_job_guard(ordinary_job,lease,true);raise exception 'Story submitted without Extended grant.';exception when raise_exception then if sqlerrm='Story submitted without Extended grant.' then raise;end if;end;
  else perform marketing_job_guard(ordinary_job,lease,true);end if;
 end loop;
 -- Fresh synthetic generation/window for clock expiry, with no transaction-time shortcut.
 update marketing_connections set credential_generation=4 where id=ig;
 begin perform marketing_job_guard(ordinary_job,lease,true);raise exception 'Old generation submitted.';exception when raise_exception then if sqlerrm='Old generation submitted.' then raise;end if;end;
 update marketing_jobs set connection_generation=4 where id=ordinary_job;
 perform marketing_meta_execution_policy(ig,4,true,'instagram_extended',clock_timestamp()+interval '0.1 seconds');perform pg_sleep(0.15);
 begin perform marketing_job_guard(ordinary_job,lease,true);raise exception 'Expired grant admitted.';exception when raise_exception then if sqlerrm='Expired grant admitted.' then raise;end if;end;
 begin perform marketing_meta_execution_policy(ig,4,true,'instagram_extended',clock_timestamp()+interval '1 minute');raise exception 'Expired window renewed.';exception when raise_exception then if sqlerrm='Expired window renewed.' then raise;end if;end;
 perform marketing_meta_execution_policy(ig,4,false,'instagram_extended');
 if (select instagram_extended_expires_at is null from marketing_connections where id=ig) then raise exception 'Revocation erased the used window.';end if;
 -- Base disable also revokes Extended; re-enable cannot revive the previous window.
 update marketing_connections set instagram_extended_enabled=true where id=ig;
 perform marketing_meta_execution_policy(ig,4,false);perform marketing_meta_execution_policy(ig,4,true);
 if (select instagram_extended_enabled from marketing_connections where id=ig) then raise exception 'Base re-enable revived Extended.';end if;
 begin update marketing_connections set instagram_extended_expires_at=instagram_extended_authorized_at+interval '21 minutes' where id=ig;raise exception 'Storage cap bypassed.';exception when check_violation then null;end;
 if has_function_privilege('anon','marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz)','execute') or has_function_privilege('authenticated','marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz)','execute')
  or has_function_privilege('anon','marketing_job_guard(uuid,uuid,boolean)','execute') or has_function_privilege('authenticated','marketing_job_guard(uuid,uuid,boolean)','execute') then raise exception 'Internal authority exposed.';end if;
end;$$;
select 'PASS: 20-minute cap; non-renewal/restart denial; expiry; revocation; generation and competing lease; partial/receipt preservation; ordinary format isolation; ACLs; zero retained fixtures' acceptance;
rollback;
