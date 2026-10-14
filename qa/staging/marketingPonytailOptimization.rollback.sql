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

-- Only disposable fixtures; no provider API or execution configuration.
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');conn uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();v integer;r jsonb;x jsonb;small jsonb;full_read jsonb;denied boolean;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation) values(conn,o,b,'facebook','999999999998','Disposable receipt fixture','test_authorized',now()+interval '1 day','{"granted_scopes":["pages_messaging"],"execution_enabled":false}',1);
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,webhook_verified) values(conn,1,true,true);
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,last_inbound_at) values(c,o,b,'facebook',conn,'777','Disposable receipt fixture',now()-interval '1 hour');
 select version into v from public.marketing_conversations where id=c;
 insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,created_by) values(d,c,'Unsent reply draft',v,'human',e);
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,due_at) values('qa-receipt-'||conn,conn,1,jsonb_build_object('peer_id','777','kind','read','event_id','777:watermark','occurred_at',now()),'qa','1970-01-01');
 r:=public.marketing_inbox_process_events(1);assert r->>'processed'='1','Receipt fixture processed';
 assert (select version from public.marketing_conversations where id=c)=v,'Receipts must not stale a draft';
 assert (select source_version from public.marketing_reply_drafts where id=d)=v;
 assert exists(select 1 from public.marketing_conversation_messages where conversation_id=c and kind='read'),'Receipt retained';
 insert into marketing_private.inbox_events(event_key,connection_id,generation,payload,fingerprint,due_at) values('qa-inbound-'||conn,conn,1,jsonb_build_object('peer_id','777','kind','incoming','body','A new genuine question','event_id','new-inbound','occurred_at',now()),'qa','1970-01-01');
 r:=public.marketing_inbox_process_events(1);assert r->>'processed'='1';
 assert (select version from public.marketing_conversations where id=c)=v+1,'New inbound still invalidates stale proposals';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 -- Compare-and-swap ensures a late failed refresh cannot expire a newer credential.
 insert into marketing_private.drive_connections(organization_id,status,generation,sealed_token,expires_at) values(o,'connected',1,'{"fixture":"old"}',now());
 r:=public.marketing_drive_server('refresh',u,o,b,'{"generation":1,"expected_token":{"fixture":"old"},"sealed_token":{"fixture":"new"},"expires_at":"2030-01-01T00:00:00Z"}');assert (r->>'updated')::boolean;
 r:=public.marketing_drive_server('refresh',u,o,b,'{"generation":1,"expected_token":{"fixture":"old"},"sealed_token":{"fixture":"stale"},"expires_at":"2030-01-01T00:00:00Z"}');assert not (r->>'updated')::boolean;
 perform public.marketing_drive_server('expired',u,o,b,'{"generation":1,"expected_token":{"fixture":"old"}}');
 assert (select status from marketing_private.drive_connections where organization_id=o)='connected';assert (select sealed_token->>'fixture' from marketing_private.drive_connections where organization_id=o)='new';
 perform public.marketing_drive_server('expired',u,o,b,'{"generation":1,"expected_token":{"fixture":"new"}}');assert (select status from marketing_private.drive_connections where organization_id=o)='expired';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 x:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"Disposable directory fixture","profiles":[{"platform":"instagram","profile_url":"https://instagram.com/feedx_directory_disposable/"}]}');
 small:=public.marketing_creator_directory(o,b);full_read:=public.marketing_creators_read(o,b);
 assert jsonb_array_length(small->'creators')=1 and jsonb_array_length(small->'accounts')=1;
 assert small->'creators'=full_read->'creators' and small->'accounts'=full_read->'accounts' and small->'options'=full_read->'options','Directory retains exact visibility and identity semantics';
 assert not small ?| array['posts','snapshots','collaborations','assets','members','campaigns'],'Directory avoids unrelated history';
 denied:=false;begin perform public.marketing_creator_directory(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Restricted Brand rejected';
 assert not has_function_privilege('anon','public.marketing_creator_directory(uuid,uuid)','execute');
end;$$;
rollback;
select 'PASS: receipt draft stability, genuine inbound invalidation, refresh CAS, authorized compact Creator directory; all fixtures rolled back' verification;
