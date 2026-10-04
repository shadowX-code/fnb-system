-- Later completed uploaded contracts invalidate reusable Profile evidence.
-- Superseded completed contracts remain dated historical evidence.
create or replace function public.payroll_ph_profile_basis(p_employee uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.employee_employment_assignment_revisions%rowtype; c public.payroll_compensation_versions%rowtype; doc public.employee_employment_documents%rowtype; derived jsonb:='{}';
begin
 a:=employee_employment_assignment_at(p_employee,p_date);
 select v.* into c from payroll_compensation_effective_versions() v join payroll_profiles f on f.id=v.profile_id where f.employee_id=p_employee and v.effective_from<=p_date order by v.effective_from desc limit 1;
 if a.id is null or c.id is null or a.legal_entity_id is distinct from c.legal_entity_id then return null; end if;
 -- Only completed, dated, matching contractual evidence can establish hours.
 select * into doc from employee_employment_documents where employee_id=p_employee and effective_date<=p_date and status in ('completed','superseded') and completed_at is not null order by effective_date desc,completed_at desc limit 1;
 if a.employment_type='full_time' then derived:=derived||jsonb_build_object('coverage','full_time'); end if;
 if doc.id is not null and doc.creation_source='template' and doc.legal_entity_id_snapshot=a.legal_entity_id and doc.employment_type_snapshot=a.employment_type and doc.position_snapshot=a.position then derived:=derived||jsonb_build_object('normal_minutes',(doc.contract_terms_snapshot->>'normal_hours_per_day')::numeric*60,'normal_weekly_minutes',(doc.contract_terms_snapshot->>'normal_hours_per_day')::numeric*(doc.contract_terms_snapshot->>'working_days_per_week')::numeric*60); end if;
 return jsonb_build_object('profile_id',c.profile_id,'employment_type',a.employment_type,'position',a.position,'legal_entity_id',a.legal_entity_id,'pay_basis',c.pay_basis,'contract_id',doc.id,'contract_hash',doc.document_sha256,'company_policy_id',(select id from payroll_ph_policy_versions where legal_entity_id=a.legal_entity_id and effective_from<=p_date order by effective_from desc,created_at desc limit 1),'derived',derived);
end $$;

