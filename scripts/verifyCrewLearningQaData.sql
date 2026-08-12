-- Rollback-only Crew-side verification for the Staging QA learning dataset.
-- It proves the mobile payload is safe and operational without leaving a
-- session, quiz attempt, acknowledgement, or progress update behind.

begin;
create temporary table qa_seed_context (assignment_id uuid not null) on commit drop;
insert into qa_seed_context(assignment_id)
select a.id
from public.crew_journey_assignments a
join public.crew_journeys j on j.id=a.journey_id
where a.employee_id='a090954a-e82f-4121-89ac-9e5adefa8040'::uuid
  and j.name='New Crew Onboarding'
  and j.position='QA Seed'
order by a.assigned_at desc
limit 1;
grant select on qa_seed_context to anon;
set local role anon;

do $$
declare
  v_auth jsonb;
  v_token text;
  v_assignment uuid;
  v_home jsonb;
  v_payload jsonb;
  v_quiz uuid;
  v_answers jsonb;
  v_result jsonb;
begin
  select assignment_id into v_assignment from qa_seed_context;
  if v_assignment is null then raise exception 'QA onboarding assignment is missing'; end if;
  v_auth:=public.crew_authenticate('60-12321312321','4829','qa-seed-verification');
  v_token:=v_auth->>'token';
  v_home:=public.crew_learning_home(v_token);
  v_payload:=public.crew_learning_assignment(v_token,v_assignment);

  if v_home->'assignment'->>'id' <> v_assignment::text then raise exception 'Crew Learn Home did not return the QA assignment'; end if;
  if jsonb_array_length(v_payload->'modules') <> 3 then raise exception 'QA payload did not return three modules'; end if;
  if coalesce((v_payload->'modules'->0->>'available')::boolean,false) is not true
    or coalesce((v_payload->'modules'->1->>'locked')::boolean,false) is not true then
    raise exception 'Sequential module availability is not correct';
  end if;
  if coalesce((v_payload->'modules'->0->'lessons'->0->>'available')::boolean,false) is not true
    or coalesce((v_payload->'modules'->0->'lessons'->1->>'locked')::boolean,false) is not true then
    raise exception 'Sequential lesson availability is not correct';
  end if;
  if not jsonb_path_exists(v_payload,'$.modules[*].lessons[*].blocks[*] ? (@.block_type == "sop_reference" && @.payload.required_acknowledgement == true)') then
    raise exception 'QA payload did not expose a required SOP acknowledgement';
  end if;
  if v_payload::text like '%is_correct%' or v_payload::text like '%correct_option%' or v_payload::text like '%journey_snapshot%' then
    raise exception 'Crew safe payload exposed scoring or raw snapshot data';
  end if;

  v_quiz:=(v_payload->'modules'->0->'lessons'->1->'quiz'->>'id')::uuid;
  select jsonb_agg(jsonb_build_object('question_id',q->>'id','option_ids',jsonb_build_array(q->'options'->0->>'id')))
    into v_answers
  from jsonb_array_elements(v_payload->'modules'->0->'lessons'->1->'quiz'->'questions') q;
  v_result:=public.crew_submit_quiz(v_token,v_assignment,v_quiz,v_answers);
  if not (v_result ? 'attempt_id') or v_result::text like '%is_correct%' or v_result::text like '%correct%' then
    raise exception 'Quiz submission was unavailable or exposed answer data';
  end if;
end;
$$;

rollback;
