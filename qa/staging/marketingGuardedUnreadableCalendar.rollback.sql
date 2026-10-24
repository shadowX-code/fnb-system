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

do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();c uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();restricted uuid;
begin
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,credential_generation,connected_by,connected_at,sync_lease,sync_lease_until)
 values(fb,o,b,'facebook','999999999998','QA removal FB','test_authorized',now()+interval '1 day','{"posts":false,"execution_enabled":false}',1,e,now()-interval '1 day',lease,now()+interval '1 hour'),(ig,o,b,'instagram','999999999997','QA removal IG','test_authorized',now()+interval '1 day','{"posts":false,"execution_enabled":false}',1,e,now()-interval '1 day',null,null);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(fb,'qa-rolled-back','{}','888',now()+interval '1 day');
 insert into marketing_content(id,organization_id,brand_id,status,revision,approved_revision,created_by) values(c,o,b,'published',1,null,e);
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(c,1,'{"title":"QA immutable receipt","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"QA only","asset_ids":[]},{"channel":"instagram","format":"image","caption":"QA only","asset_ids":[]}]}',e);
 update marketing_content set approved_revision=1 where id=c;
 insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,c,1,'facebook','succeeded',now(),e,'999999999998_777',fb,1),(o,b,c,1,'instagram','succeeded',now(),e,'999997700',ig,1);
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,published_at,metrics)
 values(o,b,fb,1,'999999999998','999999999998_777','facebook',now(),'{"views":17}'),(o,b,ig,1,'999999999997','999997700','instagram',now(),'{"views":23}');
 insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,status,capabilities)
 values(o,(select id from marketing_qa_ids where key='other_brand'),'facebook','999999999996','not_connected','{}') returning id into restricted;
 insert into marketing_qa_ids values('restricted_connection',restricted);
 insert into marketing_qa_ids values('fb',fb),('ig',ig),('content',c),('lease',lease),('manual_request',gen_random_uuid());
end;$$;
-- No time travel of shared records: only isolated rollback fixtures and pure helper inputs.
do $$declare f uuid:=(select id from marketing_qa_ids where key='fb');l uuid:=(select id from marketing_qa_ids where key='lease');o jsonb:='{"id":"999999999998_777","state":"unavailable","source":"object_read","reason":"not_public"}';checks jsonb:='[]';sample jsonb;v jsonb;t timestamptz:=now()-interval '12 hours';begin
 checks:=marketing_private.advance_calendar_checks(checks,o,l,t,now()-interval '2 days');
 assert jsonb_array_length(checks)=1,'One failure insufficient';
 assert marketing_private.advance_calendar_checks(checks,o,l,t+interval '7 hours',now()-interval '2 days')=checks,'Lease replay cannot count twice';
 assert marketing_private.advance_calendar_checks(checks,o,gen_random_uuid(),t+interval '1 hour',now()-interval '2 days')=checks,'Concurrent/rapid checks cannot accumulate';
 checks:=marketing_private.advance_calendar_checks(checks,o,gen_random_uuid(),t+interval '6 hours',now()-interval '2 days');
 checks:=marketing_private.advance_calendar_checks(checks,o,gen_random_uuid(),now(),now()-interval '2 days');
 assert jsonb_array_length(checks)=3,'Three spaced checks';
 foreach sample in array array[
  '{"state":"access_restricted","source":"object_read","reason":"permission_or_token"}'::jsonb,
  '{"state":"unavailable","source":"object_read","reason":"object_missing_or_unreadable"}'::jsonb,
  '{"state":"temporarily_unavailable","source":"object_read","reason":"provider_temporary"}'::jsonb,
  '{"state":"unavailable","source":"object_read","reason":"identity_unverified"}'::jsonb,
  '{"state":"available","source":"owned_feed","reason":"provider_observed"}'::jsonb
 ] loop assert marketing_private.advance_calendar_checks(checks,sample,gen_random_uuid(),now(),now()-interval '2 days')='[]','Errors/outages/recovery fail visible';end loop;
 assert marketing_private.advance_calendar_checks(checks,o,gen_random_uuid(),now(),null)='[]','Pending first verification stays visible';
 insert into marketing_private.publication_availability(connection_id,connection_generation,provider_account_id,provider_post_id,state,source,reason,checked_at,last_available_at,calendar_checks)
 values(f,1,'999999999998','999999999998_777','unavailable','object_read','not_public',now(),now()-interval '2 days',jsonb_build_array(checks->0,checks->1));
 -- Advance to a new isolated Sync lease; replaying the first lease must not count.
 l:=gen_random_uuid();update marketing_connections set sync_lease=l where id=f;update marketing_qa_ids set id=l where key='lease';
 perform marketing_private.record_publication_availability(f,1,l,jsonb_build_array(o));
 select calendar_checks into checks from marketing_private.publication_availability where connection_id=f;
 assert jsonb_array_length(checks)=3,'Canonical recorder accepts third distinct spaced check';
 v:=marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777');
 assert v->>'state'='unavailable' and (v#>>'{calendar_visibility,hidden}')::boolean,'Calendar eligibility is not deletion';
 assert not (marketing_private.publication_availability_projection(f,2,'999999999998','999999999998_777')#>>'{calendar_visibility,hidden}')::boolean,'No cross-generation check accumulation';
 update marketing_private.publication_availability set calendar_checks=jsonb_build_array(checks->0,checks->1) where connection_id=f;
 assert not (marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')#>>'{calendar_visibility,hidden}')::boolean,'Two checks do not hide';
 update marketing_private.publication_availability set calendar_checks=checks,checked_at=now()-interval '25 hours' where connection_id=f;
 -- Projection freshness uses the accepted evidence time, not mutable generic checked_at.
 update marketing_private.publication_availability set calendar_checks=(select jsonb_agg(jsonb_set(x,'{at}',to_jsonb(now()-interval '80 hours'))) from jsonb_array_elements(checks) x) where connection_id=f;
 assert not (marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')#>>'{calendar_visibility,hidden}')::boolean,'Stale evidence visible';
 update marketing_private.publication_availability set calendar_checks=checks,checked_at=now() where connection_id=f;
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb;denied boolean:=false;begin
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false);
 assert (r->>'total_count')::int=1,'Unknown/pending sibling preserves visibility';
 begin perform marketing_content_management(o,(select id from marketing_qa_ids where key='other_brand'),null,null,'','','','date_desc','',1,20,'list',false);exception when insufficient_privilege then denied:=true;end;assert denied,'Brand isolation preserved';
end;$$;
reset role;
do $$declare c uuid:=(select id from marketing_qa_ids where key='content');f uuid:=(select id from marketing_qa_ids where key='fb');l uuid:=(select id from marketing_qa_ids where key='lease');begin
 -- Preserve both immutable receipts; confirm only the synthetic sibling through its canonical authority.
 perform marketing_publication_availability_command(gen_random_uuid(),(select id from marketing_qa_ids where key='ig'),'999997700',0,'mark_removed');
 assert not marketing_private.publication_calendar_hidden('[{"status":"scheduled","provider_post_id":"1","availability":{"calendar_visibility":{"hidden":true}}}]'),'Scheduled visible';
 assert not marketing_private.publication_calendar_hidden('[{"status":"publishing","provider_post_id":"1","availability":{"calendar_visibility":{"hidden":true}}}]'),'Publishing visible';
 assert not marketing_private.publication_calendar_hidden('[{"status":"published","provider_post_id":"1","availability":{"state":"unavailable","calendar_visibility":{"hidden":true},"manual_confirmation":{"state":"conflict"}}}]'),'Manual conflict visible';
 assert not marketing_private.publication_calendar_hidden('[{"status":"published","provider_post_id":"1","availability":{"calendar_visibility":{"hidden":true}}},{"status":"published","provider_post_id":"2","availability":{"state":"available"}}]'),'Live sibling visible';
end;$$;
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb;begin
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false);assert (r->>'total_count')::int=0 and r->'day_counts'='{}','Hidden before day counts';
 r:=marketing_content_management(o,b,date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',true);assert (r->>'total_count')::int=1,'Show Unverified reveals original row';
 assert r#>>'{rows,0,channels,0,availability,state}'='unavailable','Show filter does not rewrite status';
 r:=marketing_content_management(o,b,null,null,'','','','date_desc','',1,20,'list',false);assert (r->>'total_count')::int=1,'List always preserves history';
end;$$;
reset role;
do $$declare f uuid:=(select id from marketing_qa_ids where key='fb');l uuid:=(select id from marketing_qa_ids where key='lease');begin
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"unavailable","source":"object_read","reason":"object_missing_or_unreadable"}]');
 assert (select calendar_checks='[]' and state='unavailable' from marketing_private.publication_availability where connection_id=f),'Actual recorder clears ambiguous evidence';
 perform marketing_private.record_publication_availability(f,1,l,'[{"id":"999999999998_777","state":"available","source":"owned_feed","reason":"provider_observed"}]');
 assert marketing_private.publication_availability_projection(f,1,'999999999998','999999999998_777')->>'state'='available','Positive observation restores';
 assert (select count(*)=2 and bool_and(state='succeeded') from marketing_jobs where content_id=(select id from marketing_qa_ids where key='content')),'Both receipts intact';
 assert (select sum((metrics->>'views')::int)=40 from marketing_social_posts where brand_id=(select id from marketing_qa_ids where key='brand')),'Insights intact';
 assert not has_function_privilege('authenticated','marketing_private.advance_calendar_checks(jsonb,jsonb,uuid,timestamptz,timestamptz)','execute'),'No client evidence authority';
end;$$;
set local role authenticated;
do $$declare r jsonb;begin
 r:=marketing_content_management((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),date_trunc('month',now()),date_trunc('month',now())+interval '1 month','','','','date_desc','',1,20,'calendar',false);assert (r->>'total_count')::int=1,'Recovery restores Calendar';
end;$$;
reset role;

-- Paired controls replay the actual FB code10 / IG100-33 classification, never provider deletion.
do $$
declare f uuid:=(select id from marketing_qa_ids where key='fb');i uuid:=(select id from marketing_qa_ids where key='ig');c marketing_connections;
 l uuid;target text;control text;sample jsonb;ctl jsonb;batch jsonb;checks jsonb;v jsonb;ch text;code integer;sub integer;at_time timestamptz:=clock_timestamp()-interval '12 hours';
begin
 for ch in select unnest(array['facebook','instagram']) loop
  select * into c from marketing_connections where id=case ch when 'facebook' then f else i end;
  l:=gen_random_uuid();update marketing_connections set sync_lease=l,sync_lease_until=now()+interval '1 hour',sync_error_code=null where id=c.id;
  insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(c.id,'qa-rolled-back','{}','888',now()+interval '1 day') on conflict do nothing;
  target:=case ch when 'facebook' then '999999999998_777' else '999997700' end;
  control:=case ch when 'facebook' then '999999999998_888' else '999997701' end;
  update marketing_social_posts set published_at=now()-interval '2 days' where connection_id=c.id and provider_post_id=target;
  insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_account_id,provider_post_id,channel,published_at,metrics)
   values(c.organization_id,c.brand_id,c.id,1,c.provider_account_id,control,ch,now()-interval '2 days','{}');
  update marketing_private.publication_availability set last_available_at=null,calendar_checks='[]',last_object_available_at=null where connection_id=c.id and provider_post_id=target;
  sample:=jsonb_build_object('id',target,'source','object_read','state',case ch when 'facebook' then 'access_restricted' else 'unavailable' end,
   'reason',case ch when 'facebook' then 'permission_or_token' else 'object_missing_or_unreadable' end,
   'graph_error_code',case ch when 'facebook' then 10 else 100 end,'graph_error_subcode',case ch when 'instagram' then 33 end,'calendar_control_id',control);
  ctl:=jsonb_build_object('id',control,'source','object_read','state','available','reason','provider_observed','calendar_control_check',true);
  batch:=jsonb_build_array(ctl,sample);
  perform marketing_private.record_publication_availability(c.id,1,l,batch);
  select calendar_checks into checks from marketing_private.publication_availability where connection_id=c.id and provider_post_id=target;
  assert jsonb_array_length(checks)=1,'Historical publication qualifies first paired check without fabricating last_available_at';
  assert not (marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target)#>>'{calendar_visibility,hidden}')::boolean,'First check visible';
  perform marketing_private.record_publication_availability(c.id,1,l,batch);
  assert(select calendar_checks=checks from marketing_private.publication_availability where connection_id=c.id and provider_post_id=target),'Lease replay cannot multiply a check';
  -- Synthetic earlier checks exist only inside this rolled-back fixture; shared records are never backdated.
  checks:=marketing_private.advance_calendar_checks('[]',sample||'{"_calendar_isolated_verified":true}',gen_random_uuid(),at_time,now()-interval '2 days');
  checks:=marketing_private.advance_calendar_checks(checks,sample||'{"_calendar_isolated_verified":true}',gen_random_uuid(),at_time+interval '6 hours',now()-interval '2 days');
  update marketing_private.publication_availability set calendar_checks=checks where connection_id=c.id and provider_post_id=target;
  l:=gen_random_uuid();update marketing_connections set sync_lease=l where id=c.id;
  perform marketing_private.record_publication_availability(c.id,1,l,batch);
  v:=marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target);
  assert v#>>'{calendar_visibility,policy}'='isolated_unreadable' and (v#>>'{calendar_visibility,hidden}')::boolean,'Actual code shape hides reversibly after three spaced paired checks';
  assert v->>'provider_state'<>'deleted' and v->>'last_available_at' is null,'No deletion or positive-availability fabrication';
  assert(select octet_length(calendar_checks::text)<=1024 and jsonb_array_length(calendar_checks)=3 from marketing_private.publication_availability where connection_id=c.id and provider_post_id=target),'Original bounded evidence storage preserved';
  assert not (marketing_private.publication_availability_projection(c.id,2,c.provider_account_id,target)#>>'{calendar_visibility,hidden}')::boolean,'Generation drift fails visible';
  update marketing_connections set sync_error_code='meta_permission_or_token_invalid' where id=c.id;
  assert not (marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target)#>>'{calendar_visibility,hidden}')::boolean,'Account-wide outage immediately fails visible';
  update marketing_connections set sync_error_code=null where id=c.id;
  perform marketing_private.record_publication_availability(c.id,1,l,jsonb_build_array(ctl||'{"state":"temporarily_unavailable","reason":"provider_temporary"}'));
  assert not (marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target)#>>'{calendar_visibility,hidden}')::boolean,'Failed control immediately fails visible';
  perform marketing_private.record_publication_availability(c.id,1,l,jsonb_build_array(ctl));
  assert (marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target)#>>'{calendar_visibility,hidden}')::boolean,'Healthy scope restores only previously qualified fresh policy';
  -- An unpaired or other-account reference cannot accumulate evidence.
  perform marketing_private.record_publication_availability(c.id,1,l,jsonb_build_array(sample||'{"calendar_control_id":"999999999996_1"}'));
  assert(select calendar_checks='[]' from marketing_private.publication_availability where connection_id=c.id and provider_post_id=target),'Cross-account or absent controls never qualify';
  perform marketing_private.record_publication_availability(c.id,1,l,jsonb_build_array(sample||'{"state":"available","reason":"provider_observed"}'));
  v:=marketing_private.publication_availability_projection(c.id,1,c.provider_account_id,target);
  assert v->>'provider_state'='available' and not(v#>>'{calendar_visibility,hidden}')::boolean,'Authoritative positive read recovers Calendar';
 end loop;
 assert(select count(*)=2 and bool_and(state='succeeded') from marketing_jobs where content_id=(select id from marketing_qa_ids where key='content')),'Receipts unchanged';
 assert(select sum((metrics->>'views')::int)=40 from marketing_social_posts where brand_id=(select id from marketing_qa_ids where key='brand')),'Insights unchanged';
end;$$;
select 'PASS: actual FB/IG codes, paired controls, age/evidence bounds, replay/generation/Brand/outage safety, recovery, partial Calendar, Show/List and receipts; all fixtures rolled back' result;
rollback;
