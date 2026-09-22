-- Platform-owned Crew Notification Foundation V1.
-- Notifications record delivery and read receipts only. They never mutate the
-- lifecycle state owned by disciplinary, employment documents, compliance,
-- leave, roster, or task authorities.

create table public.crew_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_employee_id uuid not null references public.employees(id) on delete restrict,
  outlet_id_snapshot uuid references public.outlets(id) on delete set null,
  source_domain text not null check (source_domain in ('people','leave','roster','tasks')),
  event_type text not null check (event_type in (
    'disciplinary_warning_issued','employment_document_sent','compliance_rejected',
    'compliance_expiring_soon','compliance_expired','leave_reviewed','roster_published',
    'roster_changed','task_actionable','task_changed','task_due_soon','task_overdue'
  )),
  source_entity_type text not null check (source_entity_type in (
    'disciplinary_warning','employment_document','compliance_submission','compliance_requirement',
    'leave_request','roster_publication','task_occurrence'
  )),
  source_entity_id uuid not null,
  priority text not null check (priority in ('important','normal')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  action_descriptor jsonb not null,
  dedupe_key text not null unique check (char_length(btrim(dedupe_key)) between 3 and 240),
  created_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(action_descriptor) = 'object' and action_descriptor ? 'version' and action_descriptor ? 'type')
);

create table public.crew_notification_reads (
  notification_id uuid not null references public.crew_notifications(id) on delete restrict,
  recipient_employee_id uuid not null references public.employees(id) on delete restrict,
  read_at timestamptz not null default clock_timestamp(),
  primary key (notification_id, recipient_employee_id)
);

create index crew_notifications_recipient_created_idx
  on public.crew_notifications(recipient_employee_id, created_at desc, id desc);
create index crew_notification_reads_recipient_idx
  on public.crew_notification_reads(recipient_employee_id, read_at desc);

alter table public.crew_notifications enable row level security;
alter table public.crew_notification_reads enable row level security;
revoke all on public.crew_notifications, public.crew_notification_reads from public, anon, authenticated;

create or replace function public.crew_notification_recipient_is_active(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.employees e
    join public.crew_access ca on ca.employee_id=e.id and ca.access_state='active'
    where e.id=p_employee_id
      and coalesce(e.is_active,true)
      and coalesce(e.employment_status,'active') not in ('resigned','terminated')
  );
$$;
revoke all on function public.crew_notification_recipient_is_active(uuid) from public, anon, authenticated;

create or replace function public.crew_notification_create(
  p_recipient_employee_id uuid,
  p_outlet_id_snapshot uuid,
  p_source_domain text,
  p_event_type text,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_priority text,
  p_title text,
  p_body text,
  p_action_descriptor jsonb,
  p_dedupe_key text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  -- Delivery eligibility is intentionally independent from source-event success.
  if not public.crew_notification_recipient_is_active(p_recipient_employee_id) then return null; end if;
  if jsonb_typeof(p_action_descriptor) <> 'object'
    or coalesce(p_action_descriptor->>'version','') <> '1'
    or coalesce(p_action_descriptor->>'type','') not in (
      'disciplinary_warning','employment_document','compliance_submission',
      'compliance_requirement','leave_request','roster_publication','task_occurrence'
    ) then
    raise exception using errcode='22023', message='Notification action descriptor is invalid.';
  end if;
  insert into public.crew_notifications(
    recipient_employee_id,outlet_id_snapshot,source_domain,event_type,source_entity_type,source_entity_id,
    priority,title,body,action_descriptor,dedupe_key
  ) values (
    p_recipient_employee_id,p_outlet_id_snapshot,p_source_domain,p_event_type,p_source_entity_type,p_source_entity_id,
    p_priority,left(btrim(p_title),180),left(btrim(p_body),500),p_action_descriptor,left(btrim(p_dedupe_key),240)
  ) on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.crew_notification_create(uuid,uuid,text,text,text,uuid,text,text,text,jsonb,text) from public, anon, authenticated;

create or replace function public.crew_notification_source_available(p_notification public.crew_notifications)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  case p_notification.source_entity_type
    when 'disciplinary_warning' then
      return exists(select 1 from public.employee_disciplinary_warnings w where w.id=p_notification.source_entity_id and w.employee_id=p_notification.recipient_employee_id and w.status not in ('withdrawn','superseded'));
    when 'employment_document' then
      return exists(select 1 from public.employee_employment_documents d where d.id=p_notification.source_entity_id and d.employee_id=p_notification.recipient_employee_id and d.status not in ('withdrawn','superseded'));
    when 'compliance_submission' then
      return exists(select 1 from public.employee_compliance_submissions s where s.id=p_notification.source_entity_id and s.employee_id=p_notification.recipient_employee_id);
    when 'compliance_requirement' then
      return exists(select 1 from public.employee_compliance_requirements r where r.id=p_notification.source_entity_id and r.is_active);
    when 'leave_request' then
      return exists(select 1 from public.crew_leave_requests l where l.id=p_notification.source_entity_id and l.employee_id=p_notification.recipient_employee_id);
    when 'roster_publication' then
      return exists(select 1 from public.duty_roster_publications p where p.id=p_notification.source_entity_id);
    when 'task_occurrence' then
      return exists(select 1 from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id where a.instance_id=p_notification.source_entity_id and a.employee_id=p_notification.recipient_employee_id and a.status not in ('completed','completed_with_exceptions'));
    else return false;
  end case;
end;
$$;
revoke all on function public.crew_notification_source_available(public.crew_notifications) from public, anon, authenticated;

create or replace function public.crew_notification_unread_count(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid; v_count integer;
begin
  v_employee:=public.crew_session_employee(p_token);
  select count(*)::integer into v_count
  from public.crew_notifications n
  where n.recipient_employee_id=v_employee
    and not exists(select 1 from public.crew_notification_reads r where r.notification_id=n.id and r.recipient_employee_id=v_employee);
  return jsonb_build_object('unread_count',coalesce(v_count,0));
end;
$$;

create or replace function public.crew_notifications_page(
  p_token text,
  p_unread_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid; v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end; v_total integer; v_rows jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  select count(*) into v_total from public.crew_notifications n
  where n.recipient_employee_id=v_employee
    and (not p_unread_only or not exists(select 1 from public.crew_notification_reads r where r.notification_id=n.id and r.recipient_employee_id=v_employee));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'priority',x.priority,'title',x.title,'body',x.body,'created_at',x.created_at,
    'is_read',x.is_read,'action_descriptor',x.action_descriptor,'source_available',public.crew_notification_source_available(x.n)
  ) order by x.created_at desc,x.id desc),'[]'::jsonb) into v_rows
  from (
    select n, n.id,n.priority,n.title,n.body,n.created_at,n.action_descriptor,
      exists(select 1 from public.crew_notification_reads r where r.notification_id=n.id and r.recipient_employee_id=v_employee) as is_read
    from public.crew_notifications n
    where n.recipient_employee_id=v_employee
      and (not p_unread_only or not exists(select 1 from public.crew_notification_reads r where r.notification_id=n.id and r.recipient_employee_id=v_employee))
    order by n.created_at desc,n.id desc offset (v_page-1)*v_size limit v_size
  ) x;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size);
end;
$$;

create or replace function public.crew_notification_mark_read(p_token text,p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_notification public.crew_notifications%rowtype;
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_notification from public.crew_notifications where id=p_notification_id and recipient_employee_id=v_employee;
  if v_notification.id is null then raise exception using errcode='42501',message='Notification is unavailable.'; end if;
  insert into public.crew_notification_reads(notification_id,recipient_employee_id)
  values(v_notification.id,v_employee) on conflict(notification_id,recipient_employee_id) do nothing;
  return jsonb_build_object('action_descriptor',v_notification.action_descriptor,'source_available',public.crew_notification_source_available(v_notification));
end;
$$;

revoke all on function public.crew_notification_unread_count(text),public.crew_notifications_page(text,boolean,integer,integer),public.crew_notification_mark_read(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_notification_unread_count(text),public.crew_notifications_page(text,boolean,integer,integer),public.crew_notification_mark_read(text,uuid) to anon,authenticated;

-- Immediate producer transitions. Each trigger is best-effort delivery only;
-- source lifecycle success remains authoritative even when the recipient lacks Crew access.
create or replace function public.crew_notification_on_warning_issued()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='issued' and old.status is distinct from 'issued' then
    perform public.crew_notification_create(new.employee_id,new.outlet_id_snapshot,'people','disciplinary_warning_issued','disciplinary_warning',new.id,'important',
      'New warning issued',left(coalesce(new.subject,'A disciplinary warning is ready for your review.'),500),
      jsonb_build_object('version',1,'type','disciplinary_warning','warning_id',new.id),'warning.issued:'||new.id||':'||new.employee_id);
  end if;
  return new;
end;
$$;
drop trigger if exists crew_notification_warning_issued on public.employee_disciplinary_warnings;
create trigger crew_notification_warning_issued after update of status on public.employee_disciplinary_warnings for each row execute function public.crew_notification_on_warning_issued();

create or replace function public.crew_notification_on_document_sent()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='sent' and old.status is distinct from 'sent' then
    perform public.crew_notification_create(new.employee_id,public.crew_resolve_employee_outlet(new.employee_id),'people','employment_document_sent','employment_document',new.id,'important',
      'Employment document ready',left(coalesce(new.title,'An employment document is ready for your review.'),500),
      jsonb_build_object('version',1,'type','employment_document','document_id',new.id),'employment_document.sent:'||new.id||':'||new.employee_id);
  end if;
  return new;
end;
$$;
drop trigger if exists crew_notification_document_sent on public.employee_employment_documents;
create trigger crew_notification_document_sent after update of status on public.employee_employment_documents for each row execute function public.crew_notification_on_document_sent();

create or replace function public.crew_notification_on_compliance_review()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_submission public.employee_compliance_submissions%rowtype; v_requirement public.employee_compliance_requirements%rowtype;
begin
  if new.decision='rejected' then
    select * into v_submission from public.employee_compliance_submissions where id=new.submission_id;
    select * into v_requirement from public.employee_compliance_requirements where id=v_submission.requirement_id;
    perform public.crew_notification_create(v_submission.employee_id,v_submission.submission_outlet_id,'people','compliance_rejected','compliance_submission',v_submission.id,'normal',
      'Document needs updating',left(v_requirement.name||': '||coalesce(new.rejection_reason,'Please resubmit your document.'),500),
      jsonb_build_object('version',1,'type','compliance_submission','submission_id',v_submission.id,'requirement_code',v_requirement.code),'compliance.rejected:'||v_submission.id);
  end if;
  return new;
end;
$$;
drop trigger if exists crew_notification_compliance_review on public.employee_compliance_reviews;
create trigger crew_notification_compliance_review after insert on public.employee_compliance_reviews for each row execute function public.crew_notification_on_compliance_review();

create or replace function public.crew_notification_on_leave_review()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('approved','rejected') and old.status is distinct from new.status then
    perform public.crew_notification_create(new.employee_id,new.employment_outlet_id,'leave','leave_reviewed','leave_request',new.id,'normal',
      case when new.status='approved' then 'Leave approved' else 'Leave request not approved' end,
      case when new.status='approved' then 'Your leave request has been approved.' else coalesce(new.rejection_reason,'Your leave request was not approved.') end,
      jsonb_build_object('version',1,'type','leave_request','request_id',new.id),'leave.reviewed:'||new.id||':'||new.status);
  end if;
  return new;
end;
$$;
drop trigger if exists crew_notification_leave_reviewed on public.crew_leave_requests;
create trigger crew_notification_leave_reviewed after update of status on public.crew_leave_requests for each row execute function public.crew_notification_on_leave_review();

create or replace function public.crew_notification_on_roster_publication()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_previous uuid; v_employee uuid; v_short_notice boolean; v_priority text; v_event text; v_title text; v_body text;
begin
  select id into v_previous from public.duty_roster_publications
  where outlet_id=new.outlet_id and week_start_date=new.week_start_date and revision<new.revision
  order by revision desc limit 1;
  for v_employee in
    with changed as (
      select coalesce(n.employee_id,o.employee_id) employee_id,
        bool_or(((coalesce(n.roster_date,o.roster_date) + coalesce(n.start_time,o.start_time,time '00:00')) at time zone 'Asia/Kuala_Lumpur') < clock_timestamp()+interval '24 hours') short_notice
      from (select * from public.duty_roster_published_entries where publication_id=new.id) n
      full join (select * from public.duty_roster_published_entries where publication_id=v_previous) o
        on n.employee_id=o.employee_id and n.roster_date=o.roster_date
      where v_previous is null or o.id is null or n.id is null
        or row(n.start_time,n.end_time,n.break_minutes,n.entry_type,n.template_code) is distinct from row(o.start_time,o.end_time,o.break_minutes,o.entry_type,o.template_code)
      group by coalesce(n.employee_id,o.employee_id)
    ) select employee_id from changed where employee_id is not null
  loop
    v_priority:=case when v_previous is null then 'normal' else 'important' end;
    v_event:=case when v_previous is null then 'roster_published' else 'roster_changed' end;
    v_title:=case when v_previous is null then 'Roster published' else 'Your roster changed' end;
    select exists(
      select 1
      from public.duty_roster_published_entries e
      where e.publication_id in (new.id, v_previous)
        and e.employee_id=v_employee
        and ((e.roster_date+coalesce(e.start_time,time '00:00')) at time zone 'Asia/Kuala_Lumpur') < clock_timestamp()+interval '24 hours'
    ) into v_short_notice;
    v_body:=case when v_short_notice and v_previous is not null then 'Short-notice change to your published schedule.' when v_previous is null then 'Your published roster is now available.' else 'Your published schedule has changed.' end;
    perform public.crew_notification_create(v_employee,new.outlet_id,'roster',v_event,'roster_publication',new.id,v_priority,v_title,v_body,
      jsonb_build_object('version',1,'type','roster_publication','publication_id',new.id,'week_start_date',new.week_start_date),
      case when v_previous is null then 'roster.first:'||new.id||':'||v_employee else 'roster.changed:'||new.id||':'||v_employee end);
  end loop;
  return new;
end;
$$;
drop trigger if exists crew_notification_roster_publication on public.duty_roster_publications;
create trigger crew_notification_roster_publication after insert on public.duty_roster_publications for each row execute function public.crew_notification_on_roster_publication();

-- Scheduler-owned projection state prevents historical backfill and makes
-- retries idempotent. The generator is the only producer for time-based
-- compliance and Task occurrence notifications.
create table public.crew_notification_compliance_state (
  employee_id uuid not null references public.employees(id) on delete restrict,
  requirement_id uuid not null references public.employee_compliance_requirements(id) on delete restrict,
  effective_status text not null,
  primary key(employee_id,requirement_id)
);
create table public.crew_notification_task_state (
  instance_id uuid not null references public.crew_operation_instances(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  execution_fingerprint text not null,
  observed_status text not null,
  primary key(instance_id,employee_id)
);
revoke all on public.crew_notification_compliance_state, public.crew_notification_task_state from public, anon, authenticated;

create or replace function public.crew_notification_generate_scheduled()
returns void language plpgsql security definer set search_path=public as $$
declare v_date date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date; v_now timestamptz:=clock_timestamp(); r record; v_prior text; v_fingerprint text; v_state public.crew_notification_task_state%rowtype; v_due_soon interval:=interval '1 hour';
begin
  -- Existing task authority materializes today's occurrences. This is scheduler
  -- work, never a Crew page-read side effect.
  perform public.crew_operations_ensure_instances(o.id,v_date)
  from public.outlets o where exists(select 1 from public.crew_access ca where ca.primary_outlet_id=o.id and ca.access_state='active');

  for r in
    select e.id employee_id, public.crew_resolve_employee_outlet(e.id) outlet_id, req.id requirement_id, req.code, req.name,
      public.employee_compliance_current(e.id,req.id,v_date) state
    from public.employees e cross join public.employee_compliance_requirements req
    where req.is_active and public.crew_notification_recipient_is_active(e.id)
  loop
    select effective_status into v_prior from public.crew_notification_compliance_state where employee_id=r.employee_id and requirement_id=r.requirement_id for update;
    if v_prior is not null and v_prior is distinct from r.state->>'effective_status' then
      if r.state->>'effective_status'='expiring_soon' then
        perform public.crew_notification_create(r.employee_id,r.outlet_id,'people','compliance_expiring_soon','compliance_requirement',r.requirement_id,'normal',
          'Document expires soon',r.name||' expires soon.',jsonb_build_object('version',1,'type','compliance_requirement','requirement_code',r.code),'compliance.expiring_soon:'||r.employee_id||':'||r.requirement_id||':'||v_date);
      elsif r.state->>'effective_status'='expired' then
        perform public.crew_notification_create(r.employee_id,r.outlet_id,'people','compliance_expired','compliance_requirement',r.requirement_id,'important',
          'Document expired',r.name||case when coalesce((r.state->>'replacement_pending')::boolean,false) then ' has expired while your renewal is awaiting verification.' else ' has expired. Please renew it.' end,
          jsonb_build_object('version',1,'type','compliance_requirement','requirement_code',r.code),'compliance.expired:'||r.employee_id||':'||r.requirement_id||':'||v_date);
      end if;
    end if;
    insert into public.crew_notification_compliance_state(employee_id,requirement_id,effective_status)
    values(r.employee_id,r.requirement_id,coalesce(r.state->>'effective_status','missing'))
    on conflict(employee_id,requirement_id) do update set effective_status=excluded.effective_status;
  end loop;

  for r in
    select i.id instance_id,a.employee_id,i.outlet_id,i.name,i.schedule_type,i.available_from,i.available_until,a.status,
      encode(extensions.digest(concat_ws('|',i.name,i.available_from,i.available_until,i.schedule_type,a.employee_id),'sha256'),'hex') fingerprint
    from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id
    where i.business_date>=v_date and i.available_from<=v_now and public.crew_notification_recipient_is_active(a.employee_id)
  loop
    select * into v_state from public.crew_notification_task_state where instance_id=r.instance_id and employee_id=r.employee_id for update;
    if v_state.instance_id is null then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_actionable','task_occurrence',r.instance_id,
        case when r.schedule_type='one_time' then 'important' else 'normal' end,'Task ready',left(r.name,500),
        jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.actionable:'||r.instance_id||':'||r.employee_id);
    elsif v_state.execution_fingerprint is distinct from r.fingerprint and r.status not in ('completed','completed_with_exceptions') then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_changed','task_occurrence',r.instance_id,'important','Task changed',left(r.name||' has changed.',500),
        jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.changed:'||r.instance_id||':'||r.employee_id||':'||r.fingerprint);
    end if;
    if r.status not in ('completed','completed_with_exceptions') and r.available_until is not null and r.available_until>v_now and r.available_until<=v_now+v_due_soon then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_due_soon','task_occurrence',r.instance_id,'normal','Task due soon',left(r.name||' is due soon.',500),jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.due_soon:'||r.instance_id||':'||r.employee_id);
    elsif r.status not in ('completed','completed_with_exceptions') and r.available_until is not null and r.available_until<v_now then
      perform public.crew_notification_create(r.employee_id,r.outlet_id,'tasks','task_overdue','task_occurrence',r.instance_id,'important','Task overdue',left(r.name||' is overdue.',500),jsonb_build_object('version',1,'type','task_occurrence','occurrence_id',r.instance_id),'task.overdue:'||r.instance_id||':'||r.employee_id);
    end if;
    insert into public.crew_notification_task_state(instance_id,employee_id,execution_fingerprint,observed_status)
    values(r.instance_id,r.employee_id,r.fingerprint,r.status)
    on conflict(instance_id,employee_id) do update set execution_fingerprint=excluded.execution_fingerprint,observed_status=excluded.observed_status;
  end loop;
end;
$$;
revoke all on function public.crew_notification_generate_scheduled() from public, anon, authenticated;

-- Establish a prospective baseline. Existing domain history intentionally does
-- not become a launch-time notification backlog.
insert into public.crew_notification_compliance_state(employee_id,requirement_id,effective_status)
select e.id,r.id,coalesce(public.employee_compliance_current(e.id,r.id)->>'effective_status','missing')
from public.employees e cross join public.employee_compliance_requirements r
where r.is_active
on conflict(employee_id,requirement_id) do nothing;
insert into public.crew_notification_task_state(instance_id,employee_id,execution_fingerprint,observed_status)
select i.id,a.employee_id,encode(extensions.digest(concat_ws('|',i.name,i.available_from,i.available_until,i.schedule_type,a.employee_id),'sha256'),'hex'),a.status
from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id
on conflict(instance_id,employee_id) do nothing;

-- pg_cron is the repository's existing reliable server-side scheduler. The
-- generator remains idempotent through deterministic dedupe keys and
-- projection-state rows, so a retry never emits a duplicate notification.
do $$
declare v_job bigint; v_cron_installed boolean;
begin
  select exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') into v_cron_installed;
  if not v_cron_installed
     or pg_catalog.to_regnamespace('cron') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'Crew Notification V1 requires the repository pg_cron scheduler.';
  end if;
  for v_job in execute 'select jobid from cron.job where jobname = $1' using 'feedx_crew_notification_v1' loop
    execute 'select cron.unschedule($1)' using v_job;
  end loop;
  execute 'select cron.schedule($1, $2, $3)'
    using 'feedx_crew_notification_v1','*/15 * * * *','select public.crew_notification_generate_scheduled()';
end;
$$;
