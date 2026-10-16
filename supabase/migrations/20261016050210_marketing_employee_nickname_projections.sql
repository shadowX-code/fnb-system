-- Employee display only: reuse the Team projection, preserve actor IDs and all guards.
-- Patch the live read definitions so unrelated provider/authorization changes survive.
do $$
declare signatures text[]:=array[
 'marketing_private.creators_workspace(uuid,uuid,boolean)',
 'public.marketing_dashboard_operations(uuid,uuid)',
 'public.marketing_inbox_detail(uuid,integer,integer)',
 'public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean)',
 'public.marketing_planner_read(uuid,date,uuid)',
 'public.marketing_setup_options(uuid)',
 'public.marketing_customers_read(uuid,uuid,jsonb,integer,integer)'];
 expected integer[]:=array[1,1,3,2,4,2,1];
 body text; original text; pair record; changes integer; i integer;
begin
 for i in 1..array_length(signatures,1) loop
  body:=pg_get_functiondef(signatures[i]::regprocedure);original:=body;changes:=0;
  for pair in select * from (values
   ($a$'name',e.full_name$a$,$b$'name',coalesce(nullif(btrim(e.nickname),''),e.full_name)$b$),
   ($a$e.full_name assignee_name$a$,$b$coalesce(nullif(btrim(e.nickname),''),e.full_name) assignee_name$b$),
   ($a$'assignee_name',e.full_name$a$,$b$'assignee_name',coalesce(nullif(btrim(e.nickname),''),e.full_name)$b$),
   ($a$'blocker_owner_name',bo.full_name$a$,$b$'blocker_owner_name',coalesce(nullif(btrim(bo.nickname),''),bo.full_name)$b$),
   ($a$'actor',he.full_name$a$,$b$'actor',coalesce(nullif(btrim(he.nickname),''),he.full_name)$b$),
   ($a$'actor_name',e.full_name$a$,$b$'actor_name',coalesce(nullif(btrim(e.nickname),''),e.full_name)$b$),
   ($a$(select full_name from public.employees where id=e.actor_employee_id)$a$,$b$(select coalesce(nullif(btrim(nickname),''),full_name) from public.employees where id=e.actor_employee_id)$b$)
  ) as replacements(before_text,after_text) loop
   changes:=changes+(length(body)-length(replace(body,pair.before_text,'')))/length(pair.before_text);
   body:=replace(body,pair.before_text,pair.after_text);
  end loop;
  if changes<>expected[i] or body=original then raise exception 'Employee name read contract changed: %',signatures[i];end if;
  execute body;
 end loop;
end;$$;
