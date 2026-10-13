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
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');j uuid:=gen_random_uuid();result jsonb;batch jsonb;s integer;total integer:=250;
begin
 result:=public.platform_customer_import_job(o,b,'begin',j,jsonb_build_object('source','QA POS Load','snapshot_date','2026-10-13','file_name','synthetic-10000.csv','total',total,'file_digest',repeat('a',64)));
 assert result->>'state'='uploading','Durable upload';
 for s in 0..(total/250-1) loop
  select jsonb_agg(jsonb_build_object('input',jsonb_build_object('name','Synthetic Load '||i,'phone','01199'||lpad(i::text,6,'0'),'email','fixture'||i||'@example.invalid','gender','other','birthday','01/02/2000','total_visit','8','avg_spent','0','total_spent','123.45','last_visit','12/10/2026','member_since','01/01/2025','tags',jsonb_build_array('Load Fixture')),'decision',jsonb_build_object('selected',true,'snapshot','new','fields','[]'::jsonb))) into batch from generate_series(s*250+1,s*250+250)i;
  result:=public.platform_customer_import_job(o,b,'upload',j,jsonb_build_object('start',s*250+1,'rows',batch));
  assert public.platform_customer_import_job(o,b,'upload',j,jsonb_build_object('start',s*250+1,'rows',batch))=result,'Chunk retry idempotent';
 end loop;
 result:=public.platform_customer_import_job(o,b,'confirm',j);assert result->>'state'='queued','Confirmation queues';
 assert public.platform_customer_import_job(o,b,'confirm',j)->>'state'='queued','Confirmation retry safe';
 insert into marketing_qa_ids values('load_job',j);
end;$$;
reset role;
do $$declare n integer;cursor_n integer;before_n integer:=0;t timestamptz:=clock_timestamp();begin
 for i in 1..3 loop
  n:=marketing_private.customer_import_tick();assert n<=100 and n>0, 'Bounded batches advance at '||i::text||' n='||n::text||': '||(select coalesce(error_code,'')||' '||coalesce(error,'') from marketing_private.customer_import_jobs where id=(select id from marketing_qa_ids where key='load_job'));
  select processed into cursor_n from marketing_private.customer_import_jobs where id=(select id from marketing_qa_ids where key='load_job');
  assert cursor_n=before_n+n,'Resumable exact cursor';before_n:=cursor_n;
 end loop;
 assert (select state from marketing_private.customer_import_jobs where id=(select id from marketing_qa_ids where key='load_job'))='completed','Bounded job completed';
 assert (select count(*) from public.platform_customer_brands where brand_id=(select id from marketing_qa_ids where key='brand'))=250,'No duplicate customers';
 assert (select count(*) from marketing_private.customer_pos_snapshots where brand_id=(select id from marketing_qa_ids where key='brand'))=250,'One source snapshot each';
 assert not exists(select 1 from marketing_private.customer_import_rows where job_id=(select id from marketing_qa_ids where key='load_job') and (input<>'{}' or decision<>'{}' or phone is not null)),'Raw data cleared on completion';
 assert marketing_private.customer_import_tick()=0,'Completed jobs not replayed';
 raise notice '250 rows in three bounded batches: % seconds',extract(epoch from clock_timestamp()-t);
end;$$;
do $$
declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');j uuid:=gen_random_uuid();v jsonb;batch jsonb;e uuid:=(select id from marketing_qa_ids where key='employee');
begin
 assert not exists(select 1 from marketing_private.customer_import_jobs where state in('queued','running')),'No unrelated jobs may run in this rehearsal';
 perform public.platform_customer_import_job(o,b,'begin',j,jsonb_build_object('source','QA Recovery','snapshot_date','2026-10-13','file_name','synthetic-recovery.csv','total',101,'file_digest',repeat('b',64)));
 select jsonb_agg(jsonb_build_object('input',jsonb_build_object('name','Synthetic Recovery '||i,'phone','01988'||lpad(i::text,6,'0'),'row',i+12),'decision',jsonb_build_object('selected',true,'snapshot','new','fields','[]'::jsonb))) into batch from generate_series(1,101)i;
 perform public.platform_customer_import_job(o,b,'upload',j,jsonb_build_object('start',1,'rows',batch));
 v:=public.platform_customer_import_job(o,b,'read',j);assert v->'approvals'->'1'->>'selected'='true','Interrupted upload retains exact reviewed approvals';
 perform public.platform_customer_import_job(o,b,'confirm',j);
 assert marketing_private.customer_import_tick()=100,'First batch committed';
 update public.employees set is_active=false,enable_system_login=false where id=e;
 assert marketing_private.customer_import_tick()=0,'Revoked original authority stops the remaining batch';
 assert (select processed from marketing_private.customer_import_jobs where id=j)=100,'Previously committed cursor retained';
 assert (select state from marketing_private.customer_import_jobs where id=j)='attention','Actionable recovery state';
 update public.employees set is_active=true,enable_system_login=true where id=e;
 perform public.platform_customer_import_job(o,b,'retry',j);
 assert marketing_private.customer_import_tick()=1,'Only remaining row retried';
 v:=public.platform_customer_import_job(o,b,'read',j);assert v->>'processed'='101' and v->'rows'->0->>'file_row'='13','History retains original worksheet position';
 assert not exists(select 1 from marketing_private.customer_import_rows where job_id=j and input<>'{}'),'Recovered job clears raw input';
 j:=gen_random_uuid();
 perform public.platform_customer_import_job(o,b,'begin',j,jsonb_build_object('source','QA Duplicates','snapshot_date','2026-10-13','file_name','synthetic-cross-chunk.csv','total',251,'file_digest',repeat('c',64)));
 select jsonb_agg(jsonb_build_object('input',jsonb_build_object('name','Synthetic Duplicate Check '||i,'phone',case when i=2 then 'bad' else '01388'||lpad(i::text,6,'0') end),'decision',jsonb_build_object('selected',true,'snapshot','new','fields','[]'::jsonb))) into batch from generate_series(1,250)i;
 perform public.platform_customer_import_job(o,b,'upload',j,jsonb_build_object('start',1,'rows',batch));
 perform public.platform_customer_import_job(o,b,'upload',j,'{"start":251,"rows":[{"input":{"name":"Synthetic Duplicate Last","phone":"01388000001"},"decision":{"selected":true,"snapshot":"new","fields":[]}}]}');
 perform public.platform_customer_import_job(o,b,'confirm',j);
 for i in 1..3 loop perform marketing_private.customer_import_tick();end loop;
 v:=public.platform_customer_import_job(o,b,'read',j);assert v->'counts'->>'conflict'='2' and v->'counts'->>'invalid'='1' and v->'counts'->>'created'='248','File-wide ambiguity and partial invalid rows do not prevent valid imports';
end;$$;
rollback;
select '250 synthetic customers and POS snapshots processed in three resumable batches; chunk/confirmation retries, revoked-actor recovery, source row positions, cross-chunk duplicates and partial failures safe; all fixtures rolled back' result;
