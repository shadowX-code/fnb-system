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

insert into marketing_private.whatsapp_platform_readiness(app_id,config_id,graph_version,signup_version,
 business_verified,tech_provider_verified,access_verified,app_live,permissions_reviewed,webhook_reviewed,new_number_enabled,evidence_reference,reviewed_at,expires_at)
 values('400','401','v25.0','v4',true,true,true,true,true,true,true,'rollback-fixture-only',now(),now()+interval '1 hour');
insert into marketing_private.whatsapp_pilot_authority(brand_id,app_id,customer_business_id,mode,approved_phone_hash,approval_reference,expires_at)
 select id,'400','402','new_number',repeat('a',64),'rollback-fixture-only',now()+interval '1 hour' from marketing_qa_ids where key='brand';
set local role authenticated;
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');
 b uuid:=(select id from marketing_qa_ids where key='brand'); s jsonb;
begin
 assert marketing_whatsapp_readiness(o,b,'400','401','v25.0','v4')->>'mode'='new_number','Mode-specific approval';
 s:=marketing_whatsapp_begin(o,b,repeat('c',64),'400','401','v25.0','v4');
 assert s->>'mode'='new_number','Session pins approval mode';
 insert into marketing_qa_ids values('session',(s->>'id')::uuid);
end $$;
reset role;
do $$
declare s uuid:=(select id from marketing_qa_ids where key='session');
 u uuid:=(select id from marketing_qa_ids where key='user');
 o uuid:=(select id from marketing_qa_ids where key='org');
 b uuid:=(select id from marketing_qa_ids where key='brand');
 c uuid; result jsonb; rejected boolean:=false;
 proof jsonb:=jsonb_build_object('app_id','400','business_id','402','waba_id','403','phone_id','404',
  'approved_phone_hash',repeat('a',64),'is_on_biz_app',false,'platform_type','NOT_APPLICABLE','registration_verified',false,
  'subject','999','scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),'expires_at',now()+interval '1 hour');
 sealed jsonb:='{"version":1,"ciphertext":"synthetic-only"}';
begin
 perform marketing_whatsapp_consume(s,u,repeat('c',64));
 begin perform marketing_whatsapp_bind(s,u,sealed,proof||'{"is_on_biz_app":true}'); exception when others then rejected:=true; end;
 assert rejected,'Coexistence evidence rejected for a new-number session';
 result:=marketing_whatsapp_bind(s,u,sealed,proof);c:=(result->>'connection_id')::uuid;
 assert marketing_whatsapp_connections(o,b)#>>'{connections,0,reason}'='cloud_registration_required','Registration pending state';
 assert not marketing_private.whatsapp_receiving(c),'A verified but unregistered number cannot receive';
 rejected:=false;
 begin perform marketing_whatsapp_step(c,u,1,'subscription'); exception when others then rejected:=true; end;
 assert rejected,'Subscription cannot run before registration proof';
 proof:=proof||'{"platform_type":"CLOUD_API","registration_verified":true}';
 perform marketing_whatsapp_record_verification(c,u,1,proof);
 assert (marketing_whatsapp_step(c,u,1,'subscription')->>'perform')::boolean,'Initial subscription intent';
 assert not (marketing_whatsapp_step(c,u,1,'subscription')->>'perform')::boolean,'Uncertain subscription cannot be replayed';
 perform marketing_whatsapp_step(c,u,1,'subscription','verified');
 assert marketing_private.whatsapp_receiving(c),'Verified registration and subscription can receive';
 assert marketing_whatsapp_connections(o,b)#>>'{connections,0,reason}'='awaiting_customer_inbound','Await signed inbound';
 rejected:=false;
 begin perform marketing_whatsapp_step(c,u,1,'history'); exception when others then rejected:=true; end;
 assert rejected,'New number cannot request Coexistence history';
 perform marketing_whatsapp_record_verification(c,u,1,proof);
 assert not marketing_private.whatsapp_receiving(c),'Fresh proof awaits subscription read-back';
 perform marketing_whatsapp_step(c,u,1,'subscription','verified');
 assert marketing_private.whatsapp_receiving(c),'Existing subscription can recover with verified read-back';
 assert (select not send_verified and not execution_enabled from marketing_private.inbox_authority where connection_id=c),'Sending remains off';
end $$;
rollback;
