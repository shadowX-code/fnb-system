-- Canonical Staging only; synthetic uncommitted rows, no provider calls or real job mutations.
begin;
set local statement_timeout='8s';
do $$
declare org uuid;actor uuid;brand uuid:=gen_random_uuid();conn uuid:=gen_random_uuid();content uuid:=gen_random_uuid();job uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();
 original jsonb:='{"objects":{"fb_video":"900","fb_finish":"900"},"started_at":"2026-10-24T00:00:00Z","verified_assets":[]}';
 receipt jsonb;events_before integer;
begin
 select organization_id,connected_by into org,actor from marketing_connections where channel='facebook' limit 1;
 if org is null or actor is null then raise exception 'Missing Staging fixture authority anchor.';end if;
 insert into brands(id,organization_id,name) values(brand,org,'QA rollback-only Facebook receipt recovery');
 if not marketing_private.actor_allowed(actor,org,brand,'marketing_content.execute') then raise exception 'Fixture actor lacks canonical authority.';end if;
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,status,expires_at,credential_generation,capabilities)
 values(conn,org,brand,'facebook','100000000000000001','test_authorized',now()+interval '1 day',3,'{"publishing":true,"execution_enabled":true,"formats":["video","reel"]}');
 insert into marketing_content(id,organization_id,brand_id,created_by,status) values(content,org,brand,actor,'scheduled');
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(content,1,'{"variants":[{"channel":"facebook","format":"video","caption":"Rollback receipt fixture","asset_ids":[]}]}',actor);
 update marketing_content set approved_revision=1 where id=content;
 insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,external_authorized_at,lease_token,lease_expires_at,provider_state,attempts,failures)
 values(job,org,brand,content,1,'facebook','reconciling',now(),actor,conn,3,now(),lease,now()+interval '3 minutes',original,4,0);
 -- No format lease exists. Read/checkpoint authority still works; new submissions fail.
 perform marketing_job_guard(job,lease);
 begin perform marketing_job_guard(job,lease,true);raise exception 'Missing format lease admitted submission.';exception when raise_exception then if sqlerrm='Missing format lease admitted submission.' then raise;end if;end;
 perform marketing_finish_job(job,lease,'uncertain',null,'facebook_video_post_receipt_missing');
 if not exists(select 1 from marketing_jobs where id=job and state='reconciling' and attempts=4 and failures=0 and provider_state=original and provider_post_id is null) then raise exception 'Unavailable evidence lost original job state.';end if;
 -- Simulate the next canonical read-only claim on this synthetic job only.
 update marketing_jobs set lease_expires_at=now()+interval '3 minutes' where id=job;
 receipt:=original||'{"post_id":"100000000000000001_901","facebook_receipt":{"source":"page_posts_video_permalink","video_id":"900","post_id":"100000000000000001_901","video_post_id":null}}'::jsonb;
 perform marketing_job_checkpoint(job,lease,receipt);
 begin perform marketing_finish_job(job,lease,'published','100000000000000001_999');raise exception 'Uncheckpointed receipt accepted.';exception when raise_exception then if sqlerrm='Uncheckpointed receipt accepted.' then raise;end if;end;
 perform marketing_finish_job(job,lease,'published','100000000000000001_901');
 if not exists(select 1 from marketing_jobs where id=job and state='succeeded' and attempts=4 and failures=0 and connection_generation=3 and provider_state=receipt and provider_post_id='100000000000000001_901') then raise exception 'Recovered receipt did not preserve original evidence/counters.';end if;
 if not exists(select 1 from marketing_content where id=content and status='published' and revision=1 and approved_revision=1) then raise exception 'Canonical content finalization mismatch.';end if;
 select count(*) into events_before from marketing_events where content_id=content;
 perform marketing_finish_job(job,lease,'published','100000000000000001_901');
 if (select count(*) from marketing_events where content_id=content)<>events_before then raise exception 'Retry duplicated audit evidence.';end if;
 if (select count(*) from marketing_content_revisions where content_id=content)<>1 then raise exception 'Recovery duplicated revisions.';end if;
end;$$;
select 'PASS: unavailable receipt retained; guarded checkpoint recovery; no active video authorization; original attempts/generation/evidence preserved; idempotent canonical finalization; all fixtures rolled back' acceptance;
rollback;
