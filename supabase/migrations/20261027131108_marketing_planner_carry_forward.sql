-- One visibility predicate for operational reads and revision-bound ordering.
create function marketing_private.creative_task_visible_in_month(p_task public.marketing_creative_tasks,p_month date)
returns boolean language sql immutable parallel safe as $$
 select p_task.deleted_at is null and (p_task.planning_month=p_month or
  (p_task.planning_month<p_month and p_task.status in ('planned','in_progress','in_review','revision_needed')));
$$;
revoke all on function marketing_private.creative_task_visible_in_month(public.marketing_creative_tasks,date) from public,anon,authenticated,service_role;

do $migration$
declare f text;old text;
begin
 select pg_get_functiondef('public.marketing_planner_read(uuid,date,uuid)'::regprocedure) into f;
 if md5(f)<>'b302c4866601cca0aed0d1ac2d13b564' then raise exception 'Planner read changed; reconcile before applying.';end if;
 old:='t.planning_month=p_month and t.deleted_at is null and (p_brand is null or t.brand_id=p_brand)';
 if position(old in f)=0 then raise exception 'Planner month projection missing.';end if;
 f:=replace(f,old,'marketing_private.creative_task_visible_in_month(t,p_month) and (p_brand is null or t.brand_id=p_brand)');
 f:=replace(f,'jsonb_build_object(''brand_name'',b.name','jsonb_build_object(''carried_forward'',t.planning_month<p_month,''brand_name'',b.name');
 execute f;

 select pg_get_functiondef('public.marketing_planner_order(uuid,uuid,date,jsonb)'::regprocedure) into f;
 if md5(f)<>'350ccb673f4cbb630e7ee600dc0c921e' then raise exception 'Planner ordering changed; reconcile before applying.';end if;
 old:='and planning_month=p_month and deleted_at is null;';
 if position(old in f)=0 then raise exception 'Planner order month guard missing.';end if;
 execute replace(f,old,'and marketing_private.creative_task_visible_in_month(marketing_creative_tasks,p_month);');

 -- The command's month is workspace context; editing cannot silently replan an existing task.
 select pg_get_functiondef('public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into f;
 if md5(f)<>'536723c8cb2e6e467158612bcc9adc14' then raise exception 'Planner command changed; reconcile before applying.';end if;
 old:='t.planning_month:=case when p_action=''create'' or p_payload?''month'' then month else t.planning_month end;';
 if position(old in f)=0 then raise exception 'Planner save month assignment missing.';end if;
 execute replace(f,old,'t.planning_month:=case when p_action=''create'' then month else t.planning_month end;');
end;$migration$;
