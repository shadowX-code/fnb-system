-- The generated series is timestamp-typed; the picker contract uses ISO dates.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.list_roster_eligible_employees(uuid,date,date)'::regprocedure) into v_definition;
  v_old:='jsonb_object_agg(day_date::text,eligibility)';
  v_new:='jsonb_object_agg(day_date::date::text,eligibility)';
  if position(v_old in v_definition)=0 then raise exception 'Roster picker date-key anchor not found.'; end if;
  execute replace(v_definition,v_old,v_new);
end $migration$;
revoke all on function public.list_roster_eligible_employees(uuid,date,date) from public,anon,authenticated;
grant execute on function public.list_roster_eligible_employees(uuid,date,date) to authenticated;
