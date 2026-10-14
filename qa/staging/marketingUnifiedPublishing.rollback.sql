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

set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');c jsonb;v jsonb;p jsonb;p2 jsonb;payload jsonb;r jsonb;req uuid:=gen_random_uuid();denied boolean;plan uuid;
begin
 c:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"QA unified publishing"}');
 payload:=jsonb_build_object('title','QA disposable unified publishing','creator_id',c->>'id','status','in_progress','cost_state','estimated','cash_cost',5,'deliverables',jsonb_build_array(jsonb_build_object('title','IG video','platform','instagram','content_type','video','status','pending'),jsonb_build_object('title','IG image','platform','instagram','content_type','image','status','pending'),jsonb_build_object('title','XHS','platform','xhs','content_type','image','status','pending')));
 v:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,payload);
 assert jsonb_array_length(v->'deliverables')=3;
 select (x->>'id')::uuid into plan from jsonb_array_elements(v->'deliverables') x where x->>'title'='IG image';
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/FeedxUnifiedPublishingQa/','creator_id',c->>'id','collaboration_id',v->>'id','deliverable_id',plan,'confirm_link',true,'content_type','image'));
 assert p->>'publication_confirmed_at' is null and p->>'published_at' is null and p->>'published_date' is null,'Typing a URL alone is not publication evidence';
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'link_post',(p->>'id')::uuid,(p->>'revision')::integer,jsonb_build_object('collaboration_id',v->>'id','deliverable_id',plan,'confirm_link',true,'confirm_published',true));
 assert p->>'publication_confirmed_at' is not null;
 perform public.marketing_creator_command(gen_random_uuid(),o,b,'add_metrics',(p->>'id')::uuid,0,'{"metrics":{"likes":0},"source_note":"QA explicit zero","captured_at":"2026-10-13T10:00:00Z"}');
 -- Published collaboration cannot lose its only evidence, even through removal.
 v:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',(v->>'id')::uuid,(v->>'revision')::integer,payload||jsonb_build_object('status','published','deliverables',v->'deliverables'));
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),o,b,'remove_publishing',(v->>'id')::uuid,(v->>'revision')::integer,jsonb_build_object('post_id',p->>'id','post_revision',p->'revision','deliverable_id',plan));exception when raise_exception then denied:=sqlerrm like '%last published Post evidence%';end;assert denied;
 -- Add a second confirmed Post without a planned entry; count remains one identity per Post.
 p2:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/FeedxUnifiedExtraQa/','creator_id',c->>'id','collaboration_id',v->>'id','confirm_link',true,'published_date','2026-10-13'));
 assert p2->>'published_date'='2026-10-13' and p2->>'published_at' is null;
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),o,b,'remove_publishing',(v->>'id')::uuid,0,jsonb_build_object('post_id',p->>'id','post_revision',p->'revision'));exception when serialization_failure then denied:=true;end;assert denied,'Stale collaboration revision rejected';
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),o,b,'remove_publishing',(v->>'id')::uuid,(v->>'revision')::integer,jsonb_build_object('post_id',p->>'id','post_revision',0));exception when serialization_failure then denied:=true;end;assert denied,'Stale Post revision rejected';
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),o,(select id from marketing_qa_ids where key='other_brand'),'remove_publishing',(v->>'id')::uuid,(v->>'revision')::integer,jsonb_build_object('post_id',p->>'id','post_revision',p->'revision'));exception when insufficient_privilege then denied:=true;end;assert denied,'Restricted Brand rejected';
 payload:=jsonb_build_object('post_id',p->>'id','post_revision',p->'revision','deliverable_id',plan);
 r:=public.marketing_creator_command(req,o,b,'remove_publishing',(v->>'id')::uuid,(v->>'revision')::integer,payload);
 assert (select count(*) from jsonb_array_elements(public.marketing_creator_workspace(o,b)->'posts') x where x->>'id'=p->>'id' and x->>'collaboration_id' is null and x->>'deliverable_id' is null and x->'latest_metrics'->>'likes'='0')=1,'Post and zero-valued metric evidence survive unlink';
 assert exists(select 1 from jsonb_array_elements(r->'deliverables') x where x->>'id'=plan::text and x->>'status'='cancelled');
 assert r->>'status'='published' and r->>'cash_cost'='5.00';
 assert public.marketing_creator_command(req,o,b,'remove_publishing',(v->>'id')::uuid,(v->>'revision')::integer,payload)=r,'Exact retry returns same result';
 assert not has_schema_privilege('authenticated','marketing_private','usage');
 assert not has_function_privilege('anon','public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)','execute');
 insert into marketing_qa_ids values('removed_post',(p->>'id')::uuid),('collaboration',(v->>'id')::uuid);
end;$$;
reset role;
do $$begin
 assert not has_function_privilege('authenticated','marketing_private.creator_remove_publishing(uuid,uuid,uuid,integer,jsonb)','execute');
 assert (select count(*) from marketing_private.creator_revisions where entity='post' and record_id=(select id from marketing_qa_ids where key='removed_post'))>=3,'Post revisions remain';
 assert exists(select 1 from public.marketing_events where action='creators.remove_publishing' and details->>'record_id'=(select id::text from marketing_qa_ids where key='collaboration')),'Removal is audited';
end;$$;
rollback;
select 'PASS: authenticated multi-post creation, explicit publication evidence/date, duplicate link, revision and Brand denial, last-evidence guard, unlink preservation, audit and exact retry; all fixtures rolled back' verification;
