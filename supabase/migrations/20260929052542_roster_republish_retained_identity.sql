-- A retained historical working row can be republished with other edits.
-- If its dated People assignment no longer supports this outlet, preserve
-- its previously pinned position instead of projecting an unrelated outlet's
-- later position into a new publication.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.publish_roster_week(uuid,uuid,date)'::regprocedure) into v_definition;
  v_old:='position_snapshot=coalesce(nullif(public.roster_employment_on_date(employee.id,p_outlet_id,r.roster_date)->>''position'',''''),r.position_snapshot,'''')';
  v_new:='position_snapshot=coalesce(nullif(case when public.roster_employment_on_date(employee.id,p_outlet_id,r.roster_date)->>''state''=''eligible'' then public.roster_employment_on_date(employee.id,p_outlet_id,r.roster_date)->>''position'' end,''''),r.position_snapshot,'''')';
  if position(v_old in v_definition)=0 then raise exception 'Roster republish position anchor not found.'; end if;
  execute replace(v_definition,v_old,v_new);
end $migration$;
revoke all on function public.publish_roster_week(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.publish_roster_week(uuid,uuid,date) to authenticated;
