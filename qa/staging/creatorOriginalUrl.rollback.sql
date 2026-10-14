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
do $$declare o uuid:=(select id from marketing_qa_ids where key='org');b uuid:=(select id from marketing_qa_ids where key='brand');p jsonb;q jsonb;w jsonb;id text:='6a8fb7f30000000037034698';url text;payload jsonb;req uuid:=gen_random_uuid();denied boolean;
begin
 url:='https://www.xiaohongshu.com/discovery/item/'||id||'?source=webshare&xhsshare=pc_web&xsec_token=a%2Bb%2Fc%3D%26&xsec_source=pc_share&custom=%252F';
 payload:=jsonb_build_object('url','https://www.xiaohongshu.com/explore/'||id,'original_url',url,'caption','QA URL roundtrip','confirm_link',true,'confirm_published',true);
 p:=marketing_creator_command(req,o,b,'save_post',null,0,payload);
 assert p->>'post_key'=id and p->>'original_url'=url and position('xsec_token' in p->>'canonical_url')=0;
 assert marketing_creator_command(req,o,b,'save_post',null,0,payload)=p,'Same request replays exact result';
 w:=marketing_creator_workspace(o,b);select x into q from jsonb_array_elements(w->'posts') x where x->>'id'=p->>'id';assert q->>'original_url'=url,'Saved read model retains encoded query bytes';
 q:=marketing_creator_post_preview(o,b,url);assert (q->>'duplicate')::boolean and q->>'duplicate_id'=p->>'id';
 q:=marketing_creator_post_preview(o,b,'https://www.xiaohongshu.com/explore/'||id||'?xsec_token=different');assert q->>'duplicate_id'=p->>'id','Explore/discovery identity agrees';
 q:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',(p->>'id')::uuid,(p->>'revision')::int,payload||jsonb_build_object('original_url','https://xhslink.com/o/8ztP9aMRnzT'));
 assert q->>'id'=p->>'id' and q->>'post_key'=id and q->>'original_url'='https://xhslink.com/o/8ztP9aMRnzT','Resolved short original shares canonical identity';
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('url','https://xhslink.com/o/Unresolved','original_url','https://xhslink.com/o/Unresolved','confirm_link',true,'confirm_published',true));exception when others then if sqlerrm like 'Resolve the Xiaohongshu%' then denied:=true;else raise;end if;end;assert denied;
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',(q->>'id')::uuid,(q->>'revision')::int,payload||jsonb_build_object('original_url','https://www.xiaohongshu.com/explore/68523c3c0000000012004bae'));exception when others then if sqlerrm like 'Original URL belongs to another Post%' then denied:=true;else raise;end if;end;assert denied;
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',(q->>'id')::uuid,(q->>'revision')::int,payload||jsonb_build_object('original_url','https://www.xiaohongshu.com.evil.test/explore/'||id));exception when others then denied:=true;end;assert denied;
 q:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',(q->>'id')::uuid,(q->>'revision')::int,payload);
 assert q->>'original_url'=url and q->>'caption'='QA URL roundtrip';
 -- Unique identity remains authoritative; URL variants never create a second Post.
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,payload||jsonb_build_object('url',url));exception when unique_violation then denied:=true;end;assert denied;
 insert into marketing_qa_ids values('post',(q->>'id')::uuid);
 denied:=false;begin perform marketing_creator_workspace(o,(select qa.id from marketing_qa_ids qa where qa.key='other_brand'));exception when insufficient_privilege then denied:=true;end;assert denied;
end;$$;
reset role;
do $$begin
 assert (select count(*) from marketing_creator_posts where organization_id=(select id from marketing_qa_ids where key='org') and platform='xhs')=1;
 assert not exists(select 1 from marketing_creator_metric_snapshots where post_id=(select id from marketing_qa_ids where key='post')),'No fabricated metrics';
 assert not exists(select 1 from marketing_events where organization_id=(select id from marketing_qa_ids where key='org') and details::text like '%xsec_token%'),'Share tokens absent from event analytics';
end;$$;
rollback;
select 'PASS: original URL byte-preserving save/read/edit/idempotency, encoded query roundtrip, short/discovery/explore stable identity, duplicate and unsafe/mismatched URL denial, Brand isolation, no fabricated metrics or URL tokens in events; disposable fixtures rolled back' verification;
