-- Application preference is candidate information, never Profile/coverage/fit.
alter table public.recruitment_applications add column employment_preference text not null default 'unknown' check (employment_preference in ('unknown','full_time','part_time','both')),
 add column preference_updated_at timestamptz,
 add column preference_turn_id bigint references public.recruitment_transcript_turns(id);

create function public.recruitment_set_preference_internal(p_application_id uuid,p_preference text,p_actor uuid,p_turn_id bigint default null) returns void language plpgsql security definer set search_path=public as $$
declare a recruitment_applications%rowtype; t recruitment_transcript_turns%rowtype; observed timestamptz:=clock_timestamp();
begin
 if p_preference is null or p_preference not in ('unknown','full_time','part_time','both') then raise exception using errcode='22023',message='Choose a valid employment preference.'; end if;
 select * into a from recruitment_applications where id=p_application_id for update;
 if a.id is null then raise exception using errcode='42501',message='Application unavailable.'; end if;
 if p_turn_id is not null then
  select r.* into t from recruitment_transcript_turns r join recruitment_interview_attempts x on x.id=r.attempt_id where r.id=p_turn_id and x.application_id=a.id and r.speaker='candidate';
  if t.id is null then raise exception using errcode='22023',message='Candidate preference evidence unavailable.'; end if;
  observed:=t.received_at;
  if a.preference_updated_at is not null and observed<=a.preference_updated_at then return; end if;
 end if;
 if a.employment_preference=p_preference then
  update recruitment_applications set preference_updated_at=observed,preference_turn_id=p_turn_id where id=a.id;
  return;
 end if;
 update recruitment_applications set employment_preference=p_preference,preference_updated_at=observed,preference_turn_id=p_turn_id where id=a.id;
 insert into recruitment_events(opening_id,application_id,attempt_id,action,actor_employee_id,details) values(a.opening_id,a.id,t.attempt_id,'employment_preference_changed',p_actor,jsonb_build_object('from',a.employment_preference,'to',p_preference,'turn_id',p_turn_id));
end $$;
revoke all on function public.recruitment_set_preference_internal(uuid,text,uuid,bigint) from public,anon,authenticated;

create function public.recruitment_set_preference(p_application_id uuid,p_preference text) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage');
begin
 if not exists(select 1 from recruitment_applications a join recruitment_openings o on o.id=a.opening_id where a.id=p_application_id and recruitment_opening_in_scope(o.outlet_id) and a.decision_state not in ('hired','rejected')) then raise exception using errcode='42501',message='Application unavailable.'; end if;
 perform recruitment_set_preference_internal(p_application_id,p_preference,actor);
end $$;
revoke all on function public.recruitment_set_preference(uuid,text) from public,anon,authenticated;
grant execute on function public.recruitment_set_preference(uuid,text) to authenticated;

-- Same registration authority/transaction; identity is not changed by preference.
alter function public.recruitment_register_application(uuid,jsonb,uuid) rename to recruitment_register_application_before_preference;
revoke all on function public.recruitment_register_application_before_preference(uuid,jsonb,uuid) from public,anon,authenticated;
create function public.recruitment_register_application(p_opening_id uuid,p_applicant jsonb,p_applicant_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare id uuid:=recruitment_register_application_before_preference(p_opening_id,p_applicant,p_applicant_id);
begin
 if p_applicant ? 'employment_preference' then perform recruitment_set_preference(id,p_applicant->>'employment_preference'); end if;
 return id;
end $$;
revoke all on function public.recruitment_register_application(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_register_application(uuid,jsonb,uuid) to authenticated;

-- Independent evidence observation; no coverage or hiring mutation.
create function public.recruitment_observe_preference(p_token text,p_client_id uuid,p_preference text,p_turn_number integer) returns void language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype:=recruitment_session(p_token,p_client_id); id bigint;
begin
 select t.id into id from recruitment_transcript_turns t where t.attempt_id=a.id and t.turn_number=p_turn_number and t.speaker='candidate';
 if id is null then raise exception using errcode='22023',message='Candidate preference citation required.'; end if;
 perform recruitment_set_preference_internal(a.application_id,p_preference,null,id);
end $$;
revoke all on function public.recruitment_observe_preference(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.recruitment_observe_preference(text,uuid,text,integer) to service_role;

alter function public.recruitment_workspace(uuid,text,integer,boolean) rename to recruitment_workspace_before_operations;
revoke all on function public.recruitment_workspace_before_operations(uuid,text,integer,boolean) from public,anon,authenticated;
create function public.recruitment_workspace(p_opening_id uuid default null,p_stage text default 'all',p_page integer default 1,p_include_qa boolean default false,p_search text default '',p_offering text default 'all')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_data(1,1); result jsonb; v_page integer:=greatest(1,least(coalesce(p_page,1),100000));
begin
 if length(coalesce(p_search,''))>120 or p_offering not in ('all','unknown','full_time','part_time','both') then raise exception using errcode='22023',message='Invalid candidate filter.'; end if;
 if p_stage is null or p_stage not in ('all','invited','interviewing','needs_review','shortlisted','rejected') then raise exception using errcode='22023',message='Candidate filter is invalid.'; end if;
 if p_opening_id is not null and not exists(select 1 from recruitment_openings where id=p_opening_id and recruitment_opening_in_scope(outlet_id)) then raise exception using errcode='42501',message='Opening is unavailable.'; end if;
 with scoped as (
  select o.* from recruitment_openings o where recruitment_opening_in_scope(o.outlet_id) and (coalesce(p_include_qa,false) or o.title !~* '^QA([ :_-]|$)')
 ), candidates as (
  select a.id,a.opening_id,a.created_at,case when a.decision_state<>'review' then a.decision_state when t.status in ('completed','partial','failed') then 'needs_review' when t.status in ('starting','interviewing','interrupted','finalizing') then 'interviewing' when i.id is not null then 'invited' else 'registered' end stage,
  jsonb_build_object('id',a.id,'opening_id',a.opening_id,'applicant_id',a.applicant_id,'name',coalesce(t.profile_name,p.full_name),'contact',coalesce(t.profile_contact,p.contact),'email',p.email,'opening_title',a.opening_title_snapshot,'workplace',a.workplace_snapshot,'status',a.status,'decision_state',a.decision_state,'employee_id',a.employee_id,'attempt_status',t.status,'recording_state',t.recording_state,'employment_preference',a.employment_preference,'registered_at',a.created_at,'started_at',t.interview_started_at,'completed_at',t.interview_ended_at,'duration_seconds',case when t.interview_ended_at is not null and t.interview_started_at is not null then greatest(0,extract(epoch from t.interview_ended_at-t.interview_started_at))::integer else null end,'ready_for_review_at',(select max(e.occurred_at) from recruitment_events e where e.attempt_id=t.id and e.action='interview_finalized'),'decision_at',(select max(d.occurred_at) from recruitment_decisions d where d.application_id=a.id),'reviewed_at',(select max(v.reviewed_at) from recruitment_report_reviews v join recruitment_reports r on r.id=v.report_id where r.attempt_id=t.id),'issued_at',i.issued_at,'expires_at',i.expires_at,'revoked_at',i.revoked_at) row
  from recruitment_applications a join scoped o on o.id=a.opening_id join recruitment_applicants p on p.id=a.applicant_id
  left join lateral(select * from recruitment_invitations where application_id=a.id order by issued_at desc,id desc limit 1) i on true
  left join recruitment_interview_attempts t on t.invitation_id=i.id
 ), filtered as (select * from candidates where (p_opening_id is null or opening_id=p_opening_id) and (p_stage='all' or stage=p_stage) and (p_offering='all' or row->>'employment_preference'=p_offering) and (coalesce(p_search,'')='' or strpos(lower(row->>'name'),lower(p_search))>0 or strpos(lower(row->>'contact'),lower(p_search))>0)), paged as (select * from filtered order by created_at desc,id limit 20 offset (v_page-1)*20),
 opening_rows as (
  select o.id,o.created_at,to_jsonb(o)-'created_by'-'updated_by'||jsonb_build_object('position_name',(select name from job_positions where id=o.position_id),'employer_name',(select coalesce(display_name,legal_company_name) from legal_entities where id=o.legal_entity_id),'config',to_jsonb(c)-'created_by'-'opening_id','profile',case when p.id is null then null else jsonb_build_object('id',p.id,'name',p.name,'version',p.version) end,'pipeline',jsonb_build_object('total',(select count(*) from candidates where opening_id=o.id),'invited',(select count(*) from candidates where opening_id=o.id and stage='invited'),'interviewing',(select count(*) from candidates where opening_id=o.id and stage='interviewing'),'needs_review',(select count(*) from candidates where opening_id=o.id and stage='needs_review'),'shortlisted',(select count(*) from candidates where opening_id=o.id and stage='shortlisted'),'rejected',(select count(*) from candidates where opening_id=o.id and stage='rejected'))) row
  from scoped o join recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version left join recruitment_interview_profiles p on p.id=c.interview_profile_id
 )
 select jsonb_build_object('openings',coalesce((select jsonb_agg(row order by created_at desc,id) from opening_rows),'[]'::jsonb),'applications',coalesce((select jsonb_agg(row||jsonb_build_object('stage',stage) order by created_at desc,id) from paged),'[]'::jsonb),'applications_total',(select count(*) from filtered),'page',v_page,'page_size',20,
 'summary',jsonb_build_object('open_roles',(select count(*) from scoped where status='open'),'interviewing',(select count(*) from candidates where stage='interviewing'),'needs_review',(select count(*) from candidates where stage='needs_review'),'shortlisted',(select count(*) from candidates where stage='shortlisted')),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('action',action,'occurred_at',occurred_at,'candidate',candidate) order by occurred_at desc) from (select e.action,e.occurred_at,p.full_name candidate from recruitment_events e join scoped o on o.id=e.opening_id left join recruitment_applications a on a.id=e.application_id left join recruitment_applicants p on p.id=a.applicant_id where e.opening_id=p_opening_id and e.action in ('application_registered','invitation_issued','invitation_revoked','interview_finalized','opening_saved','manager_decision') order by e.occurred_at desc,e.id desc limit 8) recent),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by version desc) from recruitment_interview_profiles p),'[]'::jsonb)) into result;
 d:=d||jsonb_build_object('outlets',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'candidate_location',coalesce(nullif(address,''),nullif(location,''))) order by name) from outlets where recruitment_opening_in_scope(id)),'[]'::jsonb));
 return (d-'openings'-'applications'-'applications_total'-'page'-'page_size')||result;
end $$;

revoke all on function public.recruitment_workspace(uuid,text,integer,boolean,text,text) from public,anon,authenticated;
grant execute on function public.recruitment_workspace(uuid,text,integer,boolean,text,text) to authenticated;

-- Existing protected evidence read plus manager-facing application history.
alter function public.recruitment_admin_evidence(uuid,uuid) rename to recruitment_admin_evidence_before_operations;
revoke all on function public.recruitment_admin_evidence_before_operations(uuid,uuid) from public,anon,authenticated;
create function public.recruitment_admin_evidence(p_application_id uuid,p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_evidence_before_operations(p_application_id,p_attempt_id);
begin
 return d||jsonb_build_object('lifecycle_events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'occurred_at',e.occurred_at,'attempt_id',e.attempt_id,'details',e.details) order by e.occurred_at,e.id) from recruitment_events e where e.application_id=p_application_id and e.action in ('application_registered','invitation_issued','invitation_revoked','interview_started','interview_finalized','recording_gap','manager_decision','employment_preference_changed')),'[]'::jsonb),'reviewed_at',(select max(v.reviewed_at) from recruitment_report_reviews v join recruitment_reports r on r.id=v.report_id where r.attempt_id=(d->'attempt'->>'id')::uuid));
end $$;
revoke all on function public.recruitment_admin_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recruitment_admin_evidence(uuid,uuid) to authenticated;
