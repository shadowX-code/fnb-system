-- Staging only. No provider calls, persistent customers, posts or media objects.
begin;
create temp table activity_fixture(key text primary key,id uuid);
grant select on activity_fixture to authenticated;
do $fixture$
declare u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();r uuid;
begin
 select id into strict r from public.roles where lower(name)='owner' limit 1;
 insert into auth.users(id,email,aud,role) values(u,'activity-'||u||'@example.invalid','authenticated','authenticated');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,nickname,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Activity Full Name','QA Nick','activity-'||u||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Planner Activity');
 insert into public.organization_memberships(organization_id,employee_id) values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Planner Activity');
 insert into activity_fixture values('user',u),('employee',e),('org',o),('brand',b);
end;$fixture$;

set local role authenticated;
do $checks$
declare b uuid:=(select id from activity_fixture where key='brand');request uuid:=gen_random_uuid();result jsonb;again jsonb;failed boolean:=false;data jsonb;
begin
 data:='{"kind":"caption","name":"Rollback-only","body":"Thanks for your visit.","active":true}';
 result:=public.marketing_caption_save(request,b,null,0,data);
 assert public.marketing_caption_save(request,b,null,0,data)=result,'Exact retry returns original revision';
 assert (public.marketing_caption_library(b,'caption')->>'total_count')::integer=1,'Brand library has one item';
 data:=jsonb_set(data,'{active}','false');again:=public.marketing_caption_save(gen_random_uuid(),b,(result->>'id')::uuid,1,data);
 assert again->>'revision'='2' and again->>'active'='false','Deactivation appends revision';
 begin perform public.marketing_caption_save(gen_random_uuid(),b,(result->>'id')::uuid,1,data);exception when sqlstate '40001' then failed:=true;end;assert failed,'Stale template revision rejected';
 result:=public.marketing_caption_save(gen_random_uuid(),b,null,0,'{"kind":"hashtags","name":"Tags","body":"#FeedX #feedx #咖啡","active":true}');
 assert result->>'body'='#FeedX #咖啡','Hashtags normalize exact duplicate keys and preserve multilingual text';
 begin perform public.marketing_caption_save(gen_random_uuid(),b,null,0,'{"kind":"hashtags","name":"Bad","body":"not_a_hashtag","active":true}');failed:=false;exception when others then failed:=true;end;assert failed,'Invalid hashtag set rejected';
 begin perform public.marketing_caption_library(gen_random_uuid(),'caption');failed:=false;exception when others then failed:=true;end;assert failed,'Foreign Brand unavailable';
 assert not has_table_privilege('authenticated',(select oid from pg_class where relname='caption_snippets'),'select'),'No direct table read';
end;$checks$;
reset role;
do $history$begin assert (select count(*) from marketing_private.caption_snippet_revisions r join marketing_private.caption_snippets s on s.id=r.snippet_id where s.brand_id=(select id from activity_fixture where key='brand'))=3,'History retained';end;$history$;
rollback;
select 'PASS: Brand library, exact retry, stale revision, activation, Unicode hashtags, history and isolation; rolled back' result;
