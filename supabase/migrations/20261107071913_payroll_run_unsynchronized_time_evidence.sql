-- The Human Run read includes live source rows for required days without a saved version.
-- Keep this outside the calculation projection, fingerprints, snapshots and Agent response.
create or replace function public.payroll_run_evidence_read(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  result jsonb := feedx_integrations.hr_payroll_run_evidence_read(null,p_run_id);
  pending jsonb;
begin
  if coalesce((result#>>'{readiness,time,unreconciled}')::integer,0)=0 then
    return result;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'unsynchronized:'||(member->>'employee_id')||':'||(day->>'work_date'),
    'employee_id',member->>'employee_id',
    'work_date',day->>'work_date',
    'pay_basis',source->>'pay_basis',
    'status','unreconciled',
    'review_state',day,
    'issue_codes',coalesce(source->'issue_codes',day->'issues','[]'::jsonb),
    'classification',source->>'classification',
    'scheduled_minutes',source->'scheduled_minutes',
    'actual_minutes',source->'actual_minutes',
    'proposed_minutes',source->'proposed_minutes',
    'evidence',source
  ) order by day->>'work_date', member->>'employee_id'),'[]'::jsonb)
  into pending
  from jsonb_array_elements(result#>'{preparation,results}') member
  cross join lateral jsonb_array_elements(member->'time_review') day
  cross join lateral public.payroll_time_evidence(
    (member->>'employee_id')::uuid,(day->>'work_date')::date
  ) source
  where day->>'state'='unreconciled'
    and (day->>'required')::boolean;

  return jsonb_set(result,'{time}',coalesce(result->'time','[]'::jsonb)||pending);
end $$;

notify pgrst,'reload schema';
