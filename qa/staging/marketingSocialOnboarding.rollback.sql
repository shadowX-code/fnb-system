-- Staging-only projection rehearsal: disposable records, no providers or execution changes.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated,service_role;
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
 insert into auth.users(id,email,aud,role) values(other_u,'marketing-scope-'||other_u::text||'@example.invalid','authenticated','authenticated');
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(other_e,other_u,'QA Out of People Scope','marketing-scope-'||other_u::text||'@example.invalid',r,true,'active',true,'Management');
 insert into marketing_qa_ids values('other_employee',other_e);
 insert into marketing_qa_ids values('user',u),('employee',e),('role',r),('org',o),('brand',b),('other_brand',other_b),('other_org',other_o);
end; $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare s jsonb;denied boolean:=false;begin
 s:=public.marketing_meta_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('a',64),'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');
 insert into marketing_qa_ids values('session',(s->>'id')::uuid);
 begin perform public.marketing_social_accounts((select id from marketing_qa_ids where key='other_org'),null);exception when insufficient_privilege then denied:=true;end;assert denied,'Other tenant denied';
 assert not has_function_privilege('authenticated','public.marketing_meta_bind_selection(uuid,uuid,uuid,jsonb,timestamptz,boolean)','EXECUTE'),'Browser binding denied';
end;$$;
set local role service_role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','service_role')::text,true);
do $$declare s uuid:=(select id from marketing_qa_ids where key='session');u uuid:=(select id from marketing_qa_ids where key='user');b uuid:=(select id from marketing_qa_ids where key='brand');a jsonb:='[{"id":"999999990001","channel":"facebook","expectedConnectionId":null,"expectedGeneration":null,"sealed_token":{"ciphertext":"rollback-only"}},{"id":"999999990002","channel":"instagram","expectedConnectionId":null,"expectedGeneration":null,"sealed_token":{"ciphertext":"rollback-only"}}]';r jsonb;again jsonb;conn uuid;denied boolean;plan jsonb:='{"page_id":"999999990001","fields":["messages"]}';req uuid:=gen_random_uuid();ev jsonb;
begin
 perform public.marketing_meta_consume(repeat('a',64));
 perform public.marketing_meta_stage(s,'999999990003','{"ciphertext":"rollback-only"}','[{"id":"999999990001","name":"Disposable Page","channel":"facebook","capabilities":{"publishing":true,"granted_scopes":["pages_messaging","instagram_manage_messages"]}},{"id":"999999990002","name":"Disposable IG","channel":"instagram","page_id":"999999990001","capabilities":{"publishing":true,"granted_scopes":["pages_messaging","instagram_manage_messages"]}}]');
 denied:=false;begin perform public.marketing_meta_bind_selection(s,u,b,a,now()+interval '1 day',false);exception when others then denied:=true;end;assert denied,'Explicit ownership required';
 denied:=false;begin perform public.marketing_meta_bind_selection(s,u,(select id from marketing_qa_ids where key='other_brand'),a,now()+interval '1 day',true);exception when others then denied:=true;end;assert denied,'Brand scope exact';
 r:=public.marketing_meta_bind_selection(s,u,b,a,now()+interval '1 day',true);again:=public.marketing_meta_bind_selection(s,u,b,a,now()+interval '1 day',true);assert r=again,'Binding retry idempotent';assert jsonb_array_length(r)=2,'Atomic channel pair';assert not exists(select 1 from jsonb_array_elements(r) x where x->'capabilities'->>'execution_enabled'='true' or x->'capabilities'->>'publishing'='true'),'Independent verification required';
 conn:=(select (x->>'id')::uuid from jsonb_array_elements(r) x where x->>'channel'='facebook');insert into marketing_qa_ids values('connection',conn);
 perform public.marketing_meta_record_health(conn,u,1,'{"publishing":{"state":"verified"},"execution_enabled":false}');
 assert public.marketing_meta_subscription_intent(req,conn,u,1,plan)='prepared','Durable intent';
 assert public.marketing_meta_subscription_intent(req,conn,u,1,plan,'pending')='pending','Write checkpoint';
 denied:=false;begin perform public.marketing_meta_subscription_intent(req,conn,u,1,plan,'pending');exception when others then denied:=true;end;assert denied,'Provider write cannot repeat';
 denied:=false;begin perform public.marketing_meta_subscription_intent(req,conn,u,1,plan||'{"page_id":"wrong"}');exception when others then denied:=true;end;assert denied,'Immutable exact plan';
 perform public.marketing_meta_subscription_intent(req,conn,u,1,plan,'verified');
 ev:='{"account_id":"999999990001","channel":"facebook","authorization_verified":true,"subscriptions_verified":true,"real_inbound_verified":true,"page_id":"999999990001","page_tasks":["MESSAGING"],"required_permissions":["pages_messaging"],"verified_inbound_ids":[]}';
 perform public.marketing_inbox_record_verification(conn,u,1,ev);
 assert (public.marketing_inbox_record_verification(conn,u,1,ev||'{"real_inbound_verified":false}')->>'receiving_verified')::boolean,'Quiet period retains same-grant inbound proof';
 assert not (public.marketing_inbox_record_verification(conn,u,1,ev||'{"authorization_verified":false}')->>'receiving_verified')::boolean,'Revoked authorization clears operational';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s:=public.marketing_meta_begin((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'),repeat('b',64),'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');insert into marketing_qa_ids values('reconnect',(s->>'id')::uuid);
end;$$;
set local role service_role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','service_role')::text,true);
do $$declare s uuid:=(select id from marketing_qa_ids where key='reconnect');u uuid:=(select id from marketing_qa_ids where key='user');b uuid:=(select id from marketing_qa_ids where key='brand');c uuid:=(select id from marketing_qa_ids where key='connection');a jsonb;denied boolean;
begin
 perform public.marketing_meta_reconnect_intent(s,u,c);perform public.marketing_meta_consume(repeat('b',64));
 perform public.marketing_meta_stage(s,'999999990003','{"ciphertext":"rollback-only"}','[{"id":"999999990001","channel":"facebook","name":"Disposable Page","capabilities":{"publishing":true}},{"id":"999999990004","channel":"facebook","name":"Other Page","capabilities":{"publishing":true}}]');
 a:=jsonb_build_array(jsonb_build_object('id','999999990004','channel','facebook','expectedConnectionId',c,'expectedGeneration',1,'sealed_token',jsonb_build_object('ciphertext','rollback-only')));
 denied:=false;begin perform public.marketing_meta_bind_selection(s,u,b,a,now()+interval '1 day',true);exception when others then denied:=true;end;assert denied,'Reconnect cannot switch assets';
 a:=jsonb_build_array(jsonb_build_object('id','999999990001','channel','facebook','expectedConnectionId',c,'expectedGeneration',0,'sealed_token',jsonb_build_object('ciphertext','rollback-only')));
 denied:=false;begin perform public.marketing_meta_bind_selection(s,u,b,a,now()+interval '1 day',true);exception when others then denied:=true;end;assert denied,'Stale generation denied';
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from marketing_qa_ids where key='user'),'role','authenticated')::text,true);
do $$declare v jsonb;begin
 v:=public.marketing_social_accounts((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'));assert jsonb_array_length(v->'connections')=2,'Both scoped accounts';assert v::text not like '%ciphertext%' and v::text not like '%sealed_token%','No credentials projected';v:=public.marketing_meta_pending((select id from marketing_qa_ids where key='org'),(select id from marketing_qa_ids where key='brand'));assert jsonb_array_length(v)=1 and v->0->>'id'=(select id::text from marketing_qa_ids where key='reconnect') and jsonb_array_length(v->0->'accounts')=1 and v->0->'accounts'->0->>'id'='999999990001','Only exact reconnect account remains; completed selection hidden';
end;$$;
reset role;
rollback;
select 'Social onboarding scope, atomic binding, idempotency, health and subscription guards passed; fixtures rolled back' result;
