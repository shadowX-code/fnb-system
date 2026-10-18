-- L3 isolated fixtures; every identity/permission/record rolls back. No provider calls.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$declare o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();other_brand uuid:=gen_random_uuid();u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();r uuid:=gen_random_uuid();c jsonb;foreign_c jsonb;a jsonb;tiktok jsonb;req uuid;result jsonb;payload jsonb;details text;before_count int;begin
 insert into auth.users(id,email) values(u,'qa-avatar-'||u||'@example.invalid');
 insert into public.roles(id,name,outlet_access_type) values(r,'Disposable Creator Avatar '||r,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code in ('marketing_workspace.access','marketing_creators.view','marketing_creators.manage');
 insert into public.employees(id,full_name,role_id,auth_user_id,enable_system_login,access_state) values(e,'Disposable Creator Avatar',r,u,true,'active');
 insert into public.organizations(id,name) values(o,'Disposable Avatar contract');
 insert into public.brands(id,organization_id,name) values(b,o,'Disposable Avatar brand'),(other_brand,o,'Inaccessible Avatar brand');
 insert into public.organization_memberships values(o,e);
 insert into public.platform_member_brands values(o,e,b);
 perform set_config('request.jwt.claim.sub',u::text,true);
 c:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,'{"name":"Avatar Fixture"}');
 foreign_c:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,'{"name":"Other Fixture"}');

 payload:=jsonb_build_object('creator_id',c->>'id','platform','xhs','profile_url','https://xiaohongshu.com/user/profile/5DCAAAD4000000000100911C/?source=share');
 req:=gen_random_uuid();a:=public.marketing_creator_command(req,o,null,'save_account',null,0,payload);
 assert a->>'external_id'='5dcaaad4000000000100911c' and a->>'handle'='' and a->>'followers' is null,'XHS identity without enrichment failed';
 assert a=public.marketing_creator_command(req,o,null,'save_account',null,0,payload),'Idempotent request changed';
 payload:=payload||jsonb_build_object('profile_url','https://www.xiaohongshu.com/user/profile/5dcaaad4000000000100911c');
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload);raise exception 'Same Creator duplicate accepted';exception when unique_violation then get stacked diagnostics details=PG_EXCEPTION_DETAIL;result:=details::jsonb;assert result->>'kind'='creator_account_conflict' and (result->>'same_creator')::boolean and result->>'account_id'=a->>'id','Same Creator target missing';end;
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload||jsonb_build_object('creator_id',foreign_c->>'id'));raise exception 'Cross Creator duplicate accepted';exception when unique_violation then get stacked diagnostics details=PG_EXCEPTION_DETAIL;result:=details::jsonb;assert not (result->>'same_creator')::boolean and result->>'creator_id'=c->>'id' and result->>'creator_name'=c->>'name','Cross Creator target missing';end;
 -- An edit with the same identity remains an ordinary revisioned save.
 a:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',(a->>'id')::uuid,(a->>'revision')::int,payload);
 assert (a->>'revision')::int=2,'Existing profile edit failed';
 -- Distinct XHS IDs must remain distinct, with no unavailable follower fabrication.
 tiktok:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload||jsonb_build_object('profile_url','https://www.xiaohongshu.com/user/profile/5dcaaad4000000000100911d'));
 assert tiktok->>'id'<>a->>'id','Distinct XHS accounts conflated';
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload||jsonb_build_object('followers',100));raise exception 'Manual followers accepted';exception when raise_exception then assert sqlerrm='Followers are system-sourced only.','Unexpected follower error';end;
 select count(*) into before_count from public.marketing_creators where organization_id=o;
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,jsonb_build_object('name','Rolled back','profiles',jsonb_build_array(payload)));raise exception 'Nested duplicate accepted';exception when unique_violation then get stacked diagnostics details=PG_EXCEPTION_DETAIL;assert details::jsonb->>'kind'='creator_account_conflict','Nested conflict lost';end;
 assert before_count=(select count(*) from public.marketing_creators where organization_id=o),'Partial Creator persisted';
 a:=public.marketing_creator_command(gen_random_uuid(),o,null,'archive_account',(a->>'id')::uuid,(a->>'revision')::int,jsonb_build_object('creator_id',c->>'id'));
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload);raise exception 'Archived identity recycled';exception when unique_violation then get stacked diagnostics details=PG_EXCEPTION_DETAIL;assert (details::jsonb->>'archived')::boolean,'Archived conflict missing';end;
 assert (select creator_id::text from public.marketing_creator_accounts where id=(a->>'id')::uuid)=c->>'id','Association changed';
 delete from public.role_permissions where role_id=r and permission_id in (select id from public.permissions where code='marketing_creators.manage');
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,payload);raise exception 'Unauthorized duplicate lookup accepted';exception when insufficient_privilege then null;end;
end;$$;
rollback;
