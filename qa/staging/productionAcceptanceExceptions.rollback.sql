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


do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid;f uuid;g uuid;begin
 insert into marketing_connections(organization_id,brand_id,channel) values(o,b,'facebook') returning id into f;
 insert into marketing_connections(organization_id,brand_id,channel) values(o,b,'instagram') returning id into g;
 insert into marketing_conversations(organization_id,brand_id,channel,title,created_at) values(o,b,'internal','QA internal only','2020-01-02');
 insert into marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,created_at) values(o,b,'facebook',f,'qa-only','QA Facebook','2020-01-02') returning id into c;
 insert into marketing_conversation_messages(conversation_id,kind,occurred_at) values(c,'incoming','2020-01-02 00:00Z'),(c,'echo','2020-01-02 00:01Z');
 insert into marketing_conversations(organization_id,brand_id,channel,connection_id,participant_key,title,created_at,status) values(o,b,'instagram',g,'qa-only','QA Instagram','2020-01-02','resolved');
end;$$;
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');s jsonb;denied boolean;ch text;begin
 s:=marketing_inbox_analytics(o,b,'social');
 assert s->>'volume'='2' and s->>'unresolved'='1','Social excludes internal and preserves status aggregation';
 assert s->>'first_response_seconds'='60' and s->>'first_response_sample'='1','Canonical response semantics';
 assert s->'automation_rate'='null'::jsonb,'Unavailable never becomes zero';
 assert marketing_inbox_analytics(o,b,'')->>'volume'='3','All channels unchanged';
 foreach ch in array array['internal','facebook','instagram'] loop
  assert marketing_inbox_analytics(o,b,ch)->>'volume'='1','Individual channel contract unchanged';
 end loop;
 assert marketing_inbox_analytics(o,null,'social')->>'volume'='2','All Brands remains scoped';
 assert marketing_inbox_analytics(o,b,'social','2020-01-03','2020-01-04')->>'volume'='0','Date range excludes old rows';
 assert marketing_inbox_analytics(o,b,'social','2020-01-02','2020-01-03')->>'volume'='2','Half-open date range retained';
 denied:=false;begin perform marketing_inbox_analytics(o,(select id from marketing_qa_ids where key='other_brand'),'social');exception when insufficient_privilege then denied:=true;end;assert denied,'Restricted Brand denied';
 denied:=false;begin perform marketing_inbox_analytics((select id from marketing_qa_ids where key='other_org'),null,'social');exception when insufficient_privilege then denied:=true;end;assert denied,'Cross tenant denied';
 denied:=false;begin perform marketing_inbox_analytics(o,b,'invalid');exception when raise_exception then denied:=true;end;assert denied,'Unknown filter denied';
 denied:=false;begin perform marketing_inbox_analytics(o,b,'social','2020-01-03','2020-01-02');exception when raise_exception then denied:=true;end;assert denied,'Invalid date range denied';
 assert not has_function_privilege('anon','public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)','execute'),'Anonymous denied';
 assert not has_function_privilege('anon','public.factory_get_dashboard_operational_monthly_analytics(date,uuid,boolean)','execute'),'Anonymous Factory denied';
 denied:=false;begin perform factory_get_dashboard_operational_monthly_analytics('2026-10-01',null,true);exception when insufficient_privilege then denied:=true;end;assert denied,'Unprivileged employee Factory denied';
end;$$;
reset role;
rollback;
select 'PASS: social/internal/platform/date/response contracts, restricted Brand and tenant isolation, anonymous and unprivileged Factory denial; all fixtures rolled back' verification;
