-- Phase 3 consumes finalized interview evidence; it does not change capture authorities.
alter table public.recruitment_applications add column decision_state text not null default 'review' check(decision_state in ('review','shortlisted','final_interview','rejected','hired'));
alter table public.recruitment_applications add column employee_id uuid references public.employees(id) on delete restrict;
create table public.recruitment_reports (
 id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.recruitment_interview_attempts(id),
 version integer not null, request_id uuid not null unique, source_snapshot jsonb not null, source_hash text not null,
 model text not null default 'gpt-4.1-mini', prompt_version text not null default 'recruitment-report-v1',
 status text not null default 'queued' check(status in ('queued','generating','ready','unusable','failed')),
 body jsonb, error_code text, provider_response_id text, generation_id uuid, lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 unique(attempt_id,version)
);
create table public.recruitment_report_reviews (
 report_id uuid not null references public.recruitment_reports(id), actor_employee_id uuid not null references public.employees(id),
 reviewed_at timestamptz not null default clock_timestamp(), primary key(report_id,actor_employee_id)
);
create table public.recruitment_decisions (
 request_id uuid primary key, application_id uuid not null references public.recruitment_applications(id),
 actor_employee_id uuid not null references public.employees(id), from_state text not null, to_state text not null,
 reason text not null default '', fingerprint text not null, report_id uuid references public.recruitment_reports(id),
 employee_id uuid references public.employees(id), occurred_at timestamptz not null default clock_timestamp()
);
create table public.recruitment_hire_conversions (
 applicant_id uuid primary key references public.recruitment_applicants(id), application_id uuid not null unique references public.recruitment_applications(id),
 employee_id uuid not null unique references public.employees(id), request_id uuid not null unique references public.recruitment_decisions(request_id)
);
create index recruitment_reports_attempt_idx on public.recruitment_reports(attempt_id,version desc);
create index recruitment_decisions_application_idx on public.recruitment_decisions(application_id,occurred_at);
alter table public.recruitment_reports enable row level security;
alter table public.recruitment_report_reviews enable row level security;
alter table public.recruitment_decisions enable row level security;
alter table public.recruitment_hire_conversions enable row level security;
revoke all on public.recruitment_reports,public.recruitment_report_reviews,public.recruitment_decisions,public.recruitment_hire_conversions from public,anon,authenticated;
grant all on public.recruitment_reports,public.recruitment_report_reviews,public.recruitment_decisions,public.recruitment_hire_conversions to service_role;
create function public.recruitment_phase3_immutable() returns trigger language plpgsql set search_path=public as $$
begin raise exception using errcode='55000',message='Recruitment final evidence is immutable.'; end $$;
create trigger recruitment_decision_immutable before update or delete on public.recruitment_decisions for each row execute function public.recruitment_phase3_immutable();
create trigger recruitment_review_immutable before update or delete on public.recruitment_report_reviews for each row execute function public.recruitment_phase3_immutable();
create trigger recruitment_conversion_immutable before update or delete on public.recruitment_hire_conversions for each row execute function public.recruitment_phase3_immutable();
create function public.recruitment_report_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' or old.status in ('ready','unusable','failed') or (new.id,new.attempt_id,new.version,new.request_id,new.source_snapshot,new.source_hash,new.model,new.prompt_version) is distinct from (old.id,old.attempt_id,old.version,old.request_id,old.source_snapshot,old.source_hash,old.model,old.prompt_version) then raise exception using errcode='55000',message='Report source and final reports are immutable. Request a new version.'; end if;
 return new;
end $$;
create trigger recruitment_report_guard before update or delete on public.recruitment_reports for each row execute function public.recruitment_report_guard();

create function public.recruitment_report_source(p_attempt_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('attempt',jsonb_build_object('id',a.id,'status',a.status,'recording_state',a.recording_state,'started_at',a.interview_started_at,'ended_at',a.interview_ended_at,'reason',a.completion_reason),
 'config',to_jsonb(c)-'created_by',
 'turns',coalesce((select jsonb_agg(to_jsonb(t) order by turn_number) from recruitment_transcript_turns t where attempt_id=a.id),'[]'::jsonb),
 'units',coalesce((select jsonb_agg(to_jsonb(u)-'object_path' order by sequence) from recruitment_recording_units u where attempt_id=a.id),'[]'::jsonb),
 'annotations',coalesce((select jsonb_agg(to_jsonb(x) order by id) from recruitment_transcript_annotations x where attempt_id=a.id),'[]'::jsonb),
 'topics',coalesce((select jsonb_agg(to_jsonb(x) order by topic_index) from recruitment_topic_coverage x where attempt_id=a.id),'[]'::jsonb),
 'scenarios',coalesce((select jsonb_agg(to_jsonb(x) order by scenario_index) from recruitment_scenario_progress x where attempt_id=a.id),'[]'::jsonb),
 'gaps',coalesce((select jsonb_agg(jsonb_build_object('at',occurred_at,'reason',details->>'reason') order by occurred_at) from recruitment_events where attempt_id=a.id and action='recording_gap'),'[]'::jsonb))
 from recruitment_interview_attempts a join recruitment_interview_configs c on c.id=a.config_version_id where a.id=p_attempt_id and a.status in ('completed','partial','failed');
$$;
create function public.recruitment_report_enqueue(p_attempt_id uuid,p_request_id uuid,p_new_version boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare a recruitment_interview_attempts%rowtype; r recruitment_reports%rowtype; source jsonb; rid uuid;
begin
 if p_request_id is null then raise exception 'Request ID required.'; end if;
 select * into a from recruitment_interview_attempts where id=p_attempt_id for update;
 source:=recruitment_report_source(a.id);
 if source is null then raise exception using errcode='55000',message='Finalize the interview before generating a report.'; end if;
 select * into r from recruitment_reports where request_id=p_request_id;
 if found then if r.attempt_id<>a.id then raise exception 'Conflicting report retry.'; end if; return r.id; end if;
 select * into r from recruitment_reports where attempt_id=a.id order by version desc limit 1;
 if found and not p_new_version then return r.id; end if;
 insert into recruitment_reports(attempt_id,version,request_id,source_snapshot,source_hash,status,body,finished_at)
 values(a.id,coalesce(r.version,0)+1,p_request_id,source,encode(extensions.digest(source::text,'sha256'),'hex'),
 case when not exists(select 1 from recruitment_transcript_turns where attempt_id=a.id and speaker='candidate') then 'unusable' else 'queued' end,
 case when not exists(select 1 from recruitment_transcript_turns where attempt_id=a.id and speaker='candidate') then jsonb_build_object('unusable_reason','No usable candidate transcript. Review available recording or arrange a human interview; this is not a candidate assessment.') end,
 case when not exists(select 1 from recruitment_transcript_turns where attempt_id=a.id and speaker='candidate') then clock_timestamp() end) returning id into rid;
 return rid;
end $$;
create function public.recruitment_report_prepare(p_application_id uuid,p_request_id uuid,p_new_version boolean default false,p_attempt_id uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor(case when p_new_version then 'recruitment.manage' else 'recruitment.view' end); a uuid; o uuid;
begin
 select op.outlet_id into o from recruitment_applications ap join recruitment_openings op on op.id=ap.opening_id where ap.id=p_application_id;
 if not found or not recruitment_opening_in_scope(o) then raise exception using errcode='42501',message='Application unavailable.'; end if;
 select id into a from recruitment_interview_attempts where application_id=p_application_id and (p_attempt_id is null or id=p_attempt_id) order by created_at desc limit 1;
 return recruitment_report_enqueue(a,p_request_id,p_new_version);
end $$;
create function public.recruitment_report_claim(p_report_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r recruitment_reports%rowtype; g uuid:=gen_random_uuid();
begin
 select * into r from recruitment_reports where id=p_report_id for update;
 if r.id is null then raise exception 'Report unavailable.'; end if;
 if r.status not in ('queued','generating') or (r.status='generating' and r.lease_until>clock_timestamp()) then return jsonb_build_object('status',r.status); end if;
 update recruitment_reports set status='generating',generation_id=g,lease_until=clock_timestamp()+interval '3 minutes' where id=r.id;
 return jsonb_build_object('status','claimed','id',r.id,'generation_id',g,'source',r.source_snapshot,'model',r.model,'prompt_version',r.prompt_version);
end $$;
create function public.recruitment_report_finish(p_report_id uuid,p_generation_id uuid,p_body jsonb,p_response_id text,p_error_code text default null) returns void language plpgsql security definer set search_path=public as $$
begin
 update recruitment_reports set status=case when p_error_code is null then 'ready' else 'failed' end,body=p_body,error_code=p_error_code,provider_response_id=p_response_id,finished_at=clock_timestamp(),lease_until=null
 where id=p_report_id and status='generating' and generation_id=p_generation_id;
 if not found then raise exception using errcode='40001',message='Generation no longer owns this report.'; end if;
end $$;
create function public.recruitment_report_review(p_report_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); o uuid;
begin
 select op.outlet_id into o from recruitment_reports r join recruitment_interview_attempts a on a.id=r.attempt_id join recruitment_openings op on op.id=a.opening_id where r.id=p_report_id and r.status in ('ready','unusable');
 if not found or not recruitment_opening_in_scope(o) then raise exception using errcode='42501',message='Report unavailable.'; end if;
 insert into recruitment_report_reviews(report_id,actor_employee_id) values(p_report_id,actor) on conflict do nothing;
end $$;

-- Use the established evidence read authority; add report/decision context without exposing tokens.
alter function public.recruitment_admin_evidence(uuid) rename to recruitment_admin_evidence_phase2;
revoke all on function public.recruitment_admin_evidence_phase2(uuid) from public,anon,authenticated;
create function public.recruitment_admin_evidence(p_application_id uuid,p_attempt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d jsonb:=recruitment_admin_evidence_phase2(p_application_id); a recruitment_applications%rowtype; t recruitment_interview_attempts%rowtype;
begin
 select * into a from recruitment_applications where id=p_application_id;
 if p_attempt_id is not null then
  select * into t from recruitment_interview_attempts where id=p_attempt_id and application_id=a.id;
  if t.id is null then raise exception using errcode='42501',message='Interview unavailable.'; end if;
  d:=d||jsonb_build_object('attempt',to_jsonb(t)-'lease_owner',
   'turns',coalesce((select jsonb_agg(to_jsonb(x) order by turn_number) from recruitment_transcript_turns x where attempt_id=t.id),'[]'::jsonb),
   'units',coalesce((select jsonb_agg(to_jsonb(x) order by sequence) from recruitment_recording_units x where attempt_id=t.id),'[]'::jsonb),
   'topics',coalesce((select jsonb_agg(to_jsonb(x) order by topic_index) from recruitment_topic_coverage x where attempt_id=t.id),'[]'::jsonb),
   'scenarios',coalesce((select jsonb_agg(to_jsonb(x) order by scenario_index) from recruitment_scenario_progress x where attempt_id=t.id),'[]'::jsonb),
   'annotations',coalesce((select jsonb_agg(to_jsonb(x)) from recruitment_transcript_annotations x where attempt_id=t.id),'[]'::jsonb),
   'events',coalesce((select jsonb_agg(jsonb_build_object('action',action,'occurred_at',occurred_at,'details',details) order by occurred_at) from recruitment_events where attempt_id=t.id),'[]'::jsonb));
 end if;
 return d||jsonb_build_object('attempts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'created_at',created_at) order by created_at desc) from recruitment_interview_attempts where application_id=a.id),'[]'::jsonb),'application',to_jsonb(a),'candidate',(select to_jsonb(p)-'created_by' from recruitment_applicants p where p.id=a.applicant_id),
 'reports',coalesce((select jsonb_agg(to_jsonb(r)-'generation_id'-'lease_until'||jsonb_build_object('reviews',(select count(*) from recruitment_report_reviews v where v.report_id=r.id)) order by r.version desc) from recruitment_reports r where r.attempt_id=(d->'attempt'->>'id')::uuid),'[]'::jsonb),
 'decisions',coalesce((select jsonb_agg(to_jsonb(x)-'fingerprint' order by occurred_at) from recruitment_decisions x where application_id=a.id),'[]'::jsonb),
 'can_manage',current_user_has_permission('recruitment.manage'),'can_hire',current_user_has_permission('recruitment.manage') and current_user_has_permission('employees.create') and current_user_has_permission('employees.view'),
 'launch_ready',exists(select 1 from recruitment_consent_copy_versions where version='phase1-provisional-v1' and status='approved'));
end $$;

create function public.recruitment_admin_evidence(p_application_id uuid) returns jsonb language sql stable security definer set search_path=public as $$ select public.recruitment_admin_evidence(p_application_id,null); $$;
revoke all on function public.recruitment_admin_evidence(uuid) from public,anon,authenticated;
grant execute on function public.recruitment_admin_evidence(uuid) to authenticated;

-- Finalization stays Phase 2-owned. Enqueue a pinned report in the same transaction.
alter function public.recruitment_finalize(text,uuid) rename to recruitment_finalize_phase2;
revoke all on function public.recruitment_finalize_phase2(text,uuid) from public,anon,authenticated;
create function public.recruitment_finalize(p_token text,p_client_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; a recruitment_interview_attempts%rowtype; rid uuid;
begin
 result:=recruitment_finalize_phase2(p_token,p_client_id);
 a:=recruitment_public_attempt(p_token);
 if a.status in ('completed','partial','failed') then rid:=recruitment_report_enqueue(a.id,gen_random_uuid()); end if;
 return result||jsonb_build_object('report_id',rid);
end $$;

create function public.recruitment_person_contact_key(p_contact text) returns text language sql immutable set search_path=public as $$
 select case when d ~ '^0[1-9]' then '60'||substring(d from 2) else d end from (select regexp_replace(coalesce(p_contact,''),'[^0-9]','','g') d) x;
$$;
revoke all on function public.recruitment_person_contact_key(text) from public,anon,authenticated;

create function public.recruitment_decide(p_application_id uuid,p_request_id uuid,p_expected_state text,p_decision text,p_reason text default '',p_hire jsonb default null,p_report_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=recruitment_actor('recruitment.manage'); a recruitment_applications%rowtype; o recruitment_openings%rowtype; prior recruitment_decisions%rowtype; eid uuid; jp job_positions%rowtype; workplace_name text; fp text; name text; contact_value text; identity_no text; start_date date; named_duplicate boolean;
begin
 if p_request_id is null or p_decision not in ('shortlisted','final_interview','rejected','hired') or length(coalesce(p_reason,''))>1000 then raise exception using errcode='22023',message='Invalid decision request.'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('app',p_application_id,'expected',p_expected_state,'decision',p_decision,'reason',coalesce(p_reason,''),'hire',p_hire,'report',p_report_id)::text,'sha256'),'hex');
 select * into a from recruitment_applications where id=p_application_id for update;
 select * into o from recruitment_openings where id=a.opening_id;
 if a.id is null or not recruitment_opening_in_scope(o.outlet_id) then raise exception using errcode='42501',message='Application unavailable.'; end if;
 select * into prior from recruitment_decisions where request_id=p_request_id;
 if found then if prior.fingerprint<>fp or prior.actor_employee_id<>actor then raise exception using errcode='22023',message='Conflicting decision retry.'; end if; return jsonb_build_object('state',prior.to_state,'employee_id',prior.employee_id); end if;
 if a.decision_state is distinct from p_expected_state or a.decision_state in ('hired','rejected') or
 (p_decision='shortlisted' and a.decision_state<>'review') or (p_decision='final_interview' and a.decision_state<>'shortlisted') or (p_decision='hired' and a.decision_state not in ('shortlisted','final_interview')) then raise exception using errcode='55000',message='Application changed or transition is unavailable. Refresh the review.'; end if;
 if exists(select 1 from recruitment_interview_attempts where application_id=a.id and status in ('starting','interviewing','finalizing','interrupted')) then raise exception using errcode='55000',message='End the active interview before deciding.'; end if;
 if p_report_id is not null then
   if not exists(select 1 from recruitment_reports r join recruitment_interview_attempts t on t.id=r.attempt_id where r.id=p_report_id and t.application_id=a.id and r.status in ('ready','unusable')) then raise exception 'Report does not belong to this application.'; end if;
   perform recruitment_report_review(p_report_id);
 end if;
 if p_decision='hired' then
   if not current_user_has_permission('employees.create') or not current_user_has_permission('employees.view') or (o.outlet_id is null and not current_user_has_all_outlet_access()) then raise exception using errcode='42501',message='Employee creation and workplace access required.'; end if;
   -- Serialize applicant conversions and person matching across concurrent applications.
   perform 1 from recruitment_applicants where id=a.applicant_id for update;
   perform pg_advisory_xact_lock(hashtextextended('people-recruitment-hire',0));
   if exists(select 1 from recruitment_hire_conversions where applicant_id=a.applicant_id) then raise exception using errcode='23505',message='Applicant already converted to an Employee. Continue in People.'; end if;
   name:=btrim(p_hire->>'full_name'); contact_value:=btrim(p_hire->>'contact'); identity_no:=nullif(btrim(p_hire->>'ic_no'),''); start_date:=(p_hire->>'joined_date')::date;
   if coalesce(length(name),0) not between 2 and 160 or coalesce(length(contact_value),0) not between 5 and 40 or coalesce(length(btrim(p_hire->>'nationality')),0) not between 2 and 80 or start_date is null or start_date>timezone('Asia/Kuala_Lumpur',clock_timestamp())::date or coalesce(p_hire->>'employment_type','') not in ('probation','full_time','part_time','intern','contract') then raise exception using errcode='22023',message='Confirm name, contact, nationality, employment type and a start date on or before today. Future starters are converted when employment begins.'; end if;
   if exists(select 1 from employees e where (identity_no is not null and regexp_replace(lower(coalesce(e.ic_no,'')),'[^a-z0-9]','','g')=regexp_replace(lower(identity_no),'[^a-z0-9]','','g')) or (length(regexp_replace(contact_value,'[^0-9]','','g'))>=5 and recruitment_person_contact_key(e.contact)=recruitment_person_contact_key(contact_value))) then raise exception using errcode='23505',message='Matching Employee identity or contact found. Resolve the person in People before Hire; no duplicate Employee was created.'; end if;
   select exists(select 1 from employees where lower(btrim(full_name))=lower(name)) into named_duplicate;
   if named_duplicate and coalesce(length(btrim(p_hire->>'duplicate_name_reason')),0)<10 then raise exception using errcode='23505',message='An Employee has this name. Confirm they are different people and record a concise explanation.'; end if;
   select * into jp from job_positions where id=o.position_id and status='active';
   if jp.id is null or not exists(select 1 from legal_entities where id=o.legal_entity_id and is_active) then raise exception 'Opening Position or Legal Employer is inactive. Resolve in People.'; end if;
   workplace_name:=o.workplace;
   if o.outlet_id is not null then select outlets.name into workplace_name from outlets where id=o.outlet_id and is_active; end if;
   if workplace_name is null then raise exception 'Opening Workplace is inactive.'; end if;
   -- Same canonical table/after-insert baseline and workforce mirror triggers as ordinary People creation.
   insert into employees(full_name,contact,ic_no,nationality,joined_date,employment_type,employment_status,position,department,workplace,legal_entity_id,enable_system_login,access_state,created_by)
   values(name,contact_value,identity_no,btrim(p_hire->>'nationality'),start_date,p_hire->>'employment_type','active',jp.name,jp.department,workplace_name,o.legal_entity_id,false,'no_access',auth.uid()) returning id into eid;
   insert into audit_logs(action,module,user_id,user_name,description,metadata) values('employee_created','people',auth.uid(),(select full_name from employees where id=actor),'Employee created through manager Recruitment Hire.',jsonb_build_object('employee_id',eid,'application_id',a.id,'request_id',p_request_id,'same_name_clarification',case when named_duplicate then p_hire->>'duplicate_name_reason' end));
 end if;
 insert into recruitment_decisions(request_id,application_id,actor_employee_id,from_state,to_state,reason,fingerprint,report_id,employee_id) values(p_request_id,a.id,actor,a.decision_state,p_decision,coalesce(p_reason,''),fp,p_report_id,eid);
 if eid is not null then insert into recruitment_hire_conversions(applicant_id,application_id,employee_id,request_id) values(a.applicant_id,a.id,eid,p_request_id); end if;
 update recruitment_applications set decision_state=p_decision,employee_id=eid where id=a.id;
 insert into recruitment_events(opening_id,application_id,action,actor_employee_id,details) values(a.opening_id,a.id,'manager_decision',actor,jsonb_build_object('from',a.decision_state,'to',p_decision,'request_id',p_request_id,'report_id',p_report_id,'employee_id',eid,'reason',coalesce(p_reason,'')));
 if p_decision in ('hired','rejected') then update recruitment_invitations set revoked_at=clock_timestamp() where application_id=a.id and revoked_at is null; end if;
 return jsonb_build_object('state',p_decision,'employee_id',eid);
end $$;
-- Prevent issuing another candidate interview on terminal manager decisions.
alter function public.recruitment_issue_invitation(uuid,timestamptz) rename to recruitment_issue_invitation_phase1;
revoke all on function public.recruitment_issue_invitation_phase1(uuid,timestamptz) from public,anon,authenticated;
create function public.recruitment_issue_invitation(p_application_id uuid,p_expires_at timestamptz) returns text language plpgsql security definer set search_path=public as $$
begin
 perform recruitment_actor('recruitment.manage');
 perform 1 from recruitment_applications where id=p_application_id for update;
 if exists(select 1 from recruitment_applications where id=p_application_id and decision_state in ('hired','rejected')) then raise exception 'This application has a final manager decision.'; end if;
 return recruitment_issue_invitation_phase1(p_application_id,p_expires_at);
end $$;
revoke all on function public.recruitment_phase3_immutable(),public.recruitment_report_guard(),public.recruitment_report_source(uuid),public.recruitment_report_enqueue(uuid,uuid,boolean),public.recruitment_report_claim(uuid),public.recruitment_report_finish(uuid,uuid,jsonb,text,text),public.recruitment_report_prepare(uuid,uuid,boolean,uuid),public.recruitment_report_review(uuid),public.recruitment_admin_evidence(uuid,uuid),public.recruitment_finalize(text,uuid),public.recruitment_decide(uuid,uuid,text,text,text,jsonb,uuid),public.recruitment_issue_invitation(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.recruitment_report_prepare(uuid,uuid,boolean,uuid),public.recruitment_report_review(uuid),public.recruitment_admin_evidence(uuid,uuid),public.recruitment_decide(uuid,uuid,text,text,text,jsonb,uuid),public.recruitment_issue_invitation(uuid,timestamptz) to authenticated;
grant execute on function public.recruitment_report_claim(uuid),public.recruitment_report_finish(uuid,uuid,jsonb,text,text),public.recruitment_report_enqueue(uuid,uuid,boolean),public.recruitment_report_source(uuid),public.recruitment_finalize(text,uuid),public.recruitment_finalize_phase2(text,uuid) to service_role;
