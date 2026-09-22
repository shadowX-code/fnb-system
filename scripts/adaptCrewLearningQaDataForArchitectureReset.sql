-- STAGING ONLY: adapt the existing Hola Hola QA onboarding draft to the
-- documented eight-module product shell through the real authenticated RLS and
-- controlled publish authority. Existing v1 assignments/progress are untouched.
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"266912cf-0e84-4074-82b5-0fc483080741","role":"authenticated"}',
  true
);

do $$
declare
  v_outlet_id uuid := '49fe2aa7-fc6e-41f1-85cf-3bb8d34a87ba';
  v_journey_id uuid;
  v_welcome_module uuid;
  v_greeting_module uuid;
  v_cleaning_module uuid;
  v_readiness_module uuid;
  v_module_id uuid;
  v_lesson_id uuid;
  module_row record;
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception 'Staging Crew Admin QA does not have the expected scoped permission.';
  end if;

  select id into v_journey_id
  from public.crew_journeys
  where outlet_id = v_outlet_id
    and is_mandatory_onboarding
    and status = 'draft'
  order by version desc
  limit 1;

  if v_journey_id is null then
    raise exception 'Expected Hola Hola mandatory onboarding draft is missing.';
  end if;

  select id into v_welcome_module
  from public.crew_journey_modules
  where journey_id = v_journey_id and sort_order = 1;
  select id into v_cleaning_module
  from public.crew_journey_modules
  where journey_id = v_journey_id and sort_order = 2;
  select id into v_readiness_module
  from public.crew_journey_modules
  where journey_id = v_journey_id and sort_order = 3;

  update public.crew_journey_modules
  set title = 'Welcome & Workplace',
      description = 'Meet the workplace, team and service expectations.',
      estimated_minutes = 15,
      required = true
  where id = v_welcome_module;

  update public.crew_journey_modules
  set title = 'Cleaning & Hygiene',
      description = 'Follow personal and workplace hygiene standards.',
      sort_order = 5,
      estimated_minutes = 25,
      required = true
  where id = v_cleaning_module;

  update public.crew_journey_modules
  set title = 'Final & Role Readiness',
      description = 'Review the essentials before independent shift work.',
      sort_order = 8,
      estimated_minutes = 20,
      required = true
  where id = v_readiness_module;

  insert into public.crew_journey_modules(
    journey_id, title, description, sort_order, estimated_minutes, required, status
  ) values (
    v_journey_id,
    'Customer Arrival & Greeting',
    'Build a warm and consistent guest welcome.',
    2, 20, true, 'draft'
  ) returning id into v_greeting_module;

  update public.crew_lessons
  set module_id = v_greeting_module,
      sort_order = 1
  where module_id = v_welcome_module
    and title = 'Guest Greeting & Farewell';

  for module_row in
    select * from (values
      (3, 'Taking Orders', 'Learn the outlet order-taking flow and accuracy standards.', 'Taking Orders essentials'),
      (4, 'Serving & Table Service', 'Deliver orders and support guests with confidence.', 'Serving & Table Service essentials'),
      (6, 'Take Away & Packaging', 'Prepare takeaway orders accurately and consistently.', 'Take Away & Packaging essentials'),
      (7, 'Opening & Closing', 'Understand shift-opening and closing responsibilities.', 'Opening & Closing essentials')
    ) as modules(sort_order, title, description, lesson_title)
  loop
    insert into public.crew_journey_modules(
      journey_id, title, description, sort_order, estimated_minutes, required, status
    ) values (
      v_journey_id, module_row.title, module_row.description,
      module_row.sort_order, 15, true, 'draft'
    ) returning id into v_module_id;

    insert into public.crew_lessons(
      module_id, title, sort_order, content_type, required, estimated_minutes
    ) values (
      v_module_id, module_row.lesson_title, 1, 'lesson', true, 15
    ) returning id into v_lesson_id;

    insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
    values (
      v_lesson_id,
      'text',
      jsonb_build_object(
        'body',
        'This module is ready for the outlet team to add approved training content.'
      ),
      1
    );
  end loop;

  update public.crew_journeys
  set name = 'New Crew Onboarding',
      description = 'Essential onboarding for every new restaurant Crew member.',
      estimated_minutes = 130,
      sequential_modules = true,
      position = 'Mandatory for all Crew',
      updated_at = now()
  where id = v_journey_id;

  if (select count(*) from public.crew_journey_modules where journey_id = v_journey_id) <> 8 then
    raise exception 'QA onboarding adaptation did not produce exactly eight modules.';
  end if;

  perform public.crew_publish_journey(v_journey_id);
end;
$$;

reset role;
commit;
