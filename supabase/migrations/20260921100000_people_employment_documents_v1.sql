-- People-owned Legal Employer and Employment Documents V1.
-- Employment documents are acknowledgements, not electronic signatures.

insert into public.permissions(code,module,description) values
  ('legal_entities.view','People','View legal employing entities'),
  ('legal_entities.manage','People','Maintain legal employing entities'),
  ('employee_employment_documents.view','People','View employee employment documents and immutable evidence'),
  ('employee_employment_documents.manage','People','Create, send, withdraw and supersede employee employment documents')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code in ('employees.view','employees.edit','employees.manage')
  and p.code in ('legal_entities.view','employee_employment_documents.view')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code in ('employees.edit','employees.manage')
  and p.code in ('legal_entities.manage','employee_employment_documents.manage')
on conflict do nothing;

create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  legal_company_name text not null check(nullif(btrim(legal_company_name),'') is not null),
  company_registration_no text not null check(nullif(btrim(company_registration_no),'') is not null),
  registered_address text not null check(nullif(btrim(registered_address),'') is not null),
  display_name text,
  is_active boolean not null default true,
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  updated_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint legal_entities_registration_unique unique(company_registration_no),
  constraint legal_entities_display_name_nonblank check(display_name is null or nullif(btrim(display_name),'') is not null)
);

alter table public.employees add column legal_entity_id uuid references public.legal_entities(id) on delete restrict;
create index employees_legal_entity_idx on public.employees(legal_entity_id) where legal_entity_id is not null;

create table public.employee_employment_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  employee_id uuid not null references public.employees(id) on delete restrict,
  document_type text not null default 'employment_contract' check(document_type='employment_contract'),
  title text not null check(nullif(btrim(title),'') is not null),
  effective_date date not null,
  status text not null default 'draft' check(status in ('draft','sent','viewed','completed','withdrawn','superseded')),
  supersedes_document_id uuid references public.employee_employment_documents(id) on delete restrict,
  superseded_by_document_id uuid references public.employee_employment_documents(id) on delete restrict,
  document_bucket text,
  document_path text unique,
  document_mime_type text,
  document_size_bytes bigint check(document_size_bytes is null or document_size_bytes between 1 and 10485760),
  document_sha256 text check(document_sha256 is null or document_sha256 ~ '^[0-9a-f]{64}$'),
  employee_name_snapshot text,
  employee_code_snapshot text,
  position_snapshot text,
  employment_type_snapshot text,
  workplace_snapshot text,
  joined_date_snapshot date,
  legal_entity_id_snapshot uuid references public.legal_entities(id) on delete restrict,
  legal_company_name_snapshot text,
  company_registration_no_snapshot text,
  registered_address_snapshot text,
  legal_entity_display_name_snapshot text,
  issuer_employee_id uuid references public.employees(id) on delete restrict,
  issuer_name_snapshot text,
  consent_method text,
  consent_copy_version text,
  consent_copy text,
  consent_copy_sha256 text check(consent_copy_sha256 is null or consent_copy_sha256 ~ '^[0-9a-f]{64}$'),
  completion_request_id uuid unique,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by_employee_id uuid references public.employees(id) on delete restrict,
  withdrawal_reason text,
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint employee_employment_document_file_shape check (
    (document_bucket is null and document_path is null and document_mime_type is null and document_size_bytes is null and document_sha256 is null)
    or (document_bucket='employee-employment-documents' and document_path is not null and document_mime_type='application/pdf' and document_size_bytes is not null and document_sha256 is not null)
  ),
  constraint employee_employment_document_sent_shape check (
    (status='draft' and sent_at is null)
    or (status<>'draft' and sent_at is not null and issuer_employee_id is not null and employee_name_snapshot is not null
      and legal_entity_id_snapshot is not null and legal_company_name_snapshot is not null
      and company_registration_no_snapshot is not null and registered_address_snapshot is not null
      and consent_method is not null and consent_copy_version is not null and consent_copy is not null and consent_copy_sha256 is not null
      and document_path is not null and document_sha256 is not null)
  ),
  constraint employee_employment_document_completed_shape check (
    (status='completed' and completed_at is not null and completion_request_id is not null)
    or (status<>'completed')
  )
);

create table public.employee_employment_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.employee_employment_documents(id) on delete restrict,
  event_type text not null check(event_type in ('draft_created','draft_updated','document_attached','sent','viewed','completed','withdrawn','superseded')),
  actor_kind text not null check(actor_kind in ('admin','crew','system')),
  actor_employee_id uuid references public.employees(id) on delete restrict,
  request_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'::jsonb
);

create unique index employee_employment_document_event_request_unique
  on public.employee_employment_document_events(document_id,event_type,request_id) where request_id is not null;
create index employee_employment_documents_employee_idx on public.employee_employment_documents(employee_id,created_at desc);
create index employee_employment_document_events_document_idx on public.employee_employment_document_events(document_id,occurred_at,id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('employee-employment-documents','employee-employment-documents',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.legal_entities enable row level security;
alter table public.employee_employment_documents enable row level security;
alter table public.employee_employment_document_events enable row level security;
revoke all on public.legal_entities,public.employee_employment_documents,public.employee_employment_document_events from public,anon,authenticated;

create or replace function public.employment_documents_current_admin_employee()
returns uuid language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid;
begin
  select id into v_employee from public.employees where auth_user_id=auth.uid() order by id limit 1;
  if v_employee is null then raise exception using errcode='42501',message='An employee profile is required.'; end if;
  return v_employee;
end; $$;

create or replace function public.employee_employment_documents_admin_can_access_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.employees e where e.id=p_employee_id and (
    public.current_user_has_all_outlet_access()
    or public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
  ));
$$;

create or replace function public.employment_documents_auth_user_can_access_employee(p_auth_user_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  with actor as (
    select e.role_id,r.name,r.outlet_access_type
    from public.employees e join public.roles r on r.id=e.role_id
    where e.auth_user_id=p_auth_user_id and e.is_active and e.enable_system_login and e.access_state='active'
    limit 1
  ), target as (
    select public.crew_resolve_employee_outlet(p_employee_id) as outlet_id
  )
  select exists(select 1 from actor a,target t where lower(a.name) in ('owner','admin') or a.outlet_access_type='all'
    or exists(select 1 from public.role_outlets ro where ro.role_id=a.role_id and ro.outlet_id=t.outlet_id));
$$;

create or replace function public.legal_entity_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('legal_entities.view') then raise exception using errcode='42501',message='Missing permission to view legal entities.'; end if;
  select coalesce(jsonb_agg(to_jsonb(le) order by le.is_active desc,coalesce(le.display_name,le.legal_company_name)),'[]'::jsonb) into v_rows from public.legal_entities le;
  return v_rows;
end; $$;

create or replace function public.legal_entity_save(p_legal_entity_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employment_documents_current_admin_employee(); v_row public.legal_entities%rowtype;
begin
  if not public.current_user_has_permission('legal_entities.manage') then raise exception using errcode='42501',message='Missing permission to manage legal entities.'; end if;
  if nullif(btrim(p_payload->>'legal_company_name'),'') is null or nullif(btrim(p_payload->>'company_registration_no'),'') is null or nullif(btrim(p_payload->>'registered_address'),'') is null then
    raise exception using errcode='22023',message='Legal company name, registration number and registered address are required.';
  end if;
  if p_legal_entity_id is null then
    insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,display_name,is_active,created_by_employee_id,updated_by_employee_id)
    values(btrim(p_payload->>'legal_company_name'),btrim(p_payload->>'company_registration_no'),btrim(p_payload->>'registered_address'),nullif(btrim(p_payload->>'display_name'),''),coalesce((p_payload->>'is_active')::boolean,true),v_actor,v_actor) returning * into v_row;
  else
    update public.legal_entities set legal_company_name=btrim(p_payload->>'legal_company_name'),company_registration_no=btrim(p_payload->>'company_registration_no'),registered_address=btrim(p_payload->>'registered_address'),display_name=nullif(btrim(p_payload->>'display_name'),''),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),updated_by_employee_id=v_actor,updated_at=clock_timestamp() where id=p_legal_entity_id returning * into v_row;
    if v_row.id is null then raise exception using errcode='P0002',message='Legal entity was not found.'; end if;
  end if;
  return to_jsonb(v_row);
exception when unique_violation then raise exception using errcode='23505',message='Company registration number is already in use.';
end; $$;

create or replace function public.employee_legal_entity_assignment_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if (tg_op='INSERT' or new.legal_entity_id is distinct from old.legal_entity_id) and new.legal_entity_id is not null
    and not exists(select 1 from public.legal_entities where id=new.legal_entity_id and is_active) then
    raise exception using errcode='23514',message='Choose an active legal employer.';
  end if;
  return new;
end; $$;
create trigger employee_legal_entity_assignment_guard before insert or update on public.employees for each row execute function public.employee_legal_entity_assignment_guard();

create or replace function public.employee_employment_document_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Employment document history is immutable.'; end if;
  if old.status<>'draft' and (
    new.employee_id is distinct from old.employee_id or new.document_type is distinct from old.document_type
    or new.title is distinct from old.title or new.effective_date is distinct from old.effective_date
    or new.document_bucket is distinct from old.document_bucket or new.document_path is distinct from old.document_path
    or new.document_mime_type is distinct from old.document_mime_type or new.document_size_bytes is distinct from old.document_size_bytes
    or new.document_sha256 is distinct from old.document_sha256 or new.employee_name_snapshot is distinct from old.employee_name_snapshot
    or new.employee_code_snapshot is distinct from old.employee_code_snapshot or new.position_snapshot is distinct from old.position_snapshot
    or new.employment_type_snapshot is distinct from old.employment_type_snapshot or new.workplace_snapshot is distinct from old.workplace_snapshot
    or new.joined_date_snapshot is distinct from old.joined_date_snapshot or new.legal_entity_id_snapshot is distinct from old.legal_entity_id_snapshot
    or new.legal_company_name_snapshot is distinct from old.legal_company_name_snapshot or new.company_registration_no_snapshot is distinct from old.company_registration_no_snapshot
    or new.registered_address_snapshot is distinct from old.registered_address_snapshot or new.legal_entity_display_name_snapshot is distinct from old.legal_entity_display_name_snapshot
    or new.issuer_employee_id is distinct from old.issuer_employee_id or new.issuer_name_snapshot is distinct from old.issuer_name_snapshot
    or new.consent_method is distinct from old.consent_method or new.consent_copy_version is distinct from old.consent_copy_version
    or new.consent_copy is distinct from old.consent_copy or new.consent_copy_sha256 is distinct from old.consent_copy_sha256
    or new.sent_at is distinct from old.sent_at or new.supersedes_document_id is distinct from old.supersedes_document_id
  ) then raise exception using errcode='55000',message='Sent employment document content is immutable.'; end if;
  return new;
end; $$;
create trigger employee_employment_document_guard before update or delete on public.employee_employment_documents for each row execute function public.employee_employment_document_guard();

create or replace function public.employee_employment_document_event_guard()
returns trigger language plpgsql set search_path=public as $$ begin raise exception using errcode='55000',message='Employment document events are immutable.'; end; $$;
create trigger employee_employment_document_events_immutable before update or delete on public.employee_employment_document_events for each row execute function public.employee_employment_document_event_guard();

create or replace function public.employee_employment_document_save_draft(p_document_id uuid,p_employee_id uuid,p_payload jsonb,p_request_id uuid,p_supersedes_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employment_documents_current_admin_employee(); v_doc public.employee_employment_documents%rowtype; v_event text;
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to manage employment documents.'; end if;
  if not public.employee_employment_documents_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  if nullif(btrim(p_payload->>'title'),'') is null or nullif(p_payload->>'effective_date','') is null then raise exception using errcode='22023',message='Document title and effective date are required.'; end if;
  if p_supersedes_document_id is not null and not exists(select 1 from public.employee_employment_documents where id=p_supersedes_document_id and employee_id=p_employee_id and status not in ('draft','withdrawn','superseded')) then raise exception using errcode='22023',message='The document to supersede is unavailable.'; end if;
  if p_document_id is null then
    select * into v_doc from public.employee_employment_documents where request_id=p_request_id;
    if v_doc.id is null then
      insert into public.employee_employment_documents(request_id,employee_id,title,effective_date,supersedes_document_id,created_by_employee_id)
      values(p_request_id,p_employee_id,btrim(p_payload->>'title'),(p_payload->>'effective_date')::date,p_supersedes_document_id,v_actor) returning * into v_doc;
      v_event:='draft_created';
    elsif v_doc.employee_id<>p_employee_id or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='42501',message='Draft request is outside your outlet scope.'; end if;
  else
    select * into v_doc from public.employee_employment_documents where id=p_document_id for update;
    if v_doc.id is null or v_doc.status<>'draft' then raise exception using errcode='55000',message='Only a draft employment document can be edited.'; end if;
    if v_doc.employee_id<>p_employee_id or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='42501',message='Employment document is outside your outlet scope.'; end if;
    update public.employee_employment_documents set title=btrim(p_payload->>'title'),effective_date=(p_payload->>'effective_date')::date,updated_at=clock_timestamp() where id=v_doc.id returning * into v_doc;
    v_event:='draft_updated';
  end if;
  if v_event is not null then insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,request_id) values(v_doc.id,v_event,'admin',v_actor,p_request_id) on conflict do nothing; end if;
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_document_upload_prepare(p_document_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype;
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Document upload is unavailable.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id and status='draft';
  if v_doc.id is null or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='42501',message='Draft employment document is unavailable.'; end if;
  return jsonb_build_object('bucket','employee-employment-documents','object_path',format('%s/%s/%s.pdf',v_doc.employee_id,v_doc.id,p_request_id),'previous_path',v_doc.document_path);
end; $$;

create or replace function public.employee_employment_document_upload_finalize_service(p_document_id uuid,p_request_id uuid,p_document_path text,p_size_bytes bigint,p_sha256 text,p_actor_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_doc public.employee_employment_documents%rowtype; v_expected text; v_actor uuid;
begin
  select e.id into v_actor from public.employees e join public.roles r on r.id=e.role_id join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id where e.auth_user_id=p_actor_auth_user_id and e.is_active and p.code='employee_employment_documents.manage' limit 1;
  if v_actor is null then raise exception using errcode='42501',message='Document upload is unavailable.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id and status='draft' for update;
  if v_doc.id is null then raise exception using errcode='55000',message='Draft employment document is unavailable.'; end if;
  if not public.employment_documents_auth_user_can_access_employee(p_actor_auth_user_id,v_doc.employee_id) then raise exception using errcode='42501',message='Draft employment document is unavailable.'; end if;
  v_expected:=format('%s/%s/%s.pdf',v_doc.employee_id,v_doc.id,p_request_id);
  if p_document_path<>v_expected or p_size_bytes not between 1 and 10485760 or p_sha256 !~ '^[0-9a-f]{64}$' or not exists(select 1 from storage.objects where bucket_id='employee-employment-documents' and name=p_document_path) then raise exception using errcode='22023',message='Employment document PDF is invalid.'; end if;
  update public.employee_employment_documents set document_bucket='employee-employment-documents',document_path=p_document_path,document_mime_type='application/pdf',document_size_bytes=p_size_bytes,document_sha256=lower(p_sha256),updated_at=clock_timestamp() where id=p_document_id returning * into v_doc;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,request_id,details) values(v_doc.id,'document_attached','admin',v_actor,p_request_id,jsonb_build_object('sha256',v_doc.document_sha256,'size_bytes',v_doc.document_size_bytes)) on conflict do nothing;
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_document_send(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype; v_employee public.employees%rowtype; v_entity public.legal_entities%rowtype; v_actor uuid:=public.employment_documents_current_admin_employee(); v_issuer text; v_now timestamptz:=clock_timestamp(); v_consent text:='I confirm that I have reviewed and acknowledge this exact employment document. This acknowledgement records receipt and review; it is not represented by FeedX as a legal electronic signature.'; v_version text:='employment_document_acknowledgement_v1';
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to send employment documents.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id for update;
  if v_doc.id is null or v_doc.status<>'draft' or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='55000',message='Draft employment document is unavailable.'; end if;
  if v_doc.document_path is null or v_doc.document_sha256 is null then raise exception using errcode='22023',message='Attach the employment contract PDF before sending.'; end if;
  select * into v_employee from public.employees where id=v_doc.employee_id;
  if v_employee.legal_entity_id is null then raise exception using errcode='22023',message='Assign the employee legal employer before sending.'; end if;
  select * into v_entity from public.legal_entities where id=v_employee.legal_entity_id and is_active;
  if v_entity.id is null then raise exception using errcode='22023',message='The assigned legal employer must be active before sending.'; end if;
  select full_name into v_issuer from public.employees where id=v_actor;
  if v_doc.supersedes_document_id is not null then
    update public.employee_employment_documents set status='superseded',superseded_by_document_id=v_doc.id,updated_at=v_now where id=v_doc.supersedes_document_id and status not in ('draft','withdrawn','superseded');
    if not found then raise exception using errcode='55000',message='The original document can no longer be superseded.'; end if;
    insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_doc.supersedes_document_id,'superseded','admin',v_actor,v_now,jsonb_build_object('superseded_by_document_id',v_doc.id));
  end if;
  update public.employee_employment_documents set status='sent',employee_name_snapshot=v_employee.full_name,employee_code_snapshot=v_employee.employee_code,position_snapshot=v_employee.position,employment_type_snapshot=v_employee.employment_type,workplace_snapshot=v_employee.workplace,joined_date_snapshot=v_employee.joined_date,legal_entity_id_snapshot=v_entity.id,legal_company_name_snapshot=v_entity.legal_company_name,company_registration_no_snapshot=v_entity.company_registration_no,registered_address_snapshot=v_entity.registered_address,legal_entity_display_name_snapshot=v_entity.display_name,issuer_employee_id=v_actor,issuer_name_snapshot=v_issuer,consent_method='crew_session_acknowledgement',consent_copy_version=v_version,consent_copy=v_consent,consent_copy_sha256=encode(extensions.digest(v_consent,'sha256'),'hex'),sent_at=v_now,updated_at=v_now where id=v_doc.id returning * into v_doc;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_doc.id,'sent','admin',v_actor,v_now,jsonb_build_object('document_sha256',v_doc.document_sha256,'consent_copy_version',v_version,'consent_copy_sha256',v_doc.consent_copy_sha256));
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_document_withdraw(p_document_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype; v_actor uuid:=public.employment_documents_current_admin_employee(); v_now timestamptz:=clock_timestamp();
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to manage employment documents.'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='A withdrawal reason is required.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id for update;
  if v_doc.id is null or v_doc.status not in ('sent','viewed') or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='55000',message='This employment document cannot be withdrawn.'; end if;
  update public.employee_employment_documents set status='withdrawn',withdrawn_at=v_now,withdrawn_by_employee_id=v_actor,withdrawal_reason=btrim(p_reason),updated_at=v_now where id=v_doc.id returning * into v_doc;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_doc.id,'withdrawn','admin',v_actor,v_now,jsonb_build_object('reason',v_doc.withdrawal_reason));
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_documents_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb; v_employer jsonb;
begin
  if not public.current_user_has_permission('employee_employment_documents.view') then raise exception using errcode='42501',message='Missing permission to view employment documents.'; end if;
  if not public.employee_employment_documents_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select case when le.id is null then null else jsonb_build_object('id',le.id,'legal_company_name',le.legal_company_name,'company_registration_no',le.company_registration_no,'registered_address',le.registered_address,'display_name',le.display_name,'is_active',le.is_active) end into v_employer from public.employees e left join public.legal_entities le on le.id=e.legal_entity_id where e.id=p_employee_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'employee_id',d.employee_id,'document_type',d.document_type,'title',d.title,'effective_date',d.effective_date,'status',d.status,'has_document',d.document_path is not null,'document_size_bytes',d.document_size_bytes,'document_sha256',d.document_sha256,'supersedes_document_id',d.supersedes_document_id,'superseded_by_document_id',d.superseded_by_document_id,'employee_name_snapshot',d.employee_name_snapshot,'employee_code_snapshot',d.employee_code_snapshot,'position_snapshot',d.position_snapshot,'employment_type_snapshot',d.employment_type_snapshot,'workplace_snapshot',d.workplace_snapshot,'legal_company_name_snapshot',d.legal_company_name_snapshot,'company_registration_no_snapshot',d.company_registration_no_snapshot,'registered_address_snapshot',d.registered_address_snapshot,'legal_entity_display_name_snapshot',d.legal_entity_display_name_snapshot,'issuer_name_snapshot',d.issuer_name_snapshot,'sent_at',d.sent_at,'first_viewed_at',d.first_viewed_at,'completed_at',d.completed_at,'withdrawn_at',d.withdrawn_at,'withdrawal_reason',d.withdrawal_reason,'created_at',d.created_at,'activity',coalesce((select jsonb_agg(jsonb_build_object('id',ev.id,'type',ev.event_type,'actor_kind',ev.actor_kind,'actor_name',actor.full_name,'occurred_at',ev.occurred_at,'details',ev.details) order by ev.occurred_at,ev.id) from public.employee_employment_document_events ev left join public.employees actor on actor.id=ev.actor_employee_id where ev.document_id=d.id),'[]'::jsonb)) order by coalesce(d.sent_at,d.created_at) desc),'[]'::jsonb) into v_rows from public.employee_employment_documents d where d.employee_id=p_employee_id;
  return jsonb_build_object('legal_employer',v_employer,'documents',v_rows);
end; $$;

create or replace function public.employee_employment_document_admin_read_context(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype;
begin
  if not public.current_user_has_permission('employee_employment_documents.view') then raise exception using errcode='42501',message='Employment document is unavailable.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id;
  if v_doc.id is null or v_doc.document_path is null or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='42501',message='Employment document is unavailable.'; end if;
  return jsonb_build_object('bucket',v_doc.document_bucket,'object_path',v_doc.document_path,'mime_type',v_doc.document_mime_type,'file_name',regexp_replace(v_doc.title,'[^A-Za-z0-9_-]+','_','g')||'.pdf');
end; $$;

create or replace function public.crew_employee_employment_documents(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_rows jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'document_type',d.document_type,'effective_date',d.effective_date,'status',d.status,'sent_at',d.sent_at,'first_viewed_at',d.first_viewed_at,'completed_at',d.completed_at,'legal_employer',coalesce(d.legal_entity_display_name_snapshot,d.legal_company_name_snapshot)) order by d.sent_at desc),'[]'::jsonb) into v_rows from public.employee_employment_documents d where d.employee_id=v_employee and d.status<>'draft';
  return jsonb_build_object('documents',v_rows);
end; $$;

create or replace function public.crew_employee_employment_document_open(p_token text,p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_doc public.employee_employment_documents%rowtype; v_now timestamptz:=clock_timestamp();
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_doc from public.employee_employment_documents where id=p_document_id and employee_id=v_employee and status<>'draft' for update;
  if v_doc.id is null then raise exception using errcode='42501',message='Employment document is unavailable.'; end if;
  if v_doc.first_viewed_at is null and v_doc.status in ('sent','viewed') then
    update public.employee_employment_documents set first_viewed_at=v_now,status=case when status='sent' then 'viewed' else status end,updated_at=v_now where id=v_doc.id returning * into v_doc;
    insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_doc.id,'viewed','crew',v_employee,v_now);
  end if;
  return jsonb_build_object('id',v_doc.id,'title',v_doc.title,'effective_date',v_doc.effective_date,'status',v_doc.status,'legal_company_name_snapshot',v_doc.legal_company_name_snapshot,'company_registration_no_snapshot',v_doc.company_registration_no_snapshot,'registered_address_snapshot',v_doc.registered_address_snapshot,'issuer_name_snapshot',v_doc.issuer_name_snapshot,'sent_at',v_doc.sent_at,'first_viewed_at',v_doc.first_viewed_at,'completed_at',v_doc.completed_at,'withdrawal_reason',v_doc.withdrawal_reason,'document_sha256',v_doc.document_sha256,'consent_copy_version',v_doc.consent_copy_version,'consent_copy',v_doc.consent_copy,'bucket',v_doc.document_bucket,'object_path',v_doc.document_path,'mime_type',v_doc.document_mime_type,'file_name',regexp_replace(v_doc.title,'[^A-Za-z0-9_-]+','_','g')||'.pdf');
end; $$;

create or replace function public.crew_employee_employment_document_complete(p_token text,p_document_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_doc public.employee_employment_documents%rowtype; v_now timestamptz:=clock_timestamp();
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_doc from public.employee_employment_documents where id=p_document_id and employee_id=v_employee for update;
  if v_doc.id is null then raise exception using errcode='42501',message='Employment document is unavailable.'; end if;
  if v_doc.status='completed' and v_doc.completion_request_id=p_request_id then return jsonb_build_object('document_id',v_doc.id,'status',v_doc.status,'completed_at',v_doc.completed_at); end if;
  if v_doc.status not in ('sent','viewed') then raise exception using errcode='55000',message='This employment document cannot be acknowledged.'; end if;
  update public.employee_employment_documents set status='completed',first_viewed_at=coalesce(first_viewed_at,v_now),completed_at=v_now,completion_request_id=p_request_id,updated_at=v_now where id=v_doc.id returning * into v_doc;
  if not exists(select 1 from public.employee_employment_document_events where document_id=v_doc.id and event_type='viewed') then insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at) values(v_doc.id,'viewed','crew',v_employee,v_now); end if;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,request_id,occurred_at,details) values(v_doc.id,'completed','crew',v_employee,p_request_id,v_now,jsonb_build_object('document_sha256',v_doc.document_sha256,'consent_method',v_doc.consent_method,'consent_copy_version',v_doc.consent_copy_version,'consent_copy',v_doc.consent_copy,'consent_copy_sha256',v_doc.consent_copy_sha256));
  return jsonb_build_object('document_id',v_doc.id,'status',v_doc.status,'completed_at',v_doc.completed_at);
end; $$;

revoke all on function public.employment_documents_current_admin_employee(),public.employee_employment_documents_admin_can_access_employee(uuid),public.employment_documents_auth_user_can_access_employee(uuid,uuid),public.legal_entity_list(),public.legal_entity_save(uuid,jsonb),public.employee_employment_document_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_employment_document_upload_prepare(uuid,uuid),public.employee_employment_document_upload_finalize_service(uuid,uuid,text,bigint,text,uuid),public.employee_employment_document_send(uuid),public.employee_employment_document_withdraw(uuid,text),public.employee_employment_documents_admin_detail(uuid),public.employee_employment_document_admin_read_context(uuid),public.crew_employee_employment_documents(text),public.crew_employee_employment_document_open(text,uuid),public.crew_employee_employment_document_complete(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.legal_entity_list(),public.legal_entity_save(uuid,jsonb),public.employee_employment_document_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_employment_document_upload_prepare(uuid,uuid),public.employee_employment_document_send(uuid),public.employee_employment_document_withdraw(uuid,text),public.employee_employment_documents_admin_detail(uuid),public.employee_employment_document_admin_read_context(uuid) to authenticated;
grant execute on function public.employee_employment_document_upload_finalize_service(uuid,uuid,text,bigint,text,uuid) to service_role;
grant execute on function public.crew_employee_employment_documents(text),public.crew_employee_employment_document_open(text,uuid),public.crew_employee_employment_document_complete(text,uuid,uuid) to anon,authenticated;
