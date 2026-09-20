-- Token, permission, and outlet helpers read mutable session/access state.
-- Mark their public projections VOLATILE so PostgreSQL does not cache access checks.
alter function public.crew_employee_compliance(text) volatile;
alter function public.crew_employee_compliance_evidence_context(text,uuid) volatile;
alter function public.employee_compliance_admin_evidence_context(uuid) volatile;
alter function public.employee_compliance_admin_detail(uuid) volatile;
alter function public.employee_compliance_admin_page(uuid,jsonb,integer,integer) volatile;
