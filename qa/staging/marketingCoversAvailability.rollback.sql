-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'QA Marketing Rollback','marketing-rollback-'||u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Marketing Organization'),(other_o,'QA Other Tenant');
 insert into public.organization_memberships values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Authorized Brand'),(other_b,o,'QA Restricted Brand');
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;


-- No queued fixture, token or provider action is visible outside this transaction.
do $covers$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');other_b uuid:=(select id from marketing_qa_ids where key='other_brand');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');vid uuid:=gen_random_uuid();pic uuid:=gen_random_uuid();foreign_pic uuid:=gen_random_uuid();conn uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();body jsonb;changed jsonb;record jsonb;saved uuid;job uuid;denied boolean;detail jsonb;
begin
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by,storage_policy,snapshot_verified_at) values
 (vid,o,b,'Rollback video.mp4','video/mp4',100,'rollback-only/'||vid,'ready',e,'temporary',now()),
 (pic,o,b,'Rollback cover.jpg','image/jpeg',100,'rollback-only/'||pic,'ready',e,'temporary',now()),
 (foreign_pic,o,other_b,'Other Brand.jpg','image/jpeg',100,'rollback-only/'||foreign_pic,'ready',e,'temporary',now());
 body:=jsonb_build_object('title','Rollback Reel cover','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','instagram','format','reel','caption','Rollback fixture','asset_ids',jsonb_build_array(vid),'reel_cover',jsonb_build_object('mode','image','video_asset_id',vid,'asset_id',pic))));
 perform marketing_private.validate_content(o,b,body,true);
 record:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body);saved:=(record->>'id')::uuid;
 detail:=public.marketing_content_detail(saved);
 assert jsonb_array_length(detail->'assets')=2,'Cover and video are read through the canonical detail asset projection';
 assert detail->'content'->'payload'->'variants'->0->'asset_ids'=jsonb_build_array(vid),'Cover never changes primary media ordering';
 assert (select count(*) from marketing_private.variant_asset_ids(body->'variants'->0))=2,'Both immutable media references pinned';
 assert exists(select 1 from public.marketing_content_revisions where content_id=saved and payload::text like '%'||pic::text||'%'),'Existing retirement reference check sees the cover';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(body,'{variants,0,reel_cover,asset_id}',to_jsonb(foreign_pic)),true);exception when others then denied:=true;end;assert denied,'Cross-Brand cover denied';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(body,'{variants,0,reel_cover,video_asset_id}',to_jsonb(pic)),true);exception when others then denied:=true;end;assert denied,'Changed video identity denied';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(body,'{variants,0,channel}','"facebook"'),true);exception when others then denied:=true;end;assert denied,'Unsupported Facebook custom cover denied';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(body,'{variants,0,format}','"image"'),true);exception when others then denied:=true;end;assert denied,'Cover on non-Reel denied';
 changed:=jsonb_set(body,'{variants,0,reel_cover}',jsonb_build_object('mode','frame','video_asset_id',vid,'offset_ms',0));perform marketing_private.validate_content(o,b,changed,true);
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(changed,'{variants,0,reel_cover,offset_ms}','-1'),true);exception when others then denied:=true;end;assert denied,'Negative frame offset denied';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(changed,'{variants,0,reel_cover,offset_ms}','0.2'),true);exception when others then denied:=true;end;assert denied,'Fractional milliseconds denied';
 denied:=false;begin perform marketing_private.validate_content(o,b,jsonb_set(changed,'{variants,0,reel_cover,asset_id}',to_jsonb(pic)),true);exception when others then denied:=true;end;assert denied,'Conflicting image/frame settings denied';
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,saved,1,'{}');perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,saved,1,'{}');
 record:=public.marketing_content_command(gen_random_uuid(),'save',o,b,saved,1,changed);
 assert record->>'revision'='2' and record->>'status'='draft' and record->>'approved_revision' is null,'Cover changes invalidate approval via canonical revision authority';
 assert (select payload=body from public.marketing_content_revisions where content_id=saved and revision=1),'Original cover revision is immutable';
 update public.marketing_assets set state='retiring' where id=pic;
 denied:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,saved,2,body);exception when others then denied:=true;end;assert denied,'Retiring cover cannot enter a new revision';
 update public.marketing_assets set state='ready' where id=pic;
 record:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body);saved:=(record->>'id')::uuid;
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,saved,1,'{}');perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,saved,1,'{}');
 perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,saved,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,credential_generation)
 values(conn,o,b,'instagram','999999999992','Rollback IG','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["reel"]}',e,1);
 update public.marketing_jobs set state='leased',connection_id=conn,connection_generation=1,lease_token=lease,lease_expires_at=now()+interval '5 minutes',external_authorized_at=now() where content_id=saved returning id into job;
 assert jsonb_array_length(public.marketing_job_assets(job,lease))=2,'Worker receives the exact video and cover snapshot';
 assert not has_table_privilege('authenticated','marketing_content_revisions','insert'),'No browser bypass of revision authority';
end;$covers$;

do $availability$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');other_b uuid:=(select id from marketing_qa_ids where key='other_brand');u uuid:=(select id from marketing_qa_ids where key='user');e uuid:=(select id from marketing_qa_ids where key='employee');c uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();p jsonb;observation jsonb;event jsonb;before_hash text;after_hash text;denied boolean;proof jsonb;count_before integer;event_time numeric;
begin
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation,sync_lease,sync_lease_until)
 values(c,o,b,'facebook','999999999991','Rollback Page','test_authorized',now()+interval '1 day','{"posts":true}',e,now()-interval '1 day',1,lease,now()+interval '5 minutes');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(c,'rollback-only','{}');
 p:=jsonb_build_object('id','999999999991_888','published_at',now()-interval '1 day','caption','Rollback evidence','metrics','{"likes":0,"views":12}'::jsonb,'unavailable_metrics','{"reach":"not_returned"}'::jsonb);
 perform public.marketing_meta_sync_finish(c,1,lease,jsonb_build_array(p),null,null);
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='unknown','Legacy six-argument sync remains compatible';
 select md5(to_jsonb(s)::text) into before_hash from public.marketing_social_posts s where connection_id=c;
 update public.marketing_connections set sync_lease_until=now()+interval '5 minutes' where id=c;
 observation:=jsonb_build_array(jsonb_build_object('id','999999999991_888','state','available','source','owned_feed','reason','provider_observed'));
 perform public.marketing_meta_sync_finish(c,1,lease,'[]',null,null,observation);
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='available','Positive feed evidence projects availability';
 select md5(to_jsonb(s)::text) into after_hash from public.marketing_social_posts s where connection_id=c;assert before_hash=after_hash,'Availability never rewrites provider post values/metrics/provenance';
 update public.marketing_connections set sync_lease_until=now()+interval '5 minutes' where id=c;
 observation:=jsonb_build_array(jsonb_build_object('id','999999999991_888','state','unavailable','source','object_read','reason','object_missing_or_unreadable'));
 perform marketing_private.record_publication_availability(c,1,lease,observation);
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='unavailable','Ambiguous missing object is not deletion';
 assert jsonb_array_length(public.marketing_meta_availability_targets(c,1,lease))=0,'Backoff prevents repeated direct probes';
 denied:=false;begin perform marketing_private.record_publication_availability(c,2,lease,observation);exception when others then denied:=true;end;assert denied,'Wrong generation denied';
 denied:=false;begin perform marketing_private.record_publication_availability(c,1,gen_random_uuid(),observation);exception when others then denied:=true;end;assert denied,'Wrong synchronization lease denied';
 denied:=false;begin perform marketing_private.record_publication_availability(c,1,lease,jsonb_set(observation,'{0,id}','"999999999991_777"'));exception when others then denied:=true;end;assert denied,'Unknown publication identity denied';
 denied:=false;begin perform marketing_private.record_publication_availability(c,1,lease,jsonb_set(observation,'{0,state}','"deleted"'));exception when others then denied:=true;end;assert denied,'Read-only observations cannot declare deletion';
 event_time:=extract(epoch from clock_timestamp());
 event:=jsonb_build_array(jsonb_build_object('account_id','999999999991','id','999999999991_888','occurred_at',event_time,'source','signed_page_feed_remove','fingerprint',repeat('a',64)));
 assert public.marketing_meta_publication_events(event)=1,'Verified explicit removal recorded once';
 assert public.marketing_meta_publication_events(event)=0,'Removal webhook replay is idempotent';
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='deleted','Explicit removal is distinct from an unreadable object';
 perform marketing_private.record_publication_availability(c,1,lease,observation);
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='deleted','Ambiguous read preserves signed removal proof';
 observation:=jsonb_build_array(jsonb_build_object('id','999999999991_888','state','available','source','owned_feed','reason','provider_observed'));
 perform marketing_private.record_publication_availability(c,1,lease,observation);
 assert (marketing_private.publication_availability_projection(c,1,'999999999991','999999999991_888')->>'state')='deleted','Stale feed echoes cannot erase explicit removal';
 update public.marketing_connections set credential_generation=2 where id=c;
 perform marketing_private.record_publication_availability(c,2,lease,observation);
 assert (marketing_private.publication_availability_projection(c,2,'999999999991','999999999991_888')->>'state')='deleted','Same-account generation change retains removal proof';
 observation:=jsonb_set(observation,'{0,source}','"object_read"');perform marketing_private.record_publication_availability(c,2,lease,observation);
 assert (marketing_private.publication_availability_projection(c,2,'999999999991','999999999991_888')->>'state')='available','Fresh exact object proof can establish restoration';
 assert public.marketing_meta_publication_events(event)=0,'Replay cannot regress restored availability';
 event:=jsonb_set(jsonb_set(event,'{0,occurred_at}',to_jsonb(event_time-60)),'{0,fingerprint}',to_jsonb(repeat('b',64)));
 assert public.marketing_meta_publication_events(event)=0,'Older removal cannot overwrite newer evidence';
 denied:=false;begin perform public.marketing_meta_publication_events(jsonb_set(event,'{0,account_id}','"999999999993"'));exception when others then denied:=true;end;assert denied,'Page-scoped removal identity enforced';
 select md5(to_jsonb(s)::text) into after_hash from public.marketing_social_posts s where connection_id=c;assert before_hash=after_hash,'Provider post history unchanged after remove/retry/recovery';
 proof:=public.marketing_content_management(o,b);
 assert exists(select 1 from jsonb_array_elements(proof->'rows') r,jsonb_array_elements(r->'channels') v where v->>'provider_post_id'='999999999991_888' and v->>'status'='published' and v->'availability'->>'state'='available'),'Calendar/List use live availability independently from Published';
 proof:=public.marketing_social_publications(o,b,null,null);
 assert exists(select 1 from jsonb_array_elements(proof->'posts') v where v->>'provider_post_id'='999999999991_888' and v->'availability'->>'state'='available' and v->'metrics'->>'likes'='0' and not v->'metrics'?'reach'),'Analytics retains historical zero/missing semantics and consistent live state';
 denied:=false;begin perform public.marketing_social_publications(o,other_b,null,null);exception when others then denied:=true;end;assert denied,'Restricted Brand reporting denied';
 assert not has_table_privilege('authenticated','marketing_private.publication_availability','select'),'No direct private projection read';
 assert not has_function_privilege('authenticated','public.marketing_meta_publication_events(jsonb)','execute'),'Browser cannot fabricate removal evidence';
 assert not has_function_privilege('authenticated','public.marketing_meta_availability_targets(uuid,integer,uuid)','execute'),'Browser cannot select provider probe targets';
 assert not has_function_privilege('authenticated','public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text,jsonb)','execute'),'Browser cannot persist availability';
end;$availability$;
rollback;
