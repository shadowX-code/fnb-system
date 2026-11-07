CREATE OR REPLACE FUNCTION public.payroll_period_employment_resolve(p_employee_id uuid, p_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_period public.payroll_periods%rowtype; v_employee public.employees%rowtype;
  v_revision public.employee_employment_assignment_revisions%rowtype;
  v_first public.employee_employment_assignment_revisions%rowtype;
  v_date date; v_previous uuid; v_spans jsonb:='[]'::jsonb; v_entities jsonb:='[]'::jsonb;
  v_missing_start date; v_missing_end date; v_changed boolean:=false; v_active boolean:=false;
  v_issue text; v_identity jsonb; v_inactive_before_active boolean:=false;
begin
  select * into v_period from public.payroll_periods where id=p_period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  if v_period.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll period or employee not found.';
  end if;
  if v_employee.joined_date is null then
    return jsonb_build_object('state','review_required','issue','employment_joined_date_missing',
      'entity_ids','[]'::jsonb,'spans','[]'::jsonb);
  end if;
  for v_date in select generate_series(greatest(v_period.period_start,v_employee.joined_date),
      v_period.period_end,interval '1 day')::date loop
    v_revision:=public.employee_employment_assignment_at(p_employee_id,v_date);
    if v_revision.id is null then
      v_missing_start:=coalesce(v_missing_start,v_date); v_missing_end:=v_date;
      continue;
    end if;
    if v_revision.id is distinct from v_previous then
      v_spans:=v_spans||jsonb_build_array(jsonb_build_object('from',v_date,
        'revision_id',v_revision.id,'effective_from',v_revision.effective_from,
        'legal_entity_id',v_revision.legal_entity_id,'employment_status',v_revision.employment_status,
        'employment_type',v_revision.employment_type,'position',v_revision.position,
        'workplace',v_revision.workplace,'employment_end_date',v_revision.employment_end_date));
      v_previous:=v_revision.id;
    end if;
    if v_revision.employment_status='active'
      and (v_revision.employment_end_date is null or v_date<=v_revision.employment_end_date) then
      v_active:=true;
      if v_inactive_before_active then v_changed:=true; end if;
      if v_revision.legal_entity_id is not null then
        -- JSON array membership is checked below without trusting Employee's current employer.
        if not exists(select 1 from jsonb_array_elements_text(v_entities) as x(value)
          where x.value=v_revision.legal_entity_id::text) then
          v_entities:=v_entities||to_jsonb(v_revision.legal_entity_id::text);
        end if;
      end if;
      if v_first.id is null then v_first:=v_revision;
      elsif (v_first.legal_entity_id,v_first.employment_status,v_first.employment_type,
        v_first.position,v_first.workplace) is distinct from
        (v_revision.legal_entity_id,v_revision.employment_status,v_revision.employment_type,
        v_revision.position,v_revision.workplace) then v_changed:=true; end if;
    else
      -- A dated terminal status ends eligibility; it does not change the identity of earlier work.
      v_inactive_before_active:=true;
      if v_first.id is not null and not coalesce(
        v_revision.employment_status in ('resigned','terminated')
        and v_revision.employment_end_date=v_revision.effective_from
        and (v_first.legal_entity_id,v_first.employment_type,v_first.position,v_first.workplace)
          is not distinct from
          (v_revision.legal_entity_id,v_revision.employment_type,v_revision.position,v_revision.workplace),
        false) then v_changed:=true; end if;
    end if;
  end loop;
  if v_missing_start is not null then
    v_issue:='employment_history_unresolved:'||v_missing_start||'..'||v_missing_end;
  elsif v_changed then v_issue:='mid_period_employment_change';
  elsif v_active and v_first.legal_entity_id is null then v_issue:='legal_employer_unresolved';
  end if;
  if v_first.id is not null and v_issue is null then
    v_identity:=jsonb_build_object('revision_id',v_first.id,
      'legal_entity_id',v_first.legal_entity_id,'employment_status',v_first.employment_status,
      'employment_type',v_first.employment_type,'position',v_first.position,
      'workplace',v_first.workplace);
  end if;
  return jsonb_build_object('state',case when v_issue is not null then 'review_required'
      when v_active then 'resolved' else 'outside_period' end,
    'issue',v_issue,'entity_ids',v_entities,'spans',v_spans,'identity',v_identity,
    'joined_date',v_employee.joined_date,'period_start',v_period.period_start,
    'period_end',v_period.period_end);
end $function$;
