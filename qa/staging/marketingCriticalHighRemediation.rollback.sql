-- Run only on Staging ujkzdaaadnvcfayuldmh. No network/provider/credential operations.
begin;
create temporary table remediation_qa_ids(key text primary key,id uuid);
grant select,insert on remediation_qa_ids to authenticated,service_role;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();l uuid:=gen_random_uuid();e uuid:=gen_random_uuid();ae uuid:=gen_random_uuid();r uuid:=gen_random_uuid();owner_role uuid;o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();other_o uuid:=gen_random_uuid();other_b uuid:=gen_random_uuid();
begin
 select id into owner_role from roles where lower(name)='owner';assert owner_role is not null;
 insert into auth.users(id,email,aud,role) values(u,u||'@example.invalid','authenticated','authenticated'),(a,a||'@example.invalid','authenticated','authenticated'),(l,l||'@example.invalid','authenticated','authenticated');
 insert into roles(id,name,is_active,outlet_access_type) values(r,'qa_remediation_'||r,true,'all');
 insert into role_permissions(role_id,permission_id) select r,id from permissions where code in ('employees.edit','employees.view','marketing_workspace.access','marketing_content.view','crew_roster.manage');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 insert into employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace)
 values(e,u,'Disposable RBAC QA',u||'@example.invalid',r,true,'active',true,'Management'),(ae,a,'Disposable Admin QA',a||'@example.invalid',owner_role,true,'active',true,'Management');
 -- A stale, privileged legacy profile must never supplement a linked Employee.
 insert into user_profiles(id,email,full_name,role_id,is_active,enable_system_login,access_state)
 values(u,u||'@example.invalid','Disposable profile QA',owner_role,true,true,'active'),(l,l||'@example.invalid','Disposable legacy QA',owner_role,true,true,'active');
 insert into organizations(id,name) values(o,'Disposable remediation tenant'),(other_o,'Disposable foreign tenant');
 insert into organization_memberships values(o,e);
 insert into brands(id,organization_id,name) values(b,o,'Disposable allowed brand'),(other_b,other_o,'Disposable foreign brand');
 insert into platform_member_brand_scopes(organization_id,employee_id,all_brands) values(o,e,false) on conflict(organization_id,employee_id) do update set all_brands=false;
 insert into platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into remediation_qa_ids values('user',u),('admin',a),('legacy',l),('employee',e),('role',r),('owner',owner_role),('org',o),('brand',b),('other_org',other_o),('other_brand',other_b);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from remediation_qa_ids where key='user'),'role','authenticated','email',(select id::text||'@example.invalid' from remediation_qa_ids where key='user'))::text,true);
do $$
declare denied boolean;u uuid:=(select id from remediation_qa_ids where key='user');e uuid:=(select id from remediation_qa_ids where key='employee');owner_role uuid:=(select id from remediation_qa_ids where key='owner');result jsonb;
begin
 assert current_user_role_id()=(select id from remediation_qa_ids where key='role'),'Employee must override privileged profile';
 assert current_user_has_permission('marketing_content.view') and current_user_has_direct_permission('marketing_content.view');
 assert current_user_has_permission('duty_roster.edit') and not current_user_has_direct_permission('duty_roster.edit'),'Legacy roster alias preserved without inventing direct grants';
 assert not current_user_has_permission('marketing_ads.execute') and not current_user_is_protected_role(),'No Profile role union';
 denied:=false;begin update user_profiles set role_id=(select id from remediation_qa_ids where key='role') where id=u;exception when insufficient_privilege then denied:=true;end;assert denied,'Self role edit rejected even when reducing it';
 denied:=false;begin update user_profiles set access_state='disabled' where id=u;exception when insufficient_privilege then denied:=true;end;assert denied,'Self access edit rejected';
 update user_profiles set nickname='QA presentation edit' where id=u;assert found,'Ordinary profile edit preserved';
 denied:=false;begin update employees set role_id=owner_role where id=e;exception when insufficient_privilege then denied:=true;end;assert denied,'Employee self escalation rejected';
 denied:=false;begin update employees set auth_user_id=(select id from remediation_qa_ids where key='legacy') where id=e;exception when insufficient_privilege then denied:=true;end;assert denied,'Direct identity reassignment rejected';
 denied:=false;begin perform save_role_configuration(gen_random_uuid(),'{"name":"unauthorized QA","outlet_access_type":"none"}',array['marketing_ads.execute'],'{}');exception when insufficient_privilege then denied:=true;end;assert denied,'Role command authority preserved';
 denied:=false;begin perform marketing_read((select id from remediation_qa_ids where key='other_org'),(select id from remediation_qa_ids where key='other_brand'),'content');exception when insufficient_privilege then denied:=true;end;assert denied,'Foreign Brand denied';
 result:=marketing_read((select id from remediation_qa_ids where key='org'),(select id from remediation_qa_ids where key='brand'),'content');assert result is not null,'Authorized Brand read preserved';
end;$$;
-- Disable only the disposable Employee: the privileged profile cannot reactivate it.
reset role;
update employees set access_state='disabled' where id=(select id from remediation_qa_ids where key='employee');
set local role authenticated;
do $$begin assert current_user_role_id() is null;assert not current_user_has_permission('marketing_content.view');end;$$;
-- Genuine legacy-only identities retain their established permissions.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from remediation_qa_ids where key='legacy'),'role','authenticated')::text,true);
do $$begin assert current_user_is_protected_role();assert current_user_has_permission('marketing_content.view');end;$$;
-- Authorized admin editing another Employee and canonical Role save remain available.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from remediation_qa_ids where key='admin'),'role','authenticated')::text,true);
do $$
declare result jsonb;e uuid:=(select id from remediation_qa_ids where key='employee');
begin
 update employees set enable_system_login=false,access_state='disabled' where id=e;assert found;
 update employees set role_id=(select id from remediation_qa_ids where key='owner'),enable_system_login=true,access_state='active' where id=e;assert found;
 update user_profiles set role_id=(select id from remediation_qa_ids where key='role') where id=(select id from remediation_qa_ids where key='legacy');assert found;
 result:=save_role_configuration(gen_random_uuid(),'{"name":"qa_remediation_role_save","outlet_access_type":"none"}',array['marketing_content.view'],'{}');
 assert result->'permissions'='["marketing_content.view"]'::jsonb;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from remediation_qa_ids where key='legacy'),'role','authenticated')::text,true);
do $$declare denied boolean;begin
 denied:=false;begin update user_profiles set role_id=(select id from remediation_qa_ids where key='owner') where id=(select id from remediation_qa_ids where key='legacy');exception when insufficient_privilege then denied:=true;end;assert denied,'Legacy self role escalation denied';
 denied:=false;begin update employees set role_id=(select id from remediation_qa_ids where key='role') where auth_user_id=(select id from remediation_qa_ids where key='user');exception when insufficient_privilege then denied:=true;end;assert denied,'Non-protected delegator cannot change a protected account';
end;$$;
reset role;
-- Disposable publishing and health queues share canonical leases; never invoke the worker endpoint.
do $$
declare o uuid:=(select id from remediation_qa_ids where key='org');b uuid:=(select id from remediation_qa_ids where key='brand');a uuid:=(select id from remediation_qa_ids where key='admin');e uuid;conn uuid;c jsonb;i integer;
begin
 assert not exists(select 1 from marketing_connections where capabilities->>'execution_enabled'='true'),'Requires all real execution disabled';
 assert not exists(select 1 from marketing_jobs where state in ('queued','retry','reconciling','leased')),'Requires no real pending publish work';
 select id into e from employees where auth_user_id=a;
 insert into organization_memberships values(o,e);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 c:=marketing_content_command(gen_random_uuid(),'save',o,b,null,0,'{"title":"Disposable fairness QA","outlet_ids":[],"variants":[{"channel":"facebook","format":"text","caption":"Never published","asset_ids":[]}]}');
 perform marketing_content_command(gen_random_uuid(),'review',o,b,(c->>'id')::uuid,1);
 perform marketing_content_command(gen_random_uuid(),'approve',o,b,(c->>'id')::uuid,1);
 perform marketing_content_command(gen_random_uuid(),'schedule',o,b,(c->>'id')::uuid,1,jsonb_build_object('scheduled_at',now()+interval '1 hour','timezone','Asia/Kuala_Lumpur'));
 for i in 1..10 loop
  if i>1 then b:=gen_random_uuid();insert into brands(id,organization_id,name) values(b,o,'Disposable health Brand '||i);end if;
  conn:=gen_random_uuid();
  insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation)
  values(conn,o,b,'facebook','99999999999'||i,'Disposable fairness QA','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["text"]}',e,now()-interval '1 hour',1);
  insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(conn,'rollback-only','{}');
  if i=1 then
   update marketing_jobs set connection_id=conn,connection_generation=1,external_authorized_at=now(),state='queued',due_at=now()-interval '1 minute' where content_id=(c->>'id')::uuid;
   insert into remediation_qa_ids values('fair_content',(c->>'id')::uuid),('fair_connection',conn);
  end if;
 end loop;
end;$$;
do $$begin assert (select count(*)>=10 from marketing_private.connection_checks where due_at<=now() and connection_id in(select id from marketing_connections where organization_id=(select id from remediation_qa_ids where key='org'))),'Health load fixture missing';
end;$$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare j jsonb;h jsonb;conn uuid:=(select id from remediation_qa_ids where key='fair_connection');denied boolean;
begin
 j:=marketing_claim_job();assert j->>'content_id'=(select id::text from remediation_qa_ids where key='fair_content'),'Publishing must remain claimable while health is due';
 assert marketing_claim_job() is null,'A leased job cannot be claimed twice';
 perform marketing_job_guard((j->>'id')::uuid,(j->>'lease_token')::uuid);
 denied:=false;begin perform marketing_job_guard((j->>'id')::uuid,gen_random_uuid());exception when others then denied:=true;end;assert denied,'Wrong lease denied';
 h:=marketing_meta_health_claim(conn);assert h is not null;assert marketing_meta_health_claim(conn) is null,'Health lease excludes duplicates';
 perform marketing_meta_health_finish(conn,1,(h->>'lease')::uuid,'connection_check_deadline');
 -- No provider checkpoint or receipt is invented. Finish the disposable attempt as a retryable failure.
 perform marketing_finish_job((j->>'id')::uuid,(j->>'lease_token')::uuid,'retryable_failure',null,'qa_no_provider_call');
end;$$;
reset role;
do $$begin assert (select due_at=now()+interval '1 minute' and lease_until is null from marketing_private.connection_checks where connection_id=(select id from remediation_qa_ids where key='fair_connection')),'Deadline follows canonical bounded retry';end;$$;
-- Every stored Creator post remains editable under the same stable key. No URL rewrite.
do $$declare p record;v jsonb;begin
 for p in select platform,post_key,canonical_url from marketing_creator_posts loop
  v:=marketing_private.creator_url(p.canonical_url);assert v->>'platform'=p.platform and v->>'post_key'=p.post_key,'Existing Creator identity changed';
 end loop;
end;$$;
rollback;
select 'PASS: authenticated DB-role denial, Employee precedence/disable, legacy compatibility, legitimate admin role save, Brand isolation, publishing/health lease exclusion and bounded retry, existing Creator keys; disposable fixtures rolled back' verification;
