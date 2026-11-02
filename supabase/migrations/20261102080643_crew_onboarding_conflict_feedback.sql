-- Business revision conflicts return HTTP 409; SQLSTATE 40001 is engine-only and can be retried indefinitely by PostgREST.
create or replace function public.crew_save_onboarding_draft(p_journey_id uuid,p_expected_revision bigint,p_request_id uuid,p_payload jsonb,p_source_units jsonb default '[]')
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
 if p_expected_revision is distinct from j.draft_revision then raise exception using errcode='PT409',message='This draft was saved in another session. Your edits are retained; reopen the latest draft before applying them.';end if;
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
create or replace function public.crew_publish_onboarding_draft(p_journey_id uuid,p_expected_revision bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.crew_journeys;
begin
 if auth.uid() is null or not public.crew_learning_admin_can_access_journey(p_journey_id) then raise exception using errcode='42501',message='You cannot publish Onboarding for this outlet.';end if;
 select * into j from public.crew_journeys where id=p_journey_id for update;
 if not j.is_mandatory_onboarding or j.status<>'draft' or j.draft_revision<1 then raise exception using errcode='22023',message='Save the Onboarding draft successfully before publishing.';end if;
 if j.draft_revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='This draft changed in another session. Reopen and review the latest draft before publishing.';end if;
 return public.crew_publish_journey(j.id);
end;$$;
