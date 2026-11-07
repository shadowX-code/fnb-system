-- The Human Run read includes live source rows for required days without a saved version.
-- Keep this outside the calculation projection, fingerprints, snapshots and Agent response.
create or replace function public.payroll_run_evidence_read(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  result jsonb := feedx_integrations.hr_payroll_run_evidence_read(null,p_run_id);
  pending jsonb;
  time_rows jsonb;
begin
  if coalesce((result#>>'{readiness,time,unreconciled}')::integer,0)>0 then

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

    result := jsonb_set(result,'{time}',coalesce(result->'time','[]'::jsonb)||pending);
  end if;

  -- Compare within the original outlet/week and keep the comparison outside bound evidence.
  select coalesce(jsonb_agg(
    case when latest.id is null then item else item || jsonb_build_object(
      'latest_published_roster',jsonb_build_object(
        'revision',latest.revision,
        'entry_type',replacement.entry_type,
        'start_time',to_char(replacement.start_time - time '00:00','HH24:MI'),
        'end_time',to_char(replacement.end_time - time '00:00','HH24:MI'),
        'break_minutes',replacement.break_minutes
      )
    ) end order by ord
  ),'[]'::jsonb)
  into time_rows
  from jsonb_array_elements(result->'time') with ordinality as rows(item,ord)
  left join public.duty_roster_published_entries original
    on original.id=(item#>>'{evidence,roster_entry_id}')::uuid
    and original.employee_id=(item->>'employee_id')::uuid
    and original.roster_date=(item->>'work_date')::date
  left join public.duty_roster_publications bound on bound.id=original.publication_id
  left join lateral (
    select pub.id,pub.revision
    from public.duty_roster_publications pub
    where pub.outlet_id=bound.outlet_id and pub.week_start_date=bound.week_start_date
      and pub.revision>bound.revision
    order by pub.revision desc limit 1
  ) latest on true
  left join public.duty_roster_published_entries replacement
    on replacement.publication_id=latest.id
    and replacement.employee_id=original.employee_id
    and replacement.roster_date=original.roster_date;

  return jsonb_set(result,'{time}',time_rows);
end $$;

notify pgrst,'reload schema';
