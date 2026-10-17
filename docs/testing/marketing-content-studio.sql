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
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');e uuid:=(select id from marketing_qa_ids where key='employee');u uuid:=(select id from marketing_qa_ids where key='user');r uuid:=(select id from marketing_qa_ids where key='role');
 t jsonb;v jsonb;cid uuid;conn uuid:=gen_random_uuid();conn_ig uuid:=gen_random_uuid();scheduled uuid:=gen_random_uuid();missing uuid:=gen_random_uuid();counts jsonb;request uuid;denied boolean;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'create',null,0,'{"month":"2026-10-01","title":"Disposable direct task","content_type":"post","due_date":"2026-10-20"}');
 -- Reviewer authority is unchanged: edit-only transition still cannot complete production.
 begin perform public.marketing_planner_command(gen_random_uuid(),o,b,'transition',(t->>'id')::uuid,1,'{"status":"completed"}');raise exception 'Completion bypass accepted';exception when raise_exception then if sqlerrm='Completion bypass accepted' then raise;end if;end;
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'request_revision',(t->>'id')::uuid,1,'{}');
 assert t->>'status'='revision_needed' and t->>'review_feedback'='','Direct revision without feedback';
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'transition',(t->>'id')::uuid,(t->>'revision')::int,'{"status":"in_progress"}');
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'request_revision',(t->>'id')::uuid,(t->>'revision')::int,'{"feedback":"Keep this feedback"}');
 assert t->>'review_feedback'='Keep this feedback','Direct feedback lost';
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'transition',(t->>'id')::uuid,(t->>'revision')::int,'{"status":"planned"}');
 -- Change only the disposable role, then roll everything back.
 delete from role_permissions where role_id=r and permission_id in (select id from permissions where code='marketing_planner.approve');
 begin perform public.marketing_planner_command(gen_random_uuid(),o,b,'approve',(t->>'id')::uuid,(t->>'revision')::int,'{}');raise exception 'Non-reviewer completed task';exception when insufficient_privilege then null;end;
 insert into role_permissions(role_id,permission_id) select r,id from permissions where code='marketing_planner.approve';
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'block',(t->>'id')::uuid,(t->>'revision')::int,'{"blocked":true}');
 begin perform public.marketing_planner_command(gen_random_uuid(),o,b,'approve',(t->>'id')::uuid,(t->>'revision')::int,'{}');raise exception 'Blocked completion accepted';exception when raise_exception then if sqlerrm='Blocked completion accepted' then raise;end if;end;
 t:=public.marketing_planner_command(gen_random_uuid(),o,b,'block',(t->>'id')::uuid,(t->>'revision')::int,'{"blocked":false}');
 request:=gen_random_uuid();v:=t;
 t:=public.marketing_planner_command(request,o,b,'approve',(t->>'id')::uuid,(t->>'revision')::int,'{}');
 assert t->>'status'='completed' and t->>'revision'=t->>'approved_revision','Direct completion lost revision';
 assert public.marketing_planner_command(request,o,b,'approve',(v->>'id')::uuid,(v->>'revision')::int,'{}')=t,'Retry not idempotent';
 v:=public.marketing_planner_command(gen_random_uuid(),o,b,'handoff',(t->>'id')::uuid,(t->>'revision')::int,'{}');cid:=(v->>'content_id')::uuid;
 assert (select status='draft' and approved_revision is null from marketing_content where id=cid),'Task completion approved Content';
 assert not exists(select 1 from marketing_jobs where content_id=cid),'Task completion queued publishing';
 assert (select count(*)>=6 from marketing_private.creative_task_revisions where task_id=(t->>'id')::uuid),'History lost';
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,credential_generation,last_synced_at)
 values(conn,o,b,'facebook','999111','Disposable FB','not_connected','{}',1,now()),(conn_ig,o,b,'instagram','999222','Disposable IG','not_connected','{}',1,now());
 -- One concept: both channels and a later revision, but only first observed publication month earns credit.
 update marketing_content_revisions set payload=payload||'{"variants":[{"channel":"facebook","format":"text","asset_ids":[]},{"channel":"instagram","format":"image","asset_ids":[]}]}' where content_id=cid and revision=1;
 insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,cid,1,'facebook','succeeded','2026-09-30',e,'post-one',conn,1),(o,b,cid,1,'instagram','succeeded','2026-11-01',e,'post-two',conn_ig,1);
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,provider_account_id,channel,published_at,observed_at,metrics)
 values(o,b,conn,1,'post-one','999111','facebook','2026-09-30T16:00:00Z',now(),'{}'),(o,b,conn_ig,1,'post-two','999222','instagram','2026-10-31T16:00:00Z',now(),'{}');
 -- Use a new immutable revision; no existing revision is overwritten outside this rollback fixture.
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) select cid,2,payload,e from marketing_content_revisions where content_id=cid and revision=1;
 update marketing_content set revision=2,status='published' where id=cid;
 insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,cid,2,'facebook','succeeded','2026-11-01',e,'post-three',conn,1);
 insert into marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,provider_account_id,channel,published_at,observed_at,metrics,media_product_type)
 values(o,b,conn,1,'post-three','999111','facebook','2026-11-01T01:00:00Z',now(),'{}',null),
 (o,b,conn_ig,1,'external-reel','999222','instagram','2026-10-31T16:00:00Z',now()-interval '1 minute','{}','REELS'),
 (o,b,conn_ig,2,'external-reel','999222','instagram','2026-10-31T16:00:00Z',now(),'{}','REELS'),
 (o,b,conn,1,'external-september','999111','facebook','2026-09-30T15:59:59Z',now(),'{}',null),
 (o,b,conn_ig,1,'external-story','999222','instagram','2026-10-10T01:00:00Z',now(),'{}','STORY');
 insert into marketing_content(id,organization_id,brand_id,status,revision,approved_revision,scheduled_at,created_by) values(scheduled,o,b,'scheduled',1,null,'2026-10-31T15:59:59Z',e);
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(scheduled,1,'{"title":"Scheduled only","variants":[{"channel":"facebook","format":"text","asset_ids":[]}]}',e);
 update marketing_content set approved_revision=1 where id=scheduled;
 counts:=marketing_private.creative_publication_counts(o,b,'2026-10-01');
 assert counts->>'published_posts'='1' and counts->>'published_reels'='0' and counts->>'scheduled_posts'='1','Oct boundary/channel/revision dedup failed: '||counts;
 counts:=marketing_private.creative_publication_counts(o,b,'2026-11-01');
 assert counts->>'published_posts'='0' and counts->>'published_reels'='1','Nov duplicate concept/external identity failed: '||counts;
 assert marketing_private.creative_publication_counts(o,b,'2026-09-01')->>'published_posts'='1','Malaysia lower boundary failed';
 -- Calendar/Content authority can be absent while planner view remains granted.
 delete from role_permissions where role_id=r and permission_id in (select id from permissions where code in ('marketing_content.view','marketing_calendar.view'));
 counts:=marketing_private.creative_publication_counts(o,b,'2026-10-01');
 assert counts->>'published_coverage'='permission_required' and counts->'published_posts'='null','Publishing evidence leaked';
 insert into role_permissions(role_id,permission_id) select r,id from permissions where code in ('marketing_content.view','marketing_calendar.view');
 perform public.marketing_planner_command(gen_random_uuid(),o,b,'open_month',null,0,'{"month":"2026-10-01"}');
 v:=public.marketing_planner_read(o,'2026-10-01',b);
 assert v->'targets'->0->>'published_posts'='1','Canonical targets projection not replaced';
 begin perform public.marketing_planner_read(o,'2026-10-01',(select id from marketing_qa_ids where key='other_brand'));raise exception 'Foreign Brand leaked';exception when insufficient_privilege then null;end;
 -- Receipt without actual provider publication date stays unavailable, never invented from due/updated time.
 insert into marketing_content(id,organization_id,brand_id,status,created_by) values(missing,o,b,'published',e);
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(missing,1,'{"title":"Undated receipt","variants":[{"channel":"facebook","format":"text","asset_ids":[]}]}',e);
 insert into marketing_jobs(organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,provider_post_id,connection_id,connection_generation)
 values(o,b,missing,1,'facebook','succeeded',now(),e,'missing-date',conn,1);
 counts:=marketing_private.creative_publication_counts(o,b,'2026-10-01');
 assert counts->>'published_available'='false' and counts->>'published_coverage'='publication_date_unavailable' and counts->'published_posts'='null','Missing evidence became zero';
 assert not has_function_privilege('authenticated','marketing_private.creative_publication_counts(uuid,uuid,date)','execute'),'Private projection exposed';
end;$$;
rollback;
