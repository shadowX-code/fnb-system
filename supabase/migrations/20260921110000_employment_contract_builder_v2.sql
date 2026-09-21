-- People-owned Employment Contract Builder V2.
-- V2 extends the V1 Employment Document lifecycle. It does not create a second
-- document authority: generated PDFs are still pinned, sent and acknowledged by
-- public.employee_employment_documents.

insert into public.permissions(code,module,description) values
  ('employment_contract_templates.view','People','View legal-entity employment contract templates'),
  ('employment_contract_templates.manage','People','Maintain legal-entity employment contract templates')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code in ('employee_employment_documents.view','employee_employment_documents.manage')
  and p.code='employment_contract_templates.view'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select distinct rp.role_id,p.id from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
cross join public.permissions p
where existing.code='employee_employment_documents.manage'
  and p.code='employment_contract_templates.manage'
on conflict do nothing;

create table public.employment_contract_templates (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.legal_entities(id) on delete restrict,
  title text not null check(nullif(btrim(title),'') is not null),
  contract_kind text not null check(contract_kind in ('full_time','part_time')),
  language_code text not null default 'en' check(language_code='en'),
  is_active boolean not null default true,
  is_default boolean not null default false,
  current_published_version_id uuid,
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  updated_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.employment_contract_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.employment_contract_templates(id) on delete restrict,
  version_number integer not null check(version_number > 0),
  status text not null default 'draft' check(status in ('draft','published')),
  sections jsonb not null default '[]'::jsonb,
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_employee_id uuid not null references public.employees(id) on delete restrict,
  published_by_employee_id uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  unique(template_id,version_number),
  constraint employment_contract_template_version_publish_shape check(
    (status='draft' and published_at is null and published_by_employee_id is null)
    or (status='published' and published_at is not null and published_by_employee_id is not null)
  )
);

alter table public.employment_contract_templates
  add constraint employment_contract_templates_current_version_fk
  foreign key(current_published_version_id) references public.employment_contract_template_versions(id) on delete restrict;

create unique index employment_contract_templates_default_unique
  on public.employment_contract_templates(legal_entity_id,contract_kind,language_code)
  where is_default;
create index employment_contract_templates_entity_idx on public.employment_contract_templates(legal_entity_id,is_active,contract_kind);
create index employment_contract_template_versions_template_idx on public.employment_contract_template_versions(template_id,version_number desc);

alter table public.employee_employment_documents
  add column creation_source text not null default 'uploaded' check(creation_source in ('uploaded','template')),
  add column template_version_id uuid references public.employment_contract_template_versions(id) on delete restrict,
  add column template_title_snapshot text,
  add column template_version_number_snapshot integer,
  add column template_content_sha256_snapshot text check(template_content_sha256_snapshot is null or template_content_sha256_snapshot ~ '^[0-9a-f]{64}$'),
  add column contract_terms jsonb,
  add column contract_terms_snapshot jsonb,
  add column render_manifest jsonb,
  add column render_manifest_sha256 text check(render_manifest_sha256 is null or render_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column rendered_at timestamptz,
  add constraint employee_employment_document_template_shape check(
    (creation_source='uploaded' and template_version_id is null and contract_terms is null and contract_terms_snapshot is null and render_manifest is null and render_manifest_sha256 is null)
    or (creation_source='template' and template_version_id is not null and contract_terms is not null)
  );

alter table public.employee_employment_document_events
  drop constraint employee_employment_document_events_event_type_check,
  add constraint employee_employment_document_events_event_type_check check(event_type in ('draft_created','draft_updated','document_attached','contract_preview_generated','sent','viewed','completed','withdrawn','superseded'));

alter table public.employment_contract_templates enable row level security;
alter table public.employment_contract_template_versions enable row level security;
revoke all on public.employment_contract_templates,public.employment_contract_template_versions from public,anon,authenticated;

create or replace function public.employment_contract_template_sections_valid(p_sections jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_section jsonb; v_token text;
begin
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections)=0 or jsonb_array_length(p_sections)>40 then return false; end if;
  for v_section in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section)<>'object'
      or nullif(btrim(v_section->>'heading'),'') is null
      or length(v_section->>'heading')>180
      or nullif(btrim(v_section->>'body'),'') is null
      or length(v_section->>'body')>12000 then return false; end if;
    for v_token in select (regexp_matches(v_section->>'body','\\{\\{([a-z_]+(?:\\.[a-z_]+)?)\\}\\}','g'))[1] loop
      if v_token not in ('legal_entity.legal_company_name','legal_entity.company_registration_no','legal_entity.registered_address','legal_entity.display_name','employee.full_name','employee.employee_code','contract.title','contract.position','contract.workplace','contract.employment_type','contract.commencement_date','contract.effective_date','contract.basic_salary','contract.salary_payment_period','contract.probation','contract.working_days','contract.normal_working_hours','contract.rest_days','contract.notice_period','contract.additional_terms','allowances_table') then return false; end if;
    end loop;
    if (v_section->>'body') ~ '\\{\\{[^}]+\\}\\}' and exists(select 1 from regexp_matches(v_section->>'body','\\{\\{([^}]+)\\}\\}','g') as bad(token) where bad.token !~ '^[a-z_]+(?:\\.[a-z_]+)?$') then return false; end if;
  end loop;
  return true;
end; $$;

create or replace function public.employment_contract_terms_valid(p_terms jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_allowance jsonb; v_key text; v_day jsonb;
begin
  if jsonb_typeof(p_terms)<>'object' then return false; end if;
  for v_key in select jsonb_object_keys(p_terms) loop
    if v_key not in ('employee_context','currency','basic_salary','salary_payment_period','allowances','probation_months','working_days_per_week','working_days_description','normal_hours_per_day','normal_hours_description','rest_days','notice_period_value','notice_period_unit','additional_terms','effective_date') then return false; end if;
  end loop;
  if jsonb_typeof(p_terms->'employee_context')<>'object' then return false; end if;
  for v_key in select jsonb_object_keys(p_terms->'employee_context') loop
    if v_key not in ('position','workplace','employment_type','commencement_date') then return false; end if;
  end loop;
  if nullif(btrim(p_terms#>>'{employee_context,position}'),'') is null or length(p_terms#>>'{employee_context,position}')>180
    or nullif(btrim(p_terms#>>'{employee_context,workplace}'),'') is null or length(p_terms#>>'{employee_context,workplace}')>180
    or nullif(btrim(p_terms#>>'{employee_context,employment_type}'),'') is null or length(p_terms#>>'{employee_context,employment_type}')>80 then return false; end if;
  if coalesce(p_terms->>'currency','')<>'MYR' or coalesce((p_terms->>'basic_salary')::numeric,-1)<0
    or coalesce(p_terms->>'salary_payment_period','') not in ('monthly','daily','hourly') then return false; end if;
  if (p_terms->>'effective_date') is null or (p_terms#>>'{employee_context,commencement_date}') is null then return false; end if;
  if (p_terms->>'probation_months') is not null and ((p_terms->>'probation_months')::integer not between 0 and 24) then return false; end if;
  if jsonb_typeof(coalesce(p_terms->'rest_days','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_terms->'rest_days','[]'::jsonb))=0 or jsonb_array_length(coalesce(p_terms->'rest_days','[]'::jsonb))>7 then return false; end if;
  for v_day in select value from jsonb_array_elements(p_terms->'rest_days') loop if jsonb_typeof(v_day)<>'string' or nullif(btrim(v_day #>> '{}'),'') is null or length(v_day #>> '{}')>32 then return false; end if; end loop;
  if coalesce((p_terms->>'working_days_per_week')::integer,0) not between 1 and 7
    or coalesce((p_terms->>'normal_hours_per_day')::numeric,0) not between 0.25 and 24
    or coalesce((p_terms->>'notice_period_value')::integer,0) not between 1 and 120
    or coalesce(p_terms->>'notice_period_unit','') not in ('days','weeks','months') then return false; end if;
  if length(coalesce(p_terms->>'working_days_description',''))>300 or length(coalesce(p_terms->>'normal_hours_description',''))>300
    or length(coalesce(p_terms->>'additional_terms',''))>4000 then return false; end if;
  if jsonb_typeof(coalesce(p_terms->'allowances','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_terms->'allowances','[]'::jsonb))>12 then return false; end if;
  for v_allowance in select value from jsonb_array_elements(coalesce(p_terms->'allowances','[]'::jsonb)) loop
    if jsonb_typeof(v_allowance)<>'object' or nullif(btrim(v_allowance->>'name'),'') is null or length(v_allowance->>'name')>120 or coalesce((v_allowance->>'amount')::numeric,-1)<0 then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;

create or replace function public.employment_contract_templates_for_legal_entity(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.current_user_has_permission('employment_contract_templates.view') then raise exception using errcode='42501',message='Missing permission to view contract templates.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'legal_entity_id',t.legal_entity_id,'title',t.title,'contract_kind',t.contract_kind,'language_code',t.language_code,'is_active',t.is_active,'is_default',t.is_default,'current_published_version_id',t.current_published_version_id,'current_published_version',case when v.id is null then null else jsonb_build_object('id',v.id,'version_number',v.version_number,'status',v.status,'sections',v.sections,'content_sha256',v.content_sha256,'published_at',v.published_at) end) order by t.is_default desc,t.title),'[]'::jsonb)
  into v_result from public.employment_contract_templates t left join public.employment_contract_template_versions v on v.id=t.current_published_version_id
  where t.legal_entity_id=p_legal_entity_id;
  return v_result;
end; $$;

create or replace function public.employment_contract_template_save(p_template_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employment_documents_current_admin_employee(); v_template public.employment_contract_templates%rowtype; v_version public.employment_contract_template_versions%rowtype; v_next integer;
begin
  if not public.current_user_has_permission('employment_contract_templates.manage') then raise exception using errcode='42501',message='Missing permission to manage contract templates.'; end if;
  if nullif(btrim(p_payload->>'title'),'') is null or coalesce(p_payload->>'contract_kind','') not in ('full_time','part_time') or coalesce(p_payload->>'language_code','en')<>'en' or not public.employment_contract_template_sections_valid(p_payload->'sections') then raise exception using errcode='22023',message='Provide a title, contract type and approved clause sections.'; end if;
  if not exists(select 1 from public.legal_entities where id=(p_payload->>'legal_entity_id')::uuid and is_active) then raise exception using errcode='22023',message='Choose an active legal employer.'; end if;
  if p_template_id is null then
    insert into public.employment_contract_templates(legal_entity_id,title,contract_kind,language_code,is_active,is_default,created_by_employee_id,updated_by_employee_id)
    values((p_payload->>'legal_entity_id')::uuid,btrim(p_payload->>'title'),p_payload->>'contract_kind','en',coalesce((p_payload->>'is_active')::boolean,true),coalesce((p_payload->>'is_default')::boolean,false),v_actor,v_actor) returning * into v_template;
    v_next:=1;
  else
    select * into v_template from public.employment_contract_templates where id=p_template_id for update;
    if v_template.id is null then raise exception using errcode='P0002',message='Contract template was not found.'; end if;
    update public.employment_contract_templates set title=btrim(p_payload->>'title'),contract_kind=p_payload->>'contract_kind',is_active=coalesce((p_payload->>'is_active')::boolean,is_active),is_default=coalesce((p_payload->>'is_default')::boolean,is_default),updated_by_employee_id=v_actor,updated_at=clock_timestamp() where id=v_template.id returning * into v_template;
    select coalesce(max(version_number),0)+1 into v_next from public.employment_contract_template_versions where template_id=v_template.id;
  end if;
  insert into public.employment_contract_template_versions(template_id,version_number,sections,content_sha256,created_by_employee_id)
  values(v_template.id,v_next,p_payload->'sections',encode(extensions.digest((p_payload->'sections')::text,'sha256'),'hex'),v_actor) returning * into v_version;
  return jsonb_build_object('template',to_jsonb(v_template),'draft_version',to_jsonb(v_version));
exception when unique_violation then raise exception using errcode='23505',message='Only one default template is allowed for this legal employer and contract type.';
end; $$;

create or replace function public.employment_contract_template_publish(p_template_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employment_documents_current_admin_employee(); v_template public.employment_contract_templates%rowtype; v_version public.employment_contract_template_versions%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if not public.current_user_has_permission('employment_contract_templates.manage') then raise exception using errcode='42501',message='Missing permission to publish contract templates.'; end if;
  select * into v_template from public.employment_contract_templates where id=p_template_id for update;
  select * into v_version from public.employment_contract_template_versions where id=p_version_id and template_id=p_template_id for update;
  if v_template.id is null or v_version.id is null or v_version.status<>'draft' then raise exception using errcode='55000',message='Only a draft contract template version can be published.'; end if;
  update public.employment_contract_template_versions set status='published',published_at=v_now,published_by_employee_id=v_actor where id=v_version.id returning * into v_version;
  update public.employment_contract_templates set current_published_version_id=v_version.id,updated_by_employee_id=v_actor,updated_at=v_now where id=v_template.id returning * into v_template;
  return jsonb_build_object('template',to_jsonb(v_template),'version',to_jsonb(v_version));
end; $$;

create or replace function public.employment_contract_template_version_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Employment contract template versions are immutable.'; end if;
  if old.status='published' then raise exception using errcode='55000',message='Published employment contract template versions are immutable.'; end if;
  if old.status='draft' and (new.template_id is distinct from old.template_id or new.version_number is distinct from old.version_number) then raise exception using errcode='55000',message='Template version identity is immutable.'; end if;
  return new;
end; $$;
create trigger employment_contract_template_version_guard before update or delete on public.employment_contract_template_versions for each row execute function public.employment_contract_template_version_guard();

create or replace function public.employment_contract_document_manifest(p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype; v_employee public.employees%rowtype; v_entity public.legal_entities%rowtype; v_template public.employment_contract_templates%rowtype; v_version public.employment_contract_template_versions%rowtype;
begin
  select * into v_doc from public.employee_employment_documents where id=p_document_id;
  if v_doc.id is null or v_doc.creation_source<>'template' or v_doc.template_version_id is null then raise exception using errcode='22023',message='Template contract draft is unavailable.'; end if;
  select * into v_employee from public.employees where id=v_doc.employee_id;
  select * into v_entity from public.legal_entities where id=v_employee.legal_entity_id and is_active;
  select t.* into v_template from public.employment_contract_templates t join public.employment_contract_template_versions v on v.template_id=t.id where v.id=v_doc.template_version_id and v.status='published' and t.is_active;
  select * into v_version from public.employment_contract_template_versions where id=v_doc.template_version_id;
  if v_employee.id is null or v_entity.id is null or v_template.id is null or v_template.legal_entity_id<>v_entity.id or v_version.id is null then raise exception using errcode='55000',message='The employee, legal employer or published template has changed. Refresh the draft before previewing.'; end if;
  return jsonb_build_object(
    'schema_version','employment_contract_render_v2',
    'document',jsonb_build_object('id',v_doc.id,'title',v_doc.title,'effective_date',v_doc.effective_date),
    'legal_entity',jsonb_build_object('id',v_entity.id,'legal_company_name',v_entity.legal_company_name,'company_registration_no',v_entity.company_registration_no,'registered_address',v_entity.registered_address,'display_name',v_entity.display_name),
    'employee',jsonb_build_object('id',v_employee.id,'full_name',v_employee.full_name,'employee_code',v_employee.employee_code,'joined_date',v_employee.joined_date),
    'template',jsonb_build_object('id',v_template.id,'title',v_template.title,'contract_kind',v_template.contract_kind,'language_code',v_template.language_code,'version_id',v_version.id,'version_number',v_version.version_number,'content_sha256',v_version.content_sha256,'sections',v_version.sections),
    'terms',v_doc.contract_terms
  );
end; $$;

create or replace function public.employee_employment_contract_save_draft(p_document_id uuid,p_employee_id uuid,p_payload jsonb,p_request_id uuid,p_supersedes_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.employment_documents_current_admin_employee(); v_doc public.employee_employment_documents%rowtype; v_template public.employment_contract_templates%rowtype; v_version public.employment_contract_template_versions%rowtype; v_employee public.employees%rowtype; v_event text;
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to manage employment documents.'; end if;
  if not public.employee_employment_documents_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  if nullif(btrim(p_payload->>'title'),'') is null or nullif(p_payload->>'effective_date','') is null or p_payload->>'effective_date' is distinct from p_payload->'terms'->>'effective_date' or not public.employment_contract_terms_valid(p_payload->'terms') then raise exception using errcode='22023',message='Provide all required employment terms before saving the contract draft.'; end if;
  select * into v_employee from public.employees where id=p_employee_id;
  select t.* into v_template from public.employment_contract_templates t join public.employment_contract_template_versions v on v.template_id=t.id where v.id=(p_payload->>'template_version_id')::uuid and t.current_published_version_id=v.id and v.status='published' and t.is_active;
  select * into v_version from public.employment_contract_template_versions where id=(p_payload->>'template_version_id')::uuid;
  if v_employee.id is null or v_employee.legal_entity_id is null or v_template.id is null or v_template.legal_entity_id<>v_employee.legal_entity_id then raise exception using errcode='22023',message='Choose a published template owned by the employee legal employer.'; end if;
  if p_supersedes_document_id is not null and not exists(select 1 from public.employee_employment_documents where id=p_supersedes_document_id and employee_id=p_employee_id and status not in ('draft','withdrawn','superseded')) then raise exception using errcode='22023',message='The document to supersede is unavailable.'; end if;
  if p_document_id is null then
    select * into v_doc from public.employee_employment_documents where request_id=p_request_id;
    if v_doc.id is null then
      insert into public.employee_employment_documents(request_id,employee_id,title,effective_date,creation_source,template_version_id,contract_terms,supersedes_document_id,created_by_employee_id)
      values(p_request_id,p_employee_id,btrim(p_payload->>'title'),(p_payload->>'effective_date')::date,'template',v_version.id,p_payload->'terms',p_supersedes_document_id,v_actor) returning * into v_doc;
      v_event:='draft_created';
    end if;
  else
    select * into v_doc from public.employee_employment_documents where id=p_document_id for update;
    if v_doc.id is null or v_doc.status<>'draft' or v_doc.creation_source<>'template' or v_doc.employee_id<>p_employee_id then raise exception using errcode='55000',message='Only a template contract draft can be edited.'; end if;
    update public.employee_employment_documents set title=btrim(p_payload->>'title'),effective_date=(p_payload->>'effective_date')::date,template_version_id=v_version.id,contract_terms=p_payload->'terms',document_bucket=null,document_path=null,document_mime_type=null,document_size_bytes=null,document_sha256=null,render_manifest=null,render_manifest_sha256=null,rendered_at=null,updated_at=clock_timestamp() where id=v_doc.id returning * into v_doc;
    v_event:='draft_updated';
  end if;
  if v_event is not null then insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,request_id,details) values(v_doc.id,v_event,'admin',v_actor,p_request_id,jsonb_build_object('creation_source','template')) on conflict do nothing; end if;
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_contract_render_context(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype; v_manifest jsonb; v_hash text;
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to render employment contracts.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id and status='draft' for update;
  if v_doc.id is null or v_doc.creation_source<>'template' or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='42501',message='Template contract draft is unavailable.'; end if;
  v_manifest:=public.employment_contract_document_manifest(v_doc.id);
  v_hash:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
  return jsonb_build_object('document_id',v_doc.id,'bucket','employee-employment-documents','object_path',format('%s/%s/contract.pdf',v_doc.employee_id,v_doc.id),'manifest',v_manifest,'manifest_sha256',v_hash,'file_name',regexp_replace(v_doc.title,'[^A-Za-z0-9_-]+','_','g')||'.pdf');
end; $$;

create or replace function public.employee_employment_contract_render_finalize_service(p_document_id uuid,p_document_path text,p_size_bytes bigint,p_pdf_sha256 text,p_manifest_sha256 text,p_actor_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_doc public.employee_employment_documents%rowtype; v_actor uuid; v_manifest jsonb; v_expected_manifest_sha text; v_expected_path text;
begin
  select e.id into v_actor from public.employees e join public.roles r on r.id=e.role_id join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id where e.auth_user_id=p_actor_auth_user_id and e.is_active and p.code='employee_employment_documents.manage' limit 1;
  if v_actor is null then raise exception using errcode='42501',message='Contract preview is unavailable.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id and status='draft' for update;
  if v_doc.id is null or v_doc.creation_source<>'template' or not public.employment_documents_auth_user_can_access_employee(p_actor_auth_user_id,v_doc.employee_id) then raise exception using errcode='42501',message='Template contract draft is unavailable.'; end if;
  v_manifest:=public.employment_contract_document_manifest(v_doc.id);
  v_expected_manifest_sha:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
  v_expected_path:=format('%s/%s/contract.pdf',v_doc.employee_id,v_doc.id);
  if p_document_path<>v_expected_path or p_size_bytes not between 1 and 10485760 or p_pdf_sha256 !~ '^[0-9a-f]{64}$' or p_manifest_sha256<>v_expected_manifest_sha or not exists(select 1 from storage.objects where bucket_id='employee-employment-documents' and name=p_document_path) then raise exception using errcode='22023',message='Generated contract preview is invalid or stale.'; end if;
  update public.employee_employment_documents set document_bucket='employee-employment-documents',document_path=p_document_path,document_mime_type='application/pdf',document_size_bytes=p_size_bytes,document_sha256=lower(p_pdf_sha256),render_manifest=v_manifest,render_manifest_sha256=v_expected_manifest_sha,rendered_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_doc.id returning * into v_doc;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,details) values(v_doc.id,'contract_preview_generated','admin',v_actor,jsonb_build_object('document_sha256',v_doc.document_sha256,'render_manifest_sha256',v_doc.render_manifest_sha256));
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_document_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',message='Employment document history is immutable.'; end if;
  if old.status<>'draft' and (
    new.employee_id is distinct from old.employee_id or new.document_type is distinct from old.document_type or new.title is distinct from old.title or new.effective_date is distinct from old.effective_date or new.creation_source is distinct from old.creation_source or new.template_version_id is distinct from old.template_version_id or new.template_title_snapshot is distinct from old.template_title_snapshot or new.template_version_number_snapshot is distinct from old.template_version_number_snapshot or new.template_content_sha256_snapshot is distinct from old.template_content_sha256_snapshot or new.contract_terms is distinct from old.contract_terms or new.contract_terms_snapshot is distinct from old.contract_terms_snapshot or new.render_manifest is distinct from old.render_manifest or new.render_manifest_sha256 is distinct from old.render_manifest_sha256 or new.rendered_at is distinct from old.rendered_at or new.document_bucket is distinct from old.document_bucket or new.document_path is distinct from old.document_path or new.document_mime_type is distinct from old.document_mime_type or new.document_size_bytes is distinct from old.document_size_bytes or new.document_sha256 is distinct from old.document_sha256 or new.employee_name_snapshot is distinct from old.employee_name_snapshot or new.employee_code_snapshot is distinct from old.employee_code_snapshot or new.position_snapshot is distinct from old.position_snapshot or new.employment_type_snapshot is distinct from old.employment_type_snapshot or new.workplace_snapshot is distinct from old.workplace_snapshot or new.joined_date_snapshot is distinct from old.joined_date_snapshot or new.legal_entity_id_snapshot is distinct from old.legal_entity_id_snapshot or new.legal_company_name_snapshot is distinct from old.legal_company_name_snapshot or new.company_registration_no_snapshot is distinct from old.company_registration_no_snapshot or new.registered_address_snapshot is distinct from old.registered_address_snapshot or new.legal_entity_display_name_snapshot is distinct from old.legal_entity_display_name_snapshot or new.issuer_employee_id is distinct from old.issuer_employee_id or new.issuer_name_snapshot is distinct from old.issuer_name_snapshot or new.consent_method is distinct from old.consent_method or new.consent_copy_version is distinct from old.consent_copy_version or new.consent_copy is distinct from old.consent_copy or new.consent_copy_sha256 is distinct from old.consent_copy_sha256 or new.sent_at is distinct from old.sent_at or new.supersedes_document_id is distinct from old.supersedes_document_id
  ) then raise exception using errcode='55000',message='Sent employment document content is immutable.'; end if;
  return new;
end; $$;

create or replace function public.employee_employment_document_send(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_doc public.employee_employment_documents%rowtype; v_employee public.employees%rowtype; v_entity public.legal_entities%rowtype; v_actor uuid:=public.employment_documents_current_admin_employee(); v_issuer text; v_now timestamptz:=clock_timestamp(); v_consent text:='I confirm that I have reviewed and acknowledge this exact employment document. This acknowledgement records receipt and review; it is not represented by FeedX as a legal electronic signature.'; v_version text:='employment_document_acknowledgement_v1'; v_manifest jsonb; v_manifest_sha text; v_template public.employment_contract_templates%rowtype; v_template_version public.employment_contract_template_versions%rowtype;
begin
  if not public.current_user_has_permission('employee_employment_documents.manage') then raise exception using errcode='42501',message='Missing permission to send employment documents.'; end if;
  select * into v_doc from public.employee_employment_documents where id=p_document_id for update;
  if v_doc.id is null or v_doc.status<>'draft' or not public.employee_employment_documents_admin_can_access_employee(v_doc.employee_id) then raise exception using errcode='55000',message='Draft employment document is unavailable.'; end if;
  if v_doc.document_path is null or v_doc.document_sha256 is null then raise exception using errcode='22023',message='Generate or attach the employment contract PDF before sending.'; end if;
  select * into v_employee from public.employees where id=v_doc.employee_id;
  if v_employee.legal_entity_id is null then raise exception using errcode='22023',message='Assign the employee legal employer before sending.'; end if;
  select * into v_entity from public.legal_entities where id=v_employee.legal_entity_id and is_active;
  if v_entity.id is null then raise exception using errcode='22023',message='The assigned legal employer must be active before sending.'; end if;
  if v_doc.creation_source='template' then
    v_manifest:=public.employment_contract_document_manifest(v_doc.id); v_manifest_sha:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
    if v_doc.render_manifest_sha256 is distinct from v_manifest_sha or v_doc.render_manifest is distinct from v_manifest then raise exception using errcode='55000',message='The contract preview is stale. Generate the exact PDF again before sending.'; end if;
    select t.* into v_template from public.employment_contract_templates t join public.employment_contract_template_versions tv on tv.template_id=t.id where tv.id=v_doc.template_version_id;
    select * into v_template_version from public.employment_contract_template_versions where id=v_doc.template_version_id;
  end if;
  select full_name into v_issuer from public.employees where id=v_actor;
  if v_doc.supersedes_document_id is not null then update public.employee_employment_documents set status='superseded',superseded_by_document_id=v_doc.id,updated_at=v_now where id=v_doc.supersedes_document_id and status not in ('draft','withdrawn','superseded'); if not found then raise exception using errcode='55000',message='The original document can no longer be superseded.'; end if; insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_doc.supersedes_document_id,'superseded','admin',v_actor,v_now,jsonb_build_object('superseded_by_document_id',v_doc.id)); end if;
  update public.employee_employment_documents set status='sent',employee_name_snapshot=v_employee.full_name,employee_code_snapshot=v_employee.employee_code,position_snapshot=case when v_doc.creation_source='template' then v_doc.contract_terms#>>'{employee_context,position}' else v_employee.position end,employment_type_snapshot=case when v_doc.creation_source='template' then v_doc.contract_terms#>>'{employee_context,employment_type}' else v_employee.employment_type end,workplace_snapshot=case when v_doc.creation_source='template' then v_doc.contract_terms#>>'{employee_context,workplace}' else v_employee.workplace end,joined_date_snapshot=v_employee.joined_date,legal_entity_id_snapshot=v_entity.id,legal_company_name_snapshot=v_entity.legal_company_name,company_registration_no_snapshot=v_entity.company_registration_no,registered_address_snapshot=v_entity.registered_address,legal_entity_display_name_snapshot=v_entity.display_name,template_title_snapshot=case when v_doc.creation_source='template' then v_template.title else null end,template_version_number_snapshot=case when v_doc.creation_source='template' then v_template_version.version_number else null end,template_content_sha256_snapshot=case when v_doc.creation_source='template' then v_template_version.content_sha256 else null end,contract_terms_snapshot=case when v_doc.creation_source='template' then v_doc.contract_terms else null end,issuer_employee_id=v_actor,issuer_name_snapshot=v_issuer,consent_method='crew_session_acknowledgement',consent_copy_version=v_version,consent_copy=v_consent,consent_copy_sha256=encode(extensions.digest(v_consent,'sha256'),'hex'),sent_at=v_now,updated_at=v_now where id=v_doc.id returning * into v_doc;
  insert into public.employee_employment_document_events(document_id,event_type,actor_kind,actor_employee_id,occurred_at,details) values(v_doc.id,'sent','admin',v_actor,v_now,jsonb_build_object('document_sha256',v_doc.document_sha256,'render_manifest_sha256',v_doc.render_manifest_sha256,'consent_copy_version',v_version,'consent_copy_sha256',v_doc.consent_copy_sha256));
  return to_jsonb(v_doc);
end; $$;

create or replace function public.employee_employment_documents_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb; v_employer jsonb; v_employee jsonb;
begin
  if not public.current_user_has_permission('employee_employment_documents.view') then raise exception using errcode='42501',message='Missing permission to view employment documents.'; end if;
  if not public.employee_employment_documents_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select case when le.id is null then null else jsonb_build_object('id',le.id,'legal_company_name',le.legal_company_name,'company_registration_no',le.company_registration_no,'registered_address',le.registered_address,'display_name',le.display_name,'is_active',le.is_active) end into v_employer from public.employees e left join public.legal_entities le on le.id=e.legal_entity_id where e.id=p_employee_id;
  select jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position,'workplace',e.workplace,'employment_type',e.employment_type,'joined_date',e.joined_date,'legal_entity_id',e.legal_entity_id) into v_employee from public.employees e where e.id=p_employee_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'employee_id',d.employee_id,'document_type',d.document_type,'title',d.title,'effective_date',d.effective_date,'status',d.status,'creation_source',d.creation_source,'template_version_id',d.template_version_id,'template_title_snapshot',d.template_title_snapshot,'template_version_number_snapshot',d.template_version_number_snapshot,'has_document',d.document_path is not null,'document_size_bytes',d.document_size_bytes,'document_sha256',d.document_sha256,'render_manifest_sha256',d.render_manifest_sha256,'supersedes_document_id',d.supersedes_document_id,'superseded_by_document_id',d.superseded_by_document_id,'employee_name_snapshot',d.employee_name_snapshot,'employee_code_snapshot',d.employee_code_snapshot,'position_snapshot',d.position_snapshot,'employment_type_snapshot',d.employment_type_snapshot,'workplace_snapshot',d.workplace_snapshot,'legal_company_name_snapshot',d.legal_company_name_snapshot,'company_registration_no_snapshot',d.company_registration_no_snapshot,'registered_address_snapshot',d.registered_address_snapshot,'legal_entity_display_name_snapshot',d.legal_entity_display_name_snapshot,'issuer_name_snapshot',d.issuer_name_snapshot,'sent_at',d.sent_at,'first_viewed_at',d.first_viewed_at,'completed_at',d.completed_at,'withdrawn_at',d.withdrawn_at,'withdrawal_reason',d.withdrawal_reason,'created_at',d.created_at,'activity',coalesce((select jsonb_agg(jsonb_build_object('id',ev.id,'type',ev.event_type,'actor_kind',ev.actor_kind,'actor_name',actor.full_name,'occurred_at',ev.occurred_at,'details',ev.details) order by ev.occurred_at,ev.id) from public.employee_employment_document_events ev left join public.employees actor on actor.id=ev.actor_employee_id where ev.document_id=d.id),'[]'::jsonb)) order by coalesce(d.sent_at,d.created_at) desc),'[]'::jsonb) into v_rows from public.employee_employment_documents d where d.employee_id=p_employee_id;
  return jsonb_build_object('employee',v_employee,'legal_employer',v_employer,'documents',v_rows);
end; $$;

revoke all on function public.employment_contract_template_sections_valid(jsonb),public.employment_contract_terms_valid(jsonb),public.employment_contract_document_manifest(uuid),public.employment_contract_templates_for_legal_entity(uuid),public.employment_contract_template_save(uuid,jsonb),public.employment_contract_template_publish(uuid,uuid),public.employee_employment_contract_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_employment_contract_render_context(uuid),public.employee_employment_contract_render_finalize_service(uuid,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.employment_contract_templates_for_legal_entity(uuid),public.employment_contract_template_save(uuid,jsonb),public.employment_contract_template_publish(uuid,uuid),public.employee_employment_contract_save_draft(uuid,uuid,jsonb,uuid,uuid),public.employee_employment_contract_render_context(uuid) to authenticated;
grant execute on function public.employee_employment_contract_render_finalize_service(uuid,text,bigint,text,text,uuid) to service_role;
