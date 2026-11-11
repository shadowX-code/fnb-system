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
do $qa$
declare o uuid:=(select id from marketing_qa_ids where key='org'); b uuid:=(select id from marketing_qa_ids where key='brand');
 c jsonb; a jsonb; v jsonb; p jsonb; w jsonb; payload jsonb; denied boolean; entry uuid;
 uid text:='5dcaaad4000000000100911c'; note text:='6a8fb7f30000000037034698';
 profile text:='https://xiaohongshu.com/user/profile/'||uid||'?xsec_token=a%2Bb%3D&xsec_source=app_share';
 original text:='https://www.xiaohongshu.com/user/profile/'||uid||'/'||note||'?source=share&xsec_token=b%2Bc';
begin
 c:=marketing_creator_command(gen_random_uuid(),o,b,'save_creator',null,0,'{"name":"Synthetic XHS QA"}');
 a:=marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','xhs','profile_url',profile));
 assert a->>'profile_url'=profile and a->>'external_id'=uid and a->>'followers' is null;
 w:=marketing_creator_directory(o,null);
 assert exists(select 1 from jsonb_array_elements(w->'accounts') x where x->>'id'=a->>'id' and x->>'profile_url'=profile),'Reopen preserves profile link';
 denied:=false;begin
  perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','xhs','profile_url','https://www.xiaohongshu.com/user/profile/'||uid||'?xsec_token=different'));
 exception when unique_violation then denied:=true;end;assert denied,'Same profile ID across URL variants is reserved';
 denied:=false;begin
  perform marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',c->>'id','platform','xhs','profile_url','https://xiaohongshu.com.evil.invalid/user/profile/'||uid));
 exception when raise_exception then denied:=true;end;assert denied;
 v:=marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,jsonb_build_object('title','Synthetic XHS collaboration','creator_id',c->>'id','status','planned','cost_state','estimated','deliverables',jsonb_build_array(jsonb_build_object('platform','xhs','title','Synthetic note','content_type','image','status','pending'))));
 entry:=(v->'deliverables'->0->>'id')::uuid;
 assert entry is not null;
 payload:=jsonb_build_object('url','https://www.xiaohongshu.com/explore/'||note,'original_url',original,'creator_id',c->>'id','collaboration_id',v->>'id','deliverable_id',entry,'content_type','image','confirm_link',true,'confirm_published',true);
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,payload);
 exception when raise_exception then if sqlerrm like 'Choose an active Collaboration%' then denied:=true;else raise;end if;end;assert denied,'Unbound XHS Post cannot save';
 payload:=payload||jsonb_build_object('account_id',a->>'id');
 p:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,payload);
 assert p->>'original_url'=original and p->>'post_key'=note and p->>'platform'='xhs' and p->>'publication_confirmed_at' is not null;
 assert p->>'account_id'=a->>'id' and p->>'creator_id'=c->>'id' and p->>'collaboration_id'=v->>'id' and p->>'brand_id'=b::text and p->>'deliverable_id'=entry::text;
 w:=marketing_creator_workspace(o,b);
 assert exists(select 1 from jsonb_array_elements(w->'posts') x where x->>'id'=p->>'id' and x->>'original_url'=original);
 assert exists(select 1 from jsonb_array_elements(w->'collaborations') x where x->>'id'=v->>'id' and x->>'status'='published'),'Collaboration reaches Published from confirmed evidence';
 assert marketing_creator_post_preview(o,b,original)->>'duplicate_id'=p->>'id';
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,payload);
 exception when unique_violation then denied:=true;end;assert denied;
 denied:=false;begin perform marketing_creator_command(gen_random_uuid(),o,(select id from marketing_qa_ids where key='other_brand'),'save_post',null,0,payload);
 exception when insufficient_privilege then denied:=true;end;assert denied,'Out-of-scope Brand is denied';
 w:=marketing_creator_command(gen_random_uuid(),o,b,'save_post',(p->>'id')::uuid,(p->>'revision')::int,payload||jsonb_build_object('original_url','https://xhslink.com/m/test-fixture?source=share'));
 assert w->>'id'=p->>'id' and w->>'post_key'=note and w->>'account_id'=a->>'id' and w->>'publication_confirmed_at'=p->>'publication_confirmed_at','Share navigation changes preserve history';
end;
$qa$;
select 'XHS profile and Collaboration Post round trip, duplicates, permission, history passed' as result;
rollback;
