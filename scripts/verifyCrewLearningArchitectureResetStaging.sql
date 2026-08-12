-- Rollback-only real Staging behavior verification for the Crew Learn reset.
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',
  true
);

do $$
declare
  v_source_outlet uuid := '49fe2aa7-fc6e-41f1-85cf-3bb8d34a87ba';
  v_target_outlet uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_isaac uuid := '9f44daf9-9f87-4129-bc71-55c082cf8782';
  v_test uuid := 'a090954a-e82f-4121-89ac-9e5adefa8040';
  v_clone jsonb;
  v_access jsonb;
  v_auth jsonb;
  v_home jsonb;
  v_assignment jsonb;
  v_library jsonb;
  v_reader jsonb;
  v_ack jsonb;
  v_token text;
  v_assignment_id uuid;
  v_version_id uuid;
  v_source_journey uuid;
  v_target_journey uuid;
begin
  if exists (
    select 1 from public.crew_journeys
    where outlet_id = v_target_outlet and is_mandatory_onboarding
  ) or exists (
    select 1 from public.crew_sops where outlet_id = v_target_outlet
  ) then
    raise exception 'Rollback-only clone target is no longer empty.';
  end if;

  select id into v_source_journey
  from public.crew_journeys
  where outlet_id = v_source_outlet
    and is_mandatory_onboarding
    and status = 'published'
  order by version desc
  limit 1;

  v_clone := public.crew_clone_learning_setup(
    v_source_outlet,
    v_target_outlet,
    true,
    true,
    true
  );
  v_target_journey := (v_clone->>'onboarding_id')::uuid;

  if v_target_journey is null
     or v_target_journey = v_source_journey
     or (select status from public.crew_journeys where id = v_target_journey) <> 'draft'
     or (select count(*) from public.crew_journey_modules where journey_id = v_target_journey) <> 8
     or (select count(*) from public.crew_sops where outlet_id = v_target_outlet) <> 3
     or exists (
       select 1
       from public.crew_lesson_blocks target_block
       join public.crew_lessons target_lesson on target_lesson.id = target_block.lesson_id
       join public.crew_journey_modules target_module on target_module.id = target_lesson.module_id
       where target_module.journey_id = v_target_journey
         and target_block.block_type = 'sop_reference'
         and (target_block.payload->>'sop_id')::uuid in (
           select id from public.crew_sops where outlet_id = v_source_outlet
         )
     ) then
    raise exception 'Independent clone behavior failed.';
  end if;

  v_access := public.manage_crew_access(v_isaac, 'reset_passcode', '7392');
  v_auth := public.crew_authenticate(v_access->>'mobile_number', '7392', null);
  v_token := v_auth->>'token';
  v_home := public.crew_learning_home(v_token);
  v_assignment_id := (v_home->'assignment'->>'id')::uuid;
  v_assignment := public.crew_learning_assignment(v_token, v_assignment_id);
  v_library := public.crew_sop_library(v_token);

  if v_home->>'outlet_id' <> v_source_outlet::text
     or v_home->'assignment'->>'enrollment_source' <> 'automatic'
     or jsonb_array_length(v_assignment->'modules') <> 8
     or v_assignment::text like '%is_correct%'
     or v_assignment::text like '%journey_snapshot%'
     or jsonb_array_length(v_library->'sops') <> 3 then
    raise exception 'New Crew onboarding or safe outlet library behavior failed.';
  end if;

  v_version_id := (v_library->'sops'->0->>'version_id')::uuid;
  v_reader := public.crew_sop_version(v_token, v_version_id);
  v_ack := public.crew_acknowledge_sop(
    v_token,
    v_version_id,
    'direct_library'
  );

  if v_reader->>'id' <> v_version_id::text
     or coalesce((v_ack->>'acknowledged')::boolean, false) is false
     or not exists (
       select 1
       from public.crew_sop_acknowledgements
       where employee_id = v_isaac and sop_version_id = v_version_id
     ) then
    raise exception 'Direct SOP library read/acknowledgement failed.';
  end if;

  v_access := public.manage_crew_access(v_test, 'reset_passcode', '4829');
  v_auth := public.crew_authenticate(v_access->>'mobile_number', '4829', null);
  v_token := v_auth->>'token';
  v_home := public.crew_learning_home(v_token);
  v_assignment := public.crew_learning_assignment(
    v_token,
    (v_home->'assignment'->>'id')::uuid
  );

  if v_home->'assignment'->>'status' <> 'completed'
     or v_home->'assignment'->>'enrollment_source' <> 'legacy'
     or jsonb_array_length(v_assignment->'modules') <> 3 then
    raise exception 'Completed legacy onboarding did not remain reviewable.';
  end if;

  raise notice 'PASS: 12/12 architecture-reset Staging behavior assertions';
end;
$$;

reset role;
select 'PASS' as result, 12 as passed, 12 as total;
rollback;
