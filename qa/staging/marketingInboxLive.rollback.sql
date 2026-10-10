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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');conn uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();
begin
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation) values(conn,o,b,'facebook','999999999998','QA isolated delivery','test_authorized',now()+interval '1 day','{"granted_scopes":["pages_messaging","pages_manage_metadata"],"execution_enabled":false}',1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(conn,'qa-rolled-back','{}','888',now()+interval '1 day');
 insert into marketing_private.inbox_authority(connection_id,generation,receive_verified,send_verified,webhook_verified,verified_at,page_id,page_tasks,granted_scopes) values(conn,1,true,true,true,now(),'999999999998',array['MESSAGING'],array['pages_messaging','pages_manage_metadata']);
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title,last_inbound_at) values(c,o,b,'facebook',conn,'777','QA live adapter authority',now()-interval '1 hour');
 insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,status,created_by,reviewed_by) values(d,c,'Rolled back fixture; never sent',1,'human','approved',e,e);
 insert into public.marketing_reply_outbox(draft_id,reason) values(d,'external_execution_disabled');
 insert into marketing_qa_ids values('connection',conn),('conversation',c),('draft',d),('request',gen_random_uuid());
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare d uuid:=(select id from marketing_qa_ids where key='draft');req uuid:=(select id from marketing_qa_ids where key='request');denied boolean:=false;r jsonb;
begin
 r:=public.marketing_inbox_prepare_send(req,d);assert r->>'state'='prepared','Bound staff intent';
 assert public.marketing_inbox_prepare_send(req,d)->>'state'='prepared','Safe request replay';
 begin perform public.marketing_inbox_prepare_send(gen_random_uuid(),d);exception when others then denied:=true;end;assert denied,'Changed execution must be rejected';
 denied:=false;begin perform public.marketing_inbox_send_material(d,(select id from marketing_qa_ids where key='user'));exception when insufficient_privilege then denied:=true;end;assert denied,'No client credential RPC access';
 denied:=false;begin perform 1 from public.marketing_reply_outbox;exception when insufficient_privilege then denied:=true;end;assert denied,'No direct outbox read';
end;$$;
reset role;
do $$declare d uuid:=(select id from marketing_qa_ids where key='draft');u uuid:=(select id from marketing_qa_ids where key='user');c uuid:=(select id from marketing_qa_ids where key='conversation');conn uuid:=(select id from marketing_qa_ids where key='connection');r jsonb;lease uuid;denied boolean;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 assert public.marketing_inbox_send_material(d,u)->'authority'->>'execution_enabled'='true','Only approved job has authority';
 update public.marketing_conversations set last_inbound_at=now()-interval '25 hours' where id=c;
 denied:=false;begin perform public.marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Expired window denied';
 update public.marketing_conversations set last_inbound_at=now()-interval '1 hour' where id=c;
 update public.marketing_connections set credential_generation=2 where id=conn;
 denied:=false;begin perform public.marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Changed token generation denied';
 update public.marketing_connections set credential_generation=1 where id=conn;
 update public.marketing_conversations set opted_out=true where id=c;
 denied:=false;begin perform public.marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Opt-out denied';
 update public.marketing_conversations set opted_out=false where id=c;
 r:=public.marketing_inbox_send_checkpoint(d,u,null,'{"pending":true}');lease:=(r->>'lease')::uuid;assert r->>'state'='pending','Checkpoint before external write';
 denied:=false;begin perform public.marketing_inbox_send_checkpoint(d,u,null,'{"pending":true}');exception when others then denied:=true;end;assert denied,'Competing claimant denied';
 denied:=false;begin perform public.marketing_inbox_send_checkpoint(d,u,gen_random_uuid(),'{"receipt":"wrong"}');exception when others then denied:=true;end;assert denied,'Wrong lease denied';
 perform public.marketing_inbox_send_checkpoint(d,u,lease,'{}');
 update public.marketing_conversations set last_inbound_at=now()-interval '25 hours' where id=c;
 denied:=false;begin perform public.marketing_inbox_send_material(d,u);exception when others then denied:=true;end;assert denied,'Reconciling state cannot bypass window guard';
 update public.marketing_conversations set last_inbound_at=now()-interval '1 hour' where id=c;
 insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at) values(c,'delivery','fixture-provider-receipt',now());
 r:=public.marketing_inbox_send_checkpoint(d,u,lease,'{"receipt":"fixture-provider-receipt"}');assert r->>'state'='delivered','Early delivery receipt adopted';
 insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at) values(c,'read','fixture-read',now());
 assert (select state from public.marketing_reply_outbox where draft_id=d)='read','Read reconciles exact conversation';
 assert (select capabilities->>'execution_enabled' from public.marketing_connections where id=conn)='false','Publishing execution stays disabled';
 insert into public.marketing_inbox_ai_artifacts(conversation_id,source_version,knowledge_revision,kind,body,model,input_tokens,output_tokens,created_by) values(c,1,0,'summary','{"text":"Fixture only"}','gpt-5-mini-2025-08-07',1000,1000,(select id from marketing_qa_ids where key='employee'));
 assert (select cost from public.marketing_inbox_ai_artifacts where conversation_id=c order by created_at desc limit 1)=0.00225,'Versioned full-price USD estimate';
 assert not (select execution_enabled from marketing_private.inbox_authority where connection_id=conn),'Automation authority stays disabled';
end;$$;
select 'Changed messaging authority checks passed; fixtures rolled back' result;
rollback;
