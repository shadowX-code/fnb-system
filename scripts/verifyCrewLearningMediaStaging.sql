-- Rollback-only behavior verification for Crew Learning private media.
begin;
create temporary table crew_learning_media_verification_result (
  suite text not null,
  passed integer not null,
  total integer not null
) on commit drop;

do $$
declare
  qa_user constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  outlet_id uuid;
  denied_outlet_id uuid;
  prepared jsonb;
  draft_media jsonb;
  assignment_id uuid;
  employee_id uuid;
  token constant text := 'crew-learning-media-staging-proof-token';
  result jsonb;
  passed integer := 0;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', qa_user, 'role', 'authenticated')::text, true);
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260812103647'
  ) then raise exception 'FAIL migration history'; end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'crew-learning-media'
      and not public
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then raise exception 'FAIL private bucket constraints'; end if;
  passed := passed + 2;

  select o.id into outlet_id
  from public.outlets o
  where public.current_user_can_access_outlet(o.id)
  order by (o.name = 'Friends Corner') desc, o.name
  limit 1;
  if outlet_id is null then raise exception 'FAIL QA Admin has no scoped outlet'; end if;

  execute 'set local role authenticated';
  prepared := public.crew_prepare_learning_media_upload(
    outlet_id, 'lesson-image.webp', 'image/webp', 1024, 1200, 800
  );
  execute 'reset role';
  if prepared->>'object_path' not like outlet_id::text || '/%' or prepared->>'status' <> 'pending' then
    raise exception 'FAIL generated object path';
  end if;
  passed := passed + 1;

  begin
    execute 'set local role authenticated';
    perform public.crew_prepare_learning_media_upload(outlet_id, 'unsafe.svg', 'image/svg+xml', 100, 100, 100);
    execute 'reset role';
    raise exception 'FAIL SVG accepted';
  exception when sqlstate '22023' then execute 'reset role'; passed := passed + 1; end;

  begin
    execute 'set local role authenticated';
    perform public.crew_prepare_learning_media_upload(outlet_id, 'too-large.webp', 'image/webp', 5242881, 100, 100);
    execute 'reset role';
    raise exception 'FAIL oversized image accepted';
  exception when sqlstate '22023' then execute 'reset role'; passed := passed + 1; end;

  select o.id into denied_outlet_id
  from public.outlets o
  where o.id <> outlet_id and not public.current_user_can_access_outlet(o.id)
  limit 1;
  if denied_outlet_id is not null then
    begin
      execute 'set local role authenticated';
      perform public.crew_prepare_learning_media_upload(denied_outlet_id, 'cross-outlet.webp', 'image/webp', 100, 100, 100);
      execute 'reset role';
      raise exception 'FAIL cross-outlet upload accepted';
    exception when sqlstate '42501' then execute 'reset role'; passed := passed + 1; end;
  else
    raise exception 'FAIL no inaccessible outlet fixture';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.crew_prepare_learning_media_upload(outlet_id, 'unauthorized.webp', 'image/webp', 100, 100, 100);
    execute 'reset role';
    raise exception 'FAIL unauthorized upload accepted';
  exception when sqlstate '42501' then execute 'reset role'; passed := passed + 1; end;

  update public.crew_learning_media set status = 'ready' where id = (prepared->>'id')::uuid;
  select a.id, a.employee_id into assignment_id, employee_id
  from public.crew_journey_assignments a
  join public.crew_access access on access.employee_id = a.employee_id
  where access.primary_outlet_id = outlet_id
  limit 1;
  if assignment_id is null then raise exception 'FAIL missing Staging Crew assignment fixture'; end if;

  update public.crew_journey_assignments
  set journey_snapshot = jsonb_build_object(
    'modules', jsonb_build_array(jsonb_build_object(
      'lessons', jsonb_build_array(jsonb_build_object(
        'blocks', jsonb_build_array(jsonb_build_object(
          'block_type', 'text',
          'payload', jsonb_build_object('media', jsonb_build_object('id', prepared->>'id'))
        ))
      ))
    ))
  )
  where id = assignment_id;
  insert into public.crew_sessions(employee_id, token_hash, expires_at)
  values (employee_id, encode(extensions.digest(token, 'sha256'), 'hex'), now() + interval '10 minutes');

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  result := public.crew_learning_media_access(token, (prepared->>'id')::uuid);
  execute 'reset role';
  if result->>'id' <> prepared->>'id' then raise exception 'FAIL assigned Crew media access'; end if;
  passed := passed + 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', qa_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  result := public.crew_request_learning_media_delete((prepared->>'id')::uuid);
  execute 'reset role';
  if coalesce((result->>'can_delete')::boolean, true) or result->>'reason' <> 'published_reference' then
    raise exception 'FAIL assignment-referenced media delete protection';
  end if;
  passed := passed + 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', qa_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  draft_media := public.crew_prepare_learning_media_upload(outlet_id, 'draft-only.webp', 'image/webp', 100, 100, 100);
  execute 'reset role';
  update public.crew_learning_media set status = 'ready' where id = (draft_media->>'id')::uuid;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    execute 'set local role anon';
    perform public.crew_learning_media_access(token, (draft_media->>'id')::uuid);
    execute 'reset role';
    raise exception 'FAIL draft media leaked to Crew';
  exception when sqlstate '42501' then execute 'reset role'; passed := passed + 1; end;

  if passed <> 10 then raise exception 'FAIL expected 10 checks, got %', passed; end if;
  insert into crew_learning_media_verification_result(suite, passed, total)
  values ('Crew Learning media Staging behavior', passed, 10);
  raise notice 'Crew Learning media Staging behavior: %/% passed', passed, 10;
end;
$$;

table crew_learning_media_verification_result;
rollback;
