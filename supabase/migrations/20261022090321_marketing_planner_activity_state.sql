-- Read-only historical state projection. Existing task/Brand authority and grants remain unchanged.
do $migration$
declare body text:=pg_get_functiondef('public.marketing_planner_read(uuid,date,uuid)'::regprocedure);
 old_fields text:=$old$'feedback',h.snapshot->>'review_feedback'$old$;
 new_fields text:=$new$'feedback',h.snapshot->>'review_feedback','state',jsonb_build_object('status',h.snapshot->'status','priority',h.snapshot->'priority','assignee_id',h.snapshot->'assignee_id','assignee_name',coalesce(nullif(btrim(ha.nickname),''),ha.full_name))$new$;
 old_join text:=$old$left join public.employees he on he.id=h.actor where h.task_id=t.id$old$;
 new_join text:=$new$left join public.employees he on he.id=h.actor left join public.employees ha on ha.id=nullif(h.snapshot->>'assignee_id','')::uuid where h.task_id=t.id$new$;
begin
 if position(old_fields in body)=0 or position(old_join in body)=0 or position('''state'',jsonb_build_object' in body)>0 then raise exception 'Unexpected Planner history projection; reconcile before applying.';end if;
 body:=replace(replace(body,old_fields,new_fields),old_join,new_join);
 execute body;
end;
$migration$;
