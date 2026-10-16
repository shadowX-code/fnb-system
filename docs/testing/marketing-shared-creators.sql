-- Staging-only disposable authority/migration fixtures. All records roll back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare o uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();r uuid:=gen_random_uuid();rv uuid:=gen_random_uuid();
 u uuid:=gen_random_uuid();ub uuid:=gen_random_uuid();uv uuid:=gen_random_uuid();un uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid();eb uuid:=gen_random_uuid();ev uuid:=gen_random_uuid();en uuid:=gen_random_uuid();
 c jsonb;shared uuid;other uuid;foreign_creator uuid;result jsonb;d jsonb;v jsonb;p jsonb;req uuid:=gen_random_uuid();payload jsonb;cn uuid:=gen_random_uuid();ca uuid;lease uuid:=gen_random_uuid();old_req uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'shared-creators-'||u||'@example.invalid'),(ub,'shared-creators-'||ub||'@example.invalid'),(uv,'shared-creators-'||uv||'@example.invalid'),(un,'shared-creators-'||un||'@example.invalid');
 insert into public.roles(id,name,outlet_access_type) values(r,'Disposable Creator Manager '||r,'none'),(rv,'Disposable Creator Viewer '||rv,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code in ('marketing_workspace.access','marketing_creators.view','marketing_creators.manage');
 insert into public.role_permissions(role_id,permission_id) select rv,id from public.permissions where code in ('marketing_workspace.access','marketing_creators.view');
 insert into public.employees(id,full_name,role_id,auth_user_id,enable_system_login,access_state) values(e,'Creator A Manager',r,u,true,'active'),(eb,'Creator B Manager',r,ub,true,'active'),(ev,'Creator Viewer',rv,uv,true,'active'),(en,'Shared-only Creator Manager',r,un,true,'active');
 insert into public.organizations(id,name) values(o,'Disposable Shared Creator Tenant'),(foreign_org,'Foreign Creator Tenant');
 insert into public.brands(id,organization_id,name) values(a,o,'Disposable Creator Brand A'),(b,o,'Disposable Creator Brand B');
 insert into public.organization_memberships values(o,e),(o,eb),(o,ev),(o,en);
 insert into public.platform_member_brands values(o,e,a),(o,eb,b),(o,ev,a);
 perform set_config('request.jwt.claim.sub',ub::text,true);
 c:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,jsonb_build_object('name','Shared Person','notes','Public professional preferences','profiles',jsonb_build_array(jsonb_build_object('platform','instagram','handle','disposable.creator','profile_url','https://www.instagram.com/disposable.creator/'))));
 shared:=(c->>'id')::uuid;
 assert c->>'profile_scope'='organization' and c->>'notes'='Public professional preferences','Shared notes mutation projection';
 assert not exists(select 1 from public.marketing_creator_brands where creator_id=shared),'Profile create must not bind Brand';
 v:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_collaboration',null,0,jsonb_build_object('creator_id',shared,'title','B private contract','cash_cost',98765,'notes','SECRET BRAND B','deliverables','[]'::jsonb));
 update public.marketing_creators set notes='LEGACY PRIVATE BRAND B' where id=shared;
 -- Same Master is visible and editable by an authorized A manager, but no B commercial record is visible.
 perform set_config('request.jwt.claim.sub',u::text,true);
 d:=public.marketing_creator_workspace(o,a);
 assert jsonb_array_length(d->'creators')=1 and d->'creators'->0->>'editable'='true','Shared Master must not depend on Brand relations';
 assert d->'creators'->0->>'notes'='Public professional preferences','Shared notes missing';
 assert strpos(d::text,'SECRET BRAND B')=0 and strpos(d::text,'98765')=0 and strpos(d::text,'LEGACY PRIVATE BRAND B')=0,'Foreign commercial disclosure';
 assert d->'creators'->0->'collaboration_history'='[]'::jsonb,'Foreign worked-with history disclosure';
 payload:=jsonb_build_object('name','Shared Person','notes','Updated shared profile');
 c:=public.marketing_creator_command(req,o,null,'save_creator',shared,1,payload);
 assert c->>'notes'='Updated shared profile' and c->>'revision'='2','Shared edit with Manage Creators';
 result:=public.marketing_creator_command(req,o,null,'save_creator',shared,1,payload);
 assert c=result,'Shared retry must return same result';
 assert (select notes from public.marketing_creators where id=shared)='LEGACY PRIVATE BRAND B','Legacy note preservation';
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',shared,1,payload);raise exception 'Stale update accepted';exception when serialization_failure then null;end;
 v:=public.marketing_creator_command(gen_random_uuid(),o,a,'save_collaboration',null,0,jsonb_build_object('creator_id',shared,'title','A collaboration','cash_cost',12,'notes','A PRIVATE','deliverables','[]'::jsonb));
 d:=public.marketing_creator_workspace(o,null);
 assert jsonb_array_length(d->'creators')=1 and jsonb_array_length(d->'collaborations')=1,'Creator reused without duplicate; Brand scope preserved';
 assert d->'creators'->0->'collaboration_history'->0->>'brand_id'=a::text,'History must derive authorized actual Collaborations';
 assert d->'creators'->0->>'legacy_brand_notes' is null,'Ambiguous legacy note protected after another collaboration';
 -- Post identity is tenant unique. A cannot duplicate an external Post already recorded for B.
 perform set_config('request.jwt.claim.sub',ub::text,true);
 p:=public.marketing_creator_command(gen_random_uuid(),o,b,'save_post',null,0,jsonb_build_object('creator_id',shared,'url','https://www.instagram.com/p/DisposableSharedPost/','caption','B PRIVATE POST','confirm_link',true,'confirm_published',true));
 perform public.marketing_creator_command(gen_random_uuid(),o,b,'add_metrics',(p->>'id')::uuid,0,jsonb_build_object('metrics',jsonb_build_object('views',777777),'source_note','B PRIVATE EVIDENCE','captured_at',now()));
 perform set_config('request.jwt.claim.sub',u::text,true);
 result:=public.marketing_creator_post_preview(o,a,'https://www.instagram.com/p/DisposableSharedPost/');
 assert result->>'duplicate'='true' and result->>'duplicate_id' is null,'Duplicate guard must not disclose foreign Post identity';
 begin perform public.marketing_creator_command(gen_random_uuid(),o,a,'save_post',null,0,jsonb_build_object('creator_id',shared,'url','https://www.instagram.com/p/DisposableSharedPost/','caption','duplicate','confirm_link',true));raise exception 'Duplicate Post accepted';exception when unique_violation then null;end;
 d:=public.marketing_creator_workspace(o,null);assert strpos(d::text,'B PRIVATE POST')=0 and strpos(d::text,'777777')=0,'Foreign Post disclosure';
 -- Names are not dedup evidence; exact platform identity is.
 c:=public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',null,0,jsonb_build_object('name','Shared Person'));other:=(c->>'id')::uuid;
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_account',null,0,jsonb_build_object('creator_id',other,'platform','instagram','handle','disposable.creator','profile_url','https://www.instagram.com/disposable.creator/'));raise exception 'Duplicate social identity accepted';exception when unique_violation then null;end;
 -- Old replay receipts must not make pre-sharing private notes newly visible.
 payload:=jsonb_build_object('name','Historical request');
 insert into public.marketing_requests values(old_req,e,md5(jsonb_build_array(o,null,'save_creator',shared,2,payload)::text),jsonb_build_object('id',shared,'notes','OLD PRIVATE RECEIPT'));
 result:=public.marketing_creator_command(old_req,o,null,'save_creator',shared,2,payload);
 assert result->>'notes'='' and strpos(result::text,'OLD PRIVATE RECEIPT')=0,'Legacy replay leak';
 -- A stale Brand-token worker cannot overwrite retained verified evidence after migration.
 select id into ca from public.marketing_creator_accounts where creator_id=shared;
 perform set_config('request.jwt.claim.role','service_role',true);
 update public.marketing_creator_accounts set followers=12,followers_source='meta_instagram_business_discovery',followers_captured_at='2026-10-01T00:00:00Z',followers_lease=lease,followers_lease_until=now()+interval '1 minute' where id=ca;
 assert public.marketing_creator_followers_finish(ca,lease,null,1,999,'meta_instagram_business_discovery','ready',null),'Stale worker completion rejected transaction';
 assert (select followers=12 and followers_captured_at='2026-10-01T00:00:00Z' and followers_sync_status='unavailable' and followers_sync_reason='organization_profile_authorization_required' from public.marketing_creator_accounts where id=ca),'Stale Brand evidence overwrote saved followers';
 perform set_config('request.jwt.claim.role','authenticated',true);
 -- Explicit tenant membership/view authority does not imply Brand access.
 perform set_config('request.jwt.claim.sub',un::text,true);
 d:=public.marketing_creator_workspace(o,null);assert jsonb_array_length(d->'creators')=2 and d->'collaborations'='[]'::jsonb and d->'posts'='[]'::jsonb,'Shared-only member boundary';
 begin perform public.marketing_creator_workspace(o,b);raise exception 'Brand scope bypass';exception when insufficient_privilege then null;end;
 perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',other,1,jsonb_build_object('name','Renamed shared profile'));
 perform set_config('request.jwt.claim.sub',uv::text,true);
 assert jsonb_array_length(public.marketing_creator_directory(o,null)->'creators')=2,'Viewer shared profile read';
 begin perform public.marketing_creator_command(gen_random_uuid(),o,null,'save_creator',other,2,jsonb_build_object('name','Forbidden'));raise exception 'Viewer edited shared profile';exception when insufficient_privilege then null;end;
 begin perform public.marketing_creator_directory(foreign_org,null);raise exception 'Foreign tenant read';exception when insufficient_privilege then null;end;
 assert public.marketing_creator_profile_connection(o)->>'eligible'='false','Brand tokens must not qualify for shared enrichment';
 assert not has_table_privilege('authenticated','public.marketing_creators','SELECT') and not has_table_privilege('authenticated','public.marketing_creator_collaborations','SELECT'),'Direct table bypass';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.marketing_creator_directory(o,null);raise exception 'Anonymous read';exception when insufficient_privilege then null;end;
end;$$;
rollback;
