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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');u uuid:=(select id from marketing_qa_ids where key='user');actor uuid:=(select id from marketing_qa_ids where key='employee');c uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();p jsonb;cm jsonb;analytics jsonb;denied boolean;ch text;cnt integer;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
 for ch in select unnest(array['facebook','instagram']) loop
  c:=gen_random_uuid();lease:=gen_random_uuid();
  insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,credential_generation,sync_lease,sync_lease_until)
  values(c,o,b,ch,case ch when 'facebook' then '999999991' else '999999992' end,'QA rollback','test_authorized',now()+interval '1 day','{"posts":true}',actor,1,lease,now()+interval '5 minutes');
  insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(c,'rollback-only','{}');
  p:=jsonb_build_object('id','999999991_888','published_at',now(),'metrics','{"likes":0,"reactions":11,"interactions":12,"views":0}'::jsonb,'unavailable_metrics','{"comments":"not_returned","reach":"not_supported"}'::jsonb,'metric_provenance',jsonb_build_object('interactions',jsonb_build_object('source','insights.post_activity_by_action_type','period','lifetime','definition','sum_reported_like_comment_share_actions','graph_version','v25.0','observed_at',stamp)));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform marketing_meta_sync_finish(c,1,lease,jsonb_build_array(p),null,null);
  assert (select metrics->>'likes'='0' and not metrics?'comments' and metric_provenance->'interactions'->>'observed_at'=stamp from marketing_social_posts where connection_id=c),'Zero/missing/source/time preserved';
  update marketing_connections set sync_lease_until=now()+interval '5 minutes' where id=c;
  perform marketing_meta_sync_finish(c,1,lease,jsonb_build_array(p),null,null);
  assert (select count(*) from marketing_social_posts where connection_id=c)=1,'Repeated sync upserts, no duplicate count';
  update marketing_connections set sync_lease_until=now()+interval '5 minutes' where id=c;
  denied:=false;begin perform marketing_meta_sync_finish(c,2,lease,jsonb_build_array(p),null,null);exception when others then denied:=true;end;assert denied,'Stale generation denied';
  denied:=false;begin perform marketing_meta_sync_finish(c,1,lease,jsonb_build_array(jsonb_set(p,'{metric_provenance,interactions,source}','"secret_value"')),null,null);exception when others then denied:=true;end;assert denied,'Unknown provenance rejected';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  cm:=marketing_content_management(o,b);analytics:=marketing_integrations(o,b,'analytics');
  assert exists(select 1 from jsonb_array_elements(cm->'rows') r,jsonb_array_elements(r->'channels') v where v->>'connection_id'=c::text and v->'metrics'->>'interactions'='12' and v->'metric_provenance'->'interactions'->>'observed_at'=stamp),'Content Management canonical source/time';
  assert exists(select 1 from jsonb_array_elements(analytics->'posts') v where v->>'connection_id'=c::text and v->'metrics'->>'interactions'='12' and v->'metric_provenance'->'interactions'->>'observed_at'=stamp),'Analytics identical canonical source/time';
 end loop;
 assert not has_function_privilege('authenticated','public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text)','execute'),'Browser cannot persist metrics';
 assert not has_table_privilege('authenticated','marketing_social_posts','insert'),'No direct browser write';
 denied:=false;begin perform marketing_content_management(o,(select id from marketing_qa_ids where key='other_brand'));exception when others then denied:=true;end;assert denied,'Other brand denied';
end;$$;
rollback;
