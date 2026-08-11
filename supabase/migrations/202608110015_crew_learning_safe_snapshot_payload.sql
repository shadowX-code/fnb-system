-- Keep immutable scoring data private; expose a separately constructed Crew payload.
-- This migration was never recorded remotely, so this is the corrected first application.
create or replace function public.crew_learning_assignment(
 p_token text,
 p_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 e uuid;
 a public.crew_journey_assignments%rowtype;
 safe_modules jsonb;
begin
 e:=public.crew_session_employee(p_token);
 select * into a
 from public.crew_journey_assignments
 where id=p_assignment_id and employee_id=e;

 if not found then
  raise exception using errcode='42501',message='Learning assignment is unavailable.';
 end if;

 select coalesce(
  jsonb_agg(module_payload order by module_sort),
  '[]'::jsonb
 ) into safe_modules
 from (
  select
   (m->'module'->>'sort_order')::int as module_sort,
   jsonb_build_object(
    'module',m->'module'-'created_by',
    'lessons',coalesce((
     select jsonb_agg(lesson_payload order by lesson_sort)
     from (
      select
       (l->'lesson'->>'sort_order')::int as lesson_sort,
       jsonb_build_object(
        'lesson',l->'lesson',
        'blocks',coalesce((
         select jsonb_agg(
          jsonb_build_object(
           'id',b->'id',
           'block_type',b->'block_type',
           'payload',b->'payload',
           'sort_order',b->'sort_order'
          ) order by (b->>'sort_order')::int
         )
         from jsonb_array_elements(coalesce(l->'blocks','[]'::jsonb)) b
        ),'[]'::jsonb),
        'quiz',case
         when l->'quiz' is null or jsonb_typeof(l->'quiz')='null' then null
         else jsonb_build_object(
          'id',l->'quiz'->'id',
          'title',l->'quiz'->'title',
          'passing_score',l->'quiz'->'passing_score',
          'required',l->'quiz'->'required',
          'questions',coalesce((
           select jsonb_agg(question_payload order by question_sort)
           from (
            select
             (q->>'sort_order')::int as question_sort,
             jsonb_build_object(
              'id',q->'id',
              'prompt',q->'prompt',
              'question_type',q->'question_type',
              'sort_order',q->'sort_order',
              'options',coalesce((
               select jsonb_agg(
                jsonb_build_object(
                 'id',o->'id',
                 'label',o->'label',
                 'sort_order',o->'sort_order'
                ) order by (o->>'sort_order')::int
               )
               from jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) o
              ),'[]'::jsonb)
             ) as question_payload
            from jsonb_array_elements(coalesce(l->'quiz'->'questions','[]'::jsonb)) q
           ) ordered_questions
          ),'[]'::jsonb)
         )
        end
       ) as lesson_payload
      from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) l
     ) ordered_lessons
    ),'[]'::jsonb)
   ) as module_payload
  from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m
 ) ordered_modules;

 return jsonb_build_object(
  'id',a.id,
  'status',a.status,
  'started_at',a.started_at,
  'completed_at',a.completed_at,
  'journey',a.journey_snapshot->'journey'-'created_by',
  'modules',safe_modules,
  'lesson_progress',(
   select coalesce(
    jsonb_agg(
     jsonb_build_object(
      'lesson_id',lesson_id,
      'status',status,
      'completed_at',completed_at
     ) order by lesson_id
    ),
    '[]'::jsonb
   )
   from public.crew_lesson_progress
   where assignment_id=a.id
  )
 );
end;
$$;

revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_learning_assignment(text,uuid) to anon,authenticated;

-- Crew users have no direct row policy for assignments; raw snapshot stays authority-only.
drop policy if exists crew_learning_crew_assignment_read on public.crew_journey_assignments;
