-- Staging-only projection rehearsal: disposable records, no providers or execution changes.
begin;
create temporary table marketing_qa_ids(key text primary key,id uuid);
grant select,insert,update on marketing_qa_ids to authenticated;
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); other_o uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); other_e uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'marketing-rollback-'||u::text||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_marketing_'||r::text,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code in ('platform_organizations.manage','platform_customers.manage') or code in ('roles.create','roles.edit','roles.view','employees.view');
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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');u uuid;aud uuid;c uuid;s uuid;r uuid;v jsonb;again jsonb;denied boolean;req uuid:=gen_random_uuid();caption text:='Hello {name} from {brand}';
begin
 v:=public.platform_customer_command(req,o,b,'{"name":"Disposable Customer","phone":"012-3456789","language":"BM","tags":["regular"]}');u:=(v->>'id')::uuid;again:=public.platform_customer_command(req,o,b,'{"name":"Disposable Customer","phone":"012-3456789","language":"BM","tags":["regular"]}');assert v=again,'Customer retries idempotent';
 denied:=false;begin perform public.platform_customer_command(gen_random_uuid(),o,(select id from marketing_qa_ids where key='other_brand'),'{}');exception when insufficient_privilege then denied:=true;end;assert denied,'Cross-brand customer creation denied';
 assert not has_table_privilege('authenticated','public.platform_customers','SELECT'),'No direct customer leak';
 v:=public.marketing_outreach_command(gen_random_uuid(),o,b,'audience',null,'{"name":"Regulars","criteria":{"tag":"regular","language":"BM"}}');aud:=(v->>'id')::uuid;
 v:=public.marketing_outreach_read(o,b);assert v->'audiences'->0->>'eligible_count'='0','Phone alone is not consent';
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'consent',u,jsonb_build_object('decision','granted','source','Disposable QA opt-in','evidence','Synthetic rollback-only evidence','occurred_at',now()));
 v:=public.marketing_outreach_read(o,b);assert v->'audiences'->0->>'eligible_count'='1','Segment preview honors consent';
 v:=public.marketing_outreach_command(gen_random_uuid(),o,b,'sender',null,'{"label":"Disposable sender","phone":"01112345678","confirmed":true}');s:=(v->>'id')::uuid;
 v:=public.marketing_outreach_command(gen_random_uuid(),o,b,'save',null,jsonb_build_object('title','Rollback campaign','audience_id',aud,'caption',caption));c:=(v->>'id')::uuid;
 denied:=false;begin perform public.marketing_outreach_command(gen_random_uuid(),o,b,'queue',c,'{"revision":1}');exception when others then denied:=true;end;assert denied,'Draft cannot execute';
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'review',c,'{"revision":1}');perform public.marketing_outreach_command(gen_random_uuid(),o,b,'approve',c,'{"revision":1}');req:=gen_random_uuid();v:=public.marketing_outreach_command(req,o,b,'queue',c,'{"revision":1}');again:=public.marketing_outreach_command(req,o,b,'queue',c,'{"revision":1}');assert v=again,'Queue retry idempotent';
 v:=public.marketing_outreach_read(o,b,c);r:=(v->'recipients'->0->>'id')::uuid;assert v->'progress'->>'pending'='1','Exact one eligible recipient';assert v->'recipients'->0->>'caption'='Hello Disposable Customer from QA Authorized Brand','Canonical personalization';assert v->'verified_delivery'='null' and v->'verified_redemptions'='null','No invented delivery/redemption';
 denied:=false;begin perform public.marketing_outreach_command(gen_random_uuid(),o,b,'open',r,'{}');exception when others then denied:=true;end;assert denied,'Sender confirmation required';
 req:=gen_random_uuid();v:=public.marketing_outreach_command(req,o,b,'open',r,jsonb_build_object('senderId',s,'senderConfirmed',true));again:=public.marketing_outreach_command(req,o,b,'open',r,jsonb_build_object('senderId',s,'senderConfirmed',true));assert v=again and v->>'state'='opened','Open retry safe';
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'suppress',u,'{"reason":"QA opt-out"}');
 denied:=false;begin perform public.marketing_outreach_command(gen_random_uuid(),o,b,'open',r,jsonb_build_object('senderId',s,'senderConfirmed',true));exception when others then denied:=true;end;assert denied,'Suppression stops repeated open';
 denied:=false;begin perform public.marketing_outreach_command(gen_random_uuid(),o,b,'confirm',r,jsonb_build_object('senderId',s,'senderConfirmed',true));exception when others then denied:=true;end;assert denied,'Suppression rechecked at confirmation';
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'unsuppress',u);
 v:=public.marketing_outreach_command(gen_random_uuid(),o,b,'confirm',r,jsonb_build_object('senderId',s,'senderConfirmed',true));assert v->>'state'='staff_confirmed','Manual confirmation distinct';
 denied:=false;begin perform public.marketing_outreach_command(gen_random_uuid(),o,b,'save',c,jsonb_build_object('revision',1,'title','Changed','audience_id',aud,'caption','Changed'));exception when others then denied:=true;end;assert denied,'Started campaign immutable';
 perform public.marketing_outreach_command(gen_random_uuid(),o,b,'consent',u,jsonb_build_object('decision','withdrawn','source','QA withdrawal','evidence','Rollback only','occurred_at',now()));v:=public.marketing_outreach_read(o,b);assert v->'audiences'->0->>'eligible_count'='0','Latest withdrawal wins even within same transaction';
 denied:=false;begin perform public.marketing_outreach_read((select id from marketing_qa_ids where key='other_org'),b);exception when insufficient_privilege then denied:=true;end;assert denied,'Cross tenant denied';
end;$$;
reset role;
rollback;
select 'Hybrid WhatsApp canonical scope, consent, approval, queue, retry and manual evidence checks passed; all disposable fixtures rolled back' result;
