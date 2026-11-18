-- Staging only: all synthetic content, events and jobs remain uncommitted and roll back.
begin;
set constraints all deferred;
do $tests$
declare org uuid; brand uuid; actor uuid; usr uuid; conn uuid; cid uuid; jid uuid; other uuid;
 mode text; jobstate text; sample record; rowdata record; result jsonb; before_hash text; after_hash text;
 confirmed timestamptz := '2026-11-18T09:29:03Z'; receipt_at timestamptz := '2026-11-18T09:35:10Z'; schedule_at timestamptz := '2026-11-20T11:00:00Z';
 fixed boolean := coalesce(current_setting('feedx.qa.visibility_fixed',true),'true')='true'; expected timestamptz;
begin
 select b.organization_id,b.id,e.id,e.auth_user_id into org,brand,actor,usr
 from brands b cross join employees e where b.name like 'QA%' and b.is_active and e.auth_user_id is not null
 and marketing_private.actor_allowed(e.id,b.organization_id,b.id,'marketing_content.view') limit 1;
 if brand is null then raise exception 'Staging QA Brand and actor required';end if;
 perform set_config('request.jwt.claim.sub',usr::text,true);
 select md5(string_agg(md5(to_jsonb(j)::text),'' order by j.id)) into before_hash from marketing_jobs j;
 for sample in select * from (values
 ('queued','now','queued',true,1),('retry','now','retry',true,1),('leased','now','leased',true,1),
 ('uncertain','now','reconciling',true,1),('failed','now','failed',true,1),
 ('unconfirmed','now','queued',false,1),('no-intent','draft','queued',true,1),
 ('scheduled','schedule','queued',true,1),('stale-version','now','queued',true,2),
 ('receipt','now','succeeded',true,1),('draft','draft','none',false,1),
 ('multi-channel','now','queued',true,1),('partial','now','queued',true,1)) x(label,intention,state,authorized,revision)
 loop
  cid:=gen_random_uuid();jid:=gen_random_uuid();
  insert into marketing_content(id,organization_id,brand_id,revision,status,created_by)
   values(cid,org,brand,sample.revision,case when sample.state='none' then 'draft' else 'scheduled' end,actor);
  insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id)
   values(cid,1,jsonb_build_object('title','Visibility fixture '||sample.label,'outlet_ids','[]'::jsonb,'variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','text','caption','Rollback-only fixture','asset_ids','[]'::jsonb))||(case when sample.label in ('multi-channel','partial') then jsonb_build_array(jsonb_build_object('channel','instagram','format','image','caption','Rollback-only fixture','asset_ids','[]'::jsonb)) else '[]'::jsonb end),'publishing_plan',sample.intention,'planned_at',null,'planned_timezone','Asia/Kuala_Lumpur'),actor);
  if sample.revision=2 then insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) select content_id,2,payload,actor_employee_id from marketing_content_revisions where content_id=cid and revision=1;end if;
  if sample.state<>'none' then
   insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,external_authorized_at,provider_post_id,provider_state)
    values(jid,org,brand,cid,1,'facebook',sample.state,'2026-11-22T03:00:00Z',actor,case when sample.authorized then confirmed end,
    case when sample.state='succeeded' then '100000000000001_200000000000001' end,
    case when sample.state='succeeded' then '{"post_id":"100000000000001_200000000000001"}'::jsonb else '{}'::jsonb end);
   if sample.intention in ('now','schedule') then
    insert into marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details,created_at)
     values(org,brand,cid,case when sample.intention='now' then 'publish_now' else 'schedule_publish' end,actor,
      jsonb_build_object('revision',1,'scheduled_at',case when sample.intention='schedule' then schedule_at end),confirmed);
   end if;
   if sample.state='succeeded' then
    insert into marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details,created_at)
     values(org,brand,cid,'publishing_succeeded',actor,jsonb_build_object('revision',1,'job_id',jid,'channel','facebook','provider_post_id','100000000000001_200000000000001'),receipt_at);
   end if;
  end if;
  if sample.label in ('multi-channel','partial') then
   other:=gen_random_uuid();
   insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,external_authorized_at,provider_post_id,provider_state)
    values(other,org,brand,cid,1,'instagram',case when sample.label='partial' then 'succeeded' else 'retry' end,'2026-11-23T00:00:00Z',actor,confirmed+interval '5 seconds',
    case when sample.label='partial' then '300000000000001' end,case when sample.label='partial' then '{"post_id":"300000000000001"}'::jsonb else '{}'::jsonb end);
   if sample.label='partial' then
    insert into marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details,created_at)
     values(org,brand,cid,'publishing_succeeded',actor,jsonb_build_object('revision',1,'job_id',other,'channel','instagram','provider_post_id','300000000000001'),receipt_at);
   end if;
  end if;
  select * into rowdata from marketing_private.content_rows(org,brand) where id=cid;
  expected:=case when sample.state='succeeded' or sample.label='partial' then receipt_at when sample.intention='schedule' then schedule_at
   when sample.intention='now' and sample.authorized and sample.revision=1 and fixed then confirmed end;
  if rowdata.display_at is distinct from expected then raise exception 'Incorrect % placement: expected %, got %',sample.label,expected,rowdata.display_at;end if;
  if rowdata.scheduled_at is distinct from (case when sample.intention='schedule' then schedule_at end) or rowdata.actual_at is not null then raise exception 'Invented schedule/publication evidence';end if;
  result:=public.marketing_content_detail(cid);
  if (result->'content'->>'display_at')::timestamptz is distinct from expected then raise exception 'Detail placement mismatch: %',sample.label;end if;
  result:=public.marketing_content_management(org,brand,'2026-11-17T16:00:00Z','2026-11-18T16:00:00Z','Visibility fixture '||sample.label,'','','date_desc','',1,20,'calendar',false,false);
  if (result->>'total_count')::int is distinct from (case when expected>= '2026-11-17T16:00:00Z'::timestamptz and expected<'2026-11-18T16:00:00Z'::timestamptz then 1 else 0 end) then raise exception 'Calendar count mismatch: %',sample.label;end if;
  if result->'total_count' is distinct from (public.marketing_content_management(org,brand,'2026-11-17T16:00:00Z','2026-11-18T16:00:00Z','Visibility fixture '||sample.label,'','','date_desc','',1,20,'list',false,false)->'total_count') then raise exception 'List count mismatch: %',sample.label;end if;
 end loop;
 -- A stale worker checkpoint date never changes the fallback. Existing records are untouched.
 select md5(string_agg(md5(to_jsonb(j)::text),'' order by j.id)) into after_hash from marketing_jobs j where not exists(select 1 from marketing_content_revisions r where r.content_id=j.content_id and r.payload->>'title' like 'Visibility fixture %');
 if before_hash is distinct from after_hash then raise exception 'Existing job evidence changed';end if;
end;$tests$;
select 'PASS: 13 lifecycle cases, Calendar/List/Detail parity, no invented evidence or original-job changes' as verification;
rollback;
