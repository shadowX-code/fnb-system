-- People-owned Employee Warning / Disciplinary Records V1.
-- Draft content is editable through trusted functions. Issued content and all
-- lifecycle evidence are immutable; corrections use withdrawal/supersession.

insert into public.permissions(code,module,description) values
  ('employee_disciplinary.view','People','View employee disciplinary records and private evidence'),
  ('employee_disciplinary.manage','People','Create, issue and manage employee disciplinary records')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
join public.permissions p on p.code='employee_disciplinary.view'
where existing.code in ('employees.view','employees.edit','employees.manage')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
join public.permissions p on p.code='employee_disciplinary.manage'
where existing.code in ('employees.edit','employees.manage')
on conflict do nothing;

create table public.employee_disciplinary_warnings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  employee_id uuid not null references public.employees(id) on delete restrict,
  outlet_id_snapshot uuid references public.outlets(id) on delete restrict,
  outlet_name_snapshot text,
  warning_type text not null check(warning_type in ('first_written_warning','final_written_warning')),
  incident_date date not null,
  subject text not null check(nullif(btrim(subject),'') is not null),
  warning_details text not null check(nullif(btrim(warning_details),'') is not null),
  required_action text not null check(nullif(btrim(required_action),'') is not null),
  issued_date date not null,
  status text not null default 'draft' check(status in ('draft','issued','delivered','viewed','acknowledged','not_acknowledged','withdrawn','superseded')),
  supersedes_warning_id uuid references public.employee_disciplinary_warnings(id) on delete restrict,
  superseded_by_warning_id uuid references public.employee_disciplinary_warnings(id) on delete restrict,
  evidence_bucket text,
  evidence_path text unique,
  evidence_mime_type text,
  evidence_size_bytes bigint check(evidence_size_bytes is null or evidence_size_bytes > 0),
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  issued_by_employee_id uuid references public.employees(id) on delete restrict,
  issued_at timestamptz,
  delivered_at timestamptz,
  first_viewed_at timestamptz,
  acknowledged_at timestamptz,
  not_acknowledged_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by_employee_id uuid references public.employees(id) on delete restrict,
  withdrawal_reason text,
  constraint employee_warning_evidence_shape check (
    (evidence_bucket is null and evidence_path is null and evidence_mime_type is null and evidence_size_bytes is null)
    or (evidence_bucket is not null and evidence_path is not null and evidence_mime_type is not null and evidence_size_bytes is not null)
  ),
  constraint employee_warning_issue_shape check (
    (status='draft' and issued_at is null and issued_by_employee_id is null)
    or (status<>'draft' and issued_at is not null and issued_by_employee_id is not null)
  )
);

create table public.employee_disciplinary_responses (
  id uuid primary key default gen_random_uuid(),
  warning_id uuid not null unique references public.employee_disciplinary_warnings(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  response_text text not null check(nullif(btrim(response_text),'') is not null),
  submitted_at timestamptz not null default clock_timestamp()
);

create table public.employee_disciplinary_events (
  id uuid primary key default gen_random_uuid(),
  warning_id uuid not null references public.employee_disciplinary_warnings(id) on delete restrict,
  event_type text not null check(event_type in ('draft_created','draft_updated','evidence_attached','issued','delivered','viewed','response_added','acknowledged','not_acknowledged','withdrawn','superseded')),
  actor_kind text not null check(actor_kind in ('admin','crew','system')),
  actor_employee_id uuid references public.employees(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'::jsonb
);

create index employee_disciplinary_warnings_employee_idx on public.employee_disciplinary_warnings(employee_id,created_at desc);
create index employee_disciplinary_events_warning_idx on public.employee_disciplinary_events(warning_id,occurred_at,id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('employee-disciplinary-evidence','employee-disciplinary-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.employee_disciplinary_warnings enable row level security;
alter table public.employee_disciplinary_responses enable row level security;
alter table public.employee_disciplinary_events enable row level security;
revoke all on public.employee_disciplinary_warnings,public.employee_disciplinary_responses,public.employee_disciplinary_events from public,anon,authenticated;

create or replace function public.employee_disciplinary_admin_can_access_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.employees e where e.id=p_employee_id and (
    public.current_user_has_all_outlet_access()
    or public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
  ));
$$;

create or replace function public.employee_disciplinary_current_admin_employee()
returns uuid language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid;
begin
  select id into v_employee from public.employees where auth_user_id=auth.uid() order by id limit 1;
  if v_employee is null then raise exception using errcode='42501',message='An employee profile is required.'; end if;
  return v_employee;
end; $$;

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
  ) then raise exception using errcode='55000',message='Issued warning content is immutable.'; end if;
  return new;
end; $$;
create trigger employee_disciplinary_warnings_guard before update or delete on public.employee_disciplinary_warnings for each row execute function public.employee_disciplinary_guard();

create or replace function public.employee_disciplinary_append_only_guard()
returns trigger language plpgsql set search_path=public as $$ begin raise exception using errcode='55000',message='Disciplinary history is immutable.'; end; $$;
create trigger employee_disciplinary_responses_immutable before update or delete on public.employee_disciplinary_responses for each row execute function public.employee_disciplinary_append_only_guard();
create trigger employee_disciplinary_events_immutable before update or delete on public.employee_disciplinary_events for each row execute function public.employee_disciplinary_append_only_guard();

create or replace function public.employee_disciplinary_save_draft(p_warning_id uuid,p_employee_id uuid,p_payload jsonb,p_request_id uuid,p_supersedes_warning_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employee_disciplinary_current_admin_employee(); v_warning public.employee_disciplinary_warnings%rowtype; v_outlet uuid; v_outlet_name text; v_event text;
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to manage disciplinary records.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  if coalesce(p_payload->>'warning_type','') not in ('first_written_warning','final_written_warning') then raise exception using errcode='22023',message='Choose a warning type.'; end if;
  if nullif(btrim(p_payload->>'subject'),'') is null or nullif(btrim(p_payload->>'warning_details'),'') is null or nullif(btrim(p_payload->>'required_action'),'') is null then raise exception using errcode='22023',message='Complete all required warning details.'; end if;
  if nullif(p_payload->>'incident_date','') is null or nullif(p_payload->>'issued_date','') is null then raise exception using errcode='22023',message='Incident and issued dates are required.'; end if;
  v_outlet:=public.crew_resolve_employee_outlet(p_employee_id); select name into v_outlet_name from public.outlets where id=v_outlet;
  if p_supersedes_warning_id is not null then
    if not exists(select 1 from public.employee_disciplinary_warnings where id=p_supersedes_warning_id and employee_id=p_employee_id and status not in ('draft','withdrawn','superseded')) then raise exception using errcode='22023',message='The warning to supersede is unavailable.'; end if;
  end if;
  if p_warning_id is null then
    select * into v_warning from public.employee_disciplinary_warnings where request_id=p_request_id;
    if v_warning.id is null then
      insert into public.employee_disciplinary_warnings(request_id,employee_id,outlet_id_snapshot,outlet_name_snapshot,warning_type,incident_date,subject,warning_details,required_action,issued_date,supersedes_warning_id,created_by_employee_id)
      values(p_request_id,p_employee_id,v_outlet,v_outlet_name,p_payload->>'warning_type',(p_payload->>'incident_date')::date,btrim(p_payload->>'subject'),btrim(p_payload->>'warning_details'),btrim(p_payload->>'required_action'),(p_payload->>'issued_date')::date,p_supersedes_warning_id,v_actor) returning * into v_warning;
      v_event:='draft_created';
    elsif v_warning.employee_id<>p_employee_id or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then
      raise exception using errcode='42501',message='Draft request is outside your outlet scope.';
    end if;
  else
    select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id for update;
    if v_warning.id is null or v_warning.status<>'draft' then raise exception using errcode='55000',message='Only a draft warning can be edited.'; end if;
    if v_warning.employee_id<>p_employee_id or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Warning is outside your outlet scope.'; end if;
    update public.employee_disciplinary_warnings set warning_type=p_payload->>'warning_type',incident_date=(p_payload->>'incident_date')::date,subject=btrim(p_payload->>'subject'),warning_details=btrim(p_payload->>'warning_details'),required_action=btrim(p_payload->>'required_action'),issued_date=(p_payload->>'issued_date')::date,updated_at=clock_timestamp() where id=v_warning.id returning * into v_warning;
    v_event:='draft_updated';
  end if;
  if v_event is not null then insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id) values(v_warning.id,v_event,'admin',v_actor); end if;
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_evidence_prepare(p_warning_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_warning public.employee_disciplinary_warnings%rowtype; v_ext text:='bin';
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Evidence upload is unavailable.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id and status='draft';
  if v_warning.id is null or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Draft warning is unavailable.'; end if;
  return jsonb_build_object('bucket','employee-disciplinary-evidence','object_path',format('%s/%s/%s',v_warning.employee_id,v_warning.id,p_request_id),'previous_path',v_warning.evidence_path);
end; $$;

create or replace function public.employee_disciplinary_evidence_finalize(p_warning_id uuid,p_request_id uuid,p_evidence_path text,p_mime_type text,p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_warning public.employee_disciplinary_warnings%rowtype; v_expected text; v_actor uuid:=public.employee_disciplinary_current_admin_employee();
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Evidence upload is unavailable.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id and status='draft' for update;
  if v_warning.id is null or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Draft warning is unavailable.'; end if;
  v_expected:=format('%s/%s/%s',v_warning.employee_id,v_warning.id,p_request_id);
  if p_evidence_path<>v_expected or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size_bytes<=0 or p_size_bytes>10485760 or not exists(select 1 from storage.objects where bucket_id='employee-disciplinary-evidence' and name=p_evidence_path) then raise exception using errcode='22023',message='Supporting evidence is invalid.'; end if;
  update public.employee_disciplinary_warnings set evidence_bucket='employee-disciplinary-evidence',evidence_path=p_evidence_path,evidence_mime_type=p_mime_type,evidence_size_bytes=p_size_bytes,updated_at=clock_timestamp() where id=p_warning_id returning * into v_warning;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id) values(v_warning.id,'evidence_attached','admin',v_actor);
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_issue(p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_warning public.employee_disciplinary_warnings%rowtype; v_actor uuid:=public.employee_disciplinary_current_admin_employee(); v_now timestamptz:=clock_timestamp();
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to issue disciplinary records.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id for update;
  if v_warning.id is null or v_warning.status<>'draft' or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='55000',message='Draft warning is unavailable.'; end if;
  if v_warning.supersedes_warning_id is not null then
    update public.employee_disciplinary_warnings set status='superseded',superseded_by_warning_id=v_warning.id,updated_at=v_now where id=v_warning.supersedes_warning_id and status not in ('withdrawn','superseded');
    if not found then raise exception using errcode='55000',message='The original warning can no longer be superseded.'; end if;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_warning.supersedes_warning_id,'superseded','admin',v_actor,v_now,jsonb_build_object('superseded_by_warning_id',v_warning.id));
  end if;
  update public.employee_disciplinary_warnings set status='issued',issued_by_employee_id=v_actor,issued_at=v_now,updated_at=v_now where id=p_warning_id returning * into v_warning;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'issued','admin',v_actor,v_now);
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_admin_transition(p_warning_id uuid,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_warning public.employee_disciplinary_warnings%rowtype; v_actor uuid:=public.employee_disciplinary_current_admin_employee(); v_now timestamptz:=clock_timestamp();
begin
  if not public.current_user_has_permission('employee_disciplinary.manage') then raise exception using errcode='42501',message='Missing permission to manage disciplinary records.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id for update;
  if v_warning.id is null or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Warning is outside your outlet scope.'; end if;
  if p_action='withdraw' then
    if v_warning.status in ('draft','withdrawn','superseded') or nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='A withdrawal reason is required for an issued warning.'; end if;
    update public.employee_disciplinary_warnings set status='withdrawn',withdrawn_at=v_now,withdrawn_by_employee_id=v_actor,withdrawal_reason=btrim(p_reason),updated_at=v_now where id=p_warning_id returning * into v_warning;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_warning.id,'withdrawn','admin',v_actor,v_now,jsonb_build_object('reason',btrim(p_reason)));
  elsif p_action='not_acknowledged' then
    if v_warning.status not in ('delivered','viewed') then raise exception using errcode='55000',message='Only a delivered or viewed warning can be marked Not Acknowledged.'; end if;
    update public.employee_disciplinary_warnings set status='not_acknowledged',not_acknowledged_at=v_now,updated_at=v_now where id=p_warning_id returning * into v_warning;
    insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'not_acknowledged','admin',v_actor,v_now);
  else raise exception using errcode='22023',message='Unsupported disciplinary action.';
  end if;
  return to_jsonb(v_warning);
end; $$;

create or replace function public.employee_disciplinary_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('employee_disciplinary.view') then raise exception using errcode='42501',message='Missing permission to view disciplinary records.'; end if;
  if not public.employee_disciplinary_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'employee_id',w.employee_id,'warning_type',w.warning_type,'incident_date',w.incident_date,'subject',w.subject,'warning_details',w.warning_details,'required_action',w.required_action,'issued_date',w.issued_date,'status',w.status,
    'outlet_id_snapshot',w.outlet_id_snapshot,'outlet_name_snapshot',w.outlet_name_snapshot,'evidence_mime_type',w.evidence_mime_type,'has_evidence',w.evidence_path is not null,'supersedes_warning_id',w.supersedes_warning_id,'superseded_by_warning_id',w.superseded_by_warning_id,
    'created_at',w.created_at,'issued_at',w.issued_at,'issued_by_name',issuer.full_name,'delivered_at',w.delivered_at,'first_viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,'not_acknowledged_at',w.not_acknowledged_at,'withdrawn_at',w.withdrawn_at,'withdrawal_reason',w.withdrawal_reason,
    'response',case when r.id is null then null else jsonb_build_object('text',r.response_text,'submitted_at',r.submitted_at) end,
    'activity',coalesce((select jsonb_agg(jsonb_build_object('id',ev.id,'type',ev.event_type,'actor_kind',ev.actor_kind,'actor_name',actor.full_name,'occurred_at',ev.occurred_at,'details',ev.details) order by ev.occurred_at,ev.id) from public.employee_disciplinary_events ev left join public.employees actor on actor.id=ev.actor_employee_id where ev.warning_id=w.id),'[]'::jsonb)
  ) order by coalesce(w.issued_at,w.created_at) desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w left join public.employees issuer on issuer.id=w.issued_by_employee_id left join public.employee_disciplinary_responses r on r.warning_id=w.id where w.employee_id=p_employee_id;
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
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'warning_type',w.warning_type,'subject',w.subject,'issued_date',w.issued_date,'status',w.status,'issued_at',w.issued_at,'viewed_at',w.first_viewed_at,'acknowledged_at',w.acknowledged_at,'has_response',r.id is not null) order by w.issued_at desc),'[]'::jsonb) into v_rows
  from public.employee_disciplinary_warnings w left join public.employee_disciplinary_responses r on r.warning_id=w.id where w.employee_id=v_employee and w.status<>'draft';
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
  select jsonb_build_object('id',v_warning.id,'warning_type',v_warning.warning_type,'incident_date',v_warning.incident_date,'subject',v_warning.subject,'warning_details',v_warning.warning_details,'required_action',v_warning.required_action,'issued_date',v_warning.issued_date,'status',v_warning.status,'outlet_name_snapshot',v_warning.outlet_name_snapshot,'issued_at',v_warning.issued_at,'delivered_at',v_warning.delivered_at,'first_viewed_at',v_warning.first_viewed_at,'acknowledged_at',v_warning.acknowledged_at,'not_acknowledged_at',v_warning.not_acknowledged_at,'withdrawn_at',v_warning.withdrawn_at,'withdrawal_reason',v_warning.withdrawal_reason,'has_evidence',v_warning.evidence_path is not null,'evidence_mime_type',v_warning.evidence_mime_type,'response',case when r.id is null then null else jsonb_build_object('text',r.response_text,'submitted_at',r.submitted_at) end) into v_result from public.employee_disciplinary_warnings w left join public.employee_disciplinary_responses r on r.warning_id=w.id where w.id=v_warning.id;
  return v_result;
end; $$;

create or replace function public.crew_employee_disciplinary_respond(p_token text,p_warning_id uuid,p_response text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_response public.employee_disciplinary_responses%rowtype;
begin
  v_employee:=public.crew_session_employee(p_token);
  if nullif(btrim(p_response),'') is null then raise exception using errcode='22023',message='Enter your response.'; end if;
  if not exists(select 1 from public.employee_disciplinary_warnings where id=p_warning_id and employee_id=v_employee and status in ('delivered','viewed','acknowledged','not_acknowledged')) then raise exception using errcode='42501',message='Warning is unavailable.'; end if;
  insert into public.employee_disciplinary_responses(warning_id,employee_id,response_text) values(p_warning_id,v_employee,btrim(p_response)) returning * into v_response;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(p_warning_id,'response_added','crew',v_employee,v_response.submitted_at);
  return to_jsonb(v_response);
exception when unique_violation then raise exception using errcode='23505',message='A response has already been submitted.';
end; $$;

create or replace function public.crew_employee_disciplinary_acknowledge(p_token text,p_warning_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_warning public.employee_disciplinary_warnings%rowtype; v_now timestamptz:=clock_timestamp();
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id and employee_id=v_employee for update;
  if v_warning.id is null or v_warning.status not in ('delivered','viewed') then raise exception using errcode='55000',message='This warning cannot be acknowledged.'; end if;
  update public.employee_disciplinary_warnings set status='acknowledged',first_viewed_at=coalesce(first_viewed_at,v_now),acknowledged_at=v_now,updated_at=v_now where id=v_warning.id returning * into v_warning;
  if not exists(select 1 from public.employee_disciplinary_events where warning_id=v_warning.id and event_type='viewed') then insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'viewed','crew',v_employee,v_now); end if;
  insert into public.employee_disciplinary_events(warning_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_warning.id,'acknowledged','crew',v_employee,v_now);
  return jsonb_build_object('warning_id',v_warning.id,'status',v_warning.status,'acknowledged_at',v_warning.acknowledged_at);
end; $$;

create or replace function public.employee_disciplinary_admin_evidence_context(p_warning_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_warning public.employee_disciplinary_warnings%rowtype;
begin
  if not public.current_user_has_permission('employee_disciplinary.view') then raise exception using errcode='42501',message='Evidence is unavailable.'; end if;
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id;
  if v_warning.id is null or v_warning.evidence_path is null or not public.employee_disciplinary_admin_can_access_employee(v_warning.employee_id) then raise exception using errcode='42501',message='Evidence is unavailable.'; end if;
  return jsonb_build_object('bucket',v_warning.evidence_bucket,'object_path',v_warning.evidence_path,'mime_type',v_warning.evidence_mime_type);
end; $$;

create or replace function public.crew_employee_disciplinary_evidence_context(p_token text,p_warning_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid; v_warning public.employee_disciplinary_warnings%rowtype;
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_warning from public.employee_disciplinary_warnings where id=p_warning_id and employee_id=v_employee and status<>'draft';
  if v_warning.id is null or v_warning.evidence_path is null then raise exception using errcode='42501',message='Evidence is unavailable.'; end if;
  return jsonb_build_object('bucket',v_warning.evidence_bucket,'object_path',v_warning.evidence_path,'mime_type',v_warning.evidence_mime_type);
end; $$;

revoke all on function public.employee_disciplinary_admin_can_access_employee(uuid),public.employee_disciplinary_current_admin_employee(),public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_disciplinary_evidence_prepare(uuid,uuid),public.employee_disciplinary_evidence_finalize(uuid,uuid,text,text,bigint),public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_transition(uuid,text,text),public.employee_disciplinary_admin_detail(uuid),public.crew_employee_disciplinary(text),public.crew_employee_disciplinary_detail(text,uuid),public.crew_employee_disciplinary_respond(text,uuid,text),public.crew_employee_disciplinary_acknowledge(text,uuid),public.employee_disciplinary_admin_evidence_context(uuid),public.crew_employee_disciplinary_evidence_context(text,uuid) from public,anon,authenticated;
grant execute on function public.employee_disciplinary_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_disciplinary_evidence_prepare(uuid,uuid),public.employee_disciplinary_evidence_finalize(uuid,uuid,text,text,bigint),public.employee_disciplinary_issue(uuid),public.employee_disciplinary_admin_transition(uuid,text,text),public.employee_disciplinary_admin_detail(uuid),public.employee_disciplinary_admin_evidence_context(uuid) to authenticated;
grant execute on function public.crew_employee_disciplinary(text),public.crew_employee_disciplinary_detail(text,uuid),public.crew_employee_disciplinary_respond(text,uuid,text),public.crew_employee_disciplinary_acknowledge(text,uuid),public.crew_employee_disciplinary_evidence_context(text,uuid) to anon,authenticated;
