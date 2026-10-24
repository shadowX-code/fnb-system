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

create function pg_temp.routine_content(fmt text,channel text) returns uuid language plpgsql as $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');v uuid:=(select id from marketing_qa_ids where key='video');i uuid:=(select id from marketing_qa_ids where key='image');c uuid;body jsonb;
begin
 body:=jsonb_build_object('title','QA routine authority — never publish','outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel',channel,'format',fmt,'caption','Rollback-only technical fixture','asset_ids',case when fmt='text' then '[]'::jsonb when fmt in('image','story') then jsonb_build_array(i) when fmt='carousel' then jsonb_build_array(i,v) else jsonb_build_array(v) end)));
 c:=(public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,body)->>'id')::uuid;
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,c,1,'{}');
 perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,c,1,'{}');
 perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,c,1,jsonb_build_object('scheduled_at',now()+interval '1 day','timezone','Asia/Kuala_Lumpur'));
 return c;
end;$$;
create function pg_temp.routine_receipt(content uuid,connection uuid,post text) returns void language sql as $$
 update public.marketing_jobs set state='succeeded',connection_id=connection,connection_generation=1,provider_post_id=post,
 provider_state=jsonb_build_object('post_id',post),authorized_by=(select id from marketing_qa_ids where key='employee'),external_authorized_at=now() where content_id=content;
$$;
do $policy$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');other_b uuid:=(select id from marketing_qa_ids where key='other_brand');e uuid:=(select id from marketing_qa_ids where key='employee');fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();vid uuid:=gen_random_uuid();pic uuid:=gen_random_uuid();content uuid;reel_content uuid;video_content uuid;mix_content uuid;job uuid;lease uuid:=gen_random_uuid();c public.marketing_connections;info jsonb;caps jsonb;denied boolean;before_count integer;ret jsonb;
begin
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values
 (vid,o,b,'QA.mp4','video/mp4',2000,'rollback/'||vid,'ready',e),(pic,o,b,'QA.jpg','image/jpeg',1000,'rollback/'||pic,'ready',e);
 insert into marketing_qa_ids values('video',vid),('image',pic),('fb',fb),('ig',ig);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,credential_generation) values
 (fb,o,b,'facebook','999999999991','QA routine Page','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["text","image","video","reel"]}',e,1),
 (ig,o,b,'instagram','999999999992','QA routine IG','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["image","reel","carousel","story"]}',e,1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(fb,'rollback','{}'),(ig,'rollback','{}');
 select * into c from public.marketing_connections where id=fb;caps:=c.capabilities;
 assert c.routine_publishing_generation is null and c.routine_publishing_formats='{}','Default off';
 assert marketing_private.format_authorizations(c)->>'facebook_video' is null,'No ambient format grant';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',null,'routine');exception when others then denied:=true;end;assert denied,'No acceptance receipt denies routine enable';
 video_content:=pg_temp.routine_content('video','facebook');perform pg_temp.routine_receipt(video_content,fb,'999999999991_901');
 perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',null,'routine');
 select * into c from public.marketing_connections where id=fb;assert c.capabilities=caps,'Base publishing capabilities preserved';
 assert marketing_private.format_authorizations(c)->>'facebook_video'='routine','Exact video receipt activates video';
 assert marketing_private.format_authorizations(c)->>'facebook_reel' is null,'Video receipt does not activate Reel';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_reel',null,'routine');exception when others then denied:=true;end;assert denied,'Reel needs its own receipt';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'instagram_mixed_carousel',null,'routine');exception when others then denied:=true;end;assert denied,'Cross-channel format rejected';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '1 minute','routine');exception when others then denied:=true;end;assert denied,'Routine does not accept a QA expiry';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '5 minutes');exception when others then denied:=true;end;assert denied,'Routine cannot authorize overlapping QA';
 reel_content:=pg_temp.routine_content('reel','facebook');perform pg_temp.routine_receipt(reel_content,fb,'999999999991_902');perform public.marketing_meta_execution_policy(fb,1,true,'facebook_reel',null,'routine');
 perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video',null,'routine');select * into c from public.marketing_connections where id=fb;
 assert marketing_private.format_authorizations(c)->>'facebook_video' is null and marketing_private.format_authorizations(c)->>'facebook_reel'='routine','Revocation preserves sibling format';
 select count(*) into before_count from public.marketing_events where action='routine_format_revoked';perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video',null,'routine');assert(select count(*) from public.marketing_events where action='routine_format_revoked')=before_count,'Revocation retry creates no duplicate event';
 perform public.marketing_meta_execution_policy(fb,1,false);select * into c from public.marketing_connections where id=fb;assert marketing_private.format_authorizations(c)->>'facebook_reel' is null,'Base execution remains independent kill switch';
 assert c.routine_publishing_formats=array['facebook_reel'],'Health does not rewrite routine grants';perform public.marketing_meta_execution_policy(fb,1,true);
 update public.marketing_connections set credential_generation=2 where id=fb;select * into c from public.marketing_connections where id=fb;
 assert marketing_private.format_authorizations(c)->>'facebook_reel' is null,'Reconnect invalidates previous generation grant';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_reel',null,'routine');exception when others then denied:=true;end;assert denied,'Stale-generation command rejected';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,2,true,'facebook_reel',null,'routine');exception when others then denied:=true;end;assert denied,'Old-generation receipt cannot authorize new generation';
 perform public.marketing_meta_execution_policy(fb,2,false,'facebook_reel',null,'routine');update public.marketing_connections set credential_generation=1 where id=fb;
 perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '5 minutes');select * into c from public.marketing_connections where id=fb;
 assert c.routine_publishing_formats='{}' and marketing_private.format_authorizations(c)->>'facebook_video'='temporary','QA does not persist routine permission';
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',null,'routine');exception when others then denied:=true;end;assert denied,'QA cannot authorize overlapping routine';
 perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video');
 denied:=false;begin perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '31 minutes');exception when others then denied:=true;end;assert denied,'FB QA cap unchanged';
 perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '5 minutes');
 update public.marketing_connections set facebook_video_authorized_at=clock_timestamp()-interval '5 minutes',facebook_video_expires_at=clock_timestamp()-interval '1 second' where id=fb;select * into c from public.marketing_connections where id=fb;
 assert marketing_private.format_authorizations(c)->>'facebook_video' is null,'Expired QA fails closed';perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video');
 mix_content:=pg_temp.routine_content('carousel','instagram');perform pg_temp.routine_receipt(mix_content,ig,'999999999993');
 perform public.marketing_meta_execution_policy(ig,1,true,'instagram_extended',now()+interval '5 minutes');
 denied:=false;begin perform public.marketing_meta_execution_policy(ig,1,true,'instagram_mixed_carousel',null,'routine');exception when others then denied:=true;end;assert denied,'IG QA cannot persist routine permission';
 perform public.marketing_meta_execution_policy(ig,1,false,'instagram_extended');
 perform public.marketing_meta_execution_policy(ig,1,true,'instagram_mixed_carousel',null,'routine');select * into c from public.marketing_connections where id=ig;
 assert marketing_private.format_authorizations(c)->>'instagram_mixed_carousel'='routine','Mixed receipt activates mixed only';
 assert marketing_private.format_authorizations(c)->>'instagram_video_carousel' is null and marketing_private.format_authorizations(c)->>'instagram_story' is null,'No video-only or Story routine permission';
 assert c.instagram_extended_generation=1 and not c.instagram_extended_enabled and c.instagram_extended_authorized_at is not null,'Spent IG window preserved';
 denied:=false;begin perform public.marketing_meta_execution_policy(ig,1,true,'instagram_story',null,'routine');exception when others then denied:=true;end;assert denied,'Story grant unsupported';
 denied:=false;begin perform public.marketing_meta_execution_policy(ig,1,true,'instagram_extended',now()+interval '5 minutes');exception when others then denied:=true;end;assert denied,'Routine cannot activate IG QA';
 perform public.marketing_meta_execution_policy(ig,1,false,'instagram_mixed_carousel',null,'routine');
 denied:=false;begin perform public.marketing_meta_execution_policy(ig,1,true,'instagram_extended',now()+interval '5 minutes');exception when others then denied:=true;end;assert denied,'Revoking routine does not reset spent IG QA';
 -- Grant admission and revocation against a distinct current publishing job.
 perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',null,'routine');content:=pg_temp.routine_content('video','facebook');
 perform public.marketing_authorize_execution(gen_random_uuid(),content,1,array[fb]);
 update public.marketing_jobs set state='leased',lease_token=lease,lease_expires_at=now()+interval '5 minutes' where content_id=content returning id into job;
 ret:=public.marketing_job_guard(job,lease);assert ret->'format_authorizations'->>'facebook_video'='routine','Job reads canonical routine mode';
 denied:=false;begin perform public.marketing_job_guard(job,lease,true);exception when others then denied:=true;end;assert denied,'Submission needs durable authorization-kind pin';
 perform public.marketing_job_checkpoint(job,lease,'{"format_authorization_kind":"routine"}');perform public.marketing_job_guard(job,lease,true);
 denied:=false;begin perform public.marketing_job_checkpoint(job,lease,'{"format_authorization_kind":"temporary"}');exception when others then denied:=true;end;assert denied,'Authorization kind cannot change';
 denied:=false;begin perform public.marketing_job_checkpoint(job,lease,'{}');exception when others then denied:=true;end;assert denied,'Authorization pin cannot disappear';
 perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video',null,'routine');
 denied:=false;begin perform public.marketing_job_guard(job,lease,true);exception when others then denied:=true;end;assert denied,'Revocation blocks next submission';
 perform public.marketing_job_guard(job,lease);perform public.marketing_job_checkpoint(job,lease,'{"format_authorization_kind":"routine","objects":{"fb_video":"999999999999"}}');
 perform public.marketing_meta_execution_policy(fb,1,true,'facebook_video',now()+interval '5 minutes');
 denied:=false;begin perform public.marketing_job_guard(job,lease,true);exception when others then denied:=true;end;assert denied,'A later QA window cannot resume a routine job';
 perform public.marketing_job_checkpoint(job,lease,'{"format_authorization_kind":"routine","objects":{"fb_video":"999999999999"},"post_id":"999999999991_904"}');
 assert(select provider_state->>'post_id' from public.marketing_jobs where id=job)='999999999991_904','Admitted receipts may reconcile after revocation';
 -- Legacy prepared jobs cannot gain a new kind retroactively.
 update public.marketing_jobs set provider_state='{"objects":{"fb_video":"999999999999"}}' where id=job;
 denied:=false;begin perform public.marketing_job_checkpoint(job,lease,'{"format_authorization_kind":"temporary","objects":{"fb_video":"999999999999"}}');exception when others then denied:=true;end;assert denied,'Legacy preparation stays read-only';
 perform public.marketing_meta_execution_policy(fb,1,false,'facebook_video');
 -- Existing capability discovery cannot authorize Stories.
 content:=pg_temp.routine_content('story','instagram');denied:=false;begin perform public.marketing_authorize_execution(gen_random_uuid(),content,1,array[ig]);exception when others then denied:=true;end;assert denied,'Canonical scheduling authorization rejects Stories';
 assert not has_function_privilege('anon','public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz,text)','execute') and not has_function_privilege('authenticated','public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz,text)','execute'),'No browser activation authority';
 ret:=public.marketing_integrations(o,b,'content',1);assert ret->'connections'->0 ? 'format_authorizations','Canonical scoped projection includes format authority';
 denied:=false;begin perform public.marketing_integrations(o,other_b,'content',1);exception when others then denied:=true;end;assert denied,'Other Brand grant data remains isolated';
end;$policy$;
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform public.marketing_meta_execution_policy((select id from marketing_qa_ids where key='fb'),1,true,'facebook_video',null,'routine');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Authenticated staff cannot bypass service activation authority';
end;$$;
reset role;
rollback;
