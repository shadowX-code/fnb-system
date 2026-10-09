-- Focused, no lasting evidence changes. Run after the provenance migration.
begin;
do $qa$
declare s jsonb; n int; a uuid:='73709e06-80ae-4142-9629-e4444eb99824';
begin
 -- Exercise the authoritative exclusion without modifying the physical turn.
 insert into recruitment_transcript_annotations(attempt_id,provider_generation,provider_item_id,kind,elapsed_ms)
 select attempt_id,provider_generation,provider_item_id,'unverified_candidate',elapsed_end_ms
 from recruitment_transcript_turns where attempt_id=a and turn_number=2 on conflict do nothing;
 if recruitment_turn_eligible(a,720) then raise exception 'Disputed turn eligible'; end if;
 s:=recruitment_eligible_context(jsonb_build_object('turns',(select jsonb_agg(to_jsonb(t)) from recruitment_transcript_turns t where attempt_id=a),'topics','[]'::jsonb,'scenarios','[]'::jsonb,'current_findings',jsonb_build_array(jsonb_build_object('evidence_turn_id',720))),a);
 if exists(select 1 from jsonb_array_elements(s->'turns') t where t->>'id'='720') then raise exception 'Disputed text leaked into intelligence'; end if;
 if jsonb_array_length(s->'current_findings')<>0 then raise exception 'Disputed findings leaked'; end if;
 if not exists(select 1 from recruitment_transcript_turns where id=720) then raise exception 'Original text lost'; end if;
 if has_function_privilege('anon','recruitment_dispute_transcript(bigint,text)','execute') or has_function_privilege('authenticated','recruitment_turn_eligible(uuid,bigint)','execute') then raise exception 'Unscoped helper access'; end if;
 if not has_function_privilege('authenticated','recruitment_dispute_transcript(bigint,text)','execute') then raise exception 'Manager workflow missing'; end if;
end $qa$;
set local role anon;
do $qa$
begin
 begin perform recruitment_dispute_transcript(720,'Unauthorized dispute'); raise exception 'Anonymous dispute accepted'; exception when insufficient_privilege then null; end;
end $qa$;
rollback;
