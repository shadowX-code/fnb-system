-- Canonical Staging only; all identities, content and channel jobs roll back. No provider calls.
begin;
create temporary table deletion_qa(key text primary key,id uuid);
grant select,insert on deletion_qa to authenticated;
do $setup$
declare u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();foreign_b uuid:=gen_random_uuid();r uuid:=gen_random_uuid();fb uuid:=gen_random_uuid();ig uuid:=gen_random_uuid();a uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,aud,role) values(u,'deletion-'||u||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_deletion_'||r,true,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' and code<>'marketing_content.approve';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Content Deletion','deletion-'||u||'@example.invalid',r,true,'active',true,'Management');
 insert into public.organizations(id,name) values(o,'QA Content Deletion');
 insert into public.organization_memberships(organization_id,employee_id) values(o,e);
 insert into public.brands(id,organization_id,name) values(b,o,'QA Authorized Brand'),(foreign_b,o,'QA Other Brand');
 insert into public.marketing_role_scopes values(o,r,false);
 insert into public.marketing_role_brands values(o,r,b);
 insert into public.platform_member_brands(organization_id,employee_id,brand_id) values(o,e,b);
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by) values(a,o,b,'rollback-only.jpg','image/jpeg',100,'rollback-only/'||a,'ready',e);
 insert into public.marketing_connections(id,organization_id,brand_id,channel,provider_account_id,account_name,status,expires_at,capabilities,connected_by,connected_at,credential_generation) values
 (fb,o,b,'facebook','999999998881','Rollback Page','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["image"]}',e,now(),1),
 (ig,o,b,'instagram','999999998882','Rollback Instagram','test_authorized',now()+interval '1 day','{"publishing":true,"execution_enabled":true,"formats":["image"]}',e,now(),1);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token) values(fb,'rollback-only','{}'),(ig,'rollback-only','{}');
 insert into deletion_qa values('user',u),('employee',e),('org',o),('brand',b),('other_brand',foreign_b),('role',r),('fb',fb),('ig',ig),('asset',a);
end;$setup$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from deletion_qa where key='user'),'role','authenticated')::text,true);
do $lifecycle$
declare o uuid:=(select id from deletion_qa where key='org');b uuid:=(select id from deletion_qa where key='brand');a uuid:=(select id from deletion_qa where key='asset');c uuid;original jsonb;confirm jsonb;saved jsonb;d jsonb;p jsonb;result jsonb;request uuid;failed boolean;due timestamptz:=now()+interval '3 days';
begin
 original:=jsonb_build_object('title','QA No tricks, just treats','outlet_ids','[]'::jsonb,'publishing_plan','schedule','planned_at',due,'planned_timezone','Asia/Kuala_Lumpur','variants',jsonb_build_array(
  jsonb_build_object('channel','facebook','format','image','caption',E'No tricks, just treats\nFB original','asset_ids',jsonb_build_array(a)),
  jsonb_build_object('channel','instagram','format','image','caption',E'原始 IG caption\nNo tricks, just treats','asset_ids',jsonb_build_array(a))));
 saved:=public.marketing_content_command(gen_random_uuid(),'save',o,b,null,0,original);c:=(saved->>'id')::uuid;insert into deletion_qa values('content',c);
 confirm:=jsonb_build_object('confirm',true,'timezone','Asia/Kuala_Lumpur','scheduled_at',due,'accounts',jsonb_build_array(
  jsonb_build_object('channel','facebook','connection_id',(select id from deletion_qa where key='fb'),'provider_account_id','999999998881','generation',1),
  jsonb_build_object('channel','instagram','connection_id',(select id from deletion_qa where key='ig'),'provider_account_id','999999998882','generation',1)));
 saved:=public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,1,confirm);
 d:=public.marketing_content_detail(c)->'content';assert d->'lifecycle'->>'can_delete'='true';
 p:=jsonb_build_object('confirm',true,'expected_updated_at',d->>'updated_at');request:=gen_random_uuid();
 failed:=false;begin perform public.marketing_content_command(request,'cancel',o,b,c,1,'{}');exception when others then failed:=true;end;assert failed,'Deletion requires explicit confirmation';
 failed:=false;begin perform public.marketing_content_command(request,'cancel',o,b,c,1,p||jsonb_build_object('expected_updated_at',now()-interval '1 day'));exception when sqlstate '40001' then failed:=true;end;assert failed,'Changed schedule cannot reuse stale confirmation';
 result:=public.marketing_content_command(request,'cancel',o,b,c,1,p);assert result->>'status'='cancelled';
 assert public.marketing_content_command(request,'cancel',o,b,c,1,p)=result,'Exact delete retries are idempotent';
 assert public.marketing_content_management(o,b,now(),now()+interval '5 days','','','','date_desc','',1,20,'list',false,false)->>'total_count'='0','Default List excludes deleted content';
 assert public.marketing_content_management(o,b,now(),now()+interval '5 days','','','','date_desc','',1,20,'calendar',false,false)->>'total_count'='0','Default Calendar excludes deleted content';
 assert public.marketing_content_management(o,b,now(),now()+interval '5 days','','','','date_desc','',1,20,'calendar',false,true)->>'total_count'='1','Show Deleted restores Calendar access';
 assert public.marketing_content_management(o,b,null,null,'','','cancelled','date_desc','',1,20,'list',false)->>'total_count'='1','Legacy explicit Deleted filter retains full history';
 assert public.marketing_content_management(o,b,null,null,'','','','date_desc','',1,20,'list',false)->>'total_count'='0','Existing reader signatures share the canonical default';
 d:=public.marketing_content_detail(c)->'content';assert d->'payload'=original and d->'lifecycle'->>'can_restore'='true','Cancelled captions/media remain exact and recoverable';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'save',o,b,c,1,original||'{"title":"Bypass restore"}');exception when others then failed:=true;end;assert failed,'Editing cannot bypass restoration';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'restore',o,(select id from deletion_qa where key='other_brand'),c,1,jsonb_build_object('confirm',true,'expected_updated_at',d->>'updated_at'));exception when others then failed:=true;end;assert failed,'Brand boundary enforced';
 insert into deletion_qa values('restore_request',gen_random_uuid());
end;$lifecycle$;
reset role;
create temporary table cancelled_before as select j.* from public.marketing_jobs j where content_id=(select id from deletion_qa where key='content');
set local role authenticated;
do $restore$
declare o uuid:=(select id from deletion_qa where key='org');b uuid:=(select id from deletion_qa where key='brand');c uuid:=(select id from deletion_qa where key='content');d jsonb;p jsonb;result jsonb;req uuid:=(select id from deletion_qa where key='restore_request');failed boolean;confirm jsonb;
begin
 d:=public.marketing_content_detail(c)->'content';p:=jsonb_build_object('confirm',true,'expected_updated_at',d->>'updated_at');
 result:=public.marketing_content_command(req,'restore',o,b,c,1,p);
 assert result->>'id'=c::text and result->>'revision'='2' and result->>'status'='draft' and result->>'approved_revision' is null and result->>'scheduled_at' is null,'Restore creates a fresh unapproved Draft on the original content ID';
 assert result->'payload'=d->'payload','Exact independent channel captions, media, original plan and schedule copied';
 assert public.marketing_content_command(req,'restore',o,b,c,1,p)=result,'Restoration replay cannot create another revision';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'restore',o,b,c,1,p);exception when sqlstate '40001' then failed:=true;end;assert failed,'Competing stale recovery cannot create a duplicate revision';
 assert jsonb_array_length(public.marketing_content_detail(c)->'content'->'channels')=2;
 confirm:=jsonb_build_object('confirm',true,'timezone','Asia/Kuala_Lumpur','scheduled_at',d->'payload'->>'planned_at','accounts',jsonb_build_array(
  jsonb_build_object('channel','facebook','connection_id',(select id from deletion_qa where key='fb'),'provider_account_id','999999998881','generation',1),
  jsonb_build_object('channel','instagram','connection_id',(select id from deletion_qa where key='ig'),'provider_account_id','999999998882','generation',1)));
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,2,confirm||'{"confirm":false}');exception when others then failed:=true;end;assert failed,'Restoration alone never authorizes execution';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,2,jsonb_set(confirm,'{accounts,1,generation}','2'));exception when others then failed:=true;end;assert failed,'Current credential generation required again';
 result:=public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,2,confirm);assert result->>'status'='scheduled';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'schedule_publish',o,b,c,2,confirm);exception when others then failed:=true;end;assert failed,'No duplicate submission jobs for a new request';
end;$restore$;
reset role;
do $preserve_and_risk$
declare c uuid:=(select id from deletion_qa where key='content');before_hash text;after_hash text;d jsonb;p jsonb;o uuid:=(select id from deletion_qa where key='org');b uuid:=(select id from deletion_qa where key='brand');
begin
 select md5(string_agg(md5(to_jsonb(j)::text),'' order by j.id)) into before_hash from cancelled_before j;
 select md5(string_agg(md5(to_jsonb(j)::text),'' order by j.id)) into after_hash from public.marketing_jobs j where content_id=c and revision=1;
 assert before_hash=after_hash,'Original cancelled jobs, authorization, attempts and timestamps stay byte-identical';
 assert (select count(*)=4 and count(*) filter(where state='cancelled')=2 and count(*) filter(where state='queued')=2 from public.marketing_jobs where content_id=c),'Only two fresh revision jobs exist';
 assert (select count(*)=2 from public.marketing_content_revisions where content_id=c),'No content copy or extra revision';
 assert (select count(*)=1 from public.marketing_events where content_id=c and action='restored_from_cancelled'),'Restoration provenance retained';
 assert (select count(*)=1 from public.marketing_assets where id=(select id from deletion_qa where key='asset') and state='ready'),'Original media retained';
 update public.marketing_jobs set state='leased',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 minute' where content_id=c and revision=2 and channel='facebook';
 assert marketing_private.content_lifecycle_actions((select x from public.marketing_content x where x.id=c))->>'can_delete'='false','In-flight claim prevents deletion';
 update public.marketing_jobs set state='cancelled',provider_state='{"pending":"publish"}' where content_id=c and revision=2 and channel='facebook';
 update public.marketing_content set status='cancelled' where id=c;
 d:=public.marketing_content_detail(c)->'content';assert d->>'status'='uncertain' and d->'lifecycle'->>'can_restore'='false','Uncertain cancelled evidence stays visible, never silently restored';
 assert public.marketing_content_management(o,b,null,null,'','','','date_desc','',1,20,'list',false,false)->>'total_count'='1','Ambiguous legacy cancellation cannot hide delivery evidence';
 update public.marketing_jobs set state='succeeded',provider_post_id='999999998881_999',provider_state='{"post_id":"999999998881_999"}' where content_id=c and revision=2 and channel='facebook';
 update public.marketing_jobs set state='cancelled' where content_id=c and revision=2 and channel='instagram';
 d:=public.marketing_content_detail(c)->'content';assert d->>'status'='published' and d->'lifecycle'->>'can_delete'='false' and d->'lifecycle'->>'can_restore'='false','Partial publication remains Published and cannot be deleted or duplicated';
 assert public.marketing_content_management(o,b,now(),now()+interval '5 days','','','','date_desc','',1,20,'calendar',false,false)->>'total_count'='1','Published sibling stays on Calendar';
 assert not has_function_privilege('authenticated','marketing_private.content_lifecycle_operation(public.marketing_content,uuid,text,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.marketing_content_management(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,integer,integer,text,boolean,boolean)','EXECUTE');
 assert position('for update of c skip locked' in pg_get_functiondef('public.marketing_claim_job()'::regprocedure))>0,'Claim and lifecycle retain the same Content-first lock boundary';
end;$preserve_and_risk$;
set local role authenticated;
do $deny_partial$
declare c uuid:=(select id from deletion_qa where key='content');o uuid:=(select id from deletion_qa where key='org');b uuid:=(select id from deletion_qa where key='brand');d jsonb;failed boolean;
begin
 d:=public.marketing_content_detail(c)->'content';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'cancel',o,b,c,2,jsonb_build_object('confirm',true,'expected_updated_at',d->>'updated_at'));exception when others then failed:=true;end;assert failed,'Server rejects whole-post deletion after partial success';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'restore',o,b,c,2,jsonb_build_object('confirm',true,'expected_updated_at',d->>'updated_at'));exception when others then failed:=true;end;assert failed,'Server rejects duplicate recovery of partial publication';
end;$deny_partial$;
reset role;
delete from public.role_permissions where role_id=(select id from deletion_qa where key='role') and permission_id in (select id from public.permissions where code in ('marketing_content.cancel','marketing_content.edit'));
set local role authenticated;
do $deny_permissions$
declare c uuid:=(select id from deletion_qa where key='content');o uuid:=(select id from deletion_qa where key='org');b uuid:=(select id from deletion_qa where key='brand');failed boolean;
begin
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'cancel',o,b,c,2,'{}');exception when insufficient_privilege then failed:=true;end;assert failed,'View/Publish does not grant Delete authority';
 failed:=false;begin perform public.marketing_content_command(gen_random_uuid(),'restore',o,b,c,2,'{}');exception when insufficient_privilege then failed:=true;end;assert failed,'View/Publish does not grant Restore/Edit authority';
end;$deny_permissions$;
reset role;
select 'PASS: delete/default visibility/history, exact restore/new revision, fresh two-channel authorization, generation/Brand/retry guards, unchanged terminal jobs, in-flight/uncertain/partial protections; rollback only' result;
rollback;
