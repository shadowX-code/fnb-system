-- Staging rollback-only. Fake accounts/credentials remain uncommitted; no provider call or worker claim.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where (code like 'marketing_%' and code<>'marketing_content.approve') or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view');
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
do $accounts$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');fb uuid:=gen_random_uuid();
begin
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation)
 values(fb,o,b,'facebook','999999998881','Rollback-only Page','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["text"]}',e,now(),7);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(fb,'rollback-only','{}');
 insert into marketing_qa_ids values('connection',fb);
end;$accounts$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $checks$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');fb uuid:=(select id from marketing_qa_ids where key='connection');c uuid;d uuid;request uuid:=gen_random_uuid();saved jsonb;result jsonb;payload jsonb;original jsonb;failed boolean;response jsonb;
begin
 assert not public.current_user_has_permission('marketing_content.approve'),'Publisher fixture does not have approval authority';
 original:='{"title":"Rollback Draft","publishing_plan":"draft","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"Isolated fixture","asset_ids":[]}]}'::jsonb;
 saved:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,original);c:=(saved->>'id')::uuid;
 assert saved->>'status'='draft' and saved->>'scheduled_at' is null and saved->>'approved_revision' is null,'Save Draft does not require approval/time';
 response:=public.marketing_content_management(o,b,now()+interval '20 days',now()+interval '21 days','','','draft','date_desc','',1,20,'list');
 assert response->>'total_count'='1' and response->>'draft_count'='1','Undated Draft ignores period filters and is counted canonically';
 assert public.marketing_content_detail(c)->'content'->'payload'=original,'Exact draft payload reopens';
 payload:=jsonb_build_object('confirm',true,'timezone','Asia/Kuala_Lumpur','accounts',jsonb_build_array(jsonb_build_object('channel','facebook','connection_id',fb,'generation',7,'provider_account_id','999999998881')));
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,c,0,payload);exception when sqlstate '40001' then failed:=true;end;assert failed,'Stale revision rejected';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,c,1,payload||'{"confirm":false}');exception when others then failed:=true;end;assert failed,'Explicit confirmation required';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,1,payload||jsonb_build_object('scheduled_at',now()-interval '1 second'));exception when others then failed:=true;end;assert failed,'Past schedule rejected';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,c,1,jsonb_set(payload,'{accounts,0,generation}','6'));exception when others then failed:=true;end;assert failed,'Generation drift rejected';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,(select id from marketing_qa_ids where key='other_brand'),c,1,payload);exception when others then failed:=true;end;assert failed,'Other Brand cannot publish';
 result:=public.marketing_content_command(request,'publish_now',o,b,c,1,payload);
 assert result->>'status'='scheduled' and result->>'approved_revision'='1','Exact direct publisher authorization pins revision';
 assert public.marketing_content_command(request,'publish_now',o,b,c,1,payload)=result,'Retry returns exact authorization without duplicate jobs';
 assert jsonb_array_length(public.marketing_content_detail(c)->'content'->'channels')=1,'Only one canonical channel';
 assert public.marketing_content_detail(c)->'content'->'channels'->0->>'job_state'='queued','Canonical execution authority used';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,c,1,payload);exception when others then failed:=true;end;assert failed,'A different request cannot duplicate an existing schedule';
 saved:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,original);d:=(saved->>'id')::uuid;
 perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,d,1,payload||jsonb_build_object('scheduled_at',now()+interval '2 days'));
 assert (public.marketing_content_detail(d)->'content'->'channels'->0->>'scheduled_at')::timestamptz>now()+interval '1 day','Future schedule retained';
 saved:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,original);d:=(saved->>'id')::uuid;
 perform public.marketing_content_command(gen_random_uuid(),'review',o,b,d,1,'{}');
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,d,1,payload);exception when others then failed:=true;end;assert failed,'Explicitly submitted Review retains approval requirement';
 insert into marketing_qa_ids values('published_content',c),('review_content',d);
end;$checks$;
reset role;
do $guards$
declare c uuid:=(select id from marketing_qa_ids where key='published_content');fb uuid:=(select id from marketing_qa_ids where key='connection');r uuid:=(select id from marketing_qa_ids where key='role');
begin
 assert (select count(*)=1 from marketing_jobs where content_id=c),'One durable job after exact retry';
 assert (select connection_generation=7 and external_authorized_at is not null from marketing_jobs where content_id=c),'Exact generation and execution receipt pinned';
 update marketing_jobs set state='leased',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 minute' where content_id=c;
 assert public.marketing_content_detail(c)->'content'->>'status'='publishing','Detail and list share runtime Publishing projection';
 update marketing_jobs set state='reconciling',provider_state='{"pending":"publish"}' where content_id=c;
 assert public.marketing_content_detail(c)->'content'->>'status'='uncertain','Uncertain is visible and not a draft';
 delete from role_permissions where role_id=r and permission_id=(select id from permissions where code='marketing_content.execute');
end;$guards$;
set local role authenticated;
do $permission$
declare denied boolean:=false;o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid:=(select id from marketing_qa_ids where key='review_content');
begin
 begin perform public.marketing_content_command(gen_random_uuid(),'publish_now',o,b,c,1,'{}');exception when insufficient_privilege then denied:=true;end;assert denied,'Publish alone cannot execute';

end;$permission$;
reset role;
do $$begin assert not has_function_privilege('authenticated','marketing_private.direct_publish(public.marketing_content,uuid,text,jsonb)','execute'),'Private helper has no browser grant';end;$$;
rollback;
select 'PASS: direct publisher without approval permission, exact retry, draft dates/count/reopen, future schedule, Review retention, scope/generation/confirmation safeguards and runtime state; rolled back' as result;
