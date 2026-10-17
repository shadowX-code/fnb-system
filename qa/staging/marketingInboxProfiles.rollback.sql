-- Staging-only, transactionally rolled back; no provider calls, sends or connection mutation.
begin;
set local statement_timeout='8s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare c public.marketing_conversations; u uuid; claimed jsonb; result jsonb; denied boolean;
begin
 select * into c from public.marketing_conversations where id='cfd9a3ff-8e82-4b79-aa65-2224027ad073';
 select auth_user_id into u from public.employees where id='9f44daf9-9f87-4129-bc71-55c082cf8782';
 assert c.id is not null and u is not null,'Verified Staging fixture unavailable';
 delete from marketing_private.inbox_profiles where conversation_id=c.id;
 denied:=false;begin perform public.marketing_inbox_profile_claim(c.id,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;assert denied,'Unauthorized identity material denied';
 claimed:=public.marketing_inbox_profile_claim(c.id,u);assert claimed ? 'lease','Initial profile lease';
 assert not (public.marketing_inbox_profile_claim(c.id,u) ? 'lease'),'Concurrent request cannot duplicate a profile API read';
 denied:=false;begin perform public.marketing_inbox_profile_finish(c.id,gen_random_uuid(),c.connection_generation,'{}','{}');exception when others then denied:=true;end;assert denied,'Wrong lease rejected';
 denied:=false;begin perform public.marketing_inbox_profile_finish(c.id,(claimed->>'lease')::uuid,c.connection_generation+1,'{}','{}');exception when others then denied:=true;end;assert denied,'Changed generation rejected';
 denied:=false;begin perform public.marketing_inbox_profile_finish(c.id,(claimed->>'lease')::uuid,c.connection_generation,'{"avatar_url":"https://attacker.invalid/a"}','{"status":"resolved"}');exception when others then denied:=true;end;assert denied,'Untrusted avatar rejected';
 result:=public.marketing_inbox_profile_finish(c.id,(claimed->>'lease')::uuid,c.connection_generation,'{"display_name":"Disposable Rollback Fixture","avatar_url":"https://cdn.fbcdn.net/profile.jpg"}','{"status":"resolved","http_status":200}');
 assert result->>'display_name'='Disposable Rollback Fixture' and result->>'available'='true','Verified evidence projected';
 assert not (public.marketing_inbox_profile_claim(c.id,u) ? 'lease'),'Cached reads do not repeat provider work';
 update marketing_private.inbox_profiles set refresh_after=now()-interval '1 second' where conversation_id=c.id;
 claimed:=public.marketing_inbox_profile_claim(c.id,u);
 result:=public.marketing_inbox_profile_finish(c.id,(claimed->>'lease')::uuid,c.connection_generation,'{}','{"status":"denied","http_status":400,"graph_code":10,"message":"Provider denies profile access"}');
 assert result->>'display_name'='Disposable Rollback Fixture' and result->>'avatar_url'='https://cdn.fbcdn.net/profile.jpg','Later errors preserve verified identity';
 assert result#>>'{diagnostic,graph_code}'='10','Failure evidence retained';
 assert not (public.marketing_inbox_profile_claim(c.id,u) ? 'lease'),'Denials are backed off';
 assert (select refresh_after>now()+interval '23 hours' from marketing_private.inbox_profiles where conversation_id=c.id),'Provider denial daily bound';
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',u)::text,true);
 result:=public.marketing_inbox_detail(c.id);
 assert result#>>'{conversation,customer_profile,display_name}'='Disposable Rollback Fixture','Detail canonical projection';
 result:=public.marketing_inbox_read(c.organization_id,c.brand_id);
 assert exists(select 1 from jsonb_array_elements(result->'rows') x where x->>'id'=c.id::text and x#>>'{customer_profile,display_name}'='Disposable Rollback Fixture'),'List canonical projection';
 denied:=false;begin perform public.marketing_inbox_profile_claim(c.id,u);exception when insufficient_privilege then denied:=true;end;assert denied,'Authenticated cannot claim service authority';
 assert not has_table_privilege('authenticated','marketing_private.inbox_profiles','SELECT'),'No client private profile-table access';
 assert not has_function_privilege('anon','public.marketing_inbox_profile_next()','EXECUTE'),'No anonymous historical queue access';
 assert not has_function_privilege('authenticated','marketing_private.inbox_profile(uuid)','EXECUTE'),'No direct profile scope bypass';
 assert (select count(*)=2 from pg_constraint where conrelid='marketing_private.inbox_profiles'::regclass and confdeltype='c'),'Conversation erasure and credential removal cascade';
end;$$;
rollback;
