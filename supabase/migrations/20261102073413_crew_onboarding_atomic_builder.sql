-- One draft transaction owns ordering, deletion, localization sources and optimistic revision.
alter table public.crew_journeys add column draft_revision bigint not null default 0,
 add column last_save_request_id uuid, add column last_save_hash text;
alter table public.crew_journey_modules drop constraint crew_journey_modules_journey_id_sort_order_key;
alter table public.crew_journey_modules add constraint crew_journey_modules_journey_id_sort_order_key unique (journey_id,sort_order) deferrable initially immediate;
alter table public.crew_lessons drop constraint crew_lessons_module_id_sort_order_key;
alter table public.crew_lessons add constraint crew_lessons_module_id_sort_order_key unique (module_id,sort_order) deferrable initially immediate;
alter table public.crew_lesson_blocks drop constraint crew_lesson_blocks_lesson_id_sort_order_key;
alter table public.crew_lesson_blocks add constraint crew_lesson_blocks_lesson_id_sort_order_key unique (lesson_id,sort_order) deferrable initially immediate;
alter table public.crew_quiz_questions drop constraint crew_quiz_questions_quiz_id_sort_order_key;
alter table public.crew_quiz_questions add constraint crew_quiz_questions_quiz_id_sort_order_key unique (quiz_id,sort_order) deferrable initially immediate;
alter table public.crew_quiz_options drop constraint crew_quiz_options_question_id_sort_order_key;
alter table public.crew_quiz_options add constraint crew_quiz_options_question_id_sort_order_key unique (question_id,sort_order) deferrable initially immediate;

create function public.crew_onboarding_draft_nodes(p_payload jsonb)
returns table(kind int,id uuid,parent_id uuid,ordinal int,data jsonb)
language sql immutable set search_path='' as $$
 with modules as (select value as node, ordinality::int as n from jsonb_array_elements(p_payload->'modules') with ordinality),
 lessons as (select value as node, ordinality::int as n,(m.node->>'id')::uuid as parent from modules m cross join lateral jsonb_array_elements(coalesce(m.node->'lessons','[]')) with ordinality),
 blocks as (select value as node,ordinality::int as n,(l.node->>'id')::uuid as parent from lessons l cross join lateral jsonb_array_elements(coalesce(l.node->'blocks','[]')) with ordinality),
 quizzes as (select value as node,ordinality::int as n,(l.node->>'id')::uuid as parent from lessons l cross join lateral jsonb_array_elements(coalesce(l.node->'quizzes','[]')) with ordinality),
 questions as (select value as node,ordinality::int as n,(q.node->>'id')::uuid as parent from quizzes q cross join lateral jsonb_array_elements(coalesce(q.node->'questions','[]')) with ordinality),
 options as (select value as node,ordinality::int as n,(q.node->>'id')::uuid as parent from questions q cross join lateral jsonb_array_elements(coalesce(q.node->'options','[]')) with ordinality)
 select 1,(node->>'id')::uuid,(p_payload->>'id')::uuid,n,node from modules union all
 select 2,(node->>'id')::uuid,parent,n,node from lessons union all
 select 3,(node->>'id')::uuid,parent,n,node from blocks union all
 select 4,(node->>'id')::uuid,parent,n,node from quizzes union all
 select 5,(node->>'id')::uuid,parent,n,node from questions union all
 select 6,(node->>'id')::uuid,parent,n,node from options;
$$;
revoke all on function public.crew_onboarding_draft_nodes(jsonb) from public,anon,authenticated;

create function public.crew_save_onboarding_draft(p_journey_id uuid,p_expected_revision bigint,p_request_id uuid,p_payload jsonb,p_source_units jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.crew_journeys; n record; old_parent uuid; names text[]:=array['crew_journey_modules','crew_lessons','crew_lesson_blocks','crew_quizzes','crew_quiz_questions','crew_quiz_options'];
 parents text[]:=array['journey_id','module_id','lesson_id','lesson_id','quiz_id','question_id']; fingerprint text; kept uuid[];
begin
 if auth.uid() is null or not public.crew_learning_admin_can_access_journey(p_journey_id) then raise exception using errcode='42501',message='You cannot edit Onboarding for this outlet.';end if;
 select * into j from public.crew_journeys where id=p_journey_id for update;
 if j.status<>'draft' or not j.is_mandatory_onboarding then raise exception using errcode='22023',message='Only an Onboarding draft can be saved.';end if;
 if p_request_id is null or jsonb_typeof(p_source_units) is distinct from 'array' or jsonb_typeof(p_payload)<>'object' or p_payload->>'id' is distinct from p_journey_id::text or jsonb_typeof(p_payload->'modules') is distinct from 'array' or octet_length(p_payload::text)>2000000 then raise exception using errcode='22023',message='The Onboarding draft payload is invalid or too large.';end if;
 fingerprint:=md5(p_payload::text||p_source_units::text);
 if j.last_save_request_id=p_request_id then
  if j.last_save_hash<>fingerprint then raise exception using errcode='22023',message='This save request has different content. Start a new save.';end if;
  return public.crew_admin_onboarding_detail(j.id);
 end if;
 if p_expected_revision is distinct from j.draft_revision then raise exception using errcode='40001',message='This draft was saved in another session. Your edits are retained; reopen the latest draft before applying them.';end if;
 if (select count(*)>2000 from public.crew_onboarding_draft_nodes(p_payload)) or exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) where id is null) or exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) group by kind,id having count(*)>1) then raise exception using errcode='22023',message='Draft items need unique identities and must stay within the content limit.';end if;
 -- Existing identities cannot be borrowed from another version or parent.
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) loop
  old_parent:=null;
  execute format('select %I from public.%I where id=$1',parents[n.kind],names[n.kind]) into old_parent using n.id;
  if old_parent is not null and old_parent<>n.parent_id then raise exception using errcode='42501',message='A draft item belongs to another module, lesson or version.';end if;
 end loop;
 set constraints public.crew_journey_modules_journey_id_sort_order_key, public.crew_lessons_module_id_sort_order_key, public.crew_lesson_blocks_lesson_id_sort_order_key, public.crew_quiz_questions_quiz_id_sort_order_key, public.crew_quiz_options_question_id_sort_order_key deferred;
 delete from public.crew_quiz_options t where t.question_id in(select qq.id from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id) and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=6 and x.id=t.id);
 delete from public.crew_quiz_questions t where t.quiz_id in(select q.id from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id) and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=5 and x.id=t.id);
 delete from public.crew_quizzes t where t.lesson_id in(select l.id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id) and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=4 and x.id=t.id);
 delete from public.crew_lesson_blocks t where t.lesson_id in(select l.id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id) and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=3 and x.id=t.id);
 delete from public.crew_lessons t where t.module_id in(select id from public.crew_journey_modules where journey_id=p_journey_id) and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=2 and x.id=t.id);
 delete from public.crew_journey_modules t where t.journey_id=p_journey_id and not exists(select 1 from public.crew_onboarding_draft_nodes(p_payload) x where x.kind=1 and x.id=t.id);
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=1 order by parent_id,ordinal loop
  insert into public.crew_journey_modules(id,journey_id,title,description,sort_order,estimated_minutes,required,status) values(n.id,n.parent_id,btrim(coalesce(n.data->>'title','')),nullif(btrim(n.data->>'description'),''),n.ordinal,coalesce((n.data->>'estimated_minutes')::int,0),coalesce((n.data->>'required')::boolean,true),'draft') on conflict(id) do update set title=excluded.title,description=excluded.description,sort_order=excluded.sort_order,estimated_minutes=excluded.estimated_minutes,required=excluded.required,status=excluded.status;
 end loop;
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=2 order by parent_id,ordinal loop
  insert into public.crew_lessons(id,module_id,title,sort_order,content_type,required,estimated_minutes) values(n.id,n.parent_id,btrim(coalesce(n.data->>'title','')),n.ordinal,coalesce(n.data->>'content_type','lesson'),coalesce((n.data->>'required')::boolean,true),coalesce((n.data->>'estimated_minutes')::int,0)) on conflict(id) do update set title=excluded.title,sort_order=excluded.sort_order,content_type=excluded.content_type,required=excluded.required,estimated_minutes=excluded.estimated_minutes;
 end loop;
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=3 order by parent_id,ordinal loop
  insert into public.crew_lesson_blocks(id,lesson_id,block_type,payload,sort_order) values(n.id,n.parent_id,n.data->>'block_type',coalesce(n.data->'payload','{}')-'pending_image',n.ordinal) on conflict(id) do update set block_type=excluded.block_type,payload=excluded.payload,sort_order=excluded.sort_order;
 end loop;
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=4 order by parent_id,ordinal loop
  insert into public.crew_quizzes(id,lesson_id,title,passing_score,required,status) values(n.id,n.parent_id,btrim(coalesce(n.data->>'title','')),coalesce((n.data->>'passing_score')::int,80),coalesce((n.data->>'required')::boolean,true),'draft') on conflict(id) do update set title=excluded.title,passing_score=excluded.passing_score,required=excluded.required,status=excluded.status;
 end loop;
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=5 order by parent_id,ordinal loop
  insert into public.crew_quiz_questions(id,quiz_id,prompt,question_type,explanation,sort_order) values(n.id,n.parent_id,btrim(coalesce(n.data->>'prompt','')),coalesce(n.data->>'question_type','single_choice'),nullif(btrim(n.data->>'explanation'),''),n.ordinal) on conflict(id) do update set prompt=excluded.prompt,question_type=excluded.question_type,explanation=excluded.explanation,sort_order=excluded.sort_order;
 end loop;
 for n in select * from public.crew_onboarding_draft_nodes(p_payload) where kind=6 order by parent_id,ordinal loop
  insert into public.crew_quiz_options(id,question_id,label,is_correct,sort_order) values(n.id,n.parent_id,btrim(coalesce(n.data->>'label','')),coalesce((n.data->>'is_correct')::boolean,false),n.ordinal) on conflict(id) do update set label=excluded.label,is_correct=excluded.is_correct,sort_order=excluded.sort_order;
 end loop;
 set constraints public.crew_journey_modules_journey_id_sort_order_key, public.crew_lessons_module_id_sort_order_key, public.crew_lesson_blocks_lesson_id_sort_order_key, public.crew_quiz_questions_quiz_id_sort_order_key, public.crew_quiz_options_question_id_sort_order_key immediate;
 perform public.crew_save_localized_content_units('onboarding',j.id,p_source_units);
 update public.crew_journeys set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),description=nullif(btrim(p_payload->>'description'),''),
 draft_revision=draft_revision+1,last_save_request_id=p_request_id,last_save_hash=fingerprint,updated_at=clock_timestamp() where id=j.id;
 return public.crew_admin_onboarding_detail(j.id);
end;$$;
revoke all on function public.crew_save_onboarding_draft(uuid,bigint,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.crew_save_onboarding_draft(uuid,bigint,uuid,jsonb,jsonb) to authenticated;
-- Child row writes must go through the transaction/revision authority.
revoke insert,update,delete on public.crew_journeys,public.crew_journey_modules,public.crew_lessons,public.crew_lesson_blocks,public.crew_quizzes,public.crew_quiz_questions,public.crew_quiz_options from anon,authenticated;
do $$begin if md5(pg_get_functiondef('public.crew_publish_journey(uuid)'::regprocedure))<>'708b76beda7888b4fc022b795125e5f2' then raise exception 'Onboarding publish authority drift';end if;end;$$;
CREATE OR REPLACE FUNCTION public.crew_publish_journey(p_journey_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  journey_row public.crew_journeys%rowtype;
begin
  if not public.current_user_has_permission('crew_learning.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to publish Crew learning.';
  end if;

  select * into journey_row
  from public.crew_journeys
  where id = p_journey_id
    and status = 'draft' for update;

  if not found then
    raise exception using errcode = '22023', message = 'Only a draft Journey can be published.';
  end if;
  if not public.crew_learning_admin_can_access_journey(p_journey_id) then
    raise exception using errcode = '42501', message = 'You cannot publish learning for this outlet.';
  end if;
  if journey_row.is_mandatory_onboarding and journey_row.outlet_id is null then
    raise exception using errcode = '22023', message = 'Mandatory onboarding requires an outlet.';
  end if;
  if journey_row.is_mandatory_onboarding and (
    select count(*) from public.crew_journey_modules where journey_id = p_journey_id
  ) <> 8 then
    raise exception using errcode = '22023', message = 'New Crew Onboarding must contain exactly eight modules.';
  end if;
  if not exists (
    select 1 from public.crew_journey_modules where journey_id = p_journey_id
  ) or exists (
    select 1
    from public.crew_journey_modules m
    where m.journey_id = p_journey_id
      and not exists (select 1 from public.crew_lessons l where l.module_id = m.id)
  ) then
    raise exception using errcode = '22023', message = 'Every module needs at least one lesson.';
  end if;
  if exists (
    select 1
    from public.crew_quizzes q
    join public.crew_lessons l on l.id = q.lesson_id
    join public.crew_journey_modules m on m.id = l.module_id
    where m.journey_id = p_journey_id
      and (
        not exists (select 1 from public.crew_quiz_questions qq where qq.quiz_id = q.id)
        or exists (
          select 1 from public.crew_quiz_questions qq
          where qq.quiz_id = q.id
            and not exists (select 1 from public.crew_quiz_options o where o.question_id = qq.id)
        )
        or not exists (
          select 1
          from public.crew_quiz_options o
          join public.crew_quiz_questions qq on qq.id = o.question_id
          where qq.quiz_id = q.id and o.is_correct
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'Each quiz needs questions, options and a correct answer.';
  end if;

  if journey_row.is_mandatory_onboarding and journey_row.draft_revision<1 then raise exception using errcode='22023',message='Save the Onboarding draft successfully before publishing.';end if;
  perform public.crew_begin_learning_transition();
  update public.crew_journeys
  set status = 'published', published_at = now(), updated_at = now()
  where id = p_journey_id;
  update public.crew_journey_modules set status = 'published' where journey_id = p_journey_id;
  update public.crew_quizzes q
  set status = 'published'
  from public.crew_lessons l
  join public.crew_journey_modules m on m.id = l.module_id
  where q.lesson_id = l.id and m.journey_id = p_journey_id;
  perform public.crew_end_learning_transition();

  if journey_row.is_mandatory_onboarding then
    perform public.crew_sync_onboarding_enrollments(journey_row.outlet_id);
  end if;

  return p_journey_id;
end;
$function$
;

create function public.crew_publish_onboarding_draft(p_journey_id uuid,p_expected_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.crew_journeys;
begin
 if auth.uid() is null or not public.crew_learning_admin_can_access_journey(p_journey_id) then raise exception using errcode='42501',message='You cannot publish Onboarding for this outlet.';end if;
 select * into j from public.crew_journeys where id=p_journey_id for update;
 if not j.is_mandatory_onboarding or j.status<>'draft' or j.draft_revision<1 then raise exception using errcode='22023',message='Save the Onboarding draft successfully before publishing.';end if;
 if j.draft_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='This draft changed in another session. Reopen and review the latest draft before publishing.';end if;
 return public.crew_publish_journey(j.id);
end;$$;
revoke all on function public.crew_publish_onboarding_draft(uuid,bigint) from public,anon;
grant execute on function public.crew_publish_onboarding_draft(uuid,bigint) to authenticated;
do $$begin if md5(pg_get_functiondef('public.crew_admin_onboarding_progress(uuid)'::regprocedure))<>'6a6f4b743bb375ba555a06c2675f7348' then raise exception 'Onboarding progress authority drift';end if;end;$$;
CREATE OR REPLACE FUNCTION public.crew_admin_onboarding_progress(p_outlet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view onboarding progress for this outlet.';
  end if;

  perform public.crew_sync_onboarding_enrollments(p_outlet_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee', jsonb_build_object(
        'id', e.id,
        'full_name', e.full_name,
        'nickname', e.nickname,
        'position', e.position,
        'employee_code', e.employee_code
      ),
      'assignment_id', a.id,
      'journey_id', a.journey_id,
      'modules', (select coalesce(jsonb_agg(jsonb_build_object('id',x.item->'module'->>'id','title',x.item->'module'->>'title','sort_order',x.n,'completed',public.crew_snapshot_module_completed(a.id,(x.item->'module'->>'id')::uuid)) order by x.n),'[]'::jsonb) from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]')) with ordinality x(item,n)),
      'journey_version', (select version from public.crew_journeys where id=a.journey_id),
      'status', coalesce(a.status, 'not_started'),
      'started_at', a.started_at,
      'completed_at', a.completed_at,
      'progress_percentage', case
        when a.id is null or stats.required_total = 0 then 0
        else round(100.0 * stats.required_completed / stats.required_total)
      end,
      'completed_modules', coalesce(stats.completed_modules, 0),
      'total_modules', coalesce(stats.total_modules, 0),
      'knowledge_checks_passed', coalesce(stats.knowledge_checks_passed, 0),
      'knowledge_checks_total', coalesce(stats.knowledge_checks_total, 0),
      'current_module', stats.current_module
    ) order by e.full_name)
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    left join lateral (
      select assignment.*
      from public.crew_journey_assignments assignment
      join public.crew_journeys journey on journey.id = assignment.journey_id
      where assignment.employee_id = e.id
        and journey.outlet_id = p_outlet_id
        and journey.is_mandatory_onboarding
      order by assignment.assigned_at desc
      limit 1
    ) a on true
    left join lateral (
      select
        count(*) filter (where lesson.required) as required_total,
        count(*) filter (where lesson.required and lesson.completed) as required_completed,
        count(distinct module.module_id) as total_modules,
        count(distinct module.module_id) filter (where module.completed) as completed_modules,
        count(*) filter (where lesson.quiz_required) as knowledge_checks_total,
        count(*) filter (where lesson.quiz_required and lesson.quiz_passed) as knowledge_checks_passed,
        (
          select module_name
          from (
            select
              module_item->'module'->>'title' as module_name,
              module_ordinality,
              public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
            from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb))
              with ordinality modules(module_item, module_ordinality)
          ) current_module_row
          where not completed
          order by module_ordinality
          limit 1
        ) as current_module
      from (
        select
          module_item->'module'->>'id' as module_id,
          public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
        from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
      ) module
      cross join lateral (
        select
          coalesce((lesson_item->'lesson'->>'required')::boolean, true) as required,
          exists (
            select 1 from public.crew_lesson_progress lp
            where lp.assignment_id = a.id
              and lp.lesson_id = (lesson_item->'lesson'->>'id')::uuid
              and lp.status = 'completed'
          ) as completed,
          coalesce((lesson_item->'quiz'->>'required')::boolean, false) as quiz_required,
          exists (
            select 1 from public.crew_quiz_attempts qa
            where qa.employee_id = e.id
              and qa.quiz_id = (lesson_item->'quiz'->>'id')::uuid
              and qa.passed
          ) as quiz_passed
        from jsonb_array_elements(coalesce((
          select module_item->'lessons'
          from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
          where module_item->'module'->>'id' = module.module_id
        ), '[]'::jsonb)) lesson_item
      ) lesson
    ) stats on a.id is not null
    where ca.primary_outlet_id = p_outlet_id
      and ca.access_state = 'active'
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  ), '[]'::jsonb);
end;
$function$
;
