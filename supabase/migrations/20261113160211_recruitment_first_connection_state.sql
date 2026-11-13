-- A reserved provider generation or a recording unit does not establish a live interview.
create or replace function public.recruitment_public_entry(p_token text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; result jsonb;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then return jsonb_build_object('available',false); end if;
 select jsonb_build_object('available',true,
 'job',jsonb_build_object('title',ap.opening_title_snapshot,'position',ap.position_snapshot,'workplace',ap.workplace_snapshot,'company',ap.legal_entity_snapshot,'description',ap.opening_description_snapshot,'candidate_instructions',c.candidate_instructions,'target_minutes',c.target_minutes,'max_minutes',c.max_minutes),
 'profile',jsonb_build_object('full_name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact)),
 'has_connected',t.provider_connected_at is not null or exists (
   select 1 from recruitment_events e where e.attempt_id=t.id and e.action='provider_connected'
 ),'preferred_language',t.preferred_language,'completed_at',t.interview_ended_at,'status',t.status,'consented',s.id is not null,'copy_version',v.version,'consent_copy',coalesce(s.copy_snapshot,v.copy),'consent_status',v.status) into result
 from recruitment_interview_attempts t join recruitment_applications ap on ap.id=t.application_id join recruitment_applicants p on p.id=ap.applicant_id join recruitment_interview_configs c on c.id=t.config_version_id
 left join recruitment_consents s on s.attempt_id=t.id
 join recruitment_consent_copy_versions v on v.version=coalesce(s.copy_version,recruitment_current_consent_version()) where t.id=a.id;
 return result;
end $$;
