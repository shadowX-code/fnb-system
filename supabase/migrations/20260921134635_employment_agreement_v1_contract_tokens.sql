-- Employment Agreement V1 extends the existing V2 contract authority only.
-- It adds canonical People identity data and a small, validated render-token
-- set; it does not create another contract lifecycle or alter sent evidence.

alter table public.employees
  add column if not exists residential_address text;

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
      if v_token not in (
        'legal_entity.legal_company_name','legal_entity.company_registration_no','legal_entity.registered_address','legal_entity.display_name',
        'employee.full_name','employee.employee_code','employee.ic_no','employee.residential_address',
        'contract.title','contract.contract_date','contract.position','contract.workplace','contract.employment_type','contract.commencement_date','contract.effective_date','contract.basic_salary','contract.salary_payment_period','contract.probation','contract.working_days','contract.normal_working_hours','contract.rest_days','contract.notice_period','contract.probation_notice_period','contract.confirmed_notice_period','contract.additional_terms',
        'allowances_table','annual_leave_table','sick_hospitalisation_leave_table','signature_block'
      ) then return false; end if;
    end loop;
    if (v_section->>'body') ~ '\\{\\{[^}]+\\}\\}' and exists(select 1 from regexp_matches(v_section->>'body','\\{\\{([^}]+)\\}\\}','g') as bad(matches) where bad.matches[1] !~ '^[a-z_]+(?:\\.[a-z_]+)?$') then return false; end if;
  end loop;
  return true;
end; $$;

create or replace function public.employment_contract_terms_valid(p_terms jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_allowance jsonb; v_key text; v_day jsonb;
begin
  if jsonb_typeof(p_terms)<>'object' then return false; end if;
  for v_key in select jsonb_object_keys(p_terms) loop
    if v_key not in ('employee_context','currency','basic_salary','salary_payment_period','allowances','probation_months','working_days_per_week','working_days_description','normal_hours_per_day','normal_hours_description','rest_days','notice_period_value','notice_period_unit','probation_notice_period_value','probation_notice_period_unit','confirmed_notice_period_value','confirmed_notice_period_unit','employer_signatory_name','employer_signatory_designation','additional_terms','effective_date','contract_date') then return false; end if;
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
  if (p_terms->>'contract_date') is not null and (p_terms->>'contract_date') !~ '^\\d{4}-\\d{2}-\\d{2}$' then return false; end if;
  if (p_terms->>'probation_months') is not null and ((p_terms->>'probation_months')::integer not between 0 and 24) then return false; end if;
  if jsonb_typeof(coalesce(p_terms->'rest_days','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_terms->'rest_days','[]'::jsonb))=0 or jsonb_array_length(coalesce(p_terms->'rest_days','[]'::jsonb))>7 then return false; end if;
  for v_day in select value from jsonb_array_elements(p_terms->'rest_days') loop if jsonb_typeof(v_day)<>'string' or nullif(btrim(v_day #>> '{}'),'') is null or length(v_day #>> '{}')>32 then return false; end if; end loop;
  if coalesce((p_terms->>'working_days_per_week')::integer,0) not between 1 and 7
    or coalesce((p_terms->>'normal_hours_per_day')::numeric,0) not between 0.25 and 24
    or coalesce((p_terms->>'notice_period_value')::integer,0) not between 1 and 120
    or coalesce(p_terms->>'notice_period_unit','') not in ('days','weeks','months') then return false; end if;
  if (p_terms->>'probation_notice_period_value') is not null and ((p_terms->>'probation_notice_period_value')::integer not between 1 and 120 or p_terms->>'probation_notice_period_unit' not in ('days','weeks','months')) then return false; end if;
  if (p_terms->>'confirmed_notice_period_value') is not null and ((p_terms->>'confirmed_notice_period_value')::integer not between 1 and 120 or p_terms->>'confirmed_notice_period_unit' not in ('days','weeks','months')) then return false; end if;
  if length(coalesce(p_terms->>'working_days_description',''))>300 or length(coalesce(p_terms->>'normal_hours_description',''))>300
    or length(coalesce(p_terms->>'additional_terms',''))>4000 or length(coalesce(p_terms->>'employer_signatory_name',''))>180 or length(coalesce(p_terms->>'employer_signatory_designation',''))>180 then return false; end if;
  if jsonb_typeof(coalesce(p_terms->'allowances','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_terms->'allowances','[]'::jsonb))>12 then return false; end if;
  for v_allowance in select value from jsonb_array_elements(coalesce(p_terms->'allowances','[]'::jsonb)) loop
    if jsonb_typeof(v_allowance)<>'object' or nullif(btrim(v_allowance->>'name'),'') is null or length(v_allowance->>'name')>120 or coalesce((v_allowance->>'amount')::numeric,-1)<0 then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;

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
    'employee',jsonb_build_object('id',v_employee.id,'full_name',v_employee.full_name,'employee_code',v_employee.employee_code,'ic_no',v_employee.ic_no,'residential_address',v_employee.residential_address,'joined_date',v_employee.joined_date),
    'template',jsonb_build_object('id',v_template.id,'title',v_template.title,'contract_kind',v_template.contract_kind,'language_code',v_template.language_code,'version_id',v_version.id,'version_number',v_version.version_number,'content_sha256',v_version.content_sha256,'sections',v_version.sections),
    'terms',v_doc.contract_terms
  );
end; $$;

revoke all on function public.employment_contract_template_sections_valid(jsonb),public.employment_contract_terms_valid(jsonb),public.employment_contract_document_manifest(uuid) from public,anon,authenticated;
