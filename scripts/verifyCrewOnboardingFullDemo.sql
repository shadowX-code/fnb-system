-- Rollback-only real Staging verification for the full Onboarding demo.
-- Exercises Admin lifecycle, Crew token flows, sequential gating, immutable
-- v1/v2 snapshot scoring and an independent Clone From Outlet operation.

begin;

create temporary table qa_verify_result (
  area text not null,
  assertion text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant select,insert on qa_verify_result to authenticated,anon;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',
  true
);

do $verify$
declare
  v_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_owner constant uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_marker constant text := 'FeedX Crew Onboarding Full Demo · Staging only';
  v_published uuid;
  v_draft uuid;
  v_employee uuid;
  v_assignment uuid;
  v_token text;
  v_old_token text;
  v_auth jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_lesson jsonb;
  v_quiz jsonb;
  v_answers jsonb;
  v_sop_version uuid;
  v_temp_outlet uuid;
  v_clone jsonb;
  v_temp_employee uuid;
  v_new_assignment uuid;
  v_old_answer text;
  v_new_answer text;
  v_old_sop uuid;
  v_new_sop uuid;
  module_item record;
  lesson_item record;
  question_item jsonb;
begin
  v_published:=(select id from public.crew_journeys
    where outlet_id=v_outlet and is_mandatory_onboarding and status='published' and version=1);
  v_draft:=(select id from public.crew_journeys
    where outlet_id=v_outlet and is_mandatory_onboarding and status='draft' and version=2);

  insert into qa_verify_result values
    ('dataset','Published v1 and Draft v2 coexist',v_published is not null and v_draft is not null,null),
    ('dataset','Published v1 contains 8 modules',(select count(*)=8 from public.crew_journey_modules where journey_id=v_published),null),
    ('dataset','Published v1 contains 22 lessons',(select count(*)=22 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published),null),
    ('dataset','Every module has 2-3 lessons',not exists(select 1 from public.crew_journey_modules m where m.journey_id=v_published and (select count(*) from public.crew_lessons l where l.module_id=m.id) not between 2 and 3),null),
    ('dataset','Required and optional lessons both exist',
      exists(select 1 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published and l.required)
      and exists(select 1 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published and not l.required),null),
    ('dataset','Six knowledge checks and 24 v1 questions exist',(select count(*)=6 from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published) and (select count(*)=24 from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published),null),
    ('dataset','Single and multiple choice are covered',(select count(distinct qq.question_type)=2 from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_published),null),
    ('dataset','Four published demo SOPs exist',(select count(*)=4 from public.crew_sops where outlet_id=v_outlet and status='published' and summary=v_marker),null),
    ('dataset','Every demo SOP has at least four sections',not exists(select 1 from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id and v.version=s.current_version where s.outlet_id=v_outlet and s.summary=v_marker and (select count(*) from public.crew_sop_sections ss where ss.sop_version_id=v.id)<4),null),
    ('dataset','At least three SOPs require acknowledgement',(select count(*)>=3 from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id and v.version=s.current_version where s.outlet_id=v_outlet and s.summary=v_marker and v.require_acknowledgement),null),
    ('dataset','Draft v2 has an extra lesson',(select count(*)=23 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_draft),null),
    ('dataset','Draft v2 final quiz has nine questions',(select count(*)=9 from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_draft and q.title='Final Readiness Check'),null);

  -- Persistent Admin progress states were created through mobile authorities.
  insert into qa_verify_result
  select 'progress',expected_name,
         assignment_status=expected_status and completed_modules=expected_modules,
         assignment_status || ' · ' || completed_modules || '/8 modules'
  from (
    select expected.full_name expected_name, expected.expected_status,
           expected.expected_modules, a.status assignment_status,
           (select count(*)
            from jsonb_array_elements(a.journey_snapshot->'modules') m
            where not exists(
              select 1
              from jsonb_array_elements(m->'lessons') lesson
              where coalesce((lesson->'lesson'->>'required')::boolean,true)
                and not exists(
                  select 1 from public.crew_lesson_progress progress
                  where progress.assignment_id=a.id
                    and progress.lesson_id=(lesson->'lesson'->>'id')::uuid
                    and progress.status='completed'
                )
            )) completed_modules
    from (values
      ('QA Crew - Not Started','not_started',0),
      ('QA Crew - In Progress','in_progress',4),
      ('QA Crew - Completed','completed',8)
    ) expected(full_name,expected_status,expected_modules)
    join public.employees e on e.full_name=expected.full_name and e.audit_summary like v_marker || '%'
    join public.crew_journey_assignments a on a.employee_id=e.id and a.journey_id=v_published
  ) states;

  insert into qa_verify_result
  select 'progress','All QA assignments are automatic enrollment',count(*)=3,null
  from public.crew_journey_assignments a
  join public.employees e on e.id=a.employee_id
  where a.journey_id=v_published and e.audit_summary like v_marker || '%'
    and a.enrollment_source='automatic';

  -- Real Crew token path, starting from the persistent Not Started employee.
  v_employee:=(select e.id from public.employees e
    where e.full_name='QA Crew - Not Started' and e.audit_summary like v_marker || '%');
  v_assignment:=(select a.id from public.crew_journey_assignments a
    where a.employee_id=v_employee and a.journey_id=v_published);
  v_auth:=(select public.crew_authenticate(ca.mobile_number,'4829','full-demo-verify')
    from public.crew_access ca where ca.employee_id=v_employee);
  v_token:=v_auth->>'token';
  v_old_token:=v_token;
  v_payload:=public.crew_learning_assignment(v_token,v_assignment);

  insert into qa_verify_result values
    ('crew','Safe assignment returns 8 modules',jsonb_array_length(v_payload->'modules')=8,null),
    ('crew','Module 1 available and later modules locked',
      coalesce((v_payload->'modules'->0->>'available')::boolean,false)
      and coalesce((v_payload->'modules'->1->>'locked')::boolean,false)
      and coalesce((v_payload->'modules'->7->>'locked')::boolean,false),null),
    ('crew','Safe payload has no scoring secrets',
      v_payload::text not like '%is_correct%'
      and v_payload::text not like '%correct_option%'
      and v_payload::text not like '%journey_snapshot%',null),
    ('crew','Rich text plain fallback is present',
      jsonb_path_exists(v_payload,'$.modules[*].lessons[*].blocks[*].payload.body')
      and jsonb_path_exists(v_payload,'$.modules[*].lessons[*].blocks[*].payload.body_html'),null),
    ('crew','Pinned SOP versions are present',
      jsonb_path_exists(v_payload,'$.modules[*].lessons[*].blocks[*].payload.sop_version_id'),null);

  -- Complete only required Module 1 lessons. The optional third lesson remains
  -- untouched and must not block Module 2.
  for lesson_item in
    select value,ordinality
    from jsonb_array_elements(v_payload->'modules'->0->'lessons') with ordinality x(value,ordinality)
    where coalesce((value->>'required')::boolean,true)
    order by ordinality
  loop
    v_result:=public.crew_complete_lesson(
      v_token,v_assignment,(lesson_item.value->'lesson'->>'id')::uuid
    );
    if not coalesce((v_result->>'completed')::boolean,false) then
      raise exception 'Rollback sequential fixture could not complete Module 1.';
    end if;
  end loop;
  v_payload:=public.crew_learning_assignment(v_token,v_assignment);
  insert into qa_verify_result values
    ('sequential','Optional Module 1 lesson does not block Module 2',
      coalesce((v_payload->'modules'->1->>'available')::boolean,false)
      and not coalesce((v_payload->'modules'->0->'lessons'->2->>'completed')::boolean,false),null);

  v_lesson:=v_payload->'modules'->1->'lessons'->0;
  v_result:=public.crew_complete_lesson(
    v_token,v_assignment,(v_lesson->'lesson'->>'id')::uuid
  );
  insert into qa_verify_result values
    ('sequential','SOP and required quiz block lesson completion',
      not coalesce((v_result->>'completed')::boolean,false)
      and v_result::text like '%sop_acknowledgement%'
      and v_result::text like '%quiz%',v_result::text);

  v_sop_version:=(select (block->'payload'->>'sop_version_id')::uuid
    from jsonb_array_elements(v_lesson->'blocks') block
    where block->>'block_type'='sop_reference' limit 1);
  perform public.crew_acknowledge_sop(v_token,v_sop_version,'journey');
  v_result:=public.crew_complete_lesson(
    v_token,v_assignment,(v_lesson->'lesson'->>'id')::uuid
  );
  insert into qa_verify_result values
    ('sequential','Exact SOP acknowledgement leaves quiz gate active',
      not coalesce((v_result->>'completed')::boolean,false)
      and v_result::text not like '%sop_acknowledgement%'
      and v_result::text like '%quiz%',v_result::text);

  v_quiz:=v_lesson->'quiz';
  v_answers:=(select jsonb_agg(jsonb_build_object(
    'question_id',question->>'id',
    'option_ids',jsonb_build_array(
      case when question->>'question_type'='single_choice'
        then question->'options'->2->>'id'
        else question->'options'->3->>'id' end
    )
  ) order by (question->>'sort_order')::int)
  from jsonb_array_elements(v_quiz->'questions') question);
  v_result:=public.crew_submit_quiz(
    v_token,v_assignment,(v_quiz->>'id')::uuid,v_answers
  );
  insert into qa_verify_result values
    ('sequential','Failed quiz attempt remains blocked',not coalesce((v_result->>'passed')::boolean,false),v_result::text);

  v_answers:=(select jsonb_agg(jsonb_build_object(
    'question_id',question->>'id',
    'option_ids',(select jsonb_agg(option->>'id' order by (option->>'sort_order')::int)
                  from jsonb_array_elements(question->'options') option
                  where coalesce((option->>'is_correct')::boolean,false))
  ) order by (question->>'sort_order')::int)
  from public.crew_journey_assignments a,
       jsonb_array_elements(a.journey_snapshot->'modules') module,
       jsonb_array_elements(module->'lessons') lesson,
       jsonb_array_elements(lesson->'quiz'->'questions') question
  where a.id=v_assignment and lesson->'quiz'->>'id'=v_quiz->>'id');
  v_result:=public.crew_submit_quiz(
    v_token,v_assignment,(v_quiz->>'id')::uuid,v_answers
  );
  insert into qa_verify_result values
    ('sequential','Passing required quiz succeeds',coalesce((v_result->>'passed')::boolean,false),v_result::text);
  v_result:=public.crew_complete_lesson(
    v_token,v_assignment,(v_lesson->'lesson'->>'id')::uuid
  );
  insert into qa_verify_result values
    ('sequential','Acknowledged SOP plus passed quiz completes lesson',coalesce((v_result->>'completed')::boolean,false),v_result::text);

  -- Publish v2 only inside this rollback transaction, create one temporary
  -- eligible Crew member, and prove old/new assignments use different frozen
  -- scoring, SOP and lesson text semantics.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated')::text,
    true
  );
  perform public.crew_publish_journey(v_draft);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_owner,'role','authenticated')::text,
    true
  );
  v_temp_employee:=gen_random_uuid();
  insert into public.employees(
    id,full_name,nickname,nationality,contact,employment_status,department,position,
    workplace,employee_code,joined_date,enable_system_login,access_state,is_active,audit_summary
  ) values(
    v_temp_employee,'QA Crew - Snapshot v2 Rollback','Snapshot v2','Malaysia','+601155500299','active',
    'Operations','Service Crew','Friends Corner','QA-CREW-V2-TEMP',current_date,
    false,'no_access',true,v_marker || ' · rollback-only'
  );
  perform public.manage_crew_access(v_temp_employee,'enable','5937');
  v_new_assignment:=(select id from public.crew_journey_assignments
    where employee_id=v_temp_employee and journey_id=v_draft);

  v_old_answer:=(select option->>'label'
  from public.crew_journey_assignments a,
       jsonb_array_elements(a.journey_snapshot->'modules') module,
       jsonb_array_elements(module->'lessons') lesson,
       jsonb_array_elements(lesson->'quiz'->'questions') question,
       jsonb_array_elements(question->'options') option
  where a.id=v_assignment and lesson->'quiz'->>'title'='Greeting Basics'
    and question->>'prompt'='When should a guest be acknowledged?'
    and coalesce((option->>'is_correct')::boolean,false));
  v_new_answer:=(select option->>'label'
  from public.crew_journey_assignments a,
       jsonb_array_elements(a.journey_snapshot->'modules') module,
       jsonb_array_elements(module->'lessons') lesson,
       jsonb_array_elements(lesson->'quiz'->'questions') question,
       jsonb_array_elements(question->'options') option
  where a.id=v_new_assignment and lesson->'quiz'->>'title'='Greeting Basics'
    and question->>'prompt'='When should a guest be acknowledged?'
    and coalesce((option->>'is_correct')::boolean,false));
  v_old_sop:=(select (block->'payload'->>'sop_version_id')::uuid
  from public.crew_journey_assignments a,
       jsonb_array_elements(a.journey_snapshot->'modules') module,
       jsonb_array_elements(module->'lessons') lesson,
       jsonb_array_elements(lesson->'blocks') block
  where a.id=v_assignment and block->'payload'->>'title'='Welcome & Goodbye Standard' limit 1);
  v_new_sop:=(select (block->'payload'->>'sop_version_id')::uuid
  from public.crew_journey_assignments a,
       jsonb_array_elements(a.journey_snapshot->'modules') module,
       jsonb_array_elements(module->'lessons') lesson,
       jsonb_array_elements(lesson->'blocks') block
  where a.id=v_new_assignment and block->'payload'->>'title'='Welcome & Goodbye Standard' limit 1);

  insert into qa_verify_result values
    ('snapshot','Old assignment retains v1 correct answer',v_old_answer='Within 5 seconds',v_old_answer),
    ('snapshot','New v2 assignment receives changed correct answer',v_new_answer='After taking the order',v_new_answer),
    ('snapshot','Old and new assignments pin different SOP versions',v_old_sop is not null and v_new_sop is not null and v_old_sop<>v_new_sop,v_old_sop::text || ' / ' || v_new_sop::text),
    ('snapshot','Old assignment stays on journey v1',(select journey_version_assigned=1 from public.crew_journey_assignments where id=v_assignment),null),
    ('snapshot','New eligible Crew receives journey v2',(select journey_version_assigned=2 from public.crew_journey_assignments where id=v_new_assignment),null),
    ('snapshot','New snapshot contains Draft v2 lesson text',(select journey_snapshot::text like '%Draft v2 coaching%' from public.crew_journey_assignments where id=v_new_assignment),null),
    ('snapshot','Old snapshot excludes Draft v2 lesson text',(select journey_snapshot::text not like '%Draft v2 coaching%' from public.crew_journey_assignments where id=v_assignment),null);

  -- Exercise the real snapshot-only scoring RPC for both versions. All other
  -- questions use their frozen correct choices while Q1 deliberately switches.
  v_quiz:=(select lesson->'quiz'
    from public.crew_journey_assignments a,
         jsonb_array_elements(a.journey_snapshot->'modules') module,
         jsonb_array_elements(module->'lessons') lesson
    where a.id=v_assignment and lesson->'quiz'->>'title'='Greeting Basics');
  v_answers:=(select jsonb_agg(jsonb_build_object(
    'question_id',question->>'id',
    'option_ids',case when question->>'prompt'='When should a guest be acknowledged?'
      then jsonb_build_array((select option->>'id' from jsonb_array_elements(question->'options') option where option->>'label'='Within 5 seconds'))
      else (select jsonb_agg(option->>'id' order by (option->>'sort_order')::int) from jsonb_array_elements(question->'options') option where coalesce((option->>'is_correct')::boolean,false)) end
  ) order by (question->>'sort_order')::int) from jsonb_array_elements(v_quiz->'questions') question);
  v_result:=public.crew_submit_quiz(v_old_token,v_assignment,(v_quiz->>'id')::uuid,v_answers);
  insert into qa_verify_result values('snapshot','Old v1 RPC scores A correct',coalesce((v_result->>'passed')::boolean,false) and (v_result->>'score')::int=100,v_result::text);
  v_answers:=jsonb_set(v_answers,'{0,option_ids}',jsonb_build_array((select option->>'id' from jsonb_array_elements(v_quiz->'questions'->0->'options') option where option->>'label'='After taking the order')));
  v_result:=public.crew_submit_quiz(v_old_token,v_assignment,(v_quiz->>'id')::uuid,v_answers);
  insert into qa_verify_result values('snapshot','Old v1 RPC scores B incorrect',not coalesce((v_result->>'passed')::boolean,false) and (v_result->>'score')::int=50,v_result::text);

  v_auth:=(select public.crew_authenticate(ca.mobile_number,'5937','full-demo-v2-verify') from public.crew_access ca where ca.employee_id=v_temp_employee);
  v_token:=v_auth->>'token';
  v_quiz:=(select lesson->'quiz'
    from public.crew_journey_assignments a,
         jsonb_array_elements(a.journey_snapshot->'modules') module,
         jsonb_array_elements(module->'lessons') lesson
    where a.id=v_new_assignment and lesson->'quiz'->>'title'='Greeting Basics');
  v_answers:=(select jsonb_agg(jsonb_build_object(
    'question_id',question->>'id',
    'option_ids',case when question->>'prompt'='When should a guest be acknowledged?'
      then jsonb_build_array((select option->>'id' from jsonb_array_elements(question->'options') option where option->>'label'='After taking the order'))
      else (select jsonb_agg(option->>'id' order by (option->>'sort_order')::int) from jsonb_array_elements(question->'options') option where coalesce((option->>'is_correct')::boolean,false)) end
  ) order by (question->>'sort_order')::int) from jsonb_array_elements(v_quiz->'questions') question);
  v_result:=public.crew_submit_quiz(v_token,v_new_assignment,(v_quiz->>'id')::uuid,v_answers);
  insert into qa_verify_result values('snapshot','New v2 RPC scores B correct',coalesce((v_result->>'passed')::boolean,false) and (v_result->>'score')::int=100,v_result::text);
  v_answers:=jsonb_set(v_answers,'{0,option_ids}',jsonb_build_array((select option->>'id' from jsonb_array_elements(v_quiz->'questions'->0->'options') option where option->>'label'='Within 5 seconds')));
  v_result:=public.crew_submit_quiz(v_token,v_new_assignment,(v_quiz->>'id')::uuid,v_answers);
  insert into qa_verify_result values('snapshot','New v2 RPC scores A incorrect',not coalesce((v_result->>'passed')::boolean,false) and (v_result->>'score')::int=50,v_result::text);

  -- Independent Clone From Outlet verification against a rollback-only outlet.
  v_temp_outlet:=gen_random_uuid();
  insert into public.outlets(id,name,code,location,address,status,is_active)
  values(v_temp_outlet,'QA Clone Target Rollback','QA-CLONE-TEMP','Staging','Rollback-only','active',true);
  v_clone:=public.crew_clone_learning_setup(v_outlet,v_temp_outlet,true,true,true);
  insert into qa_verify_result values
    ('clone','Clone creates an independent draft',(v_clone->>'status')='draft' and (v_clone->>'onboarding_id')::uuid<>v_draft,v_clone::text),
    ('clone','Clone copies 8 modules',(select count(*)=8 from public.crew_journey_modules where journey_id=(v_clone->>'onboarding_id')::uuid),null),
    ('clone','Clone copies all 23 v2 lessons',(select count(*)=23 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=(v_clone->>'onboarding_id')::uuid),null),
    ('clone','Clone copies quizzes',(select count(*)=6 from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=(v_clone->>'onboarding_id')::uuid),null),
    ('clone','Clone remaps SOP references to target outlet',not exists(
      select 1 from public.crew_lesson_blocks b
      join public.crew_lessons l on l.id=b.lesson_id
      join public.crew_journey_modules m on m.id=l.module_id
      join public.crew_sops source_sop on source_sop.id=(b.payload->>'sop_id')::uuid
      where m.journey_id=(v_clone->>'onboarding_id')::uuid
        and b.block_type='sop_reference' and source_sop.outlet_id<>v_temp_outlet
    ),null);

  if exists(select 1 from qa_verify_result where not passed) then
    raise exception 'Full Onboarding demo verification has failed assertions: %',(
      select jsonb_agg(jsonb_build_object('area',area,'assertion',assertion,'detail',detail))
      from qa_verify_result where not passed
    );
  end if;
end;
$verify$;

reset role;
select area,count(*) as passed
from qa_verify_result
where passed
group by area
order by area;
select count(*) as passed,count(*) as total
from qa_verify_result;
rollback;
