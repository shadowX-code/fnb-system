-- Staging-only changed live-delivery authorities, no provider calls.
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
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

grant select,insert,update on marketing_qa_ids to service_role;
create temporary table creator_qa_values(key text primary key,value jsonb);
grant select,insert,update on creator_qa_values to authenticated,service_role;
do $$declare c uuid:=gen_random_uuid();foreign_c uuid:=gen_random_uuid();foreign_b uuid:=gen_random_uuid();begin
 insert into public.brands(id,organization_id,name) values(foreign_b,(select id from marketing_qa_ids where key='other_org'),'QA Foreign Brand');
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,credential_generation,expires_at,capabilities)
 values(c,(select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'instagram','99999999001','qa_delegation_source','test_authorized',1,now()+interval '1 day','{"granted_scopes":["instagram_basic","pages_read_engagement","instagram_manage_insights"]}'),
 (foreign_c,(select id from marketing_qa_ids where key='other_org'),foreign_b,'instagram','99999999002','qa_foreign_source','test_authorized',1,now()+interval '1 day','{"granted_scopes":["instagram_basic","pages_read_engagement","instagram_manage_insights"]}');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,expires_at) values(c,'synthetic-no-provider-token','{"synthetic":true}',now()+interval '1 day'),(foreign_c,'synthetic-no-provider-token','{"synthetic":true}',now()+interval '1 day');
 insert into marketing_qa_ids values('connection',c),('foreign_connection',foreign_c);
 insert into public.organization_memberships values((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='other_employee'));
end;$$;
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');c jsonb;a jsonb;v jsonb;p jsonb;r jsonb;denied boolean:=false;begin
 c:=marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,'{"name":"QA Delegated Creator"}');
 a:=marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','instagram','handle','qa_delegate_one','profile_url','https://www.instagram.com/qa_delegate_one/'));
 insert into marketing_qa_ids values('creator',(c->>'id')::uuid),('account',(a->>'id')::uuid);
 v:=marketing_creator_command(gen_random_uuid(),o,(select id from marketing_qa_ids where key='brand'),'save_collaboration',null,0,jsonb_build_object('title','QA Unchanged Collaboration','creator_id',c->>'id','status','planned','cost_state','estimated'));
 p:=marketing_creator_command(gen_random_uuid(),o,(select id from marketing_qa_ids where key='brand'),'save_post',null,0,jsonb_build_object('url','https://www.instagram.com/p/DelegationFixture/','creator_id',c->>'id','account_id',a->>'id','collaboration_id',v->>'id','confirm_link',true,'confirm_published',true));
 insert into creator_qa_values values('history',marketing_creator_workspace(o,(select id from marketing_qa_ids where key='brand')));
 assert marketing_creator_profile_connection(o)->>'eligible'='false','Default deny';
 assert marketing_creator_enrichment_begin(o,'qa_delegate_one',(a->>'id')::uuid)->>'reason'='organization_profile_authorization_required';
 begin perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,0,(select id from marketing_qa_ids where key='foreign_connection'),1,true);exception when insufficient_privilege then denied:=true;end;assert denied,'Foreign-org delegation denied';
 r:=marketing_creator_enrichment_delegate(gen_random_uuid(),o,0,(select id from marketing_qa_ids where key='connection'),1,true);
 assert r->>'eligible'='true' and r->>'revision'='1','Grant returned: '||r::text;assert not (r::text like '%sealed_token%'),'No credentials in admin view';
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_one',(a->>'id')::uuid);insert into marketing_qa_ids values('revoked_request',(r->>'request_id')::uuid);
 perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
 perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,1,null,null,false);
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('creator_id',c->>'id','platform','instagram','handle','qa_delegate_one','profile_url','https://www.instagram.com/qa_delegate_one/','public_observation',jsonb_build_object('source','Meta Instagram Business Discovery','captured_at',now(),'avatar_url','https://scontent.cdninstagram.com/forged.jpg')));exception when insufficient_privilege then denied:=true;end;assert denied,'Raw browser Meta evidence denied';
 assert not has_function_privilege('authenticated','public.marketing_creator_enrichment_finish(uuid,uuid,jsonb,text)','execute');
 assert not has_function_privilege('authenticated','public.marketing_creator_enrichment_material(uuid,uuid)','execute');
 denied:=false;begin perform 1 from marketing_private.creator_enrichment_delegations;exception when insufficient_privilege then denied:=true;end;assert denied,'Private delegation table inaccessible';
 denied:=false;begin perform 1 from marketing_private.creator_enrichment_requests;exception when insufficient_privilege then denied:=true;end;assert denied,'Private result evidence inaccessible';
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Legacy last-known evidence exists only on this synthetic fixture and must survive replacement.
update public.marketing_creator_accounts set followers=31,followers_source='meta_instagram_business_discovery',followers_captured_at=now()-interval '1 day',public_observation=jsonb_build_object('source','public_profile_staff_confirmed','source_hint','Controlled fixture cache','captured_at',now()-interval '1 day','profile_url','https://www.instagram.com/qa_delegate_one/','avatar_kind','profile_picture','avatar_url','https://scontent.cdninstagram.com/old.jpg') where id=(select id from marketing_qa_ids where key='account');
set local role service_role;
do $$declare denied boolean:=false;begin
 begin perform marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='revoked_request'),(select id from marketing_qa_ids where key='user'),'{"id":"88888","username":"qa_delegate_one","avatar_url":"https://scontent.cdninstagram.com/late.jpg","followers":99}',null);exception when insufficient_privilege then denied:=true;end;assert denied,'Revocation blocks in-flight result';
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;begin
 perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,2,(select id from marketing_qa_ids where key='connection'),1,true);
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_one',(select id from marketing_qa_ids where key='account'));insert into marketing_qa_ids values('good_request',(r->>'request_id')::uuid);assert marketing_creator_enrichment_begin(o,'qa_delegate_one',(select id from marketing_qa_ids where key='account'))->>'reason'='profile_refresh_in_progress','Overlapping profile reads are denied';perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;denied boolean:=false;begin
 begin perform marketing_creator_enrichment_material((select id from marketing_qa_ids where key='revoked_request'),(select id from marketing_qa_ids where key='user'));exception when insufficient_privilege then denied:=true;end;assert denied,'Regrant cannot revive old request epoch';
 r:=marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='good_request'),(select id from marketing_qa_ids where key='user'),'{"id":"88888","username":"qa_delegate_one","name":"Public fixture name","biography":"Fixture biography","media_count":12,"avatar_url":"https://scontent.cdninstagram.com/good.jpg","followers":0}',null);
 assert r->'observation'->>'name'='Public fixture name' and r->'observation'->>'biography'='Fixture biography','Public metadata belongs to canonical observation';
 assert r->>'state'='ready' and r->'account'->>'followers'='0','Zero is valid provider evidence';
 assert r->'account'->'public_observation'->>'source'='meta_instagram_business_discovery','Automatic provider evidence is not mislabeled as staff confirmation';
 assert r->'account'->'public_observation'->>'request_id'=(select id::text from marketing_qa_ids where key='good_request');
 insert into creator_qa_values values('good_account',r->'account');
 r:=marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='good_request'),(select id from marketing_qa_ids where key='user'),'{"id":"88888","username":"qa_delegate_one","followers":999}',null);
 assert r->'account'->>'followers'='0','Duplicate completion cannot replace evidence';
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from public.employees where id=(select id from marketing_qa_ids where key='other_employee')),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;denied boolean:=false;begin
 assert jsonb_array_length(marketing_creator_directory(o,null)->'creators')>0,'Shared directory remains available';
 begin perform marketing_creator_workspace(o,(select id from marketing_qa_ids where key='brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Delegation does not grant private Brand data';
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_one',(select id from marketing_qa_ids where key='account'));insert into marketing_qa_ids values('shared_request',(r->>'request_id')::uuid);perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
 denied:=false;begin perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,3,(select id from marketing_qa_ids where key='connection'),1,true);exception when insufficient_privilege then denied:=true;end;assert denied,'Admin without source Brand authority cannot delegate';
end;$$;
reset role;
-- A second actor cannot overlap the same delegated read; expire only this synthetic pending fixture.
do $$begin assert (select count(*) from marketing_private.creator_enrichment_requests where id=(select id from marketing_qa_ids where key='shared_request') and state='pending')=1;end;$$;
update marketing_private.creator_enrichment_requests set expires_at=clock_timestamp()-interval '1 second' where id=(select id from marketing_qa_ids where key='shared_request');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;begin
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_one',(select id from marketing_qa_ids where key='account'));insert into marketing_qa_ids values('rotated_request',(r->>'request_id')::uuid);perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
end;$$;
reset role;
update public.marketing_connections set credential_generation=2 where id=(select id from marketing_qa_ids where key='connection');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare denied boolean:=false;begin
 begin perform marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='rotated_request'),(select id from marketing_qa_ids where key='user'),'{"id":"88888","username":"qa_delegate_one","followers":80}',null);exception when insufficient_privilege then denied:=true;end;assert denied,'Generation rotation blocks in-flight result';
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;denied boolean:=false;begin
 assert marketing_creator_profile_connection(o)->>'eligible'='false';
 begin perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,3,(select id from marketing_qa_ids where key='connection'),1,true);exception when insufficient_privilege then denied:=true;end;assert denied,'Old generation cannot be delegated';
 perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,3,(select id from marketing_qa_ids where key='connection'),2,true);
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_one',(select id from marketing_qa_ids where key='account'));insert into marketing_qa_ids values('failed_request',(r->>'request_id')::uuid);perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;begin
 r:=marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='failed_request'),(select id from marketing_qa_ids where key='user'),null,'profile_not_available_with_current_meta_access');assert r->>'state'='failed' and r->>'reason'='profile_not_available_with_current_meta_access';
end;$$;
reset role;
do $$declare a public.marketing_creator_accounts;begin
 select * into a from public.marketing_creator_accounts where id=(select id from marketing_qa_ids where key='account');
 assert a.followers=0 and a.public_observation->>'avatar_url'='https://scontent.cdninstagram.com/good.jpg','Failed refresh preserves last known avatar and zero follower evidence';
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;begin
 r:=marketing_creator_enrichment_begin(o,'qa_delegate_new',null);insert into marketing_qa_ids values('preview_request',(r->>'request_id')::uuid);perform marketing_creator_inspection_access(o,null,false,(r->>'request_id')::uuid);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='preview_request'),(select id from marketing_qa_ids where key='user'),'{"id":"77777","username":"qa_delegate_new","avatar_url":"https://scontent.cdninstagram.com/new.jpg","followers":5}',null) is not null;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;request uuid:=gen_random_uuid();payload jsonb;before_data jsonb;after_data jsonb;denied boolean:=false;begin
 payload:=jsonb_build_object('creator_id',(select id from marketing_qa_ids where key='creator'),'platform','instagram','handle','qa_delegate_new','profile_url','https://www.instagram.com/qa_delegate_new/','profile_enrichment_receipt',(select id from marketing_qa_ids where key='preview_request'));
 r:=marketing_creator_command(request,o,null,'save_account',null,0,payload);
 assert r->'public_observation'->>'avatar_url'='https://scontent.cdninstagram.com/new.jpg','Browser uses only server proof';
 assert r->>'followers'='5' and r->>'followers_source'='meta_instagram_business_discovery' and r->>'followers_sync_status'='ready','New profile persists the same authorized follower receipt';
 assert marketing_creator_command(request,o,null,'save_account',null,0,payload)=r,'Canonical retry remains idempotent';
 denied:=false;begin update public.marketing_creator_accounts set followers=999 where id=(r->>'id')::uuid;exception when insufficient_privilege then denied:=true;end;assert denied,'Browser cannot write follower evidence directly';
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',(r->>'id')::uuid,(r->>'revision')::int,(payload-'profile_enrichment_receipt')||jsonb_build_object('followers',999));exception when others then denied:=SQLERRM='Followers are system-sourced only.';end;assert denied,'Browser command cannot forge follower evidence';
 begin perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload);exception when insufficient_privilege then denied:=true;end;assert denied,'One-use proof cannot create duplicate identities';
 before_data:=(select value from creator_qa_values where key='history');after_data:=marketing_creator_workspace(o,(select id from marketing_qa_ids where key='brand'));
 assert before_data->'posts'=after_data->'posts' and before_data->'collaborations'=after_data->'collaborations' and before_data->'snapshots'=after_data->'snapshots','Historical commercial evidence unchanged';
end;$$;
reset role;
do $$begin assert (select previous_observation->>'followers' from marketing_private.creator_enrichment_requests where id=(select id from marketing_qa_ids where key='good_request'))='31','Legacy follower observation retained before replacement';assert (select previous_observation->'public_observation'->>'avatar_url' from marketing_private.creator_enrichment_requests where id=(select id from marketing_qa_ids where key='good_request'))='https://scontent.cdninstagram.com/old.jpg','Legacy avatar retained before replacement';end;$$;
-- An older ready preview cannot be saved after revocation; the queue uses the same authority.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=marketing_creator_enrichment_begin((select id from marketing_qa_ids where key='org'),'qa_delegate_stale',null);insert into marketing_qa_ids values('stale_preview',(r->>'request_id')::uuid);perform marketing_creator_inspection_access((select id from marketing_qa_ids where key='org'),null,false,(r->>'request_id')::uuid);
end;$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;begin
 r:=marketing_creator_enrichment_finish((select id from marketing_qa_ids where key='stale_preview'),(select id from marketing_qa_ids where key='user'),'{"id":"77778","username":"qa_delegate_stale","avatar_url":"https://scontent.cdninstagram.com/stale.jpg"}',null);assert r->>'state'='ready';
 update public.marketing_creator_accounts set followers_due_at='-infinity'::timestamptz where organization_id=(select id from marketing_qa_ids where key='org') and handle='qa_delegate_new';
 -- Only claim if the oldest due row is our uncommitted synthetic account.
 if (select ca.organization_id=(select id from marketing_qa_ids where key='org') from public.marketing_creator_accounts ca join public.marketing_creators cr on cr.id=ca.creator_id where not ca.archived and not cr.archived and ca.platform in ('facebook','instagram') and ca.followers_due_at<=now() and (ca.followers_lease_until is null or ca.followers_lease_until<now()) order by ca.followers_due_at,ca.id limit 1) then
  r:=marketing_creator_followers_claim();assert r->>'organization_id'=(select id::text from marketing_qa_ids where key='org');assert r->>'enrichment_request_id' is not null;
  perform marketing_creator_enrichment_material((r->>'enrichment_request_id')::uuid,null);
  r:=marketing_creator_enrichment_finish((r->>'enrichment_request_id')::uuid,null,jsonb_build_object('id','77777','username',r->>'handle','followers',4),null);assert r->'account'->>'followers'='4';
 else raise exception 'Worker fixture cannot safely claim while unrelated older work is due';end if;
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');denied boolean:=false;begin
 perform marketing_creator_enrichment_delegate(gen_random_uuid(),o,4,null,null,false);
 begin perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',(select id from marketing_qa_ids where key='creator'),'platform','instagram','handle','qa_delegate_stale','profile_url','https://www.instagram.com/qa_delegate_stale/','profile_enrichment_receipt',(select id from marketing_qa_ids where key='stale_preview')));exception when insufficient_privilege then denied:=true;end;assert denied,'Ready browser proof rejected after revocation';
end;$$;
reset role;
-- Real connection generations and credential bytes were never changed; every row above is disposable.
rollback;
select 'PASS: default deny, explicit grant, source/org authorization, revocation + regrant epoch, rotation, atomic result persistence, provider failure preservation, shared directory without Brand data, browser evidence rejection, one-use proof and history; fixtures rolled back' verification;
