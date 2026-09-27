-- Rollback-only Staging read-projection contract. No existing evidence changes.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare
  v_employee uuid; v_submission uuid; v_requirement record; v_case text;
  v_result jsonb; v_filtered jsonb; v_today date:=(statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  foreach v_case in array array['verified','pending_verification','expiring_soon','expired','missing','rejected'] loop
    insert into public.employees(full_name,workplace,is_active,employment_status,enable_system_login)
    values('QA ROLLBACK COMPLIANCE REGISTRY '||v_case,'Friends Corner',true,'active',false)
    returning id into v_employee;
    for v_requirement in select * from public.employee_compliance_requirements where is_active loop
      if v_requirement.code='typhoid_injection' and v_case='missing' then continue; end if;
      insert into public.employee_compliance_submissions(
        request_id,request_hash,employee_id,requirement_id,submission_outlet_id,
        expiry_date,evidence_bucket,evidence_path,evidence_mime_type,evidence_size_bytes
      ) values(
        gen_random_uuid(),'qa-rollback-only',v_employee,v_requirement.id,public.crew_resolve_employee_outlet(v_employee),
        case when not v_requirement.requires_expiry then null
          when v_case='expired' then v_today-1 when v_case='expiring_soon' then v_today+30 else v_today+90 end,
        'employee-compliance-evidence','qa-rollback-only/'||gen_random_uuid()::text,'image/webp',1
      ) returning id into v_submission;
      if v_requirement.code='food_handler_certificate' or v_case not in ('pending_verification') then
        perform public.employee_compliance_review(v_submission,
          case when v_requirement.code='typhoid_injection' and v_case='rejected' then 'rejected' else 'verified' end,
          case when v_case='rejected' then 'QA rollback-only rejected fixture' else null end);
      end if;
    end loop;
  end loop;
  v_result:=public.employee_compliance_admin_employee_page(null,'{"query":"QA ROLLBACK COMPLIANCE REGISTRY"}',1,20);
  assert (v_result->>'total_count')::int=6,'Expected one row per employee';
  assert jsonb_array_length(v_result->'rows')=6,'Paging is employee-level';
  assert (select count(distinct e->>'employee_id') from jsonb_array_elements(v_result->'rows') e)=6,'No duplicate employees';
  assert (select bool_and(jsonb_array_length(e->'requirements')=2) from jsonb_array_elements(v_result->'rows') e),'Both canonical requirements retained';
  assert v_result->'summary' @> '{"compliant":1,"needs_verification":1,"expiring_soon":1,"missing_or_expired":3}'::jsonb,'Summary uses exclusive most-actionable employee states';
  v_filtered:=public.employee_compliance_admin_employee_page(null,'{"query":"QA ROLLBACK COMPLIANCE REGISTRY","requirement":"typhoid_injection","status":"missing"}',1,20);
  assert (v_filtered->>'total_count')::int=1,'Requirement and status match the same requirement';
  assert jsonb_array_length(v_filtered->'rows'->0->'requirements')=2,'Filtering retains other requirement states';
  v_filtered:=public.employee_compliance_admin_employee_page(null,'{"query":"QA ROLLBACK COMPLIANCE REGISTRY","requirement":"food_handler_certificate","status":"missing"}',1,20);
  assert (v_filtered->>'total_count')::int=0,'Do not match status from another requirement';
  v_filtered:=public.employee_compliance_admin_employee_page(null,'{"query":"QA ROLLBACK COMPLIANCE REGISTRY"}',2,20);
  assert jsonb_array_length(v_filtered->'rows')=0 and (v_filtered->>'total_count')::int=6,'Total remains authoritative past last page';
end $$;
select 'employee_registry_states_filters_summary_paging = PASS (rollback only)' result;
rollback;
