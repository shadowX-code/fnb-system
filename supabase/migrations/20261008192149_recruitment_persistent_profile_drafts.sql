-- Mutable authoring is separate from the immutable published profile authority.
create table public.recruitment_interview_profile_drafts (
 id uuid primary key default gen_random_uuid(),
 profile_key text not null check(profile_key='service_crew'),
 base_profile_id uuid not null references public.recruitment_interview_profiles(id),
 definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=60000),
 revision integer not null default 1 check(revision>0),
 status text not null default 'draft' check(status in ('draft','published')),
 published_profile_id uuid references public.recruitment_interview_profiles(id),
 created_by uuid not null references public.employees(id),
 updated_by uuid not null references public.employees(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='draft' and published_profile_id is null) or (status='published' and published_profile_id is not null))
);
create unique index recruitment_one_active_profile_draft on public.recruitment_interview_profile_drafts(profile_key) where status='draft';
alter table public.recruitment_interview_profile_drafts enable row level security;
revoke all on public.recruitment_interview_profile_drafts from public,anon,authenticated,service_role;
grant select on public.recruitment_interview_profile_drafts to service_role;

create function public.recruitment_profile_drafts() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform recruitment_actor('recruitment.view');
 return coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('name',p.name,'version',p.version+1) order by d.updated_at desc)
 from recruitment_interview_profile_drafts d join recruitment_interview_profiles p on p.id=d.base_profile_id where d.status='draft'),'[]'::jsonb);
end $$;

-- Shared family lock makes repeated/concurrent Prepare calls resume the same draft.
create function public.recruitment_prepare_profile_draft(p_profile_key text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype;
begin
 if p_profile_key is distinct from 'service_crew' then raise exception using errcode='22023',message='Interview Profile is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:'||p_profile_key,0));
 select * into d from recruitment_interview_profile_drafts where profile_key=p_profile_key and status='draft';
 if d.id is null then
  select * into p from recruitment_interview_profiles where profile_key=p_profile_key order by version desc limit 1;
  if p.version is distinct from p_expected_version then raise exception using errcode='40001',message='Profile has changed. Reload before preparing a draft.'; end if;
  insert into recruitment_interview_profile_drafts(profile_key,base_profile_id,definition,created_by,updated_by) values(p_profile_key,p.id,p.definition,actor,actor) returning * into d;
  insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_created',actor,jsonb_build_object('draft_id',d.id,'base_profile_id',p.id));
 else select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 end if;
 return to_jsonb(d)||jsonb_build_object('name',p.name,'version',p.version+1);
end $$;

create function public.recruitment_save_profile_draft(p_draft_id uuid,p_expected_revision integer,p_definition jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype;
begin
 -- Incomplete authoring is allowed; publication applies the full profile validator.
 if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>60000 or jsonb_typeof(p_definition->'evidence_areas') is distinct from 'array' or jsonb_typeof(p_definition->'scenarios') is distinct from 'array' or jsonb_typeof(p_definition->'completion_criteria') is distinct from 'object' then raise exception using errcode='22023',message='Draft must be a bounded profile definition.'; end if;
 select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
 if d.id is null or d.status<>'draft' then raise exception using errcode='55000',message='This draft is no longer editable. Reload the Profile Library.'; end if;
 if d.revision is distinct from p_expected_revision then raise exception using errcode='40001',message='A newer draft has been saved. Your edits have not overwritten it. Reload the saved draft before editing again.'; end if;
 select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 -- Safe retry after an acknowledged/lost save, without creating noisy revisions.
 if d.definition is distinct from p_definition then
  update recruitment_interview_profile_drafts set definition=p_definition,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=d.id returning * into d;
  insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_saved',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision));
 end if;
 return to_jsonb(d)||jsonb_build_object('name',p.name,'version',p.version+1);
end $$;

-- Retain the existing validator/version insertion authority behind both entry points.
alter function public.recruitment_publish_profile(jsonb,integer) rename to recruitment_publish_profile_version;
revoke all on function public.recruitment_publish_profile_version(jsonb,integer) from public,anon,authenticated,service_role;
create function public.recruitment_publish_profile(p_definition jsonb,p_expected_version integer) returns uuid language plpgsql security definer set search_path=public as $$
begin
 perform recruitment_actor('recruitment.manage');
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:service_crew',0));
 if exists(select 1 from recruitment_interview_profile_drafts where profile_key='service_crew' and status='draft') then raise exception using errcode='55000',message='Resume and publish the saved draft from Interview Profiles.'; end if;
 return recruitment_publish_profile_version(p_definition,p_expected_version);
end $$;

create function public.recruitment_publish_profile_draft(p_draft_id uuid,p_expected_revision integer) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); d recruitment_interview_profile_drafts%rowtype; p recruitment_interview_profiles%rowtype; result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('recruitment_profile:service_crew',0));
 select * into d from recruitment_interview_profile_drafts where id=p_draft_id for update;
 if d.id is null then raise exception using errcode='55000',message='Draft is unavailable.'; end if;
 if d.revision is distinct from p_expected_revision then raise exception using errcode='40001',message='A newer draft has been saved. Reload before publishing.'; end if;
 if d.status='published' then return d.published_profile_id; end if;
 select * into p from recruitment_interview_profiles where id=d.base_profile_id;
 result:=recruitment_publish_profile_version(d.definition,p.version);
 update recruitment_interview_profile_drafts set status='published',published_profile_id=result,updated_by=actor,updated_at=clock_timestamp() where id=d.id;
 insert into recruitment_events(action,actor_employee_id,details) values('interview_profile_draft_published',actor,jsonb_build_object('draft_id',d.id,'revision',d.revision,'profile_id',result));
 return result;
end $$;

revoke all on function public.recruitment_profile_drafts() from public,anon,authenticated,service_role;
revoke all on function public.recruitment_prepare_profile_draft(text,integer) from public,anon,authenticated,service_role;
revoke all on function public.recruitment_save_profile_draft(uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.recruitment_publish_profile_draft(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.recruitment_publish_profile(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.recruitment_profile_drafts(),public.recruitment_prepare_profile_draft(text,integer),public.recruitment_save_profile_draft(uuid,integer,jsonb),public.recruitment_publish_profile_draft(uuid,integer),public.recruitment_publish_profile(jsonb,integer) to authenticated;
