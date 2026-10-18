-- Standalone Staging-only rollback rehearsal; no provider calls.
begin;
-- Run inside a rollback-only transaction after the scoped migration. No provider requests.
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'all');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view','outlets.view','outlets.edit');
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


do $$declare x uuid:=gen_random_uuid();org uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');begin
 insert into outlets(id,name,code,is_active) values(x,'QA Brand Editor Outlet','QA-'||left(x::text,8),true);
 insert into organization_outlets values(org,x);
 insert into marketing_qa_ids values('outlet',x);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');other_b uuid:=(select id from marketing_qa_ids where key='other_brand');o uuid:=(select id from marketing_qa_ids where key='outlet');r jsonb;p jsonb;req uuid:=gen_random_uuid();failed boolean;begin
 r:=platform_brand_management_read();assert exists(select 1 from jsonb_array_elements(r->'outlets') x where x->>'id'=o::text and x ? 'code' and x ? 'location' and x ? 'brands'),'Outlet selection projection complete';
 p:=platform_brand_logo_prepare(b,1,req,'qa.png','image/png',68);
 assert platform_brand_logo_prepare(b,1,req,'qa.png','image/png',68)=p,'Prepare stable retry';
 failed:=false;begin perform platform_brand_logo_prepare(other_b,1,gen_random_uuid(),'qa.png','image/png',68);exception when insufficient_privilege then failed:=true;end;assert failed,'Cross Brand upload denied';
 failed:=false;begin perform platform_brand_logo_prepare(b,0,gen_random_uuid(),'qa.png','image/png',68);exception when serialization_failure then failed:=true;end;assert failed,'Stale logo generation denied';
 insert into storage.objects(bucket_id,name,owner) values(p->>'bucket',p->>'object_path',auth.uid());
 insert into marketing_qa_ids values('logo',(p->>'id')::uuid);
 req:=gen_random_uuid();p:=jsonb_build_object('id',b,'expected_revision',1,'name','QA Edited Brand','timezone','Asia/Kuala_Lumpur','outlet_ids',jsonb_build_array(o),'mapping_confirmed',false,'brand_accent_color','#123456','logo_media_id',p->>'id','request_id',req);
 failed:=false;begin perform platform_brand_command('save_brand',p);exception when others then failed:=true;end;assert failed,'Relationships require confirmation';
 p:=p||'{"mapping_confirmed":true}';r:=platform_brand_command('save_brand',p);
 assert platform_brand_command('save_brand',p)=r,'Save retry preserves one receipt/revision';assert (r->'brand'->>'revision')::integer=2,'One Brand revision';
 assert r->'brand'->>'brand_accent_color'='#123456','Color canonical Brand field';
 assert jsonb_array_length(r->'brand'->'outlet_ids')=1,'Mapping persisted';
 r:=marketing_context();assert exists(select 1 from jsonb_array_elements(r->'brands') x where x->>'id'=b::text and x->>'logo_path' is not null and x->>'brand_accent_color'='#123456'),'Marketing consumes canonical Brand asset';
 failed:=false;begin perform platform_brand_command('save_brand',p||jsonb_build_object('request_id',gen_random_uuid()));exception when serialization_failure then failed:=true;end;assert failed,'Stale Brand save denied';
 failed:=false;begin update outlets set brand_accent_color='#FFFFFF' where id=o;exception when others then failed:=true;end;assert failed,'Legacy Outlet branding cannot be edited';
 assert not has_function_privilege('authenticated','public.outlet_prepare_logo_upload(uuid,text,text,bigint)','EXECUTE'),'Old Outlet upload authority revoked';
 r:=platform_brand_command('save_brand',jsonb_build_object('id',b,'expected_revision',2,'name','QA Edited Brand','timezone','Asia/Kuala_Lumpur','outlet_ids',jsonb_build_array(o),'mapping_confirmed',true,'logo_media_id',null,'request_id',gen_random_uuid()));
 assert r->'brand'->>'logo_media_id' is null,'Remove active pointer';
 assert exists(select 1 from outlet_logo_media where id=(select id from marketing_qa_ids where key='logo') and status='ready'),'Prior asset/history retained';
end;$$;
reset role;
-- A user without Brand management permission cannot prepare or save branding.
delete from role_permissions where role_id=(select id from marketing_qa_ids where key='role') and permission_id in(select id from permissions where code='platform_organizations.manage');
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform platform_brand_logo_prepare((select id from marketing_qa_ids where key='brand'),3,gen_random_uuid(),'qa.png','image/png',68);exception when insufficient_privilege then failed:=true;end;assert failed,'Brand management permission required';
end;$$;
reset role;
rollback;
