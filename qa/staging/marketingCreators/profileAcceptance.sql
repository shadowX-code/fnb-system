begin;
do $$
declare org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1';brand uuid:='88718f61-2915-42ef-b62f-5e6e2fe5b3eb';other_brand uuid:='88a73473-5dc7-471c-b484-fe247cf0f660';
 actor uuid:='9f44daf9-9f87-4129-bc71-55c082cf8782';c jsonb;x jsonb;a jsonb;p jsonb;payload jsonb;req uuid:=gen_random_uuid();denied boolean;before_count integer;
begin
 perform set_config('request.jwt.claim.sub',(select auth_user_id::text from public.employees where id=actor),true);
 assert marketing_private.creator_profile('{"platform":"facebook","profile_url":"https://m.facebook.com/profile.php?id=123456&tracking=1"}')->>'external_id'='123456';
 assert marketing_private.creator_profile('{"platform":"xhs","profile_url":"https://xiaohongshu.com/user/profile/ABCDEF?source=1"}')->>'external_id'='abcdef';
 denied:=false;begin perform marketing_private.creator_profile('{"platform":"instagram","profile_url":"https://instagram.com.evil.test/person"}');exception when others then denied:=true;end;assert denied;
 payload:=jsonb_build_object('name','Disposable atomic Creator refinement','profiles',jsonb_build_array(
 jsonb_build_object('platform','instagram','profile_url','https://instagram.com/feedx_profile_qa_one/?utm=1','display_name','First alias','followers',0,'followers_captured_at',now()-interval '1 hour'),
 jsonb_build_object('platform','instagram','profile_url','https://instagram.com/feedx_profile_qa_two/','display_name','Second alias'),
 jsonb_build_object('platform','tiktok','profile_url','https://www.tiktok.com/@feedx_profile_qa_three','display_name','Third alias')));
 c:=public.marketing_creator_command(req,org,brand,'save_creator',null,0,payload);
 x:=public.marketing_creator_command(req,org,brand,'save_creator',null,0,payload);assert c=x;
 assert (select count(*) from public.marketing_creator_accounts where creator_id=(c->>'id')::uuid)=3;
 select to_jsonb(t) into a from public.marketing_creator_accounts t where creator_id=(c->>'id')::uuid and handle='feedx_profile_qa_one';
 assert a->>'followers'='0' and (a->>'identity_verified')::boolean=false;
 select count(*) into before_count from public.marketing_creators;
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),org,brand,'save_creator',null,0,payload||'{"name":"Duplicate identity"}');exception when unique_violation then denied:=true;end;assert denied;
 assert (select count(*) from public.marketing_creators)=before_count;
 c:=public.marketing_creator_command(gen_random_uuid(),org,other_brand,'share_creator',(c->>'id')::uuid,(c->>'revision')::integer,'{}');
 assert (select count(*) from public.marketing_creator_brands where creator_id=(c->>'id')::uuid)=2;
 p:=public.marketing_creator_command(gen_random_uuid(),org,brand,'save_post',null,0,jsonb_build_object('url','https://www.instagram.com/p/FeedxQaAtomic/','creator_id',c->>'id','account_id',a->>'id','confirm_link',true));
 assert p->>'published_at' is null and p->>'match_method'='manual_confirmed';
 a:=public.marketing_creator_command(gen_random_uuid(),org,brand,'archive_account',(a->>'id')::uuid,(a->>'revision')::integer,a);
 assert (a->>'archived')::boolean;
 assert (select account_id from public.marketing_creator_posts where id=(p->>'id')::uuid)=(a->>'id')::uuid;
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),org,brand,'save_post',null,0,jsonb_build_object('url','https://www.instagram.com/p/FeedxQaOther/','creator_id',c->>'id','account_id',a->>'id','confirm_link',true));exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.marketing_creator_command(gen_random_uuid(),org,brand,'save_account',(a->>'id')::uuid,1,a);exception when serialization_failure then denied:=true;end;assert denied;
 assert not has_table_privilege('authenticated','public.marketing_creator_accounts','SELECT');
 assert not has_function_privilege('anon','marketing_private.creator_profile(jsonb)','EXECUTE');
end;$$;
select 'PASS: atomic multi-profile creation, same-platform aliases, normalized URLs, observed zero, exact duplicate rollback, shared brands, archived-account history/new-link protection, stale revisions and protected grants' as verification;
rollback;
