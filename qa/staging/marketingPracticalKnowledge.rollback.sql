-- Run inside a rollback-only transaction after the scoped migration. No provider requests.
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
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);


do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');r jsonb;c uuid;menu uuid;req uuid:=gen_random_uuid();failed boolean:=false;begin
 r:=public.marketing_knowledge_command(req,b,'identity',null,0,'{"positioning":"Test positioning","story":"Test story","differentiation":"Test difference","audience":"Test audience"}');
 assert r->>'revision'='1','Identity saves directly without approval';
 assert public.marketing_knowledge_command(req,b,'identity',null,0,'{"positioning":"Test positioning","story":"Test story","differentiation":"Test difference","audience":"Test audience"}')=r,'Command retries are idempotent';
 r:=public.marketing_knowledge_command(gen_random_uuid(),b,'tone',null,1,'{"tone":"warm","formality":"casual","emoji":"light","language":"customer","guidelines":"Be kind."}');
 r:=public.marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"Knowledge rollback-only case"}');c:=(r->'conversation'->>'id')::uuid;insert into marketing_qa_ids values('conversation',c);
 r:=public.marketing_inbox_configure(gen_random_uuid(),b,0,'policy','{"automation_mode":"suggest","ai_allowed":true}');
 r:=public.marketing_knowledge_prepare_file(b,'QA menu.pdf','application/pdf',100);menu:=(r->>'id')::uuid;insert into marketing_qa_ids values('menu',menu);
 begin perform public.marketing_knowledge_command(gen_random_uuid(),b,'menu',menu,0,'{"name":"No upload","source_date":"2026-10-17","currency":"MYR","outlet_ids":[],"items":[{"name":"Tea","price":"3.50"}]}');exception when others then failed:=true;end;assert failed,'No confirmation without private original file';
 failed:=false;begin perform public.marketing_knowledge_command(gen_random_uuid(),(select id from marketing_qa_ids where key='other_brand'),'promotion',null,0,'{}');exception when others then failed:=true;end;assert failed,'Other Brand rejected';
 failed:=false;begin perform public.marketing_knowledge_command(gen_random_uuid(),b,'tone',null,1,'{}');exception when others then failed:=true;end;assert failed,'Stale revisions rejected';
 assert not has_table_privilege('authenticated','public.marketing_customer_knowledge','SELECT'),'No direct table access';
 assert not has_function_privilege('anon','public.marketing_knowledge_command(uuid,uuid,text,uuid,integer,jsonb)','EXECUTE'),'Anon denied';
 assert not has_function_privilege('authenticated','public.marketing_knowledge_ai_claim(uuid,uuid)','EXECUTE'),'Service claim private';
end;$$;
reset role;
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');m public.marketing_customer_knowledge;f jsonb;begin
 select * into m from public.marketing_customer_knowledge where id=(select id from marketing_qa_ids where key='menu');
 insert into storage.objects(bucket_id,name,metadata) values('marketing-knowledge',m.object_path,'{"size":100,"mimetype":"application/pdf"}');
 f:=marketing_private.inbox_assistant_material((select id from marketing_qa_ids where key='conversation'));
 assert f->'facts' ? 'identity','Manager-confirmed identity available without duplicate FAQ';
 assert not (f->'facts')::text like '%QA menu%','Pending menu excluded';
end;$$;
set local role authenticated;
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');m uuid:=(select id from marketing_qa_ids where key='menu');r jsonb;req uuid:=gen_random_uuid();begin
 r:=public.marketing_knowledge_ai_prepare(req,b,'menu',m);assert r->>'state'='prepared','AI preparation allowed under consent';insert into marketing_qa_ids values('ai_request',req);
 r:=public.marketing_knowledge_workspace(b);assert jsonb_array_length(r->'customer_knowledge')=1,'Canonical source projection';
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
do $$declare r jsonb;done jsonb;req uuid:=(select id from marketing_qa_ids where key='ai_request');begin
 r:=public.marketing_knowledge_ai_claim(req,(select id from marketing_qa_ids where key='user'));
 done:=public.marketing_knowledge_ai_finish(req,(r->>'lease')::uuid,'{"currency":"MYR","partial":false,"warnings":[],"items":[{"name":"Tea","category":"Drinks","description":"","price":"3.50"}]}','{"model":"fixture","input":0,"output":0,"latency_ms":1}');assert done->>'state'='completed','Preview persisted';
 assert public.marketing_knowledge_ai_finish(req,(r->>'lease')::uuid,'{}','{}')->>'state'='completed','AI receipt idempotent';
 assert marketing_private.customer_knowledge_facts((select id from marketing_qa_ids where key='brand'))='{}','Preview is not confirmed knowledge';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');r jsonb;d date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;begin
 r:=public.marketing_knowledge_command(gen_random_uuid(),b,'menu',(select id from marketing_qa_ids where key='menu'),1,jsonb_build_object('name','Confirmed QA Menu','currency','MYR','source_date',d::text,'outlet_ids','[]'::jsonb,'items','[{"name":"Tea","category":"Drinks","description":"","price":"3.50"}]'::jsonb));
 r:=public.marketing_knowledge_command(gen_random_uuid(),b,'promotion',null,0,jsonb_build_object('name','Current QA offer','details','A confirmed offer','terms','Subject to stated conditions','starts_on',d::text,'ends_on',d::text,'outlet_ids','[]'::jsonb));insert into marketing_qa_ids values('promotion',(r->>'id')::uuid);
 r:=public.marketing_knowledge_command(gen_random_uuid(),b,'promotion',null,0,jsonb_build_object('name','FUTURE_EXCLUDED','details','future','terms','','starts_on',(d+1)::text,'ends_on',(d+2)::text,'outlet_ids','[]'::jsonb));
 r:=public.marketing_knowledge_command(gen_random_uuid(),b,'promotion',null,0,jsonb_build_object('name','EXPIRED_EXCLUDED','details','expired','terms','','starts_on',(d-2)::text,'ends_on',(d-1)::text,'outlet_ids','[]'::jsonb));
end;$$;
reset role;
do $$declare f jsonb;h text;begin
 f:=marketing_private.inbox_assistant_material((select id from marketing_qa_ids where key='conversation'));
 assert (f->'facts')::text like '%3.50%','Confirmed menu available directly';
 assert (f->'facts')::text like '%Current QA offer%','Inclusive current promotion available';
 assert (f->'facts')::text not like '%FUTURE_EXCLUDED%' and (f->'facts')::text not like '%EXPIRED_EXCLUDED%','Future/expired promotion excluded';
 h:=f->>'source_hash';
 update public.marketing_customer_knowledge set state='inactive',revision=revision+1 where id=(select id from marketing_qa_ids where key='menu');
 assert h is distinct from marketing_private.inbox_assistant_material((select id from marketing_qa_ids where key='conversation'))->>'source_hash','Knowledge changes invalidate suggestion evidence';
end;$$;
-- Additional scoped-source and canonical-price contracts.
reset role;
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');org uuid:=(select id from marketing_qa_ids where key='org');outlet uuid:=gen_random_uuid();recipe uuid:=gen_random_uuid();m uuid:=(select id from marketing_qa_ids where key='menu');facts jsonb;begin
 insert into public.outlets(id,name,code,address) values(outlet,'QA Outlet','QA-'||left(outlet::text,8),'QA Address');
 insert into public.organization_outlets values(org,outlet);
 insert into public.brand_outlets(organization_id,brand_id,outlet_id) values(org,b,outlet);
 insert into public.inventory_recipes(id,outlet_id,recipe_name,recipe_code,selling_price) values(recipe,outlet,'Tea','QA-'||left(recipe::text,8),8.90);
 update public.marketing_customer_knowledge set state='confirmed' where id=m;
 facts:=marketing_private.customer_knowledge_facts(b);
 assert facts::text like '%canonical_menu_link_required%' and not facts::text like '%3.50%','Conflicting supplemental price withheld';
 update public.marketing_customer_knowledge set data=jsonb_set(data,'{outlet_ids}',jsonb_build_array(outlet)) where id=m;
 assert not exists(select 1 from jsonb_each(marketing_private.customer_knowledge_facts(b)) x where key like 'menu:%'),'Unknown conversational Outlet cannot expose scoped menu';
 update public.marketing_customer_knowledge set data=jsonb_set(data,'{outlet_ids}','[]') where id=m;
 update public.marketing_customer_knowledge set data=jsonb_set(data,'{items,0,recipe_id}',to_jsonb(recipe::text)) where id=m;
 facts:=marketing_private.customer_knowledge_facts(b);
 assert facts::text like '%outlet_required%' and not facts::text like '%8.90%','Linked canonical Outlet price not inferred into unknown context';
end;$$;
select 'knowledge authority checks passed' result;
