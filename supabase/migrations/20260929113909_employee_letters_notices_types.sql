-- People Letters & Notices extends the existing warning authority. The legacy
-- table/function names remain compatibility identifiers, not a second system.
create table public.employee_letter_notice_types (
  code text primary key,
  label text not null,
  workflow text not null check (workflow in ('warning','receipt','future')),
  enabled boolean not null default false,
  response_allowed boolean not null default false
);
insert into public.employee_letter_notice_types(code,label,workflow,enabled,response_allowed) values
  ('warning','Warning','warning',true,true),
  ('show_cause','Show Cause','future',false,false),
  ('advisory_reminder','Advisory / Reminder','receipt',true,true),
  ('performance_attendance_notice','Performance / Attendance Notice','future',false,false),
  ('confirmation','Confirmation','future',false,false),
  ('promotion_transfer','Promotion / Transfer','future',false,false),
  ('salary_adjustment','Salary Adjustment','future',false,false),
  ('suspension','Suspension','future',false,false),
  ('resignation_acknowledgement','Resignation Acknowledgement','future',false,false),
  ('termination','Termination','future',false,false),
  ('general_notice','General Notice','receipt',true,false);
alter table public.employee_letter_notice_types enable row level security;
revoke all on public.employee_letter_notice_types from public,anon,authenticated;

alter table public.employee_disciplinary_warnings
  add column document_type text not null default 'warning' references public.employee_letter_notice_types(code),
  add column body text;
update public.employee_disciplinary_warnings set body=warning_details where body is null;
alter table public.employee_disciplinary_warnings
  alter column body set not null,
  alter column warning_type drop not null,
  alter column incident_date drop not null,
  alter column warning_details drop not null,
  alter column required_action drop not null;
alter table public.employee_disciplinary_warnings
  add constraint employee_letter_notice_content_shape check (
    nullif(btrim(body),'') is not null and
    ((document_type='warning' and warning_type is not null and incident_date is not null
      and nullif(btrim(warning_details),'') is not null and body=warning_details
      and nullif(btrim(required_action),'') is not null)
     or (document_type<>'warning' and warning_type is null and incident_date is null
      and warning_details is null and required_action is null and related_previous_warning_id is null))
  );
alter table public.employee_disciplinary_warnings
  drop constraint employee_disciplinary_warning_sequence_shape;
alter table public.employee_disciplinary_warnings
  add constraint employee_disciplinary_warning_sequence_shape check (
    (document_type='warning' and ((status='draft' and display_sequence is null) or (status<>'draft' and display_sequence is not null)))
    or (document_type<>'warning' and display_sequence is null)
  );
create index employee_letters_notices_chronology_idx
  on public.employee_disciplinary_warnings(employee_id,issued_at desc,created_at desc);

create or replace function public.employee_disciplinary_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Letters and notices are immutable.'; end if;
  if old.status<>'draft' and (
    new.employee_id is distinct from old.employee_id or new.outlet_id_snapshot is distinct from old.outlet_id_snapshot
    or new.outlet_name_snapshot is distinct from old.outlet_name_snapshot or new.document_type is distinct from old.document_type
    or new.body is distinct from old.body or new.warning_type is distinct from old.warning_type
    or new.incident_date is distinct from old.incident_date or new.subject is distinct from old.subject
    or new.warning_details is distinct from old.warning_details or new.required_action is distinct from old.required_action
    or new.issued_date is distinct from old.issued_date or new.evidence_bucket is distinct from old.evidence_bucket
    or new.evidence_path is distinct from old.evidence_path or new.evidence_mime_type is distinct from old.evidence_mime_type
    or new.evidence_size_bytes is distinct from old.evidence_size_bytes or new.issued_by_employee_id is distinct from old.issued_by_employee_id
    or new.issued_at is distinct from old.issued_at or new.supersedes_warning_id is distinct from old.supersedes_warning_id
    or new.related_previous_warning_id is distinct from old.related_previous_warning_id
    or new.display_sequence is distinct from old.display_sequence
  ) then raise exception using errcode='55000',message='Issued letter or notice content is immutable.'; end if;
  return new;
end; $$;

create or replace function public.employee_disciplinary_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('employee_disciplinary.view') then raise exception using errcode='42501',message='Missing permission to view letters and notices.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'employee_id',w.employee_id,'document_type',w.document_type,'type_label',type.label,
    'response_allowed',type.response_allowed,'body',w.body,'display_sequence',w.display_sequence,
    'warning_type',w.warning_type,'incident_date',w.incident_date,'subject',w.subject,
    'warning_details',w.warning_details,'required_action',w.required_action,'issued_date',w.issued_date,'status',w.status,
    'outlet_id_snapshot',w.outlet_id_snapshot,'outlet_name_snapshot',w.outlet_name_snapshot,
    'evidence_mime_type',w.evidence_mime_type,'has_evidence',w.evidence_path is not null,
    'supersedes_warning_id',w.supersedes_warning_id,'superseded_by_warning_id',w.superseded_by_warning_id,
    'related_previous_warning_id',w.related_previous_warning_id,
    'related_warning',case when related.id is null then null else jsonb_build_object('id',related.id,'display_sequence',related.display_sequence,'warning_type',related.warning_type,'subject',related.subject,'issued_date',related.issued_date,'status',related.status) end,
    'created_at',w.created_at,'issued_at',w.issued_at,'issued_by_name',issuer.full_name,
    'delivered_at',w.delivered_at,'first_viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,
    'not_acknowledged_at',w.not_acknowledged_at,'withdrawn_at',w.withdrawn_at,'withdrawal_reason',w.withdrawal_reason,
    'response',case when response.id is null then null else jsonb_build_object('text',response.response_text,'submitted_at',response.submitted_at) end,
    'activity',coalesce((select jsonb_agg(jsonb_build_object('id',event.id,'type',event.event_type,
      'actor_kind',event.actor_kind,'actor_name',actor.full_name,'occurred_at',event.occurred_at,'details',event.details)
      order by event.occurred_at,event.id) from public.employee_disciplinary_events event
      left join public.employees actor on actor.id=event.actor_employee_id where event.warning_id=w.id),'[]'::jsonb)
  ) order by coalesce(w.issued_at,w.created_at) desc,w.created_at desc,w.id desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w
  join public.employee_letter_notice_types type on type.code=w.document_type
  left join public.employee_disciplinary_warnings related on related.id=w.related_previous_warning_id
  left join public.employees issuer on issuer.id=w.issued_by_employee_id
  left join public.employee_disciplinary_responses response on response.warning_id=w.id
  where w.employee_id=p_employee_id;
  return jsonb_build_object('records',v_rows,'warnings',v_rows);
end; $$;

create or replace function public.crew_employee_disciplinary(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_now timestamptz:=clock_timestamp(); v_rows jsonb; v_unread_count integer;
begin
  v_employee:=public.crew_session_employee(p_token);
  with delivered as (
    update public.employee_disciplinary_warnings set status='delivered',delivered_at=v_now,updated_at=v_now
    where employee_id=v_employee and status='issued' returning id
  ) insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
    select id,'delivered','system',null,v_now from delivered;
  select count(*)::integer into v_unread_count from public.employee_disciplinary_warnings
    where employee_id=v_employee and status='delivered' and first_viewed_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'document_type',w.document_type,'type_label',type.label,'display_sequence',w.display_sequence,
    'warning_type',w.warning_type,'subject',w.subject,'issued_date',w.issued_date,'status',w.status,
    'issued_at',w.issued_at,'viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,
    'has_response',response.id is not null
  ) order by w.issued_at desc,w.created_at desc,w.id desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w
  join public.employee_letter_notice_types type on type.code=w.document_type
  left join public.employee_disciplinary_responses response on response.warning_id=w.id
  where w.employee_id=v_employee and w.status<>'draft';
  return jsonb_build_object('records',v_rows,'warnings',v_rows,'unread_count',v_unread_count);
end; $$;

create or replace function public.crew_employee_disciplinary_detail(p_token text,p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_record public.employee_disciplinary_warnings%rowtype; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_record from public.employee_disciplinary_warnings
    where id=p_warning_id and employee_id=v_employee and status<>'draft' for update;
  if v_record.id is null then raise exception using errcode='42501',message='Letter or notice is unavailable.'; end if;
  if v_record.status='issued' then
    update public.employee_disciplinary_warnings set status='delivered',delivered_at=v_now,updated_at=v_now where id=v_record.id
      returning * into v_record;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,occurred_at)
      values(v_record.id,'delivered','system',v_now);
  end if;
  if v_record.first_viewed_at is null then
    update public.employee_disciplinary_warnings set first_viewed_at=v_now,
      status=case when status='delivered' then 'viewed' else status end,updated_at=v_now
      where id=v_record.id returning * into v_record;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
      values(v_record.id,'viewed','crew',v_employee,v_now);
  end if;
  select jsonb_build_object(
    'id',v_record.id,'document_type',v_record.document_type,'type_label',type.label,
    'response_allowed',type.response_allowed,'body',v_record.body,'display_sequence',v_record.display_sequence,
    'warning_type',v_record.warning_type,'incident_date',v_record.incident_date,'subject',v_record.subject,
    'warning_details',v_record.warning_details,'required_action',v_record.required_action,
    'issued_date',v_record.issued_date,'status',v_record.status,'outlet_name_snapshot',v_record.outlet_name_snapshot,
    'issued_at',v_record.issued_at,'delivered_at',v_record.delivered_at,'first_viewed_at',v_record.first_viewed_at,
    'acknowledged_at',v_record.acknowledged_at,'not_acknowledged_at',v_record.not_acknowledged_at,
    'withdrawn_at',v_record.withdrawn_at,'withdrawal_reason',v_record.withdrawal_reason,
    'has_evidence',v_record.evidence_path is not null,'evidence_mime_type',v_record.evidence_mime_type,
    'related_warning',case when related.id is null then null else jsonb_build_object('id',related.id,
      'display_sequence',related.display_sequence,'warning_type',related.warning_type,
      'subject',related.subject,'issued_date',related.issued_date,'status',related.status) end,
    'response',case when response.id is null then null else jsonb_build_object('text',response.response_text,
      'submitted_at',response.submitted_at) end
  ) into v_result
  from public.employee_letter_notice_types type
  left join public.employee_disciplinary_warnings related on related.id=v_record.related_previous_warning_id
  left join public.employee_disciplinary_responses response on response.warning_id=v_record.id
  where type.code=v_record.document_type;
  return v_result;
end; $$;

create or replace function public.crew_employee_disciplinary_respond(p_token text,p_warning_id uuid,p_response text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_response public.employee_disciplinary_responses%rowtype;
begin
  v_employee:=public.crew_session_employee(p_token);
  if nullif(btrim(p_response),'') is null then raise exception using errcode='22023',message='Enter your response.'; end if;
  if not exists(
    select 1 from public.employee_disciplinary_warnings w
    join public.employee_letter_notice_types type on type.code=w.document_type
    where w.id=p_warning_id and w.employee_id=v_employee and type.response_allowed
      and w.status in ('delivered','viewed','acknowledged','not_acknowledged')
  ) then raise exception using errcode='42501',message='Response is unavailable.'; end if;
  insert into public.employee_disciplinary_responses(warning_id,employee_id,response_text)
    values(p_warning_id,v_employee,btrim(p_response)) returning * into v_response;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
    values(p_warning_id,'response_added','crew',v_employee,v_response.submitted_at);
  return to_jsonb(v_response);
exception when unique_violation then raise exception using errcode='23505',message='A response has already been submitted.';
end; $$;

-- The legacy notification descriptor explicitly means a warning. Other types
-- remain visible in Crew records but do not produce a mislabeled warning alert.
create or replace function public.crew_notification_on_warning_issued()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.document_type='warning' and new.status='issued' and old.status is distinct from 'issued' then
    perform public.crew_notification_create(new.employee_id,new.outlet_id_snapshot,'people',
      'disciplinary_warning_issued','disciplinary_warning',new.id,'important',
      'New warning issued',left(coalesce(new.subject,'A warning is ready for your review.'),500),
      jsonb_build_object('version',1,'type','disciplinary_warning','warning_id',new.id),
      'warning.issued:'||new.id||':'||new.employee_id);
  end if;
  return new;
end; $$;

revoke all on function public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),
  public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_detail(uuid),
  public.crew_employee_disciplinary(text),public.crew_employee_disciplinary_detail(text,uuid),
  public.crew_employee_disciplinary_respond(text,uuid,text) from public,anon,authenticated;
grant execute on function public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),
  public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_detail(uuid) to authenticated;
grant execute on function public.crew_employee_disciplinary(text),
  public.crew_employee_disciplinary_detail(text,uuid),public.crew_employee_disciplinary_respond(text,uuid,text)
  to anon,authenticated;

create or replace function public.employee_disciplinary_save_draft(p_warning_id uuid,p_employee_id uuid,p_payload jsonb,p_request_id uuid,p_supersedes_warning_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.employee_disciplinary_current_admin_employee();
  v_record public.employee_disciplinary_warnings%rowtype;
  v_type text:=coalesce(nullif(p_payload->>'document_type',''),'warning');
  v_body text;
  v_warning_type text;
  v_incident_date date;
  v_warning_details text;
  v_required_action text;
  v_related uuid;
  v_outlet uuid;
  v_outlet_name text;
  v_event text;
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to manage letters and notices.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  if not exists(select 1 from public.employee_letter_notice_types t where t.code=v_type and t.enabled) then
    raise exception using errcode='22023',message='This letter or notice type is not available.';
  end if;
  if nullif(btrim(p_payload->>'subject'),'') is null or nullif(btrim(p_payload->>'issued_date'),'') is null then
    raise exception using errcode='22023',message='Subject and issued date are required.';
  end if;
  if v_type='warning' then
    v_warning_type:=p_payload->>'warning_type';
    v_incident_date:=nullif(p_payload->>'incident_date','')::date;
    v_warning_details:=nullif(btrim(p_payload->>'warning_details'),'');
    v_required_action:=nullif(btrim(p_payload->>'required_action'),'');
    v_body:=v_warning_details;
    v_related:=nullif(p_payload->>'related_previous_warning_id','')::uuid;
    if v_warning_type not in ('written_warning','final_written_warning') or v_incident_date is null
      or v_body is null or v_required_action is null then
      raise exception using errcode='22023',message='Complete the required warning fields.';
    end if;
    if v_related is not null and not exists(
      select 1 from public.employee_disciplinary_warnings related
      where related.id=v_related and related.employee_id=p_employee_id and related.document_type='warning'
        and related.status<>'draft' and related.issued_at is not null
    ) then raise exception using errcode='22023',message='The related warning is unavailable.'; end if;
  else
    v_body:=nullif(btrim(p_payload->>'body'),'');
    if v_body is null or p_payload ?| array['warning_type','incident_date','warning_details','required_action','related_previous_warning_id'] then
      raise exception using errcode='22023',message='Complete the letter or notice content without warning fields.';
    end if;
  end if;
  v_outlet:=public.crew_resolve_employee_outlet(p_employee_id);
  select name into v_outlet_name from public.outlets where id=v_outlet;
  if p_supersedes_warning_id is not null and not exists(
    select 1 from public.employee_disciplinary_warnings previous
    where previous.id=p_supersedes_warning_id and previous.employee_id=p_employee_id
      and previous.document_type=v_type and previous.status not in ('draft','withdrawn','superseded')
  ) then raise exception using errcode='22023',message='The record to supersede is unavailable.'; end if;
  if p_warning_id is null then
    select * into v_record from public.employee_disciplinary_warnings where request_id=p_request_id;
    if v_record.id is null then
      insert into public.employee_disciplinary_warnings(
        request_id,employee_id,outlet_id_snapshot,outlet_name_snapshot,document_type,body,
        warning_type,incident_date,subject,warning_details,required_action,issued_date,
        supersedes_warning_id,related_previous_warning_id,created_by_employee_id
      ) values (
        p_request_id,p_employee_id,v_outlet,v_outlet_name,v_type,v_body,
        v_warning_type,v_incident_date,btrim(p_payload->>'subject'),v_warning_details,v_required_action,(p_payload->>'issued_date')::date,
        p_supersedes_warning_id,v_related,v_actor
      ) returning * into v_record;
      v_event:='draft_created';
    elsif v_record.employee_id<>p_employee_id or v_record.document_type<>v_type
      or not public.employee_disciplinary_admin_can_access_employee(v_record.employee_id) then
      raise exception using errcode='42501',message='Draft request is outside your scope.';
    end if;
  else
    select * into v_record from public.employee_disciplinary_warnings where id=p_warning_id for update;
    if v_record.id is null or v_record.status<>'draft' then raise exception using errcode='55000',message='Only a draft can be edited.'; end if;
    if v_record.employee_id<>p_employee_id or not public.employee_disciplinary_admin_can_access_employee(v_record.employee_id) then
      raise exception using errcode='42501',message='Record is outside your scope.';
    end if;
    if v_related=v_record.id then raise exception using errcode='22023',message='A warning cannot relate to itself.'; end if;
    update public.employee_disciplinary_warnings set document_type=v_type,body=v_body,warning_type=v_warning_type,
      incident_date=v_incident_date,subject=btrim(p_payload->>'subject'),warning_details=v_warning_details,
      required_action=v_required_action,issued_date=(p_payload->>'issued_date')::date,
      related_previous_warning_id=v_related,updated_at=clock_timestamp()
    where id=v_record.id returning * into v_record;
    v_event:='draft_updated';
  end if;
  if v_event is not null then
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id)
    values(v_record.id,v_event,'admin',v_actor);
  end if;
  return to_jsonb(v_record);
end; $$;

create or replace function public.employee_disciplinary_issue(p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_record public.employee_disciplinary_warnings%rowtype;
  v_actor uuid:=public.employee_disciplinary_current_admin_employee();
  v_now timestamptz:=clock_timestamp();
  v_sequence integer;
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to issue letters and notices.'; end if;
  select * into v_record from public.employee_disciplinary_warnings where id=p_warning_id for update;
  if v_record.id is null or v_record.status<>'draft' or not public.employee_disciplinary_admin_can_access_employee(v_record.employee_id)
    or not exists(select 1 from public.employee_letter_notice_types t where t.code=v_record.document_type and t.enabled) then
    raise exception using errcode='55000',message='Draft letter or notice is unavailable.';
  end if;
  perform 1 from public.employees where id=v_record.employee_id for update;
  if v_record.document_type='warning' then
    if v_record.related_previous_warning_id is not null and not exists(
      select 1 from public.employee_disciplinary_warnings related where related.id=v_record.related_previous_warning_id
        and related.employee_id=v_record.employee_id and related.document_type='warning'
        and related.status<>'draft' and related.issued_at is not null
    ) then raise exception using errcode='55000',message='The related warning is no longer available.'; end if;
    select coalesce(max(display_sequence),0)+1 into v_sequence from public.employee_disciplinary_warnings
      where employee_id=v_record.employee_id and document_type='warning';
  end if;
  if v_record.supersedes_warning_id is not null then
    update public.employee_disciplinary_warnings set status='superseded',superseded_by_warning_id=v_record.id,updated_at=v_now
    where id=v_record.supersedes_warning_id and employee_id=v_record.employee_id and document_type=v_record.document_type
      and status not in ('draft','withdrawn','superseded');
    if not found then raise exception using errcode='55000',message='The original record can no longer be superseded.'; end if;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at,details)
    values(v_record.supersedes_warning_id,'superseded','admin',v_actor,v_now,jsonb_build_object('superseded_by_record_id',v_record.id));
  end if;
  update public.employee_disciplinary_warnings set status='issued',display_sequence=v_sequence,
    issued_by_employee_id=v_actor,issued_at=v_now,updated_at=v_now where id=p_warning_id returning * into v_record;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at)
  values(v_record.id,'issued','admin',v_actor,v_now);
  return to_jsonb(v_record);
end; $$;

create or replace function public.employee_letter_notice_type_options()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_has_permission('employee_disciplinary.manage')
    then coalesce(jsonb_agg(jsonb_build_object('code',code,'label',label,'workflow',workflow,
      'response_allowed',response_allowed) order by case code when 'warning' then 0 when 'advisory_reminder' then 1 else 2 end),'[]'::jsonb)
    else '[]'::jsonb end
  from public.employee_letter_notice_types where enabled;
$$;
revoke all on function public.employee_letter_notice_type_options() from public,anon,authenticated;
grant execute on function public.employee_letter_notice_type_options() to authenticated;
