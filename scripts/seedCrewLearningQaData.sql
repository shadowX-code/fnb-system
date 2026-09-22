-- FeedX Crew Journey Phase B Staging QA dataset.
--
-- This file is deliberately not a migration and must be invoked only through
-- scripts/seedCrewLearningQaData.sh.  It creates normal drafts as an existing
-- authenticated FeedX owner, publishes them using the lifecycle RPCs, and
-- assigns via assign_crew_journey.  It never mutates published content.

begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  v_owner uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  v_employee uuid := 'a090954a-e82f-4121-89ac-9e5adefa8040';
  v_marker constant text := 'FeedX Crew Phase B Staging QA seed data';
  v_sop_welcome uuid; v_sop_grooming uuid; v_sop_cleanliness uuid; v_sop_version uuid;
  v_onboarding uuid; v_refresher uuid;
  v_module_welcome uuid; v_module_standards uuid; v_module_shift uuid; v_module_refresher uuid;
  v_lesson_intro uuid; v_lesson_greeting uuid; v_lesson_grooming uuid; v_lesson_cleanliness uuid; v_lesson_ready uuid;
  v_lesson_refresher_1 uuid; v_lesson_refresher_2 uuid;
  v_assignment uuid;
  v_journey_created boolean := false;
  v_quiz_spec jsonb; v_question_spec jsonb; v_option_spec jsonb;
  v_quiz_id uuid; v_question_id uuid; v_lesson_id uuid;
begin
  -- Staging safety rail: this exact known QA Crew record is required.  A
  -- production project will not satisfy this guard and the script aborts.
  if auth.uid() <> v_owner
    or not public.current_user_has_permission('crew_learning.manage')
    or not public.current_user_has_permission('crew_sop.manage')
    or not public.current_user_has_permission('crew_employees.manage') then
    raise exception 'Staging QA seed requires the established FeedX owner context';
  end if;

  if not exists (
    select 1 from public.employees e
    join public.crew_access ca on ca.employee_id=e.id
    where e.id=v_employee
      and e.full_name='Test'
      and e.email='abc@gmail.com'
      and e.employment_status='active'
      and ca.access_state='active'
  ) then
    raise exception 'Staging QA employee Test / a090954a-e82f-4121-89ac-9e5adefa8040 is unavailable';
  end if;

  -- SOP drafts are created normally, then published exclusively through the
  -- lifecycle authority.  Existing QA seed SOPs are reused untouched.
  select id into v_sop_welcome from public.crew_sops where title='Welcome & Goodbye Standard' and summary=v_marker;
  if v_sop_welcome is null then
    if exists(select 1 from public.crew_sops where title='Welcome & Goodbye Standard') then raise exception 'A non-QA SOP already uses Welcome & Goodbye Standard'; end if;
    insert into public.crew_sops(title,category,summary,status,position) values ('Welcome & Goodbye Standard','Service',v_marker,'draft','QA Seed') returning id into v_sop_welcome;
    insert into public.crew_sop_versions(sop_id,version,status,change_summary,require_acknowledgement) values(v_sop_welcome,1,'draft','Initial Staging QA version',true) returning id into v_sop_version;
    insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point) values
      (v_sop_version,'Welcome within 5 seconds','Welcome guest within 5 seconds.',1,true),
      (v_sop_version,'Warm presence','Smile and maintain eye contact.',2,true),
      (v_sop_version,'Appropriate greeting','Use an appropriate greeting for every guest.',3,false),
      (v_sop_version,'Thank the guest','Thank guest before leaving.',4,false),
      (v_sop_version,'Goodbye','Invite guest to visit again.',5,false);
    perform public.crew_publish_sop_version(v_sop_version);
  end if;

  select id into v_sop_grooming from public.crew_sops where title='Personal Grooming Standard' and summary=v_marker;
  if v_sop_grooming is null then
    if exists(select 1 from public.crew_sops where title='Personal Grooming Standard') then raise exception 'A non-QA SOP already uses Personal Grooming Standard'; end if;
    insert into public.crew_sops(title,category,summary,status,position) values ('Personal Grooming Standard','Service',v_marker,'draft','QA Seed') returning id into v_sop_grooming;
    insert into public.crew_sop_versions(sop_id,version,status,change_summary,require_acknowledgement) values(v_sop_grooming,1,'draft','Initial Staging QA version',true) returning id into v_sop_version;
    insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point) values
      (v_sop_version,'Uniform','Wear a clean uniform.',1,true),
      (v_sop_version,'Hair','Keep hair neat.',2,false),
      (v_sop_version,'Name tag','Wear your name tag.',3,false),
      (v_sop_version,'Hygiene','Maintain personal hygiene.',4,true),
      (v_sop_version,'Shoes','Wear proper shoes.',5,false);
    perform public.crew_publish_sop_version(v_sop_version);
  end if;

  select id into v_sop_cleanliness from public.crew_sops where title='Workstation Cleanliness' and summary=v_marker;
  if v_sop_cleanliness is null then
    if exists(select 1 from public.crew_sops where title='Workstation Cleanliness') then raise exception 'A non-QA SOP already uses Workstation Cleanliness'; end if;
    insert into public.crew_sops(title,category,summary,status,position) values ('Workstation Cleanliness','Service',v_marker,'draft','QA Seed') returning id into v_sop_cleanliness;
    insert into public.crew_sop_versions(sop_id,version,status,change_summary,require_acknowledgement) values(v_sop_cleanliness,1,'draft','Initial Staging QA version',true) returning id into v_sop_version;
    insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point) values
      (v_sop_version,'Assigned area','Keep your assigned area clean.',1,true),
      (v_sop_version,'Used items','Clear used items promptly.',2,false),
      (v_sop_version,'Table and floor','Check table and floor condition.',3,false),
      (v_sop_version,'End of shift','Complete end-of-shift cleanliness.',4,true);
    perform public.crew_publish_sop_version(v_sop_version);
  end if;

  select id into v_onboarding from public.crew_journeys where name='New Crew Onboarding' and position='QA Seed' order by version desc limit 1;
  if v_onboarding is null then
    v_journey_created:=true;
    insert into public.crew_journeys(name,description,journey_type,status,version,estimated_minutes,sequential_modules,position,created_by)
    values('New Crew Onboarding','Essential onboarding journey for new restaurant crew.','onboarding','draft',1,45,true,'QA Seed',v_owner) returning id into v_onboarding;
    insert into public.crew_journey_modules(journey_id,title,description,sort_order,estimated_minutes,required,status) values
      (v_onboarding,'Welcome to the Team','Start with our service mindset.',1,10,true,'draft') returning id into v_module_welcome;
    insert into public.crew_journey_modules(journey_id,title,description,sort_order,estimated_minutes,required,status) values
      (v_onboarding,'Professional Standards','Build reliable daily standards.',2,20,true,'draft') returning id into v_module_standards;
    insert into public.crew_journey_modules(journey_id,title,description,sort_order,estimated_minutes,required,status) values
      (v_onboarding,'First Shift Ready','Bring the standards together before shift.',3,15,true,'draft') returning id into v_module_shift;

    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_welcome,'Welcome to FeedX Crew Journey',1,'lesson',true,5) returning id into v_lesson_intro;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values
      (v_lesson_intro,'intro',jsonb_build_object('text','Welcome to FeedX Crew Journey. This onboarding will prepare you for a confident first shift.'),1),
      (v_lesson_intro,'key_point',jsonb_build_object('text','Great service starts before the first order is taken.'),2);

    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_welcome,'Guest Greeting & Farewell',2,'lesson',true,5) returning id into v_lesson_greeting;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values
      (v_lesson_greeting,'text',jsonb_build_object('text','Use the Welcome & Goodbye Standard to make every guest feel seen.'),1),
      (v_lesson_greeting,'sop_reference',jsonb_build_object('sop_id',v_sop_welcome::text),2);

    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_standards,'Personal Grooming',1,'lesson',true,10) returning id into v_lesson_grooming;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values
      (v_lesson_grooming,'text',jsonb_build_object('text','Professional presentation supports guest confidence.'),1),
      (v_lesson_grooming,'sop_reference',jsonb_build_object('sop_id',v_sop_grooming::text),2);

    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_standards,'Workstation Cleanliness',2,'lesson',true,10) returning id into v_lesson_cleanliness;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values
      (v_lesson_cleanliness,'text',jsonb_build_object('text','A clean workstation keeps service safe and ready.'),1),
      (v_lesson_cleanliness,'sop_reference',jsonb_build_object('sop_id',v_sop_cleanliness::text),2);

    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_shift,'Ready for Your First Shift',1,'lesson',true,15) returning id into v_lesson_ready;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values
      (v_lesson_ready,'text',jsonb_build_object('text','Review greeting, grooming and cleanliness before your first shift.'),1),
      (v_lesson_ready,'key_point',jsonb_build_object('text','Remember to Clock In before work.'),2);

    for v_quiz_spec in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('lesson','greeting','title','Knowledge Check – Greeting Standards','questions',jsonb_build_array(
        jsonb_build_object('prompt','When should you greet a guest?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Within 5 seconds','correct',true),jsonb_build_object('label','After they order','correct',false),jsonb_build_object('label','Only when asked','correct',false))),
        jsonb_build_object('prompt','Which are part of a proper greeting?','type','multiple_choice','options',jsonb_build_array(jsonb_build_object('label','Smile','correct',true),jsonb_build_object('label','Eye contact','correct',true),jsonb_build_object('label','Ignore the guest','correct',false),jsonb_build_object('label','Appropriate greeting','correct',true)))
      )),
      jsonb_build_object('lesson','grooming','title','Knowledge Check – Personal Grooming','questions',jsonb_build_array(
        jsonb_build_object('prompt','What should you wear for your shift?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','A clean uniform','correct',true),jsonb_build_object('label','Any casual clothes','correct',false))),
        jsonb_build_object('prompt','How should your hair look?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Neat','correct',true),jsonb_build_object('label','Untidy','correct',false))),
        jsonb_build_object('prompt','Which item identifies you to guests?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Name tag','correct',true),jsonb_build_object('label','Personal phone','correct',false))),
        jsonb_build_object('prompt','Which standard supports a professional appearance?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Personal hygiene','correct',true),jsonb_build_object('label','Skipping handwashing','correct',false))),
        jsonb_build_object('prompt','What footwear is expected?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Proper shoes','correct',true),jsonb_build_object('label','Beach sandals','correct',false)))
      )),
      jsonb_build_object('lesson','cleanliness','title','Knowledge Check – Workstation Cleanliness','questions',jsonb_build_array(
        jsonb_build_object('prompt','What should you do with used items?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Clear them promptly','correct',true),jsonb_build_object('label','Leave them until close','correct',false))),
        jsonb_build_object('prompt','Which areas need regular checks?','type','multiple_choice','options',jsonb_build_array(jsonb_build_object('label','Table condition','correct',true),jsonb_build_object('label','Floor condition','correct',true),jsonb_build_object('label','Only the office','correct',false))),
        jsonb_build_object('prompt','What is required at end of shift?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Complete end-of-shift cleanliness','correct',true),jsonb_build_object('label','Ignore your assigned area','correct',false)))
      )),
      jsonb_build_object('lesson','ready','title','Final Quiz – First Shift Ready','questions',jsonb_build_array(
        jsonb_build_object('prompt','When should a guest be welcomed?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Within 5 seconds','correct',true),jsonb_build_object('label','After payment','correct',false))),
        jsonb_build_object('prompt','Which grooming standard is required?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Clean uniform','correct',true),jsonb_build_object('label','No name tag','correct',false))),
        jsonb_build_object('prompt','What should be cleared promptly?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Used items','correct',true),jsonb_build_object('label','Safety notices','correct',false))),
        jsonb_build_object('prompt','What should you do before work?','type','single_choice','options',jsonb_build_array(jsonb_build_object('label','Clock In','correct',true),jsonb_build_object('label','Skip attendance','correct',false))),
        jsonb_build_object('prompt','Which behaviours support great service?','type','multiple_choice','options',jsonb_build_array(jsonb_build_object('label','Smile','correct',true),jsonb_build_object('label','Eye contact','correct',true),jsonb_build_object('label','Ignore guest needs','correct',false)))
      ))
    )) loop
      v_lesson_id:=case v_quiz_spec->>'lesson' when 'greeting' then v_lesson_greeting when 'grooming' then v_lesson_grooming when 'cleanliness' then v_lesson_cleanliness else v_lesson_ready end;
      insert into public.crew_quizzes(lesson_id,title,passing_score,status,required) values(v_lesson_id,v_quiz_spec->>'title',80,'draft',true) returning id into v_quiz_id;
      for v_question_spec in select value from jsonb_array_elements(v_quiz_spec->'questions') with ordinality s(value,ordinality) order by ordinality loop
        insert into public.crew_quiz_questions(quiz_id,prompt,question_type,sort_order) values(v_quiz_id,v_question_spec->>'prompt',v_question_spec->>'type',(select ordinality from jsonb_array_elements(v_quiz_spec->'questions') with ordinality s(value,ordinality) where s.value=v_question_spec limit 1)) returning id into v_question_id;
        for v_option_spec in select value from jsonb_array_elements(v_question_spec->'options') with ordinality s(value,ordinality) order by ordinality loop
          insert into public.crew_quiz_options(question_id,label,is_correct,sort_order) values(v_question_id,v_option_spec->>'label',coalesce((v_option_spec->>'correct')::boolean,false),(select ordinality from jsonb_array_elements(v_question_spec->'options') with ordinality s(value,ordinality) where s.value=v_option_spec limit 1));
        end loop;
      end loop;
    end loop;
    perform public.crew_publish_journey(v_onboarding);
  end if;

  select id into v_refresher from public.crew_journeys where name='Service Refresher' and position='QA Seed' order by version desc limit 1;
  if v_refresher is null then
    insert into public.crew_journeys(name,description,journey_type,status,version,estimated_minutes,sequential_modules,position,created_by)
    values('Service Refresher','A short non-sequential service refresher for Staging QA.','refresher','draft',1,10,false,'QA Seed',v_owner) returning id into v_refresher;
    insert into public.crew_journey_modules(journey_id,title,description,sort_order,estimated_minutes,required,status) values(v_refresher,'Service Refresh','Two quick refresh lessons.',1,10,true,'draft') returning id into v_module_refresher;
    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_refresher,'Refresh the Welcome',1,'lesson',true,5) returning id into v_lesson_refresher_1;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values(v_lesson_refresher_1,'text',jsonb_build_object('text','Remember to welcome guests promptly and warmly.'),1);
    insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(v_module_refresher,'Refresh a Clean Workstation',2,'lesson',true,5) returning id into v_lesson_refresher_2;
    insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) values(v_lesson_refresher_2,'text',jsonb_build_object('text','Keep your workstation ready throughout every shift.'),1);
    perform public.crew_publish_journey(v_refresher);
  end if;

  select id into v_assignment from public.crew_journey_assignments where employee_id=v_employee and journey_id=v_onboarding order by assigned_at desc limit 1;
  if v_assignment is null then
    v_assignment:=public.assign_crew_journey(v_employee,v_onboarding,null);
    -- Controlled Crew access reset for this explicitly identified Staging-only QA user.
    perform public.manage_crew_access(v_employee,'reset_passcode','4829');
  elsif exists(select 1 from public.crew_lesson_progress where assignment_id=v_assignment)
     or exists(select 1 from public.crew_quiz_attempts a join public.crew_quizzes q on q.id=a.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where a.employee_id=v_employee and m.journey_id=v_onboarding) then
    raise exception 'Existing QA onboarding assignment has learning activity; refusing to reset a manual QA state';
  end if;

  if not exists(select 1 from public.crew_sop_versions v where v.sop_id in (v_sop_welcome,v_sop_grooming,v_sop_cleanliness) and v.status='published' and v.require_acknowledgement) then
    raise exception 'QA SOP acknowledgement versions were not published';
  end if;
  if not exists(select 1 from public.crew_journeys where id=v_onboarding and status='published' and sequential_modules)
     or not exists(select 1 from public.crew_journeys where id=v_refresher and status='published' and not sequential_modules) then
    raise exception 'QA journeys were not published with the requested sequencing';
  end if;
  if not ((select journey_snapshot from public.crew_journey_assignments where id=v_assignment)::text like '%' || v_sop_welcome::text || '%')
     or not ((select journey_snapshot from public.crew_journey_assignments where id=v_assignment)::text like '%' || v_sop_grooming::text || '%')
     or not ((select journey_snapshot from public.crew_journey_assignments where id=v_assignment)::text like '%' || v_sop_cleanliness::text || '%') then
    raise exception 'QA assignment did not pin all required SOPs';
  end if;
end;
$$;

commit;

-- This concise result is intended for manual QA handoff and contains no answer keys.
select
  (select count(*) from public.crew_sops where summary='FeedX Crew Phase B Staging QA seed data' and status='published') as published_sops,
  (select count(*) from public.crew_journeys where position='QA Seed' and status='published') as published_journeys,
  (select count(*) from public.crew_journey_modules m join public.crew_journeys j on j.id=m.journey_id where j.name='New Crew Onboarding' and j.position='QA Seed') as onboarding_modules,
  (select count(*) from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id where j.name='New Crew Onboarding' and j.position='QA Seed') as onboarding_lessons,
  (select count(*) from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id where j.name='New Crew Onboarding' and j.position='QA Seed' and q.status='published') as published_quizzes,
  (select a.id from public.crew_journey_assignments a join public.crew_journeys j on j.id=a.journey_id where a.employee_id='a090954a-e82f-4121-89ac-9e5adefa8040'::uuid and j.name='New Crew Onboarding' and j.position='QA Seed' order by a.assigned_at desc limit 1) as onboarding_assignment_id;
