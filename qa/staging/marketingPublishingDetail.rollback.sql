-- Staging only: rollback-only receipt fixtures; no provider calls or executable jobs.
begin;
create temporary table receipt_fixture(key text primary key,id uuid);
grant select on receipt_fixture to authenticated;
do $setup$
declare u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();other_b uuid:=gen_random_uuid();r uuid:=gen_random_uuid();fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();c jsonb;k text;
begin
 insert into auth.users(id,email,aud,role) values(u,'receipt-'||u||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_receipt_'||r,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,nickname,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'QA Receipt Full Name','QA Receipt','receipt-'||u||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Receipt Organization');
 insert into public.organization_memberships(organization_id,employee_id) values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Receipt Brand'),(other_b,o,'QA Hidden Receipt Brand');
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into receipt_fixture values('user',u),('employee',e),('org',o),('brand',b),('hidden_brand',other_b),('fb',fb),('ig',ig);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,status,credential_generation,capabilities,connected_by)
 values(fb,o,b,'facebook','999999999991','test_authorized',3,'{"publishing":true,"execution_enabled":false,"formats":["text"]}',e),
 (ig,o,b,'instagram','999999999992','test_authorized',3,'{"publishing":true,"execution_enabled":false,"formats":["image"]}',e);
 foreach k in array array['t1','t2','partial','legacy'] loop
  c:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,jsonb_build_object('title','QA receipt '||k,'outlet_ids','[]'::jsonb,'variants',
   case when k='t1' then '[{"channel":"facebook","format":"text","caption":"QA receipt","asset_ids":[]}]'::jsonb
   when k='partial' then '[{"channel":"facebook","format":"text","caption":"QA receipt","asset_ids":[]},{"channel":"instagram","format":"image","caption":"QA receipt","asset_ids":[]}]'::jsonb
   else '[{"channel":"instagram","format":"image","caption":"QA receipt","asset_ids":[]}]'::jsonb end));
  insert into receipt_fixture values(k,(c->>'id')::uuid);
  update public.marketing_content set approved_revision=1,status=case when k='partial' then 'failed' when k='legacy' then 'scheduled' else 'published' end,
   scheduled_at='2026-10-23T16:46:19Z' where id=(c->>'id')::uuid;
 end loop;
 insert into public.marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,provider_post_id,provider_state)
 select o,b,f.id,1,v.channel,case when f.key='legacy' then 'blocked' when f.key='partial' and v.channel='instagram' then 'failed' else 'succeeded' end,
  '2026-10-23T16:46:19Z',e,case when v.channel='facebook' then fb else ig end,3,
  case when f.key='legacy' or f.key='partial' and v.channel='instagram' then null when v.channel='facebook' then '999999999991_999' else '999999999993' end,
  case when f.key='legacy' then '{}'::jsonb when v.channel='facebook' then '{"post_id":"999999999991_999","started_at":"2026-10-23T16:30:03.851Z"}'::jsonb
   when f.key='partial' then '{"started_at":"2026-10-23T16:45:10.621Z"}'::jsonb else '{"post_id":"999999999993","started_at":"2026-10-23T16:45:10.621Z"}'::jsonb end
 from receipt_fixture f cross join lateral (select value->>'channel' as channel from public.marketing_content_revisions cr cross join lateral jsonb_array_elements(cr.payload->'variants') where cr.content_id=f.id and cr.revision=1) v
 where f.key in ('t1','t2','partial','legacy');
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details,created_at)
 select o,b,f.id,'publisher_authorized',jsonb_build_object('revision',1,'mode',case when f.key='t1' then 'publish_now' else 'schedule_publish' end,'scheduled_at',case when f.key='t1' then '2026-10-23T16:29:03.324941Z' else '2026-10-23T16:43:00Z' end),'2026-10-23T16:31:31.100511Z'
 from receipt_fixture f where f.key in ('t1','t2','partial');
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details,created_at)
 select o,b,j.content_id,'publishing_succeeded',jsonb_build_object('job_id',j.id,'revision',1,'channel',j.channel,'provider_post_id',j.provider_post_id),
  case when j.channel='facebook' then '2026-10-23T16:30:07.427775Z'::timestamptz else '2026-10-23T16:47:11.700274Z'::timestamptz end
 from public.marketing_jobs j where j.organization_id=o and j.state='succeeded';
end;$setup$;
create temporary table receipt_before as select
 (select md5(string_agg(to_jsonb(j)::text,'' order by j.id)) from public.marketing_jobs j where organization_id=(select id from receipt_fixture where key='org')) as jobs,
 (select md5(string_agg(to_jsonb(e)::text,'' order by e.id)) from public.marketing_events e where organization_id=(select id from receipt_fixture where key='org')) as events;
grant select on receipt_before to authenticated;
set local role authenticated;
do $reads$
declare o uuid:=(select id from receipt_fixture where key='org');b uuid:=(select id from receipt_fixture where key='brand');d jsonb;v jsonb;denied boolean:=false;
begin
 d:=public.marketing_content_detail((select id from receipt_fixture where key='t1'));v:=d->'content'->'channels'->0;
 assert v->>'scheduled_at' is null and d->'content'->>'scheduled_at' is null,'Publish Now is not an authorized schedule';
 assert v->>'publishing_intention'='now' and v->>'status'='published','T1 independent receipt status';
 assert (v->>'receipt_confirmed_at')::timestamptz='2026-10-23T16:30:07.427775Z','T1 exact receipt time';
 assert v->>'actual_at' is null,'Receipt time never fabricates Meta publication time';
 assert v->>'permalink'='https://www.facebook.com/999999999991/posts/999/','Exact FB receipt link';
 assert (d->'content'->>'display_at')::timestamptz='2026-10-23T16:30:07.427775Z','Calendar retains receipt-confirmed posts without fabricating actual_at';
 d:=public.marketing_content_detail((select id from receipt_fixture where key='t2'));v:=d->'content'->'channels'->0;
 assert (v->>'scheduled_at')::timestamptz='2026-10-23T16:43:00Z','T2 authorized 00:43 not next checkpoint 00:46';
 assert (v->>'processing_started_at')::timestamptz='2026-10-23T16:45:10.621Z','T2 preparation start';
 assert (v->>'receipt_confirmed_at')::timestamptz='2026-10-23T16:47:11.700274Z','T2 receipt completion';
 assert v->>'permalink' is null and v->>'actual_at' is null,'Instagram API ID cannot invent a public shortcode or timestamp';
 d:=public.marketing_content_detail((select id from receipt_fixture where key='partial'));
 assert (select channel->>'status'='published' from jsonb_array_elements(d->'content'->'channels') channel where channel->>'channel'='facebook'),'Partial FB remains published';
 assert (select channel->>'status'='failed' and channel->>'receipt_confirmed_at' is null from jsonb_array_elements(d->'content'->'channels') channel where channel->>'channel'='instagram'),'Failed IG never inherits FB receipt';
 d:=public.marketing_content_detail((select id from receipt_fixture where key='legacy'));assert d->'content'->'channels'->0->>'scheduled_at' is null,'Missing immutable schedule stays unavailable';
 begin perform public.marketing_content_management(o,(select id from receipt_fixture where key='hidden_brand'));exception when insufficient_privilege then denied:=true;end;
 assert denied,'Existing Brand scope retained';
 begin perform marketing_private.publishing_job_timeline(null::public.marketing_jobs);raise exception 'Private helper exposed';exception when insufficient_privilege then null;end;
end;$reads$;
reset role;
do $later_evidence$
declare o uuid:=(select id from receipt_fixture where key='org');b uuid:=(select id from receipt_fixture where key='brand');j public.marketing_jobs;d jsonb;v jsonb;
begin
 assert (select md5(string_agg(to_jsonb(job)::text,'' order by job.id)) from public.marketing_jobs job where organization_id=o)=(select jobs from receipt_before),'Reads preserve every job field';
 assert (select md5(string_agg(to_jsonb(event)::text,'' order by event.id)) from public.marketing_events event where organization_id=o)=(select events from receipt_before),'Reads preserve exact audit history';
 select * into j from public.marketing_jobs where content_id=(select id from receipt_fixture where key='t2');
 -- Later retry times and unrelated/outdated events cannot replace the authorized schedule.
 update public.marketing_jobs set due_at='2026-10-25T16:59:00Z' where id=j.id;
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details) values(o,b,j.content_id,'reschedule_channel',jsonb_build_object('revision',0,'job_id',j.id,'scheduled_at','2026-10-26T00:00:00Z'));
 d:=public.marketing_content_detail(j.content_id);assert (d->'content'->'channels'->0->>'scheduled_at')::timestamptz='2026-10-23T16:43:00Z','Wrong revision and processing checkpoint ignored';
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details) values(o,b,j.content_id,'reschedule_channel',jsonb_build_object('revision',1,'job_id',j.id,'scheduled_at','2026-10-27T00:00:00Z'));
 d:=public.marketing_content_detail(j.content_id);assert (d->'content'->'channels'->0->>'scheduled_at')::timestamptz='2026-10-27T00:00:00Z','Latest exact job reschedule replaces only schedule evidence';
 insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,permalink,published_at)
 values(o,b,j.connection_id,99,'888888888888',j.provider_post_id,'instagram','https://www.instagram.com/p/WRONG/','2026-10-23T16:46:50Z');
 d:=public.marketing_content_detail(j.content_id);assert d->'content'->'channels'->0->>'permalink' is null,'Unproven reconnect generation does not attach';
 insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,permalink,published_at)
 values(o,b,j.connection_id,3,'999999999992',j.provider_post_id,'instagram','https://www.instagram.com/p/QA_RECEIPT/','2026-10-23T16:47:05Z');
 d:=public.marketing_content_detail(j.content_id);v:=d->'content'->'channels'->0;
 assert v->>'permalink'='https://www.instagram.com/p/QA_RECEIPT/' and (v->>'actual_at')::timestamptz='2026-10-23T16:47:05Z','Exact Meta observation supplies actual time and URL';
 update public.marketing_jobs set provider_state='{"post_id":"wrong","started_at":"not-a-date"}' where id=j.id;
 select * into j from public.marketing_jobs where id=j.id;v:=marketing_private.publishing_job_timeline(j);
 assert v->>'receipt_confirmed_at' is null and v->>'processing_started_at' is null and v->>'receipt_verified'='false','Mismatched receipt and malformed historical dates remain unavailable';
end;$later_evidence$;
select 'Publishing detail evidence: 21 focused assertions passed; no provider calls; all fixtures rolled back' as result;
rollback;
