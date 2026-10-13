-- Canonical Staging L3 rehearsal; disposable data and grants always roll back.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from public.employees where id='9f44daf9-9f87-4129-bc71-55c082cf8782'),'role','authenticated')::text,true);
create temporary table qa_member_access_ids(k text primary key,id uuid);
grant select on qa_member_access_ids to authenticated;
do $$declare org uuid:=gen_random_uuid();brand_a uuid:=gen_random_uuid();brand_b uuid:=gen_random_uuid();role_id uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();member_a uuid:=gen_random_uuid();member_b uuid:=gen_random_uuid();admin_uid uuid:=gen_random_uuid();uid_a uuid:=gen_random_uuid();uid_b uuid:=gen_random_uuid();begin
 insert into auth.users(id,email) values(admin_uid,'qa-team-admin-'||admin_uid||'@example.invalid'),(uid_a,'qa-team-a-'||uid_a||'@example.invalid'),(uid_b,'qa-team-b-'||uid_b||'@example.invalid');
 insert into public.roles(id,name,outlet_access_type) values(role_id,'Disposable Team Brand Contract '||role_id,'none');
 insert into public.role_permissions(role_id,permission_id) select role_id,p.id from public.permissions p where p.code like 'marketing_%' or p.code='platform_organizations.manage';
 insert into public.employees(id,full_name,role_id,auth_user_id,enable_system_login,access_state) values(admin_id,'Disposable Team Administrator',role_id,admin_uid,true,'active'),(member_a,'Disposable Team A',role_id,uid_a,true,'active'),(member_b,'Disposable Team B',role_id,uid_b,true,'active');
 insert into public.organizations(id,name) values(org,'Disposable Member Brand Contract');
 insert into public.brands(id,organization_id,name) values(brand_a,org,'Disposable Brand A'),(brand_b,org,'Disposable Brand B');
 insert into public.organization_memberships values(org,admin_id),(org,member_a),(org,member_b);
 update public.platform_member_brand_scopes set all_brands=true where organization_id=org and employee_id=admin_id;
 insert into qa_member_access_ids values('org',org),('a',brand_a),('b',brand_b),('admin',admin_id),('member_a',member_a),('member_b',member_b),('admin_uid',admin_uid),('uid_a',uid_a),('uid_b',uid_b);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='admin_uid'),'role','authenticated')::text,true);
do $$declare org uuid:=(select id from qa_member_access_ids where k='org');a uuid:=(select id from qa_member_access_ids where k='a');b uuid:=(select id from qa_member_access_ids where k='b');m1 uuid:=(select id from qa_member_access_ids where k='member_a');m2 uuid:=(select id from qa_member_access_ids where k='member_b');result jsonb;request uuid:=gen_random_uuid();denied boolean:=false;begin
 result:=public.platform_member_brand_access(org,m1,array[a],1,request);
 if result<>public.platform_member_brand_access(org,m1,array[a],1,request) then raise exception 'Retry result changed';end if;
 perform public.platform_member_brand_access(org,m2,array[b],1,gen_random_uuid());
 begin perform public.platform_member_brand_access(org,m1,array[b],1,gen_random_uuid());exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Stale scope update accepted';end if;
 denied:=false;begin perform public.platform_member_brand_access(org,m1,array[b],2,request);exception when others then denied:=true;end;if not denied then raise exception 'Changed retry accepted';end if;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='uid_a'),'role','authenticated')::text,true);
do $$declare org uuid:=(select id from qa_member_access_ids where k='org');a uuid:=(select id from qa_member_access_ids where k='a');b uuid:=(select id from qa_member_access_ids where k='b');ctx jsonb;denied boolean;begin
 ctx:=public.marketing_brand_context();
 if jsonb_array_length(ctx->'brands')<>1 or ctx->'brands'->0->>'id'<>a::text then raise exception 'Member A selector isolation failed';end if;
 if jsonb_array_length(public.platform_brand_management_read()->'brands')<>1 then raise exception 'Brand Master scope isolation failed';end if;
 denied:=false;begin perform public.platform_brand_command('set_brand_status',jsonb_build_object('id',b,'expected_revision',1,'is_active',false,'confirmed',true),null);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Brand Master cross-brand mutation allowed';end if;
 perform public.marketing_read(org,a,'settings',null,null,1,20);
 denied:=false;begin perform public.marketing_read(org,b,'settings',null,null,1,20);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand settings allowed';end if;
 denied:=false;begin perform public.marketing_planner_read(org,date_trunc('month',now())::date,b);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand Planner allowed';end if;
 denied:=false;begin perform public.marketing_creators_read(org,b);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand Creators allowed';end if;
 denied:=false;begin perform public.marketing_customers_read(org,b,'{}',1,20);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand CRM allowed';end if;
 denied:=false;begin perform public.marketing_inbox_read(org,b,'','','',1,20,'',false);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand Inbox allowed';end if;
 denied:=false;begin perform public.marketing_ads_read(org,b,current_date-7,current_date);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Cross-brand Ads allowed';end if;
 denied:=false;begin perform public.platform_member_brand_access(org,(select id from qa_member_access_ids where k='member_a'),array[a,b],2,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Self escalation allowed';end if;
 denied:=false;begin perform public.platform_member_brand_access(org,(select id from qa_member_access_ids where k='member_b'),array[a],2,gen_random_uuid());exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Overwriting hidden Brand scope allowed';end if;
 denied:=false;begin perform public.marketing_set_role_scope(org,(select role_id from public.employees where id=(select id from qa_member_access_ids where k='member_a')),true,'{}');exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Legacy role scope still mutable';end if;
 denied:=false;begin perform 1 from public.platform_member_brands;exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Direct scope table exposed';end if;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='uid_b'),'role','authenticated')::text,true);
do $$declare ctx jsonb:=public.marketing_brand_context();begin
 if jsonb_array_length(ctx->'brands')<>1 or ctx->'brands'->0->>'id'<>(select id::text from qa_member_access_ids where k='b') then raise exception 'Same-Role Member B isolation failed';end if;
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='admin_uid'),'role','authenticated')::text,true);
do $$declare org uuid:=(select id from qa_member_access_ids where k='org');begin
 perform public.platform_member_brand_access(org,(select id from qa_member_access_ids where k='member_a'),'{}',2,gen_random_uuid());
end;$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='uid_a'),'role','authenticated')::text,true);
do $$declare denied boolean:=false;begin
 if jsonb_array_length(public.marketing_brand_context()->'brands')<>0 then raise exception 'Revocation selector retained Brand';end if;
 begin perform public.marketing_read((select id from qa_member_access_ids where k='org'),(select id from qa_member_access_ids where k='a'),'content',null,null,1,20);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Revocation read still authorized';end if;
end;$$;
reset role;
do $$declare m1 uuid:=(select id from qa_member_access_ids where k='member_a');m2 uuid:=(select id from qa_member_access_ids where k='member_b');org uuid:=(select id from qa_member_access_ids where k='org');a uuid:=(select id from qa_member_access_ids where k='a');b uuid:=(select id from qa_member_access_ids where k='b');j public.marketing_jobs;begin
 if marketing_private.actor_allowed(m1,org,a,'marketing_content.execute') or marketing_private.actor_allowed(m1,org,a,'marketing_inbox.send') or marketing_private.actor_allowed(m1,org,a,'marketing_ads.execute') then raise exception 'Revoked worker actor authorized';end if;
 if not marketing_private.actor_allowed(m2,org,b,'marketing_content.execute') then raise exception 'Other member lost worker authorization';end if;
 if marketing_private.creative_assignee_allowed(org,a,m1) or not marketing_private.creative_assignee_allowed(org,b,m2) then raise exception 'Assignee isolation failed';end if;
 if marketing_private.ads_org_allowed(m2,org,'marketing_ads.view') or marketing_private.drive_admin(m2,org) then raise exception 'Restricted member bypassed Brand isolation through tenant adapter';end if;
 j.authorized_by:=m1;j.organization_id:=org;j.brand_id:=a;j.external_authorized_at:=now();if marketing_private.job_authorized(j) then raise exception 'Revoked scheduled publishing authorized';end if;
 -- Dormant login must not erase configured assignments in the management read model.
 update public.employees set is_active=false where id=m2;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from qa_member_access_ids where k='admin_uid'),'role','authenticated')::text,true);
 if not exists(select 1 from jsonb_array_elements(public.platform_team_brand_access(org)->'members') member where member->>'id'=m2::text and member->'brand_ids' ? b::text and member->>'access_active'='false') then raise exception 'Dormant configured assignments hidden';end if;
 if marketing_private.actor_allowed(m2,org,b,'marketing_content.execute') then raise exception 'Dormant actor gained execution';end if;
end;$$;
rollback;
select 'PASS: two same-Role members, independent scopes, cross-module reads, stale/retry guards, revocation, assignees and worker authorization; all fixtures rolled back' result;
