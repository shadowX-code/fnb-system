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


-- Disposable receipt fixtures only. Never configure execution or call a provider.
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand'); e uuid:=(select id from marketing_qa_ids where key='employee');
 conn uuid; c uuid; d1 uuid; d2 uuid; channel_name text; receipt_lease uuid; r jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 foreach channel_name in array array['instagram','facebook'] loop
  conn:=gen_random_uuid(); c:=gen_random_uuid(); d1:=gen_random_uuid(); d2:=gen_random_uuid();
  insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,credential_generation)
   values(conn,o,b,channel_name,'999999999998','Rollback receipt fixture','not_connected','{"execution_enabled":false}',1);
  insert into public.marketing_conversations(id,organization_id,brand_id,channel,connection_id,participant_key,title)
   values(c,o,b,channel_name,conn,'777','Rollback receipt fixture');
  insert into public.marketing_reply_drafts(id,conversation_id,body,source_version,provenance,status,created_by)
   values(d1,c,'Not sent',1,'human','approved',e),(d2,c,'Not sent',1,'human','approved',e);
  insert into public.marketing_reply_outbox(draft_id,state,provider_message_id,sent_at) values
   (d1,'sent','mid-one',now()-interval '2 minutes'),(d2,'sent','mid-two',now()-interval '1 minute');
  insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at)
   values(c,'read',case when channel_name='instagram' then 'mid-one' else '777:watermark' end,now());
  assert (select state from public.marketing_reply_outbox where draft_id=d1)='read','First receipt reconciled';
  assert (select state from public.marketing_reply_outbox where draft_id=d2)=case when channel_name='instagram' then 'sent' else 'read' end,'Instagram exact ID, Messenger watermark';
  if channel_name='instagram' then
   insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at) values(c,'read','777:legacy-watermark',now());
   assert (select state from public.marketing_reply_outbox where draft_id=d2)='sent','No IG timestamp inference';
   insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at) values(c,'read','mid-one',now()) on conflict do nothing;
   assert (select count(*) from public.marketing_conversation_messages where conversation_id=c and kind='read' and provider_message_id='mid-one')=1,'Duplicate receipt suppressed';
   -- Early read arrives before the Send API returns its exact receipt.
   receipt_lease:=gen_random_uuid();
   update public.marketing_reply_outbox set state='pending',provider_message_id=null,lease=receipt_lease where draft_id=d1;
   r:=public.marketing_inbox_send_checkpoint(d1,(select id from marketing_qa_ids where key='user'),receipt_lease,'{"receipt":"mid-one"}');
   assert r->>'state'='read','Early exact read adopted';
   receipt_lease:=gen_random_uuid();
   update public.marketing_reply_outbox set state='pending',provider_message_id=null,lease=receipt_lease where draft_id=d2;
   r:=public.marketing_inbox_send_checkpoint(d2,(select id from marketing_qa_ids where key='user'),receipt_lease,'{"receipt":"mid-two"}');
   assert r->>'state'='sent','Other message cannot become read';
   insert into public.marketing_conversation_messages(conversation_id,kind,provider_message_id,occurred_at) values(c,'delivery','mid-two',now());
   assert (select state from public.marketing_reply_outbox where draft_id=d2)='delivered','Delivery still matches exact receipt';
  end if;
 end loop;
end;$$;
select 'Exact IG reads, Messenger watermark, early receipts and duplicate suppression passed' as result;
rollback;
