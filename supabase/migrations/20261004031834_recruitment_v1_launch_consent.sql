-- Approved product copy is a new immutable version; accepted historical evidence stays pinned.
insert into public.recruitment_consent_copy_versions(version,copy,status) values
('feedx-interview-v1-approved',jsonb_build_object(
 'title','Before you begin',
 'body',jsonb_build_array(
  'This interview will be conducted by an AI interviewer and recorded using your camera and microphone.',
  'Your responses, interview transcript and recording will be used by the hiring team to review your application.',
  'Please complete the interview in a private and comfortable environment. You may leave the interview at any time before submitting it.'
 ),
 'consent','I understand and consent to the AI interview and recording of my camera and microphone for recruitment review.'
),'approved');

create function public.recruitment_current_consent_version() returns text language sql stable security definer set search_path=public as $$
 select version from recruitment_consent_copy_versions order by (status='approved') desc,created_at desc,version desc limit 1;
$$;
revoke all on function public.recruitment_current_consent_version() from public,anon,authenticated;
-- Existing replaced SECURITY DEFINER entry points retain their canonical postgres owner.
grant execute on function public.recruitment_current_consent_version() to postgres;

create or replace function public.recruitment_public_entry(p_token text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; result jsonb;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then return jsonb_build_object('available',false); end if;
 select jsonb_build_object('available',true,
 'job',jsonb_build_object('title',ap.opening_title_snapshot,'position',ap.position_snapshot,'workplace',ap.workplace_snapshot,'company',ap.legal_entity_snapshot,'description',ap.opening_description_snapshot,'candidate_instructions',c.candidate_instructions,'target_minutes',c.target_minutes,'max_minutes',c.max_minutes),
 'profile',jsonb_build_object('full_name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact)),
 'status',t.status,'consented',s.id is not null,'copy_version',v.version,'consent_copy',coalesce(s.copy_snapshot,v.copy),'consent_status',v.status) into result
 from recruitment_interview_attempts t join recruitment_applications ap on ap.id=t.application_id join recruitment_applicants p on p.id=ap.applicant_id join recruitment_interview_configs c on c.id=t.config_version_id
 left join recruitment_consents s on s.attempt_id=t.id
 join recruitment_consent_copy_versions v on v.version=coalesce(s.copy_version,recruitment_current_consent_version()) where t.id=a.id;
 return result;
end $$;

create or replace function public.recruitment_public_consent(p_token text,p_copy_version text,p_accepted jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; existing recruitment_consents%rowtype; copy jsonb;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
 select * into a from recruitment_interview_attempts where id=a.id for update;
 select * into existing from recruitment_consents where attempt_id=a.id;
 if existing.id is not null then
  if p_copy_version is distinct from existing.copy_version or p_accepted is distinct from existing.accepted_purposes then raise exception using errcode='22023',message='Consent was already recorded for this interview.'; end if;
  return recruitment_public_entry(p_token);
 end if;
 if a.status<>'profile_confirmed' then raise exception using errcode='55000',message='Confirm your profile first.'; end if;
 select v.copy into copy from recruitment_consent_copy_versions v where v.version=p_copy_version and v.version=recruitment_current_consent_version();
 if copy is null then raise exception using errcode='22023',message='Consent copy has changed. Reload this page.'; end if;
 if p_accepted is distinct from '{"ai":true,"recording":true,"review":true}'::jsonb then raise exception using errcode='22023',message='Consent to the interview, recording and recruitment review is required.'; end if;
 insert into recruitment_consents(attempt_id,application_id,copy_version,copy_snapshot,accepted_purposes) values(a.id,a.application_id,p_copy_version,copy,p_accepted);
 update recruitment_interview_attempts set status='consented' where id=a.id;
 insert into recruitment_events(opening_id,application_id,attempt_id,action,details) values(a.opening_id,a.application_id,a.id,'consent_accepted',jsonb_build_object('copy_version',p_copy_version));
 return recruitment_public_entry(p_token);
end $$;

-- Preserve established scope, pagination and evidence projections; readiness describes copy only.
alter function public.recruitment_admin_data(integer,integer) rename to recruitment_admin_data_phase3;
revoke all on function public.recruitment_admin_data_phase3(integer,integer) from public,anon,authenticated;
create function public.recruitment_admin_data(p_page integer default 1,p_page_size integer default 20) returns jsonb language sql stable security definer set search_path=public as $$
 select recruitment_admin_data_phase3(p_page,p_page_size)||jsonb_build_object('consent_status',(select status from recruitment_consent_copy_versions where version=recruitment_current_consent_version()));
$$;
alter function public.recruitment_admin_evidence(uuid,uuid) rename to recruitment_admin_evidence_phase3;
revoke all on function public.recruitment_admin_evidence_phase3(uuid,uuid) from public,anon,authenticated;
create function public.recruitment_admin_evidence(p_application_id uuid,p_attempt_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select recruitment_admin_evidence_phase3(p_application_id,p_attempt_id)||jsonb_build_object('launch_ready',exists(select 1 from recruitment_consent_copy_versions where version=recruitment_current_consent_version() and status='approved'));
$$;
create or replace function public.recruitment_admin_evidence(p_application_id uuid) returns jsonb language sql stable security definer set search_path=public as $$ select recruitment_admin_evidence(p_application_id,null); $$;
revoke all on function public.recruitment_public_entry(text),public.recruitment_public_consent(text,text,jsonb),public.recruitment_admin_data(integer,integer),public.recruitment_admin_evidence(uuid),public.recruitment_admin_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_public_entry(text),public.recruitment_public_consent(text,text,jsonb) to anon,authenticated;
grant execute on function public.recruitment_admin_data(integer,integer),public.recruitment_admin_evidence(uuid),public.recruitment_admin_evidence(uuid,uuid) to authenticated;
