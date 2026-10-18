-- Standalone Staging-only rollback rehearsal; no provider calls.
begin;
-- Run inside a rollback-only transaction after the scoped migration. No provider requests.
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'all');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage' or code in ('roles.create','roles.edit','roles.view','employees.view','outlets.view','outlets.edit');
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

-- Isolated source fixtures only; no persistent business records are changed.
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');x uuid:=gen_random_uuid();r uuid:=gen_random_uuid();recipe uuid:=gen_random_uuid();begin
 insert into outlets(id,name,code,location,is_active) values(x,'QA source Outlet','QA-'||left(x::text,8),'QA location',true);
 insert into organization_outlets(organization_id,outlet_id) values(o,x);
 insert into brand_outlets(organization_id,brand_id,outlet_id) values(o,b,x);
 insert into product_sales_reports(id,outlet_id,report_year,report_month,status,file_name) values(r,x,2026,9,'completed','QA rollback.csv');
 insert into product_sales_items(report_id,outlet_id,category_name,product_name,variant_name,quantity,gross_sales,nett_sales) values(r,x,'Drinks','QA Tea','Default',10,90,80),(r,x,'Drinks','QA Tea','Large',10,90,80),(r,x,'Food','QA Toast','Default',1,9,8);
 insert into inventory_recipes(id,outlet_id,recipe_name,recipe_code,selling_price,status) values(recipe,x,'QA Tea Recipe','QA-'||left(recipe::text,8),5,'active');
 insert into product_recipe_mappings(outlet_id,product_name,recipe_id,status) values(x,'QA Tea',recipe,'mapped');
 insert into marketing_qa_ids values('outlet',x),('report',r),('recipe',recipe);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');x uuid:=(select id from marketing_qa_ids where key='outlet');r jsonb;d jsonb;p jsonb;req uuid:=gen_random_uuid();c uuid;failed boolean;begin
 r:=marketing_knowledge_products(b);assert r->>'total'='3','Complete normalized product projection';
 assert not r::text like '%nett_sales%','No financial amounts leaked';
 select value into p from jsonb_array_elements(r->'rows') value where value->>'name'='QA Tea' and value->>'variant'='Default';
 assert p->>'current_price'='5.00' or (p->>'current_price')::numeric=5,'Explicit mapped configured price';
 assert exists(select 1 from jsonb_array_elements(r->'rows') value where value->>'variant'='Large' and value->>'current_price' is null),'Variant price is not inferred';
 d:='{"description":"A fragrant tea.","signature":true,"customer_facing":true,"wording":"Try our signature tea."}';
 r:=marketing_product_description_save(req,b,x,p->>'product_key',0,p->>'source_hash',d);
 assert marketing_product_description_save(req,b,x,p->>'product_key',0,p->>'source_hash',d)=r,'Retry has one revision';
 failed:=false;begin perform marketing_product_description_save(gen_random_uuid(),b,x,p->>'product_key',0,p->>'source_hash',d);exception when serialization_failure then failed:=true;end;assert failed,'Concurrent stale edit denied';
 failed:=false;begin perform marketing_knowledge_products((select id from marketing_qa_ids where key='other_brand'));exception when others then failed:=true;end;assert failed,'Other Brand denied';
 failed:=false;begin perform marketing_product_description_save(gen_random_uuid(),b,x,p->>'product_key',1,p->>'source_hash','{"description":"RM 5 available today","signature":false,"customer_facing":false,"wording":""}');exception when others then failed:=true;end;assert failed,'Copy cannot override source price/availability';
 d:=jsonb_build_object('timezone','Asia/Kuala_Lumpur','phone','QA phone','email','','website','','service_policies','QA policy','weekly_hours',(select jsonb_agg(jsonb_build_object('day',n,'status','unknown','periods','[]'::jsonb)) from generate_series(0,6)n),'special_hours',jsonb_build_array(jsonb_build_object('date',(now() at time zone 'Asia/Kuala_Lumpur')::date::text,'status','closed','periods','[]'::jsonb,'reason','QA special closure')));
 req:=gen_random_uuid();r:=outlet_service_profile_save(req,x,0,d);assert outlet_service_profile_save(req,x,0,d)=r,'Outlet retry has one revision';
 failed:=false;begin perform outlet_service_profile_save(gen_random_uuid(),x,0,d);exception when serialization_failure then failed:=true;end;assert failed,'Stale Outlet edit denied';
 r:=marketing_knowledge_workspace(b);assert (r->'canonical_outlets'->0->'service_profile'->>'revision')='1','One canonical profile in workspace';
 r:=marketing_inbox_command(gen_random_uuid(),o,b,null,0,'create','{"title":"Operational context QA"}');c:=(r->'conversation'->>'id')::uuid;
 r:=marketing_inbox_command(gen_random_uuid(),o,b,c,1,'outlet_context',jsonb_build_object('outlet_id',x));assert r->'conversation'->>'outlet_id'=x::text,'Explicit context via canonical command';
 assert marketing_inbox_detail(c)->'outlet_options'->0->>'id'=x::text,'Scoped Outlet options';
 insert into marketing_qa_ids values('conversation',c);
end;$$;
reset role;
do $$declare b uuid:=(select id from marketing_qa_ids where key='brand');x uuid:=(select id from marketing_qa_ids where key='outlet');r jsonb;p jsonb;begin
 r:=marketing_private.customer_knowledge_facts(b,null,'QA Tea price hours');
 assert jsonb_array_length(r->'menu:restaurant'->'items')=1,'Internal/unreviewed POS products excluded from AI';
 assert r->'menu:restaurant'->'items'->0->>'price' is null,'Unknown Outlet has no price';
 assert r->('outlet:'||x)->'service_profile'='null'::jsonb,'Unknown Outlet has no hours/contact/policies';
 r:=marketing_private.customer_knowledge_facts(b,x,'QA Tea price hours');
 assert r->('outlet:'||x)->'service_profile'->'today_hours'->>'status'='closed','Special hours override weekly hours';
 assert exists(select 1 from jsonb_array_elements(r->'menu:restaurant'->'items') value where (value->>'price')::numeric=5),'Confirmed Outlet source price available';
 assert r::text like '%A fragrant tea.%','Current Marketing supplement retrieved';
 update inventory_recipes set selling_price=0 where id=(select id from marketing_qa_ids where key='recipe');
 r:=marketing_private.customer_knowledge_facts(b,x,'QA Tea');assert r::text not like '%A fragrant tea.%','Source change invalidates copy';
 assert not exists(select 1 from jsonb_array_elements(r->'menu:restaurant'->'items') value where value->>'price' is not null),'Default zero is not free';
 assert not has_table_privilege('authenticated','outlet_service_profiles','UPDATE'),'Private source writes require RPC';
 assert not has_function_privilege('anon','marketing_knowledge_products(uuid,text,text,uuid,integer,integer)','EXECUTE'),'Anonymous read denied';
 assert not has_function_privilege('authenticated','marketing_private.customer_knowledge_facts(uuid,uuid,text)','EXECUTE'),'Private helper not exposed';
end;$$;
-- All mutations, role fixtures and source evidence roll back together.

-- Remove only rollback-fixture permission; ensure Marketing access cannot edit Restaurant facts.
delete from role_permissions where role_id=(select id from marketing_qa_ids where key='role') and permission_id=(select id from permissions where code='outlets.edit');
set local role authenticated;
do $$declare failed boolean:=false;x uuid:=(select id from marketing_qa_ids where key='outlet');r jsonb;begin
 r:=outlet_service_profile_read(x);assert r->>'can_edit'='false','Marketing source visibility is not source edit authority';
 begin perform outlet_service_profile_save(gen_random_uuid(),x,1,r->'profile'->'data');exception when insufficient_privilege then failed:=true;end;assert failed,'Outlet edit denied without source permission';
end;$$;
reset role;


-- Context is canonical, survives follow-ups, and never crosses Brand mappings.
do $$declare c uuid:=(select id from marketing_qa_ids where key='conversation');b uuid:=(select id from marketing_qa_ids where key='brand');o uuid:=(select id from marketing_qa_ids where key='org');x uuid:=(select id from marketing_qa_ids where key='outlet');y uuid:=gen_random_uuid();r jsonb;begin
 update marketing_conversations set outlet_id=null,outlet_context_evidence='{}' where id=c;
 r:=marketing_private.inbox_outlet_context(c);assert r->>'outlet_id'=x::text and r->>'source'='single_outlet','Only eligible Outlet resolves without storing an inferred mapping';
 assert (select outlet_id is null from marketing_conversations where id=c),'Sole Outlet resolution is read-only';
 insert into outlets(id,name,code,location,is_active) values(y,'QA Lake Branch','QA-LAKE','QA Lakeside',true);
 insert into organization_outlets values(o,y);insert into brand_outlets(organization_id,brand_id,outlet_id) values(o,b,y);
 assert marketing_private.inbox_outlet_context(c)->>'known'='false','Multiple Outlets require evidence';
 insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','QA Lake Branch tonight open?',clock_timestamp());
 assert marketing_private.inbox_outlet_context(c)->>'outlet_id'=y::text,'Explicit canonical reference resolves';
 for n in 1..15 loop insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','And tomorrow?',clock_timestamp());end loop;
 assert marketing_private.inbox_outlet_context(c)->>'outlet_id'=y::text,'Context survives bounded history truncation';
 insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','QA source Outlet instead',clock_timestamp());
 assert marketing_private.inbox_outlet_context(c)->>'outlet_id'=x::text,'Explicit change replaces context';
 insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','not QA source Outlet',clock_timestamp());
 assert marketing_private.inbox_outlet_context(c)->>'known'='false','Negated identity requires clarification';
 insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','QA Lake Branch',clock_timestamp());
 insert into marketing_conversation_messages(conversation_id,kind,body,occurred_at) values(c,'note','QA source Outlet',now()-interval '1 day');
 assert marketing_private.inbox_outlet_context(c)->>'outlet_id'=y::text,'Late delivery cannot replace newer context';
 delete from brand_outlets where brand_id=b and outlet_id=y;
 assert marketing_private.inbox_outlet_context(c)->>'known'='false','Unlinked context never silently moves to remaining Outlet';
 update marketing_conversations set outlet_id=null,outlet_context_evidence='{"state":"cleared"}' where id=c;
 assert marketing_private.inbox_outlet_context(c)->>'known'='false','Explicit staff clear overrides automatic single Outlet';
 r:=marketing_private.customer_knowledge_facts(b,x,'tomorrow hours');
 assert (r->('outlet:'||x)->'service_profile'->>'requested_date')::date=(now() at time zone 'Asia/Kuala_Lumpur')::date+1,'Tomorrow uses Outlet timezone';
 r:=marketing_private.customer_knowledge_facts(b,x,'next week hours');assert r->('outlet:'||x)->'service_profile'->>'requested_date' is null,'Ambiguous future date is not today';
 assert not has_function_privilege('authenticated','marketing_private.inbox_outlet_context(uuid)','EXECUTE'),'Private context authority not exposed';
end;$$;
select 'Outlet context, persistence, change, negation, out-of-order delivery, mapping revocation and date guards passed' result;
rollback;
