-- Refine future disciplinary classification while preserving issued legacy evidence.
-- Sequence numbers are assigned once, under an employee row lock, when a draft is issued.

alter table public.employee_disciplinary_warnings
  drop constraint if exists employee_disciplinary_warnings_warning_type_check;

alter table public.employee_disciplinary_warnings
  add constraint employee_disciplinary_warnings_warning_type_check
  check (warning_type in ('first_written_warning','written_warning','final_written_warning')),
  add column if not exists display_sequence integer,
  add column if not exists related_previous_warning_id uuid references public.employee_disciplinary_warnings(id) on delete restrict;

with numbered as (
  select id,row_number() over (
    partition by employee_id
    order by coalesce(issued_at,created_at),created_at,id
  )::integer as display_sequence
  from public.employee_disciplinary_warnings
  where status<>'draft'
)
update public.employee_disciplinary_warnings warning
set display_sequence=numbered.display_sequence
from numbered
where warning.id=numbered.id and warning.display_sequence is null;

create unique index if not exists employee_disciplinary_warning_sequence_unique
  on public.employee_disciplinary_warnings(employee_id,display_sequence)
  where display_sequence is not null;

alter table public.employee_disciplinary_warnings
  add constraint employee_disciplinary_warning_sequence_shape
  check (
    (status='draft' and display_sequence is null)
    or (status<>'draft' and display_sequence is not null)
  );

create or replace function public.employee_disciplinary_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Disciplinary evidence is immutable.'; end if;
  if old.status<>'draft' and (
    new.employee_id is distinct from old.employee_id or new.outlet_id_snapshot is distinct from old.outlet_id_snapshot
    or new.outlet_name_snapshot is distinct from old.outlet_name_snapshot or new.warning_type is distinct from old.warning_type
    or new.incident_date is distinct from old.incident_date or new.subject is distinct from old.subject
    or new.warning_details is distinct from old.warning_details or new.required_action is distinct from old.required_action
    or new.issued_date is distinct from old.issued_date or new.evidence_bucket is distinct from old.evidence_bucket
    or new.evidence_path is distinct from old.evidence_path or new.evidence_mime_type is distinct from old.evidence_mime_type
    or new.evidence_size_bytes is distinct from old.evidence_size_bytes or new.issued_by_employee_id is distinct from old.issued_by_employee_id
    or new.issued_at is distinct from old.issued_at or new.supersedes_warning_id is distinct from old.supersedes_warning_id
    or new.related_previous_warning_id is distinct from old.related_previous_warning_id
    or new.display_sequence is distinct from old.display_sequence
  ) then raise exception using errcode='55000',message='Issued warning content is immutable.'; end if;
  return new;
end; $$;

create or replace function public.employee_disciplinary_save_draft(p_warning_id uuid,p_employee_id uuid,p_payload jsonb,p_request_id uuid,p_supersedes_warning_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.employee_disciplinary_current_admin_employee();
  v_warning public.employee_disciplinary_warnings%rowtype;
  v_outlet uuid;
  v_outlet_name text;
  v_event text;
  v_related uuid:=nullif(p_payload->>'related_previous_warning_id','')::uuid;
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to manage disciplinary records.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  if coalesce(p_payload->>'warning_type','') not in ('written_warning','final_written_warning') then raise exception using errcode='22023',message='Choose a warning type.'; end if;
  if nullif(btrim(p_payload->>'subject'),'') is null or nullif(btrim(p_payload->>'warning_details'),'') is null or nullif(btrim(p_payload->>'required_action'),'') is null then raise exception using errcode='22023',message='Complete all required warning details.'; end if;
  if nullif(p_payload->>'incident_date','') is null or nullif(p_payload->>'issued_date','') is null then raise exception using errcode='22023',message='Incident and issued dates are required.'; end if;
  if v_related is not null and not exists(
    select 1 from public.employee_disciplinary_warnings related
    where related.id=v_related and related.employee_id=p_employee_id and related.status<>'draft' and related.issued_at is not null
  ) then raise exception using errcode='22023',message='The related warning is unavailable.'; end if;
  v_outlet:=public.crew_resolve_employee_outlet(p_employee_id);
  select name into v_outlet_name from public.outlets where id=v_outlet;
  if p_supersedes_warning_id is not null then
    if not exists(select 1 from public.employee_disciplinary_warnings where id=p_supersedes_warning_id and employee_id=p_employee_id and status not in ('draft','withdrawn','superseded')) then raise exception using errcode='22023',message='The warning to supersede is unavailable.'; end if;
  end if;
  if p_warning_id is null then
    select * into v_warning from public.employee_disciplinary_warnings where request_id=p_request_id;
    if v_warning.id is null then
      insert into public.employee_disciplinary_warnings(request_id,employee_id,outlet_id_snapshot,outlet_name_snapshot,warning_type,incident_date,subject,warning_details,required_action,issued_date,supersedes_warning_id,related_previous_warning_id,created_by_employee_id)
      values(p_request_id,p_employee_id,v_outlet,v_outlet_name,p_payload->>'warning_type',(p_payload->>'incident_date')::date,btrim(p_payload->>'subject'),btrim(p_payload->>'warning_details'),btrim(p_payload->>'required_action'),(p_payload->>'issued_date')::date,p_supersedes_warning_id,v_related,v_actor) returning * into v_warning;
      v_event:='draft_created';
    elsif v_warning.employee_id<>p_employee_id or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then
      raise exception using errcode='42501',message='Draft request is outside your outlet scope.';
    end if;
  else
    select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id for update;
    if v_warning.id is null or v_warning.status<>'draft' then raise exception using errcode='55000',message='Only a draft warning can be edited.'; end if;
    if v_warning.employee_id<>p_employee_id or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Warning is outside your outlet scope.'; end if;
    if v_related=v_warning.id then raise exception using errcode='22023',message='A warning cannot relate to itself.'; end if;
    update public.employee_disciplinary_warnings set warning_type=p_payload->>'warning_type',incident_date=(p_payload->>'incident_date')::date,subject=btrim(p_payload->>'subject'),warning_details=btrim(p_payload->>'warning_details'),required_action=btrim(p_payload->>'required_action'),issued_date=(p_payload->>'issued_date')::date,related_previous_warning_id=v_related,updated_at=clock_timestamp() where id=v_warning.id returning * into v_warning;
    v_event:='draft_updated';
  end if;
  if v_event is not null then insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id) values(v_warning.id,v_event,'admin',v_actor); end if;
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_issue(p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_warning public.employee_disciplinary_warnings%rowtype;
  v_actor uuid:=public.employee_disciplinary_current_admin_employee();
  v_now timestamptz:=clock_timestamp();
  v_sequence integer;
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to issue disciplinary records.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id for update;
  if v_warning.id is null or v_warning.status<>'draft' or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='55000',message='Draft warning is unavailable.'; end if;
  perform 1 from public.employees where id=v_warning.employee_id for update;
  if v_warning.related_previous_warning_id is not null and not exists(
    select 1 from public.employee_disciplinary_warnings related
    where related.id=v_warning.related_previous_warning_id and related.employee_id=v_warning.employee_id and related.status<>'draft' and related.issued_at is not null
  ) then raise exception using errcode='55000',message='The related warning is no longer available.'; end if;
  select coalesce(max(display_sequence),0)+1 into v_sequence from public.employee_disciplinary_warnings where employee_id=v_warning.employee_id;
  if v_warning.supersedes_warning_id is not null then
    update public.employee_disciplinary_warnings set status='superseded',superseded_by_warning_id=v_warning.id,updated_at=v_now where id=v_warning.supersedes_warning_id and status not in ('withdrawn','superseded');
    if not found then raise exception using errcode='55000',message='The original warning can no longer be superseded.'; end if;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_warning.supersedes_warning_id,'superseded','admin',v_actor,v_now,jsonb_build_object('superseded_by_warning_id',v_warning.id));
  end if;
  update public.employee_disciplinary_warnings set status='issued',display_sequence=v_sequence,issued_by_employee_id=v_actor,issued_at=v_now,updated_at=v_now where id=p_warning_id returning * into v_warning;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'issued','admin',v_actor,v_now);
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('employee_disciplinary.view') then raise exception using errcode='42501',message='Missing permission to view disciplinary records.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'employee_id',w.employee_id,'display_sequence',w.display_sequence,'warning_type',w.warning_type,'incident_date',w.incident_date,'subject',w.subject,'warning_details',w.warning_details,'required_action',w.required_action,'issued_date',w.issued_date,'status',w.status,
    'outlet_id_snapshot',w.outlet_id_snapshot,'outlet_name_snapshot',w.outlet_name_snapshot,'evidence_mime_type',w.evidence_mime_type,'has_evidence',w.evidence_path is not null,'supersedes_warning_id',w.supersedes_warning_id,'superseded_by_warning_id',w.superseded_by_warning_id,'related_previous_warning_id',w.related_previous_warning_id,
    'related_warning',case when related.id is null then null else jsonb_build_object('id',related.id,'display_sequence',related.display_sequence,'warning_type',related.warning_type,'subject',related.subject,'issued_date',related.issued_date,'status',related.status) end,
    'created_at',w.created_at,'issued_at',w.issued_at,'issued_by_name',issuer.full_name,'delivered_at',w.delivered_at,'first_viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,'not_acknowledged_at',w.not_acknowledged_at,'withdrawn_at',w.withdrawn_at,'withdrawal_reason',w.withdrawal_reason,
    'response',case when response.id is null then null else jsonb_build_object('text',response.response_text,'submitted_at',response.submitted_at) end,
    'activity',coalesce((select jsonb_agg(jsonb_build_object('id',event.id,'type',event.event_type,'actor_kind',event.actor_kind,'actor_name',actor.full_name,'occurred_at',event.occurred_at,'details',event.details) order by event.occurred_at,event.id) from public.employee_disciplinary_events event left join public.employees actor on actor.id=event.actor_employee_id where event.warning_id=w.id),'[]'::jsonb)
  ) order by coalesce(w.issued_at,w.created_at) desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w
  left join public.employee_disciplinary_warnings related on related.id=w.related_previous_warning_id
  left join public.employees issuer on issuer.id=w.issued_by_employee_id
  left join public.employee_disciplinary_responses response on response.warning_id=w.id
  where w.employee_id=p_employee_id;
  return jsonb_build_object('warnings',v_rows);
end; $$;

create or replace function public.crew_employee_disciplinary(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_now timestamptz:=clock_timestamp(); v_rows jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  with delivered as (
    update public.employee_disciplinary_warnings set status='delivered',delivered_at=v_now,updated_at=v_now where employee_id=v_employee and status='issued' returning id
  ) insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) select id,'delivered','system',null,v_now from delivered;
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'display_sequence',w.display_sequence,'warning_type',w.warning_type,'subject',w.subject,'issued_date',w.issued_date,'status',w.status,'issued_at',w.issued_at,'viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,'has_response',response.id is not null) order by w.display_sequence desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w left join public.employee_disciplinary_responses response on response.warning_id=w.id where w.employee_id=v_employee and w.status<>'draft';
  return jsonb_build_object('warnings',v_rows);
end; $$;

create or replace function public.crew_employee_disciplinary_detail(p_token text,p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_warning public.employee_disciplinary_warnings%rowtype; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id and employee_id=v_employee and status<>'draft' for update;
  if v_warning.id is null then raise exception using errcode='42501',message='Warning is unavailable.'; end if;
  if v_warning.status='issued' then update public.employee_disciplinary_warnings set status='delivered',delivered_at=v_now,updated_at=v_now where id=v_warning.id; v_warning.status:='delivered'; v_warning.delivered_at:=v_now; insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,occurred_at) values(v_warning.id,'delivered','system',v_now); end if;
  if v_warning.first_viewed_at is null then
    update public.employee_disciplinary_warnings set first_viewed_at=v_now,status=case when status='delivered' then 'viewed' else status end,updated_at=v_now where id=v_warning.id returning * into v_warning;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'viewed','crew',v_employee,v_now);
  end if;
  select jsonb_build_object(
    'id',v_warning.id,'display_sequence',v_warning.display_sequence,'warning_type',v_warning.warning_type,'incident_date',v_warning.incident_date,'subject',v_warning.subject,'warning_details',v_warning.warning_details,'required_action',v_warning.required_action,'issued_date',v_warning.issued_date,'status',v_warning.status,'outlet_name_snapshot',v_warning.outlet_name_snapshot,'issued_at',v_warning.issued_at,'delivered_at',v_warning.delivered_at,'first_viewed_at',v_warning.first_viewed_at,'acknowledged_at',v_warning.acknowledged_at,'not_acknowledged_at',v_warning.not_acknowledged_at,'withdrawn_at',v_warning.withdrawn_at,'withdrawal_reason',v_warning.withdrawal_reason,'has_evidence',v_warning.evidence_path is not null,'evidence_mime_type',v_warning.evidence_mime_type,
    'related_warning',case when related.id is null then null else jsonb_build_object('id',related.id,'display_sequence',related.display_sequence,'warning_type',related.warning_type,'subject',related.subject,'issued_date',related.issued_date,'status',related.status) end,
    'response',case when response.id is null then null else jsonb_build_object('text',response.response_text,'submitted_at',response.submitted_at) end
  ) into v_result
  from public.employee_disciplinary_warnings warning
  left join public.employee_disciplinary_warnings related on related.id=warning.related_previous_warning_id
  left join public.employee_disciplinary_responses response on response.warning_id=warning.id
  where warning.id=v_warning.id;
  return v_result;
end; $$;

revoke all on function public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_detail(uuid),public.crew_employee_disciplinary(text),public.crew_employee_disciplinary_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_detail(uuid) to authenticated;
grant execute on function public.crew_employee_disciplinary(text),public.crew_employee_disciplinary_detail(text,uuid) to anon,authenticated;
