-- Local evidence observations only; no additional external provider request.
create or replace function public.recruitment_learning_completion() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('completed','partial','failed') and old.status not in ('completed','partial','failed') then
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,'unresolved_item',topic||': '||state,case when evidence_turn_id is null then '{}'::bigint[] else array[evidence_turn_id] end,'topic:'||topic_index from recruitment_topic_coverage where attempt_id=new.id and state<>'covered' on conflict do nothing;
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,'scenario_usage',brief||': '||case when equivalent_turn_id is not null then 'equivalent real-world evidence' else state end,array_remove(array[asked_turn_id,evidence_turn_id,equivalent_turn_id],null),'scenario:'||scenario_index from recruitment_scenario_progress where attempt_id=new.id on conflict do nothing;
  -- Literal finalized questions only. No semantic/personality inference. Quote
  -- source text and keep citations; absence of a signal never implies absence.
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,'candidate_question',left(t.transcript,1000),array[t.id],'question:'||t.id
   from recruitment_transcript_turns t where t.attempt_id=new.id and t.speaker='candidate'
   and (t.transcript ~ '[?？]' or t.transcript ~* '^(what|when|where|how|can i|could i|may i|berapa|boleh saya|bila|bagaimana|apakah|请问|請問|有没有|有沒有|薪水|福利)\y') on conflict do nothing;
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   select new.id,new.config_version_id,k.kind,left(q.observation,800)||' — interviewer explicitly could not confirm',q.turn_ids||array[t.id],k.kind||':'||q.source_key
   from recruitment_learning_observations q
   join recruitment_transcript_turns c on c.id=q.turn_ids[1]
   cross join lateral (select id,transcript from recruitment_transcript_turns where attempt_id=new.id and speaker='ai' and turn_number>c.turn_number order by turn_number limit 1) t
   cross join (values ('unconfirmed_question'),('knowledge_gap')) k(kind)
   where q.attempt_id=new.id and q.kind='candidate_question'
   and t.transcript ~* '(not confirmed|not sure|cannot confirm|hiring team can clarify|belum disahkan|tidak pasti|tak pasti|未确认|未確認|不确定|不確定|唔确定|唔確定)' on conflict do nothing;
 end if;
 return new;
end $$;
