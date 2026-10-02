begin;
-- Run together with the migration in a transaction and always roll back.
create temporary table sop_rbac_qa_cases(name text primary key, passed boolean);
create temporary table sop_rbac_qa_ids(key text primary key,id uuid);
grant all on sop_rbac_qa_cases,sop_rbac_qa_ids to authenticated;
insert into sop_rbac_qa_ids select 'outlet',id from public.outlets where is_active and id in ('49fe2aa7-fc6e-41f1-85cf-3bb8d34a87ba','e804c48d-6343-4bf8-99d7-9893c473948f') limit 1;
select set_config('request.jwt.claims','{"sub":"fcc31341-cb34-490e-b992-f13281056d25","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.crew_sop_admin_library((select id from sop_rbac_qa_ids where key='outlet'));raise exception 'no View allowed library';exception when insufficient_privilege then null;end;
  if exists(select 1 from public.crew_sops) then raise exception 'no View allowed table';end if;
  insert into sop_rbac_qa_cases values('no_view_rpc_and_rls_denied',true);
end $$;
reset role;
insert into role_permissions(role_id,permission_id) select 'eeb77282-1ea8-45f5-8895-a1a22b23172e',id from permissions where code='crew_sop_library.view';
set local role authenticated;
do $$ begin
  perform public.crew_sop_admin_library((select id from sop_rbac_qa_ids where key='outlet'));
  begin insert into public.crew_sops(title,category,status,outlet_id) values('QA denied','Service','draft',(select id from sop_rbac_qa_ids where key='outlet'));raise exception 'View allowed create';exception when insufficient_privilege then null;end;
  insert into sop_rbac_qa_cases values('view_only_reads_without_create',true);
end $$;
reset role;
insert into role_permissions(role_id,permission_id) select 'eeb77282-1ea8-45f5-8895-a1a22b23172e',id from permissions where code='crew_sop_library.create';
set local role authenticated;
do $$ declare s uuid;v uuid; begin
  insert into public.crew_sops(title,category,status,outlet_id,created_by) values('QA SOP RBAC rollback','Service','draft',(select id from sop_rbac_qa_ids where key='outlet'),'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd') returning id into s;
  if (select created_by from public.crew_sops where id=s)<>auth.uid() then raise exception 'creator spoof accepted';end if;
  v:=public.crew_new_sop_version(s);
  update public.crew_sop_versions set title='QA completed initial draft' where id=v;
  insert into public.crew_sop_sections(sop_version_id,title,body,sort_order) values(v,'QA section','test',1);
  perform public.crew_admin_localized_content('sop',v);
  insert into sop_rbac_qa_ids values('sop',s),('version',v);
  begin update public.crew_sops set created_by='b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd' where id=s;raise exception 'creator update accepted';exception when insufficient_privilege then null;end;
  begin perform public.crew_publish_sop_version(v);raise exception 'create published';exception when insufficient_privilege then null;end;
  begin update public.crew_sop_versions set status='published' where id=v;raise exception 'direct publish accepted';exception when insufficient_privilege then null;end;
  if exists(select 1 from public.crew_sops other where other.id<>s and public.crew_sop_admin_can_access_sop(other.id)) then raise exception 'create may edit existing';end if;
  insert into sop_rbac_qa_cases values('create_own_initial_draft_and_creator_guard',true),('create_cannot_edit_existing_or_publish',true);
end $$;
reset role;
insert into role_permissions(role_id,permission_id) select 'eeb77282-1ea8-45f5-8895-a1a22b23172e',id from permissions where code='crew_sop_library.edit';
-- Owner-attributed initial draft gives a separate existing document for Edit.
select set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
with created as (insert into public.crew_sops(title,category,status,outlet_id) values('QA existing other draft','Service','draft',(select id from sop_rbac_qa_ids where key='outlet')) returning id) insert into sop_rbac_qa_ids select 'other',id from created;
select set_config('request.jwt.claims','{"sub":"fcc31341-cb34-490e-b992-f13281056d25","role":"authenticated"}',true);
set local role authenticated;
do $$ declare v uuid;p uuid; begin
 v:=public.crew_new_sop_version((select id from sop_rbac_qa_ids where key='other'));
 update public.crew_sop_versions set title='QA Manager edited existing' where id=v;
 if not found then raise exception 'edit existing failed';end if;
 select id into p from public.crew_sop_versions where status='published' limit 1;
 if p is not null then
   begin update public.crew_sop_versions set title='must reject' where id=p;raise exception 'published evidence rewritten';exception when insufficient_privilege then null;end;
 end if;
 insert into sop_rbac_qa_cases values('edit_existing_and_published_immutability',true);
end $$;
reset role;
delete from role_permissions rp using permissions p where p.id=rp.permission_id and rp.role_id='eeb77282-1ea8-45f5-8895-a1a22b23172e' and p.code='crew_sop_library.view';
set local role authenticated;
do $$ begin
  if public.crew_sop_admin_can_access_sop((select id from sop_rbac_qa_ids where key='sop')) then raise exception 'Create/Edit imply View';end if;
  begin perform public.crew_sop_admin_detail((select id from sop_rbac_qa_ids where key='sop'));raise exception 'Create/Edit read without View';exception when insufficient_privilege then null;end;
  insert into sop_rbac_qa_cases values('create_edit_without_view_denied',true);
end $$;
reset role;
select jsonb_agg(to_jsonb(c) order by name) as results from sop_rbac_qa_cases c;

rollback;
