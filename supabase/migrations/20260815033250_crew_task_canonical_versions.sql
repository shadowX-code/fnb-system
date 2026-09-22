-- FeedX Crew Operations: canonical Task series reads and idempotent Draft
-- revision creation. Existing immutable revisions, instances and results are
-- retained; duplicate Drafts are archived rather than deleted.

-- A previous browser-driven New Revision flow could create more than one Draft
-- for a logical Task. Keep the newest Draft editable and retain older rows as
-- archived history before enforcing the invariant.
with ranked_drafts as (
  select id,
         row_number() over (
           partition by series_id
           order by revision desc, updated_at desc, id desc
         ) as draft_rank
  from public.crew_operation_templates
  where status='draft'
)
update public.crew_operation_templates t
set status='archived',
    archived_at=coalesce(t.archived_at,now()),
    updated_at=now()
from ranked_drafts r
where t.id=r.id and r.draft_rank>1;

create unique index if not exists crew_operation_templates_one_draft_per_series_idx
  on public.crew_operation_templates(series_id)
  where status='draft';

create or replace function public.crew_tasks_ensure_draft(p_template_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_source public.crew_operation_templates%rowtype;
  v_draft public.crew_operation_templates%rowtype;
begin
  select * into v_source
  from public.crew_operation_templates
  where id=p_template_id;

  if v_source.id is null
     or not public.current_user_has_permission('crew_operations.manage')
     or not public.current_user_can_access_outlet(v_source.outlet_id) then
    raise exception using errcode='42501',message='Task Draft creation is unavailable.';
  end if;

  -- Serialize Draft creation for the logical Task without locking unrelated
  -- outlets or series. Re-check after acquiring the lock to make this RPC
  -- idempotent across double-clicks and concurrent browser requests.
  perform pg_advisory_xact_lock(hashtextextended(v_source.series_id::text,0));

  select * into v_draft
  from public.crew_operation_templates
  where series_id=v_source.series_id and status='draft'
  order by revision desc
  limit 1;

  if v_draft.id is not null then
    return jsonb_build_object(
      'id',v_draft.id,'series_id',v_draft.series_id,'revision',v_draft.revision,
      'status',v_draft.status,'created',false
    );
  end if;

  insert into public.crew_operation_templates(
    series_id,outlet_id,revision,name,operation_type,status,
    applicable_role_ids,applicable_positions,effective_date,available_from,available_until,
    created_by,task_type,schedule_type,schedule_config,schedule_end_date,
    assignment_type,applicable_employee_ids,applicable_group_names,on_duty_only,
    priority,completion_rule,allow_exception,exception_requires_reason,
    manager_review_required,allow_late_completion
  )
  select
    v_source.series_id,v_source.outlet_id,
    (select coalesce(max(t.revision),0)+1 from public.crew_operation_templates t where t.series_id=v_source.series_id),
    v_source.name,v_source.operation_type,'draft',
    v_source.applicable_role_ids,v_source.applicable_positions,
    greatest(v_source.effective_date,timezone('Asia/Kuala_Lumpur',now())::date),
    v_source.available_from,v_source.available_until,auth.uid(),
    v_source.task_type,v_source.schedule_type,v_source.schedule_config,
    case when v_source.schedule_end_date is not null
              and v_source.schedule_end_date<greatest(v_source.effective_date,timezone('Asia/Kuala_Lumpur',now())::date)
         then null else v_source.schedule_end_date end,
    v_source.assignment_type,v_source.applicable_employee_ids,v_source.applicable_group_names,
    v_source.on_duty_only,v_source.priority,v_source.completion_rule,
    v_source.allow_exception,v_source.exception_requires_reason,
    v_source.manager_review_required,v_source.allow_late_completion
  returning * into v_draft;

  insert into public.crew_operation_template_items(
    template_id,title,description,is_required,sort_order,evidence_requirement,
    health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config
  )
  select v_draft.id,title,description,is_required,sort_order,evidence_requirement,
         health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config
  from public.crew_operation_template_items
  where template_id=v_source.id
  order by sort_order;

  return jsonb_build_object(
    'id',v_draft.id,'series_id',v_draft.series_id,'revision',v_draft.revision,
    'status',v_draft.status,'created',true
  );
end;
$$;
revoke all on function public.crew_tasks_ensure_draft(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_ensure_draft(uuid) to authenticated;

create or replace function public.crew_tasks_admin_data(
  p_outlet_id uuid,
  p_from date default timezone('Asia/Kuala_Lumpur',now())::date,
  p_to date default timezone('Asia/Kuala_Lumpur',now())::date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public
as $$
declare v_definitions jsonb; v_instances jsonb; v_sops jsonb; v_employees jsonb; v_review_queue jsonb;
begin
  if not public.current_user_has_permission('crew_operations.view')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Tasks are unavailable for this outlet.';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>92 then
    raise exception using errcode='22023',message='Choose a valid Task period of 93 days or fewer.';
  end if;

  perform public.crew_tasks_refresh_lifecycle(p_outlet_id);
  perform public.crew_operations_ensure_instances(p_outlet_id,d::date)
  from generate_series(p_from,p_to,interval '1 day') g(d);

  with task_series as (
    select t.series_id,min(t.created_at)::date as created_date,max(t.updated_at) as series_updated_at
    from public.crew_operation_templates t
    where t.outlet_id=p_outlet_id
    group by t.series_id
  ), canonical as (
    select s.*,
           coalesce(live.id,draft.id) as canonical_id,
           live.id as current_id,
           draft.id as draft_id
    from task_series s
    left join lateral (
      select t.* from public.crew_operation_templates t
      where t.series_id=s.series_id and t.status<>'draft'
      order by case t.status when 'active' then 1 when 'paused' then 2 when 'ended' then 3 else 4 end,
               t.revision desc
      limit 1
    ) live on true
    left join lateral (
      select t.* from public.crew_operation_templates t
      where t.series_id=s.series_id and t.status='draft'
      order by t.revision desc limit 1
    ) draft on true
  )
  select coalesce(jsonb_agg(
    (to_jsonb(t)-'created_by')||jsonb_build_object(
      'definition_status',t.status,
      'created_date',c.created_date,
      'next_run',public.crew_tasks_next_run(t),
      'has_draft',c.draft_id is not null,
      'current_version',case when c.current_id is null then null else jsonb_build_object(
        'id',current_t.id,'revision',current_t.revision,'status',current_t.status,
        'updated_at',current_t.updated_at,'activated_at',current_t.activated_at
      ) end,
      'draft_version',case when c.draft_id is null then null else jsonb_build_object(
        'id',draft_t.id,'revision',draft_t.revision,'status',draft_t.status,
        'updated_at',draft_t.updated_at
      ) end,
      'blocks',coalesce((
        select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object(
          'sop_reference',i.sop_snapshot,'config',i.block_config
        ) order by i.sort_order)
        from public.crew_operation_template_items i where i.template_id=t.id
      ),'[]'::jsonb)
    ) order by c.series_updated_at desc
  ),'[]'::jsonb) into v_definitions
  from canonical c
  join public.crew_operation_templates t on t.id=c.canonical_id
  left join public.crew_operation_templates current_t on current_t.id=c.current_id
  left join public.crew_operation_templates draft_t on draft_t.id=c.draft_id;

  select coalesce(jsonb_agg(
    (to_jsonb(i)-'template_snapshot')||jsonb_build_object(
      'instance_status',case when i.status='completed_with_exceptions' then 'exception'
        when i.status='not_started' and i.available_until<now() then 'overdue' else i.status end,
      'assignee_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id),
      'completed_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id and a.status in ('completed','completed_with_exceptions'))
    ) order by i.business_date,i.available_from,i.name
  ),'[]'::jsonb) into v_instances
  from public.crew_operation_instances i
  where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('sop_id',s.id,'title',s.title,'version_id',v.id,'version',v.version) order by s.title),'[]'::jsonb) into v_sops
  from public.crew_sops s
  join lateral(select * from public.crew_sop_versions v where v.sop_id=s.id and v.status='published' order by v.version desc limit 1)v on true
  where s.outlet_id is null or s.outlet_id=p_outlet_id;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into v_employees
  from public.employees e
  join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active'
  where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');

  select coalesce(jsonb_agg(jsonb_build_object('instance_id',i.id,'employee_id',e.id,'task_name',i.name,'employee_name',e.full_name,'business_date',i.business_date,'status',a.status) order by i.business_date,e.full_name),'[]'::jsonb) into v_review_queue
  from public.crew_task_instance_assignees a
  join public.crew_operation_instances i on i.id=a.instance_id
  join public.employees e on e.id=a.employee_id
  where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to and a.status='review_required';

  return jsonb_build_object('from',p_from,'to',p_to,'definitions',v_definitions,'instances',v_instances,'published_sops',v_sops,'employees',v_employees,'review_queue',v_review_queue);
end;
$$;
revoke all on function public.crew_tasks_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_tasks_admin_detail(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
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
  from public.crew_operation_instances i where i.template_series_id=v_source.series_id;

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
  from public.crew_operation_instances i where i.template_series_id=v_source.series_id;

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
$$;
revoke all on function public.crew_tasks_admin_detail(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_detail(uuid) to authenticated;

-- Reassert the intended browser boundary after redefining Admin authorities.
revoke all on public.crew_operation_templates,public.crew_operation_template_items,
  public.crew_operation_instances,public.crew_operation_instance_items,
  public.crew_task_instance_assignees,public.crew_task_item_responses,
  public.crew_task_reviews from public,anon,authenticated;
