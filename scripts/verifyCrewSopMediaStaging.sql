-- Rollback-only real Staging behavior checks for private SOP media authorities.
begin;
create temporary table crew_sop_media_verification_result(suite text, passed integer, total integer) on commit drop;

do $$
declare
  qa_user constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_outlet uuid; v_denied_outlet uuid; v_sop uuid := gen_random_uuid(); v_version uuid := gen_random_uuid();
  v_section uuid := gen_random_uuid(); v_prepared jsonb; v_other jsonb; v_result jsonb;
  v_employee uuid; v_token text := 'crew-sop-media-staging-proof-token'; v_passed integer := 0;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_user,'role','authenticated')::text,true);
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260813183402') then raise exception 'FAIL migration history'; end if;
  if not exists(select 1 from storage.buckets where id='crew-sop-media' and not public and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[]) then raise exception 'FAIL bucket'; end if;
  v_passed:=v_passed+2;

  select id into v_outlet from public.outlets where public.current_user_can_access_outlet(id) order by (name='Friends Corner') desc,name limit 1;
  select id into v_denied_outlet from public.outlets where id<>v_outlet and not public.current_user_can_access_outlet(id) limit 1;
  if v_outlet is null or v_denied_outlet is null then raise exception 'FAIL outlet scope fixture'; end if;
  insert into public.crew_sops(id,title,category,status,outlet_id) values(v_sop,'SOP Media Rollback QA','Service','draft',v_outlet);
  insert into public.crew_sop_versions(id,sop_id,version,status) values(v_version,v_sop,1,'draft');
  insert into public.crew_sop_sections(id,sop_version_id,title,body,sort_order) values(v_section,v_version,'Image section','<p>Safe body</p>',1);

  execute 'set local role authenticated';
  v_prepared:=public.crew_prepare_sop_media_upload(v_version,'qa image.png','image/webp',1024,1200,800);
  execute 'reset role';
  if v_prepared->>'object_path' <> v_outlet::text||'/'||v_sop::text||'/'||v_version::text||'/'||(v_prepared->>'id')||'.webp' then raise exception 'FAIL scoped opaque path'; end if;
  v_passed:=v_passed+1;

  begin execute 'set local role authenticated'; perform public.crew_prepare_sop_media_upload(v_version,'unsafe.svg','image/svg+xml',100,10,10); execute 'reset role'; raise exception 'FAIL SVG'; exception when sqlstate '22023' then execute 'reset role'; v_passed:=v_passed+1; end;
  begin execute 'set local role authenticated'; perform public.crew_prepare_sop_media_upload(v_version,'large.png','image/png',5242881,10,10); execute 'reset role'; raise exception 'FAIL size'; exception when sqlstate '22023' then execute 'reset role'; v_passed:=v_passed+1; end;

  update public.crew_sop_media set status='ready' where id=(v_prepared->>'id')::uuid;
  execute 'set local role authenticated'; perform public.crew_attach_sop_media(v_section,(v_prepared->>'id')::uuid,'QA caption'); execute 'reset role';
  if not exists(select 1 from public.crew_sop_sections where id=v_section and media_id=(v_prepared->>'id')::uuid and media_caption='QA caption') then raise exception 'FAIL attach'; end if;
  v_passed:=v_passed+1;

  execute 'set local role authenticated'; perform public.crew_publish_sop_version(v_version); execute 'reset role';
  select e.id into v_employee from public.employees e join public.crew_access a on a.employee_id=e.id where a.primary_outlet_id=v_outlet and a.access_state='active' limit 1;
  if v_employee is null then raise exception 'FAIL Crew fixture'; end if;
  insert into public.crew_sessions(employee_id,token_hash,expires_at) values(v_employee,encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '10 minutes');
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon'; v_result:=public.crew_sop_media_access(v_token,v_version,(v_prepared->>'id')::uuid); execute 'reset role';
  if v_result->>'id' <> v_prepared->>'id' or v_result ? 'caption' then raise exception 'FAIL Crew safe access'; end if;
  v_passed:=v_passed+1;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',qa_user,'role','authenticated')::text,true);
  execute 'set local role authenticated'; v_result:=public.crew_request_sop_media_delete((v_prepared->>'id')::uuid); execute 'reset role';
  if coalesce((v_result->>'can_delete')::boolean,true) or v_result->>'reason'<>'published_reference' then raise exception 'FAIL published protection'; end if;
  v_passed:=v_passed+1;

  insert into public.crew_sops(id,title,category,status,outlet_id) values(gen_random_uuid(),'Denied Outlet SOP','Service','draft',v_denied_outlet) returning id into v_sop;
  insert into public.crew_sop_versions(id,sop_id,version,status) values(gen_random_uuid(),v_sop,1,'draft') returning id into v_version;
  begin execute 'set local role authenticated'; perform public.crew_prepare_sop_media_upload(v_version,'cross.webp','image/webp',100,10,10); execute 'reset role'; raise exception 'FAIL cross outlet'; exception when sqlstate '42501' then execute 'reset role'; v_passed:=v_passed+1; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin execute 'set local role authenticated'; perform public.crew_prepare_sop_media_upload(v_version,'unauthorized.webp','image/webp',100,10,10); execute 'reset role'; raise exception 'FAIL unauthorized'; exception when sqlstate '42501' then execute 'reset role'; v_passed:=v_passed+1; end;

  if v_passed<>10 then raise exception 'FAIL expected 10 got %',v_passed; end if;
  insert into crew_sop_media_verification_result values('Crew SOP media Staging behavior',v_passed,10);
  raise notice 'Crew SOP media Staging behavior: %/% passed',v_passed,10;
end;
$$;
table crew_sop_media_verification_result;
rollback;
