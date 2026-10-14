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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');cr jsonb;c jsonb;w jsonb;p jsonb;ds jsonb;item jsonb;req uuid;denied boolean;cid uuid;first_post jsonb;legacy jsonb;
begin
 cr:=marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"QA Lifecycle"}');
 c:=marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,jsonb_build_object('title','QA lifecycle','creator_id',cr->>'id','status','planned','cost_state','estimated','deliverables',jsonb_build_array(jsonb_build_object('platform','instagram','title','A','status','pending'),jsonb_build_object('platform','instagram','title','B','status','pending'),jsonb_build_object('platform','instagram','title','C','status','pending'))));
 cid:=(c->>'id')::uuid;ds:=c->'deliverables';assert c->>'status'='planned';
 -- A URL alone and deliverable completion never establish publication.
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',cid,(c->>'revision')::int,c||jsonb_build_object('status','published'));exception when others then if sqlerrm like 'Choose Planned%' then denied:=true;else raise;end if;end;assert denied;
 for item in select value from jsonb_array_elements(ds) loop
 p:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/QaLifecycle'||replace(item->>'id','-','')||'/','creator_id',cr->>'id','collaboration_id',cid,'deliverable_id',item->>'id','confirm_link',true,'confirm_published',true));
 if first_post is null then first_post:=p;end if;
 w:=marketing_creator_workspace(o,b);select x into c from jsonb_array_elements(w->'collaborations') x where x->>'id'=cid::text;
 assert c->>'status'=case when item=ds->2 then 'published' else 'in_progress' end,'1/3 and 2/3 In Progress; 3/3 Published';
 end loop;
 -- Add a fourth planned entry through the existing revision-bound command.
 req:=gen_random_uuid();
 c:=marketing_creator_command(req,o,b,'save_collaboration',cid,(c->>'revision')::int,c||jsonb_build_object('status',c->>'workflow_status','deliverables',(c->'deliverables')||jsonb_build_array(jsonb_build_object('platform','tiktok','title','New planned entry','status','pending'))));
 assert c->>'status'='in_progress','New planned entry removes Published';
 insert into marketing_qa_ids values('collaboration',cid),('creator',(cr->>'id')::uuid),('post',(first_post->>'id')::uuid);
end;$$;
reset role;
-- Seed only disposable historical rows. No existing Collaboration or audit data changes.
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');cr uuid:=(select id from marketing_qa_ids where key='creator');v uuid;
begin
 insert into marketing_creator_collaborations(organization_id,brand_id,creator_id,title,status,created_by,updated_by) values(o,b,cr,'QA legacy Completed','completed',(select id from marketing_qa_ids where key='employee'),(select id from marketing_qa_ids where key='employee')) returning id into v;
 insert into marketing_private.creator_revisions(entity,record_id,revision,snapshot,actor,recorded_at) select 'collaboration',id,revision,to_jsonb(c),(select id from marketing_qa_ids where key='employee'),now() from marketing_creator_collaborations c where id=v;
 insert into marketing_qa_ids values('legacy',v);
 insert into marketing_creator_collaborations(organization_id,brand_id,creator_id,title,status,created_by,updated_by) values(o,b,cr,'QA legacy Published','published',(select id from marketing_qa_ids where key='employee'),(select id from marketing_qa_ids where key='employee')) returning id into v;
 insert into marketing_qa_ids values('legacy_published',v);
end;$$;
set local role authenticated;
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');cr uuid:=(select id from marketing_qa_ids where key='creator');cid uuid:=(select id from marketing_qa_ids where key='collaboration');w jsonb;c jsonb;p jsonb;legacy jsonb;one jsonb;request_id uuid:=gen_random_uuid();payload jsonb;denied boolean:=false;
begin
 w:=marketing_creator_workspace(o,b);select x into legacy from jsonb_array_elements(w->'collaborations') x where x->>'id'=(select id::text from marketing_qa_ids where key='legacy');
 assert legacy->>'status'='in_progress' and legacy->>'workflow_status'='completed','Legacy empty Completed remains historical but operationally In Progress';
 legacy:=marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',(legacy->>'id')::uuid,(legacy->>'revision')::int,legacy||jsonb_build_object('status','completed','title','QA legacy Completed edited'));
 assert legacy->>'workflow_status'='completed' and legacy->>'status'='in_progress';
 -- Unlink preserves canonical Post and recalculates active entries.
 select x into c from jsonb_array_elements(w->'collaborations') x where x->>'id'=cid::text;
 select x into p from jsonb_array_elements(w->'posts') x where x->>'id'=(select id::text from marketing_qa_ids where key='post');
 c:=marketing_creator_command(gen_random_uuid(),o,b,'remove_publishing',cid,(c->>'revision')::int,jsonb_build_object('post_id',p->>'id','post_revision',p->>'revision','deliverable_id',p->>'deliverable_id'));
 assert c->>'status'='in_progress','Other planned entry remains unfulfilled';
 w:=marketing_creator_workspace(o,b);assert exists(select 1 from jsonb_array_elements(w->'posts') x where x->>'id'=p->>'id' and x->>'collaboration_id' is null),'Post identity survives unlink';
 -- Formerly the final unlink from a stored Published row was rejected.
 select x into one from jsonb_array_elements(w->'collaborations') x where x->>'id'=(select id::text from marketing_qa_ids where key='legacy_published');
 assert one->>'status'='in_progress','Zero entries never Published';
 p:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://instagram.com/p/QaLastPublication/','creator_id',cr,'collaboration_id',one->>'id','confirm_link',true,'confirm_published',true));
 w:=marketing_creator_workspace(o,b);select x into one from jsonb_array_elements(w->'collaborations') x where x->>'id'=one->>'id';assert one->>'status'='published';
 one:=marketing_creator_command(gen_random_uuid(),o,b,'remove_publishing',(one->>'id')::uuid,(one->>'revision')::int,jsonb_build_object('post_id',p->>'id','post_revision',p->>'revision'));
 assert one->>'status'='in_progress','Final unlink allowed and no Published without evidence';
 begin perform marketing_creator_workspace(o,(select id from marketing_qa_ids where key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied,'Brand denial preserved';
 assert not has_function_privilege('anon','public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)','execute');
end;$$;
reset role;
do $$begin
 assert (select status from marketing_creator_collaborations where id=(select id from marketing_qa_ids where key='legacy'))='completed';
 assert exists(select 1 from marketing_private.creator_revisions where record_id=(select id from marketing_qa_ids where key='legacy') and snapshot->>'status'='completed'),'Historical Completed revision preserved';
end;$$;
rollback;
select 'PASS: zero/partial/full publishing, added entry, manual Published denial, unlink and final unlink, canonical Post preservation, legacy Completed storage/audit preservation, permissions; disposable fixtures rolled back' verification;