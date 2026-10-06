-- Approved candidate-information synchronization; reuse the Application authority.
create function public.recruitment_observe_preference(p_token text,p_client_id uuid,p_preference text,p_turn_number integer,p_quote text)
returns void language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype:=recruitment_session(p_token,p_client_id); t recruitment_transcript_turns%rowtype;
begin
 if p_preference is null or p_preference not in ('full_time','part_time','both') then raise exception using errcode='22023',message='Explicit employment preference required.'; end if;
 select * into t from recruitment_transcript_turns where attempt_id=a.id and turn_number=p_turn_number and speaker='candidate';
 if t.id is null or p_quote is null or length(btrim(p_quote))<3 or length(p_quote)>2500 or strpos(t.transcript,p_quote)=0 then raise exception using errcode='22023',message='Exact candidate preference citation required.'; end if;
 if not exists(select 1 from recruitment_applications where id=a.application_id and decision_state not in ('hired','rejected')) then raise exception using errcode='42501',message='Application unavailable.'; end if;
 perform recruitment_set_preference_internal(a.application_id,p_preference,null,t.id);
end $$;
revoke all on function public.recruitment_observe_preference(text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.recruitment_observe_preference(text,uuid,text,integer,text) to service_role;
