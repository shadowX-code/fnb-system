-- Explicit citation alias prevents inner transcript IDs shadowing the requested ID.
create or replace function public.recruitment_capture_learning(p_attempt_id uuid,p_observations jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; x jsonb; ids bigint[]; n integer:=0; added integer;
begin
 select * into a from recruitment_interview_attempts where id=p_attempt_id;
 if a.id is null or a.status not in ('completed','partial','failed') then raise exception 'Learning requires a terminal interview.'; end if;
 if jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)>50 then raise exception 'Invalid learning observations.'; end if;
 for x in select value from jsonb_array_elements(p_observations) loop
  ids:=array(select value::bigint from jsonb_array_elements_text(x->'turn_ids'));
  if cardinality(ids)=0 or exists(select 1 from unnest(ids) as citation(turn_id) where not exists(select 1 from recruitment_transcript_turns t where t.id=citation.turn_id and t.attempt_id=a.id)) then raise exception 'Learning citation is invalid.'; end if;
  if x->>'kind' in ('candidate_question','unconfirmed_question') and not exists(select 1 from recruitment_transcript_turns where id=any(ids) and attempt_id=a.id and speaker='candidate') then raise exception 'Candidate question needs candidate evidence.'; end if;
  insert into recruitment_learning_observations(attempt_id,config_version_id,kind,observation,turn_ids,source_key)
   values(a.id,a.config_version_id,x->>'kind',x->>'observation',ids,encode(extensions.digest((x->>'kind')||':'||array_to_string(ids,','),'sha256'),'hex')) on conflict do nothing;
  get diagnostics added=row_count; n:=n+added;
 end loop;
 return n;
end $$;
