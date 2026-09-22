-- Correct the V2 approved-variable validator without changing any template or document data.
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
    if (v_section->>'body') ~ '\\{\\{[^}]+\\}\\}' and exists(select 1 from regexp_matches(v_section->>'body','\\{\\{([^}]+)\\}\\}','g') as bad(matches) where bad.matches[1] !~ '^[a-z_]+(?:\\.[a-z_]+)?$') then return false; end if;
  end loop;
  return true;
end; $$;

revoke all on function public.employment_contract_template_sections_valid(jsonb) from public,anon,authenticated;
