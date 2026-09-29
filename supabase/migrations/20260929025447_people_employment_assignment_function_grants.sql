-- Trigger functions are database-owned internals, not Data API RPCs.
revoke all on function public.employee_employment_new_employee_baseline()
  from public,anon,authenticated;
revoke all on function public.employee_employment_projection_guard()
  from public,anon,authenticated;
revoke all on function public.employee_employment_assignment_immutable()
  from public,anon,authenticated;
