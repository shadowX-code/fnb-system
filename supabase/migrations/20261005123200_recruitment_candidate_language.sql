-- Preference is attempt-owned presentation context, never an evaluation rule.
alter table public.recruitment_interview_attempts add column preferred_language text not null default 'en'
  check (preferred_language in ('en','ms','zh','yue'));

create or replace function public.recruitment_public_entry(p_token text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; result jsonb;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then return jsonb_build_object('available',false); end if;
 select jsonb_build_object('available',true,
 'job',jsonb_build_object('title',ap.opening_title_snapshot,'position',ap.position_snapshot,'workplace',ap.workplace_snapshot,'company',ap.legal_entity_snapshot,'description',ap.opening_description_snapshot,'candidate_instructions',c.candidate_instructions,'target_minutes',c.target_minutes,'max_minutes',c.max_minutes),
 'profile',jsonb_build_object('full_name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact)),
 'preferred_language',t.preferred_language,'completed_at',t.interview_ended_at,'status',t.status,'consented',s.id is not null,'copy_version',v.version,'consent_copy',coalesce(s.copy_snapshot,v.copy),'consent_status',v.status) into result
 from recruitment_interview_attempts t join recruitment_applications ap on ap.id=t.application_id join recruitment_applicants p on p.id=ap.applicant_id join recruitment_interview_configs c on c.id=t.config_version_id
 left join recruitment_consents s on s.attempt_id=t.id
 join recruitment_consent_copy_versions v on v.version=coalesce(s.copy_version,recruitment_current_consent_version()) where t.id=a.id;
 return result;
end $$;

create function public.recruitment_public_language(p_token text,p_language text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
  a:=public.recruitment_public_attempt(p_token);
  if a.id is null then raise exception using errcode='42501',message='Interview link unavailable.'; end if;
  select * into a from public.recruitment_interview_attempts where id=a.id for update;
  -- Revalidate after the lock, including invitation expiry/revocation.
  if (public.recruitment_public_attempt(p_token)).id is null then
    raise exception using errcode='42501',message='Interview link unavailable.';
  end if;
  if p_language is null or p_language not in ('en','ms','zh','yue') then
    raise exception using errcode='22023',message='Choose an available interview language.';
  end if;
  if a.status not in ('invited','profile_confirmed','consented','ready') then
    raise exception using errcode='22023',message='Interview language is already pinned. You may switch languages naturally while speaking.';
  end if;
  if a.preferred_language<>p_language then
    update public.recruitment_interview_attempts set preferred_language=p_language where id=a.id;
  end if;
  return public.recruitment_public_entry(p_token);
end $$;
revoke all on function public.recruitment_public_language(text,text) from public,anon,authenticated;
grant execute on function public.recruitment_public_language(text,text) to anon,authenticated;
