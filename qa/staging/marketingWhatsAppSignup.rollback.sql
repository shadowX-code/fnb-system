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
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');denied boolean:=false;begin
 assert not (marketing_whatsapp_readiness(o,b,'100','101','v25.0','v4')->>'eligible')::boolean,'No platform evidence fails closed';
 begin perform marketing_whatsapp_begin(o,b,repeat('a',64),'100','101','v25.0','v4');exception when insufficient_privilege then denied:=true;end;assert denied,'No unapproved live signup';
 begin perform marketing_whatsapp_consume(gen_random_uuid(),(select id from marketing_qa_ids where key='user'),repeat('a',64));raise exception 'Browser reached service consume';exception when insufficient_privilege then null;end;
end;$$;
reset role;
insert into marketing_private.whatsapp_platform_readiness(app_id,config_id,graph_version,signup_version,business_verified,tech_provider_verified,access_verified,app_live,permissions_reviewed,webhook_reviewed,coexistence_enabled,evidence_reference,reviewed_at,expires_at)
values('100','101','v25.0','v4',true,true,true,true,true,true,true,'rollback-fixture-only',now(),now()+interval '1 hour');
insert into marketing_private.whatsapp_pilot_authority(brand_id,app_id,customer_business_id,waba_id,phone_id,approval_reference,expires_at)
select id,'100','202','200','201','rollback-fixture-only',now()+interval '1 hour' from marketing_qa_ids where key='brand';
set local role authenticated;
do $$declare s jsonb;begin
 assert (marketing_whatsapp_readiness((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),'100','101','v25.0','v4')->>'eligible')::boolean,'Approved exact platform and Brand eligible';
 s:=marketing_whatsapp_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('a',64),'100','101','v25.0','v4');
 insert into marketing_qa_ids values('session',(s->>'id')::uuid);
end;$$;
reset role;
do $$declare s uuid:=(select id from marketing_qa_ids where key='session');u uuid:=(select id from marketing_qa_ids where key='user');r jsonb;proof jsonb;conn uuid;denied boolean;begin
 denied:=false;begin perform marketing_whatsapp_consume(s,gen_random_uuid(),repeat('a',64));exception when insufficient_privilege then denied:=true;end;assert denied,'Wrong callback actor denied';
 r:=marketing_whatsapp_consume(s,u,repeat('a',64));
 denied:=false;begin perform marketing_whatsapp_consume(s,u,repeat('a',64));exception when insufficient_privilege then denied:=true;end;assert denied,'Code session consumed once';
 proof:=jsonb_build_object('app_id','100','waba_id','200','phone_id','201','business_id','202','is_on_biz_app',true,'platform_type','CLOUD_API','subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof||'{"phone_id":"666"}');exception when others then denied:=true;end;assert denied,'Wrong exact phone rejected';
 denied:=false;begin perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof-'scopes');exception when others then denied:=true;end;assert denied,'Missing permission proof rejected';
 r:=marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);conn:=(r->>'connection_id')::uuid;
 insert into marketing_qa_ids values('connection',conn);
 assert not marketing_private.whatsapp_receiving(conn),'OAuth alone cannot receive';
 assert (marketing_whatsapp_step(conn,u,1,'subscription')->>'perform')::boolean,'Durable first subscription intent';
 assert not (marketing_whatsapp_step(conn,u,1,'subscription')->>'perform')::boolean,'No duplicate subscription mutation';
 perform marketing_whatsapp_step(conn,u,1,'subscription','verified');
 assert marketing_private.whatsapp_receiving(conn),'Verified receive authority';
 perform marketing_whatsapp_step(conn,u,1,'contacts');perform marketing_whatsapp_step(conn,u,1,'contacts','uncertain');
 assert not (marketing_whatsapp_step(conn,u,1,'contacts')->>'perform')::boolean,'Uncertain sync never retried';
 perform marketing_whatsapp_step(conn,u,1,'contacts','accepted','support-readback-fixture');
 perform marketing_whatsapp_step(conn,u,1,'history');perform marketing_whatsapp_step(conn,u,1,'history','accepted','history-fixture');
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','history','waba_id','200','phone_id','666','occurred_at',clock_timestamp(),'hash',repeat('b',64),'progress',100,'sealed_payload','{"version":1}')));
 assert not(select sync_observed from marketing_private.whatsapp_onboarding where connection_id=conn),'Wrong sync phone ignored';
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','history','waba_id','200','phone_id','201','occurred_at',clock_timestamp(),'hash',repeat('b',64),'progress',100,'sealed_payload','{"version":1}')));
 assert(select sync_progress=100 from marketing_private.whatsapp_onboarding where connection_id=conn),'History completion is generation-bound evidence';
 assert not exists(select 1 from platform_customers where organization_id=(select id from marketing_qa_ids where key='org')),'No CRM identity inferred';
 assert not exists(select 1 from marketing_consent_evidence where brand_id=(select id from marketing_qa_ids where key='brand')),'No consent inferred';
 assert (select not send_verified and not execution_enabled from marketing_private.inbox_authority where connection_id=conn),'Sending remains disabled';
 perform marketing_whatsapp_record_verification(conn,u,1,'{"issue":"coexistence_unsupported"}');
 assert not marketing_private.whatsapp_receiving(conn),'Unsupported closes receive gate';
 perform marketing_whatsapp_record_verification(conn,u,1,proof);
end;$$;
set local role authenticated;
do $$declare s jsonb;c uuid:=(select id from marketing_qa_ids where key='connection');denied boolean:=false;begin
 begin perform marketing_whatsapp_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('c',64),'100','101','v25.0','v4',c,0);exception when others then denied:=true;end;assert denied,'Stale begin generation rejected';
 s:=marketing_whatsapp_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('c',64),'100','101','v25.0','v4',c,1);
 insert into marketing_qa_ids values('reconnect_session',(s->>'id')::uuid);
end;$$;
reset role;
do $$declare s uuid:=(select id from marketing_qa_ids where key='reconnect_session');u uuid:=(select id from marketing_qa_ids where key='user');c uuid:=(select id from marketing_qa_ids where key='connection');proof jsonb;denied boolean:=false;begin
 perform marketing_whatsapp_consume(s,u,repeat('c',64));
 proof:=jsonb_build_object('app_id','100','waba_id','200','phone_id','201','business_id','202','is_on_biz_app',true,'platform_type','CLOUD_API','subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 perform marketing_whatsapp_bind(s,u,'{"version":1,"ciphertext":"synthetic-only"}',proof);
 assert(select credential_generation=2 from marketing_connections where id=c),'Reconnect increments generation';
 assert not marketing_private.whatsapp_receiving(c),'Reconnect resets current receive authority';
 assert(select contacts_state='accepted' and history_state='accepted' from marketing_private.whatsapp_onboarding where connection_id=c),'Reconnect never repeats once-only sync';
 begin perform marketing_whatsapp_step(c,u,1,'subscription');exception when others then denied:=true;end;assert denied,'Old worker generation rejected';
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','account_update','waba_id','200','occurred_at',clock_timestamp(),'hash',repeat('d',64),'event','PARTNER_REMOVED')));
 assert(select issue='provider_disconnected' from marketing_private.whatsapp_onboarding where connection_id=c),'Signed removal blocks current authority';
 perform marketing_whatsapp_lifecycle(jsonb_build_array(jsonb_build_object('field','account_update','waba_id','200','occurred_at',clock_timestamp(),'hash',repeat('e',64),'event','ACCOUNT_RECONNECTED')));
 assert(select issue='provider_disconnected' from marketing_private.whatsapp_onboarding where connection_id=c),'Reconnected event cannot restore authority';
 delete from marketing_private.credentials where connection_id=c;
 assert not exists(select 1 from marketing_private.whatsapp_lifecycle_events where connection_id=c),'Credential erasure removes quarantined personal data';
end;$$;
rollback;
