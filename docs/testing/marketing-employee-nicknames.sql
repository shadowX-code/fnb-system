-- Isolated Staging fixtures only; all employees, grants, tasks and notes roll back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();r uuid:=gen_random_uuid();
 u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();u3 uuid:=gen_random_uuid();
 e1 uuid:=gen_random_uuid();e2 uuid:=gen_random_uuid();e3 uuid:=gen_random_uuid();c uuid:=gen_random_uuid();t jsonb;d jsonb;row jsonb;v jsonb;
begin
 insert into auth.users(id,email) values(u1,'qa-nickname-'||u1||'@example.invalid'),(u2,'qa-nickname-'||u2||'@example.invalid'),(u3,'qa-nickname-'||u3||'@example.invalid');
 insert into public.roles(id,name,outlet_access_type) values(r,'Disposable Name Projection '||r,'none');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code like 'marketing_%' or code='platform_organizations.manage';
 insert into public.employees(id,full_name,nickname,role_id,auth_user_id,enable_system_login,access_state) values
 (e1,'Yap Hy fixture','Isaac Yap',r,u1,true,'active'),(e2,'Soo Kai Lin fixture',' Kai Lin ',r,u2,true,'active'),(e3,'Fallback Full Name','   ',r,u3,true,'active');
 insert into public.organizations(id,name) values(o,'Disposable Employee Names');
 insert into public.brands(id,organization_id,name) values(a,o,'Disposable Name Brand A'),(b,o,'Disposable Name Brand B');
 insert into public.organization_memberships values(o,e1),(o,e2),(o,e3);
 insert into public.platform_member_brands values(o,e1,a),(o,e1,b),(o,e2,a),(o,e3,a);
 insert into public.marketing_conversations(id,organization_id,brand_id,channel,title,assigned_to,created_by) values(c,o,a,'internal','External identity unchanged',e2,e1);
 insert into public.marketing_conversation_messages(conversation_id,kind,body,occurred_at,actor_employee_id,delivery_state) values(c,'note','Disposable internal note',now(),e2,'internal');
 perform set_config('request.jwt.claim.sub',u1::text,true);
 t:=public.marketing_planner_command(gen_random_uuid(),o,a,'create',null,0,jsonb_build_object('month','2026-10-01','title','Disposable named task','content_type','post','due_date','2026-10-16','assignee_id',e2));
 t:=public.marketing_planner_command(gen_random_uuid(),o,a,'block',(t->>'id')::uuid,1,jsonb_build_object('blocked',true,'blocker_owner',e3));
 d:=public.marketing_planner_read(o,'2026-10-01',a);
 select x into row from jsonb_array_elements(d->'tasks')x where x->>'id'=t->>'id';
 assert row->>'assignee_name'='Kai Lin' and row->>'blocker_owner_name'='Fallback Full Name','Task names/fallback mismatch';
 assert not exists(select 1 from jsonb_array_elements(row->'history')h where h->>'actor'<>'Isaac Yap'),'History actor name mismatch';
 assert exists(select 1 from jsonb_array_elements(d->'members')m where m->>'id'=e1::text and m->>'name'='Isaac Yap'),'New Task member nickname absent';
 assert exists(select 1 from jsonb_array_elements(d->'members')m where m->>'id'=e2::text and m->>'name'='Kai Lin'),'Member nickname not trimmed';
 d:=public.marketing_inbox_detail(c,1,30);
 assert exists(select 1 from jsonb_array_elements(d->'messages')m where m->>'actor_name'='Kai Lin'),'Internal note author mismatch';
 assert d->'conversation'->>'title'='External identity unchanged','External conversation identity changed';
 d:=marketing_private.creators_workspace(o,a,false);
 assert exists(select 1 from jsonb_array_elements(d->'members')m where m->>'id'=e2::text and m->>'name'='Kai Lin'),'Creator collaboration owner mismatch';
 d:=public.marketing_setup_options(o);
 assert exists(select 1 from jsonb_array_elements(d->'members')m where m->>'id'=e2::text and m->>'name'='Kai Lin'),'Setup member name mismatch';
 -- Same-role member retains only Brand A; formatting grants no additional scope.
 perform set_config('request.jwt.claim.sub',u2::text,true);
 begin perform public.marketing_planner_read(o,'2026-10-01',b);raise exception 'Unexpected foreign Brand access';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.marketing_planner_read(o,'2026-10-01',a);raise exception 'Unexpected unauthenticated access';exception when insufficient_privilege then null;end;
 assert coalesce(nullif(btrim(null::text),''),'Full Name')='Full Name','Null nickname fallback mismatch';
end;$$;
rollback;
