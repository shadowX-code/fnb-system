-- Domain conflicts are permanent for this revision, not retryable database serialization failures.
-- PT409 returns one HTTP conflict instead of PostgREST transaction retrying SQLSTATE 40001.
create or replace function public.recruitment_prepare_profile_draft(p_profile_key text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype;
begin
 if p_profile_key is distinct from 'service_crew' then raise exception using errcode='22023',message='Interview Profile is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:'||p_profile_key,0));
 select * into d from recruitment_interview_profile_drafts where profile_key=p_profile_key and status='draft';
 if d.id is null then
  select * into p from recruitment_interview_profiles where profile_key=p_profile_key order by version desc limit 1;
  if p.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Profile has changed. Reload before preparing a draft.'; end if;
  insert into recruitment_interview_profile_drafts(profile_key,base_profile_id,definition,created_by,updated_by) values(p_profile_key,p.id,p.definition,actor,actor) returning * into d;
  insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_created',actor,jsonb_build_object('draft_id',d.id,'base_profile_id',p.id));
 else select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 end if;
 return to_jsonb(d)||jsonb_build_object('name',p.name,'version',p.version+1);
end $$;

create or replace function public.recruitment_save_profile_draft(p_draft_id uuid,p_expected_revision integer,p_definition jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype;
begin
 -- Incomplete authoring is allowed; publication applies the full profile validator.
 if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>60000 or jsonb_typeof(p_definition->'evidence_areas') is distinct from 'array' or jsonb_typeof(p_definition->'scenarios') is distinct from 'array' or jsonb_typeof(p_definition->'completion_criteria') is distinct from 'object' then raise exception using errcode='22023',message='Draft must be a bounded profile definition.'; end if;
 select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
 if d.id is null or d.status<>'draft' then raise exception using errcode='55000',message='This draft is no longer editable. Reload the Profile Library.'; end if;
 if d.revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='A newer draft has been saved. Your edits have not overwritten it. Reload the saved draft before editing again.'; end if;
 select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 -- Safe retry after an acknowledged/lost save, without creating noisy revisions.
 if d.definition is distinct from p_definition then
  update recruitment_interview_profile_drafts set definition=p_definition,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=d.id returning * into d;
  insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_saved',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision));
 end if;
 return to_jsonb(d)||jsonb_build_object('name',p.name,'version',p.version+1);
end $$;

create or replace function public.recruitment_publish_profile(p_definition jsonb,p_expected_version integer) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform recruitment_actor('recruitment.manage');
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:service_crew',0));
 if exists(select 1 from recruitment_interview_profile_drafts where profile_key='service_crew' and status='draft') then raise exception using errcode='55000',message='Resume and publish the saved draft from Interview Profiles.'; end if;
 return recruitment_publish_profile_version(p_definition,p_expected_version);
exception when serialization_failure then
 raise exception using errcode='PT409',message='The published profile has changed. Reload before publishing.';
end $$;

create or replace function public.recruitment_publish_profile_draft(p_draft_id uuid,p_expected_revision integer) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:service_crew',0));
 select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
 if d.id is null then raise exception using errcode='55000',message='Draft is unavailable.'; end if;
 if d.revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='A newer draft has been saved. Reload before publishing.'; end if;
 if d.status='published' then return d.published_profile_id; end if;
 select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 result:=recruitment_publish_profile_version(d.definition,p.version);
 update recruitment_interview_profile_drafts set status='published',published_profile_id=result,updated_by=actor,updated_at=clock_timestamp() where id=d.id;
 insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_published',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision,'profile_id',result));
 return result;
exception when serialization_failure then
 raise exception using errcode='PT409',message='The published profile has changed. Reload before publishing.';
end $$;
