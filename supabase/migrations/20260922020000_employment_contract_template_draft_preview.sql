-- Draft template previews are deliberately read-only. They use the exact
-- Employment Documents PDF renderer, but never create an employment document,
-- version, Storage object or audit event.

create or replace function public.employment_contract_templates_for_legal_entity(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.current_user_has_permission('employment_contract_templates.view') then
    raise exception using errcode='42501',message='Missing permission to view contract templates.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'legal_entity_id',t.legal_entity_id,
    'title',t.title,
    'contract_kind',t.contract_kind,
    'language_code',t.language_code,
    'is_active',t.is_active,
    'is_default',t.is_default,
    'current_published_version_id',t.current_published_version_id,
    'current_published_version',case when current_version.id is null then null else jsonb_build_object(
      'id',current_version.id,'version_number',current_version.version_number,'status',current_version.status,
      'sections',current_version.sections,'content_sha256',current_version.content_sha256,'published_at',current_version.published_at
    ) end,
    'versions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',version.id,'version_number',version.version_number,'status',version.status,
        'sections',version.sections,'content_sha256',version.content_sha256,
        'created_at',version.created_at,'published_at',version.published_at
      ) order by version.version_number desc)
      from public.employment_contract_template_versions version
      where version.template_id=t.id
    ),'[]'::jsonb)
  ) order by t.is_default desc,t.title),'[]'::jsonb)
  into v_result
  from public.employment_contract_templates t
  left join public.employment_contract_template_versions current_version on current_version.id=t.current_published_version_id
  where t.legal_entity_id=p_legal_entity_id;
  return v_result;
end; $$;

create or replace function public.employment_contract_template_preview_employees(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('employment_contract_templates.manage')
    or not public.current_user_has_permission('employee_employment_documents.manage') then
    raise exception using errcode='42501',message='Missing permission to preview employment contract templates.';
  end if;
  if not exists(select 1 from public.legal_entities where id=p_legal_entity_id and is_active) then
    raise exception using errcode='22023',message='Choose an active legal employer.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'full_name',e.full_name,'employee_code',e.employee_code,'position',e.position,
    'workplace',e.workplace,'employment_type',e.employment_type,'joined_date',e.joined_date
  ) order by e.full_name),'[]'::jsonb)
  into v_rows
  from public.employees e
  where e.legal_entity_id=p_legal_entity_id
    and e.is_active
    and e.employment_status='active'
    and public.employee_employment_documents_admin_can_access_employee(e.id);
  return v_rows;
end; $$;

create or replace function public.employment_contract_template_preview_context(p_legal_entity_id uuid,p_employee_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_employee public.employees%rowtype;
  v_entity public.legal_entities%rowtype;
  v_sections jsonb:=p_payload->'sections';
  v_body text;
  v_missing jsonb;
begin
  if not public.current_user_has_permission('employment_contract_templates.manage')
    or not public.current_user_has_permission('employee_employment_documents.manage') then
    raise exception using errcode='42501',message='Missing permission to preview employment contract templates.';
  end if;
  if nullif(btrim(p_payload->>'title'),'') is null
    or coalesce(p_payload->>'contract_kind','') not in ('full_time','part_time')
    or coalesce(p_payload->>'language_code','en')<>'en'
    or not public.employment_contract_template_sections_valid(v_sections) then
    raise exception using errcode='22023',message='Provide a title, contract type and approved clause sections before previewing.';
  end if;

  select * into v_entity from public.legal_entities where id=p_legal_entity_id and is_active;
  select * into v_employee from public.employees where id=p_employee_id and legal_entity_id=p_legal_entity_id and is_active and employment_status='active';
  if v_entity.id is null or v_employee.id is null or not public.employee_employment_documents_admin_can_access_employee(p_employee_id) then
    raise exception using errcode='42501',message='The selected preview employee is unavailable.';
  end if;

  select string_agg(value->>'body',E'\n') into v_body from jsonb_array_elements(v_sections);
  select coalesce(jsonb_agg(token order by token),'[]'::jsonb) into v_missing
  from (values
    ('employee.employee_code',nullif(btrim(v_employee.employee_code),'') is null),
    ('employee.ic_no',nullif(btrim(v_employee.ic_no),'') is null),
    ('employee.residential_address',nullif(btrim(v_employee.residential_address),'') is null),
    ('contract.contract_date',true),('contract.effective_date',true),('contract.basic_salary',true),
    ('contract.salary_payment_period',true),('contract.probation',true),('contract.working_days',true),
    ('contract.normal_working_hours',true),('contract.rest_days',true),('contract.notice_period',true),
    ('contract.probation_notice_period',true),('contract.confirmed_notice_period',true),
    ('contract.additional_terms',true)
  ) as candidate(token,is_missing)
  where candidate.is_missing and position('{{' || candidate.token || '}}' in coalesce(v_body,''))>0;

  return jsonb_build_object(
    'schema_version','employment_contract_template_preview_v1',
    'preview',true,
    'missing_variables',v_missing,
    'document',jsonb_build_object('id',null,'title',btrim(p_payload->>'title'),'effective_date',null),
    'legal_entity',jsonb_build_object('id',v_entity.id,'legal_company_name',v_entity.legal_company_name,'company_registration_no',v_entity.company_registration_no,'registered_address',v_entity.registered_address,'display_name',v_entity.display_name),
    'employee',jsonb_build_object('id',v_employee.id,'full_name',v_employee.full_name,'employee_code',v_employee.employee_code,'ic_no',v_employee.ic_no,'residential_address',v_employee.residential_address,'joined_date',v_employee.joined_date),
    'template',jsonb_build_object('id',null,'title',btrim(p_payload->>'title'),'contract_kind',p_payload->>'contract_kind','language_code','en','version_id',null,'version_number','Draft','content_sha256',encode(extensions.digest(v_sections::text,'sha256'),'hex'),'sections',v_sections),
    'terms',jsonb_build_object('employee_context',jsonb_build_object('position',v_employee.position,'workplace',v_employee.workplace,'employment_type',v_employee.employment_type,'commencement_date',v_employee.joined_date),'allowances','[]'::jsonb)
  );
end; $$;

revoke all on function public.employment_contract_template_preview_employees(uuid),public.employment_contract_template_preview_context(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.employment_contract_template_preview_employees(uuid),public.employment_contract_template_preview_context(uuid,uuid,jsonb) to authenticated;
