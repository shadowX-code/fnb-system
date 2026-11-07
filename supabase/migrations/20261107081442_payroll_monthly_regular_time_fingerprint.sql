-- A prior blocked calculation can have the same inputs when no deduction rule existed.
-- Mark only the decisions affected by the revised calculation.
do $migration$
declare
  definition text:=pg_get_functiondef('public.payroll_calculation_project(uuid,uuid)'::regprocedure);
  anchor text:='        -- Basic Salary already covers Regular Monthly time.
        null;';
begin
  if position(anchor in definition)=0 then
    raise exception 'Unexpected Monthly Regular time calculation';
  end if;
  definition:=replace(definition,anchor,
    '        -- Basic Salary already covers Regular Monthly time.
        if coalesce(v_time.scheduled_minutes,0)>coalesce(v_time.approved_minutes,0) then
          v_inputs:=v_inputs||jsonb_build_object(''monthly_regular_attendance_only'',true);
        end if;');
  execute definition;
end $migration$;
