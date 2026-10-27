-- Keep operational reads and ordering restricted to canonical first-of-month scope.
create or replace function marketing_private.creative_task_visible_in_month(p_task public.marketing_creative_tasks,p_month date)
returns boolean language sql immutable parallel safe as $$
 select extract(day from p_month)=1 and p_task.deleted_at is null and (p_task.planning_month=p_month or
  (p_task.planning_month<p_month and p_task.status in ('planned','in_progress','in_review','revision_needed')));
$$;
revoke all on function marketing_private.creative_task_visible_in_month(public.marketing_creative_tasks,date) from public,anon,authenticated,service_role;
