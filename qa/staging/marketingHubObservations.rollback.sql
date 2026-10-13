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

do $$declare
 o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');u uuid:=(select id from marketing_qa_ids where key='user');actor uuid:=(select id from marketing_qa_ids where key='employee');
 c uuid:=gen_random_uuid(); lease uuid:=gen_random_uuid();j uuid;v jsonb;p jsonb;denied boolean;ch text;observed date:=(now() at time zone 'UTC')::date;conv uuid;original_delivery boolean;
begin
 for ch in select unnest(array['facebook','instagram']) loop
 c:=gen_random_uuid();lease:=gen_random_uuid();
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,credential_generation,connected_at,sync_lease,sync_lease_until)
 values(c,o,b,ch,case ch when 'facebook' then '999999991' else '999999992' end,'QA rollback','test_authorized',now()+interval '1 day',jsonb_build_object('posts',true,'granted_scopes',jsonb_build_array(case ch when 'facebook' then 'pages_messaging' else 'instagram_manage_messages' end)),actor,1,now()-interval '20 days',lease,now()+interval '5 minutes');
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(c,'rollback-only','{}');
 insert into marketing_private.social_coverage(connection_id,generation,history_after,history_pages,active_mode) values(c,1,'old-cursor',39,'history');
 p:=jsonb_build_object('id','999999991_888','published_at',now()-interval '10 days','metrics','{"views":10,"likes":0}'::jsonb,'unavailable_metrics','{"interactions":"not_returned"}'::jsonb,'metric_provenance',jsonb_build_object('views',jsonb_build_object('source',case ch when 'facebook' then 'insights.post_media_view' else 'insights.views' end,'period','lifetime','definition','views','graph_version','v26.0','observed_at',now())));
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform marketing_meta_sync_finish(c,1,lease,jsonb_build_array(p),'retained-tail',null);
 assert (select history_after='retained-tail' and history_pages=0 and history_due>now() from marketing_private.social_coverage where connection_id=c),'40-page batch keeps historical cursor';
 update marketing_connections set sync_lease_until=now()+interval '5 minutes' where id=c;
 perform marketing_meta_sync_finish(c,1,lease,jsonb_build_array(p),'retained-tail-2',null);
 assert (select count(*) from marketing_social_daily_observations where connection_id=c)=1,'One latest observed snapshot per UTC day';
 assert (select metrics->>'likes'='0' and not metrics?'interactions' and unavailable_metrics->>'interactions'='not_returned' from marketing_social_daily_observations where connection_id=c),'Actual zero and unavailable retained';
 -- Synthetic baseline inside rollback only. Never seed shared historical observations.
 insert into marketing_social_daily_observations select connection_id,connection_generation,provider_post_id,observation_date-7,organization_id,brand_id,channel,provider_account_id,observed_at-interval '7 days','{"views":0}',unavailable_metrics,metric_provenance from marketing_social_daily_observations where connection_id=c and observation_date=observed;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 v:=marketing_social_observed_growth(o,b);
 assert exists(select 1 from jsonb_array_elements(v->'rows') r where r->>'channel'=ch and r->>'metric'='views' and r->>'days'='7' and r->>'growth'='10' and r->>'paired_posts'='1'),'Exact comparable 7-day observed growth';
 assert exists(select 1 from jsonb_array_elements(v->'rows') r where r->>'channel'=ch and r->>'metric'='views' and r->>'days'='30' and r->>'paired_posts'='0' and r->'growth'='null'),'No fabricated 30-day baseline';
 update marketing_social_daily_observations set metrics='{"views":20}' where connection_id=c and observation_date=observed-7;
 v:=marketing_social_observed_growth(o,b);
 assert exists(select 1 from jsonb_array_elements(v->'rows') r where r->>'channel'=ch and r->>'metric'='views' and r->>'days'='7' and r->>'paired_posts'='0'),'Counter decrease excluded';
 update marketing_social_daily_observations set metrics='{"views":0}',metric_provenance=jsonb_set(metric_provenance,'{views,definition}','"different_definition"') where connection_id=c and observation_date=observed-7;
 v:=marketing_social_observed_growth(o,b);
 assert exists(select 1 from jsonb_array_elements(v->'rows') r where r->>'channel'=ch and r->>'metric'='views' and r->>'days'='7' and r->>'paired_posts'='0'),'Incompatible definition excluded';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 denied:=false;begin perform marketing_social_observed_growth((select id from marketing_qa_ids where key='other_org'),null);exception when others then denied:=true;end;assert denied,'Cross-org growth denied';
 assert not has_table_privilege('authenticated','public.marketing_social_daily_observations','SELECT'),'No browser snapshot table access';
 assert not has_function_privilege('authenticated','public.marketing_inbox_history_authorize(uuid,integer,text)','EXECUTE'),'Browser cannot grant privacy approval';
 delete from marketing_social_posts where connection_id=c;
 assert not exists(select 1 from marketing_social_daily_observations where connection_id=c),'Provider grant lineage deletion clears daily observations';
 end loop;
end;$$;
rollback;
