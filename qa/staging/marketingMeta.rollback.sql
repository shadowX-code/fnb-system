-- Staging-only L3 rehearsal. Every fixture and mutation is rolled back.
-- Run only against verified ujkzdaaadnvcfayuldmh; no provider call is made.
begin;

-- A synthetic independent receipt is used ONLY in rollback contract QA; live Blob rehearsal is separate.
create function pg_temp.qa_journal_ack(intent jsonb) returns void language plpgsql as $$begin
 perform public.marketing_privacy_journal_ack(intent->>'id',encode(extensions.digest(intent->>'payload','sha256'),'hex'),'feedx/ujkzdaaadnvcfayuldmh/erasure/v1/'||(intent->>'id')||'.json');
end;$$;
-- Do not run the global claim rehearsal alongside configured live accounts.
do $$begin assert not exists(select 1 from public.marketing_connections where capabilities->>'execution_enabled'='true'),'Global claim QA requires no enabled external accounts';end;$$;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated,service_role;
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
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;
set local role authenticated;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','authenticated'))::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');s jsonb;c jsonb;denied boolean;
begin
 s:=public.marketing_meta_begin(o,b,repeat('a',64),'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');
 insert into marketing_qa_ids values('oauth',(s->>'id')::uuid);
 denied:=false;begin perform public.marketing_meta_begin(o,(select id from marketing_qa_ids where key='other_brand'),repeat('b',64),'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');exception when insufficient_privilege then denied:=true;end;assert denied,'OAuth must deny hidden brands';
 denied:=false;begin perform public.marketing_meta_begin(o,b,repeat('c',64),'https://attacker.invalid/callback');exception when others then denied:=true;end;assert denied,'Redirect must be fixed';
 denied:=false;begin perform public.marketing_meta_connection_material(gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'No browser credential access';
 denied:=false;begin perform public.marketing_meta_bind(gen_random_uuid(),gen_random_uuid(),'111','facebook','{}',now()+interval '1 day','test');exception when insufficient_privilege then denied:=true;end;assert denied,'No browser bind authority';
 c:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,'{"title":"QA Meta execution","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"Rollback only, never sent","asset_ids":[]}]}');
 insert into marketing_qa_ids values('meta_content',(c->>'id')::uuid);
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,(c->>'id')::uuid,1);
 perform public.marketing_content_command(gen_random_uuid(),'approve',o,b,(c->>'id')::uuid,1);
 perform public.marketing_content_command(gen_random_uuid(),'schedule',o,b,(c->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 hour','timezone','Asia/Kuala_Lumpur'));
end;$$;
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
do $$
declare s uuid:=(select id from marketing_qa_ids where key='oauth'); u uuid:=(select id from marketing_qa_ids where key='user');c jsonb;again jsonb;denied boolean;
begin
 assert public.marketing_claim_job() is null,'No execution before explicit external approval';
 perform public.marketing_meta_consume(repeat('a',64));
 denied:=false;begin perform public.marketing_meta_consume(repeat('a',64));exception when insufficient_privilege then denied:=true;end;assert denied,'OAuth state must be single-use';
 perform public.marketing_meta_stage(s,'789','{"version":1,"ciphertext":"QA rollback only"}','[{"id":"111","name":"Rollback Test Page","channel":"facebook","capabilities":{"publishing":true,"posts":true,"insights":false,"formats":["text"]}}]');
 denied:=false;begin perform public.marketing_meta_session_material(s,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'Selection must match the authorizing Auth actor';
 c:=public.marketing_meta_bind(s,u,'111','facebook','{"version":1,"ciphertext":"QA rollback only"}',now()+interval '1 day','test');
 again:=public.marketing_meta_bind(s,u,'111','facebook','{"version":1,"ciphertext":"QA retry only"}',now()+interval '1 day','test');
 assert again=c and c->>'credential_generation'='1','Exact account selection retry must not rotate credentials';
 insert into marketing_qa_ids values('connection',(c->>'id')::uuid);
 assert public.marketing_claim_job() is null,'A connection must not release queued content';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','authenticated'))::text,true);
do $$
declare denied boolean;conn uuid:=(select id from marketing_qa_ids where key='connection');c uuid:=(select id from marketing_qa_ids where key='meta_content');result jsonb;
begin
 assert public.marketing_meta_pending((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'))->0->'accounts'='[]','Bound channel must leave selection choices';
 result:=public.marketing_integrations((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'));
 assert result::text not like '%ciphertext%' and result::text not like '%sealed_token%','Integration metadata must never include credentials';
 denied:=false;begin perform public.marketing_authorize_execution(gen_random_uuid(),c,1,array[conn]);exception when others then denied:=true;end;assert denied,'Server test-account policy must be required';
end;$$;
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
select public.marketing_meta_execution_policy((select id from marketing_qa_ids where key='connection'),1,true);
do $$declare c jsonb;begin
 c:=public.marketing_meta_sync_claim();assert c is not null,'Authorized post sync must be claimable';
 perform public.marketing_meta_sync_finish((c->>'id')::uuid,1,(c->>'sync_lease')::uuid,'[{"id":"111_999","caption":"Rollback source contract","published_at":"2026-10-09T00:00:00Z","metrics":{"likes":4},"unavailable_metrics":{"reach":"not_available"}}]',null,null);
end;$$;
reset role;
update public.marketing_jobs set due_at=now()-interval '1 minute' where content_id=(select id from marketing_qa_ids where key='meta_content');
set local role authenticated;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','authenticated'))::text,true);
do $$declare req uuid:=gen_random_uuid();result jsonb;again jsonb;begin
 result:=public.marketing_authorize_execution(req,(select id from marketing_qa_ids where key='meta_content'),1,array[(select id from marketing_qa_ids where key='connection')]);
 again:=public.marketing_authorize_execution(req,(select id from marketing_qa_ids where key='meta_content'),1,array[(select id from marketing_qa_ids where key='connection')]);assert result=again,'Execution approval retry must be idempotent';
end;$$;
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
do $$declare j jsonb;denied boolean;begin
 j:=public.marketing_claim_job();assert j->>'channel'='facebook','Approved enabled test job must be claimable';
 insert into marketing_qa_ids values('job',(j->>'id')::uuid),('lease',(j->>'lease_token')::uuid);
 perform public.marketing_job_guard((j->>'id')::uuid,(j->>'lease_token')::uuid);
 denied:=false;begin perform public.marketing_finish_job((j->>'id')::uuid,(j->>'lease_token')::uuid,'published','111_222');exception when others then denied:=true;end;assert denied,'No publication without durable provider evidence';
 perform public.marketing_job_checkpoint((j->>'id')::uuid,(j->>'lease_token')::uuid,'{"pending":"publish"}');
 perform public.marketing_finish_job((j->>'id')::uuid,(j->>'lease_token')::uuid,'uncertain',null,'qa_uncertain');
 assert public.marketing_claim_job() is null,'Uncertain writes must never be resent';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','authenticated'))::text,true);
do $$declare denied boolean;begin
 denied:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',(select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),(select id from marketing_qa_ids where key='meta_content'),1,'{"title":"Changed","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"Changed","asset_ids":[]}]}');exception when others then denied:=true;end;assert denied,'Uncertainty must freeze material revisions';
 perform public.marketing_meta_disconnect((select id from marketing_qa_ids where key='connection'));
end;$$;
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
do $$declare denied boolean;begin
 assert public.marketing_meta_connection_material((select id from marketing_qa_ids where key='connection')) is null,'Disconnect removes token material';
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_meta(repeat('1',64),'789',repeat('d',64),now()));
 perform public.marketing_meta_removal_once(repeat('1',64),'789',true,repeat('d',64),now());
 assert public.marketing_meta_deletion_status(repeat('d',64))->>'status'='local_completed_followup_pending','Deletion confirmation must distinguish unverified backup/provider handling';
 assert public.marketing_meta_deletion_status(repeat('e',64)) is null,'Unknown deletion code must not reveal anything';
end;$$;
reset role;
do $$begin
 assert not exists(select 1 from marketing_private.credentials where connection_id=(select id from marketing_qa_ids where key='connection')),'Credential erasure failed';
 assert (select state='cancelled' and provider_state='{}' and provider_post_id is null from public.marketing_jobs where id=(select id from marketing_qa_ids where key='job')),'Provider job evidence must be erased';
 assert not exists(select 1 from public.marketing_social_posts where connection_id=(select id from marketing_qa_ids where key='connection')),'Meta-derived projections must be erased';
 assert (select provider_account_id is null and account_name is null from public.marketing_connections where id=(select id from marketing_qa_ids where key='connection')),'Disconnected identity must be erased';
 assert exists(select 1 from public.marketing_content_revisions where content_id=(select id from marketing_qa_ids where key='meta_content')),'FeedX-owned creative revisions must remain';
 assert not has_function_privilege('anon','public.marketing_authorize_execution(uuid,uuid,integer,uuid[])','EXECUTE'),'Anonymous execution exposed';
 assert not has_function_privilege('authenticated','public.marketing_job_checkpoint(uuid,uuid,jsonb)','EXECUTE'),'Browser checkpoint exposed';
end;$$;
-- Reconnect through the same authority; a signed removal replay cannot erase this later grant.
set local role authenticated;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','authenticated'))::text,true);
do $$declare s jsonb;begin
 s:=public.marketing_meta_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('f',64),'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');
 insert into marketing_qa_ids values('reconnect',(s->>'id')::uuid);
end;$$;
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
do $$declare s uuid:=(select id from marketing_qa_ids where key='reconnect');begin
 perform public.marketing_meta_consume(repeat('f',64));
 perform public.marketing_meta_stage(s,'789','{"ciphertext":"QA later grant"}','[{"id":"111","name":"Rollback Later Consent","channel":"facebook","capabilities":{"publishing":true,"posts":true,"formats":["text"]}}]');
 perform public.marketing_meta_bind(s,(select id from marketing_qa_ids where key='user'),'111','facebook','{"ciphertext":"QA later grant"}',now()+interval '1 day','test');
 perform public.marketing_meta_removal_once(repeat('1',64),'789',true,repeat('2',64),now());
 assert public.marketing_meta_connection_material((select id from marketing_qa_ids where key='connection')) is not null,'Signed callback replay must preserve later consent';
 perform pg_temp.qa_journal_ack(public.marketing_privacy_prepare_meta(repeat('3',64),'789',encode(extensions.digest('789:'||(now()-interval '5 minutes')::text,'sha256'),'hex'),now()-interval '5 minutes'));
 perform public.marketing_meta_removal_once(repeat('3',64),'789',false,null,now()-interval '5 minutes');
 assert public.marketing_meta_connection_material((select id from marketing_qa_ids where key='connection')) is not null,'Older removal event cannot erase later consent';
end;$$;
reset role;
-- Recover a known completed checkpoint after a lease crash; never repeat a pending write.
update public.marketing_connections set capabilities=capabilities||'{"execution_enabled":true}' where id=(select id from marketing_qa_ids where key='connection');
update public.marketing_jobs set state='leased',external_authorized_at=now(),connection_generation=3,provider_state='{"objects":{"photo_0":"901"}}',due_at=now()-interval '1 minute',lease_expires_at=now()-interval '1 minute' where id=(select id from marketing_qa_ids where key='job');
set local role service_role;
select set_config('request.jwt.claims',(coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb||jsonb_build_object('role','service_role'))::text,true);
do $$declare j jsonb;begin
 j:=public.marketing_claim_job();assert j->>'state'='leased' and j->'provider_state'->'objects'->>'photo_0'='901','Known completed checkpoint must resume without recreating media';
 perform public.marketing_job_checkpoint((j->>'id')::uuid,(j->>'lease_token')::uuid,'{"pending":"publish"}');
 perform public.marketing_finish_job((j->>'id')::uuid,(j->>'lease_token')::uuid,'permanent_failure',null,'qa_failure_after_lost_write');
 assert public.marketing_claim_job() is null,'A failure cannot unlock a pending uncertain write';
end;$$;
reset role;
rollback;
select 'Marketing Meta OAuth/execution/privacy rollback rehearsal passed' result;
