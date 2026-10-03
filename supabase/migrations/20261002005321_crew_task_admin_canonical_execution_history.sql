-- Admin consumes the same operational-run resolution as Crew.
-- Preserve superseded snapshots/evidence and the full Versions projection.
do $guard$ begin if md5(pg_get_functiondef('public.crew_tasks_admin_detail(uuid)'::regprocedure)) <> '801b1913863b6823a66046c61352795b' then raise exception 'Reviewed Admin Task detail baseline drift'; end if; if not exists(select 1 from pg_indexes where schemaname='public' and indexname='crew_task_one_operational_run') then raise exception 'Canonical Task run lifecycle prerequisite is missing'; end if; end $guard$;
CREATE OR REPLACE FUNCTION public.crew_tasks_admin_detail(p_template_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source public.crew_operation_templates%rowtype;
  v_current public.crew_operation_templates%rowtype;
  v_draft public.crew_operation_templates%rowtype;
  v_progress jsonb;
  v_history jsonb;
  v_versions jsonb;
begin
  select * into v_source from public.crew_operation_templates where id=p_template_id;
  if v_source.id is null
     or not public.current_user_has_permission('crew_operations.view')
     or not public.current_user_can_access_outlet(v_source.outlet_id) then
    raise exception using errcode='42501',message='Task detail is unavailable.';
  end if;

  select * into v_current
  from public.crew_operation_templates t
  where t.series_id=v_source.series_id and t.status<>'draft'
  order by case t.status when 'active' then 1 when 'paused' then 2 when 'ended' then 3 else 4 end,
           t.revision desc
  limit 1;

  select * into v_draft
  from public.crew_operation_templates t
  where t.series_id=v_source.series_id and t.status='draft'
  order by t.revision desc limit 1;

  if v_current.id is null then v_current:=v_draft; end if;

  select jsonb_build_object(
    'instances',count(*),
    'completed',count(*) filter(where i.status='completed'),
    'in_progress',count(*) filter(where i.status='in_progress'),
    'not_started',count(*) filter(where i.status='not_started' and i.available_until>=now()),
    'exception',count(*) filter(where i.status='completed_with_exceptions'),
    'overdue',count(*) filter(where i.status='overdue' or (i.status='not_started' and i.available_until<now()))
  ) into v_progress
  from public.crew_operation_instances i where i.template_series_id=v_source.series_id and i.is_operational;

  select coalesce(jsonb_agg(jsonb_build_object(
    'instance_id',i.id,'date',i.business_date,'revision',i.template_revision,
    'status',case when i.status='completed_with_exceptions' then 'exception'
      when i.status='not_started' and i.available_until<now() then 'overdue' else i.status end,
    'available_from',i.available_from,'due_at',i.available_until,'completed_at',i.completed_at,
    'actors',coalesce((select jsonb_agg(distinct jsonb_build_object('id',e.id,'name',e.full_name))
      from public.crew_task_item_responses r
      join public.crew_operation_instance_items ii on ii.id=r.instance_item_id
      join public.employees e on e.id=r.employee_id where ii.instance_id=i.id),'[]'::jsonb),
    'has_result',exists(select 1 from public.crew_task_item_responses r join public.crew_operation_instance_items ii on ii.id=r.instance_item_id where ii.instance_id=i.id)
      or exists(select 1 from public.crew_task_reviews r where r.instance_id=i.id)
      or exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=i.id and a.status<>'not_started')
  ) order by i.business_date desc,i.available_from desc),'[]'::jsonb) into v_history
  from public.crew_operation_instances i where i.template_series_id=v_source.series_id and i.is_operational;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'revision',t.revision,'status',t.status,'created_at',t.created_at,
    'updated_at',t.updated_at,'activated_at',t.activated_at,'archived_at',t.archived_at,
    'block_count',(select count(*) from public.crew_operation_template_items i where i.template_id=t.id),
    'instance_count',(select count(*) from public.crew_operation_instances i where i.template_id=t.id)
  ) order by t.revision desc),'[]'::jsonb) into v_versions
  from public.crew_operation_templates t where t.series_id=v_source.series_id;

  return jsonb_build_object(
    'definition',(to_jsonb(v_current)-'created_by')||jsonb_build_object(
      'created_date',(select min(x.created_at)::date from public.crew_operation_templates x where x.series_id=v_source.series_id),
      'next_run',public.crew_tasks_next_run(v_current),
      'blocks',coalesce((select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object('sop_reference',i.sop_snapshot,'config',i.block_config) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=v_current.id),'[]'::jsonb),
      'block_count',(select count(*) from public.crew_operation_template_items x where x.template_id=v_current.id)
    ),
    'draft',case when v_draft.id is null then null else
      (to_jsonb(v_draft)-'created_by')||jsonb_build_object(
        'blocks',coalesce((select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object('sop_reference',i.sop_snapshot,'config',i.block_config) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=v_draft.id),'[]'::jsonb),
        'block_count',(select count(*) from public.crew_operation_template_items x where x.template_id=v_draft.id)
      ) end,
    'progress',v_progress,'history',v_history,'versions',v_versions
  );
end;
$function$
;
