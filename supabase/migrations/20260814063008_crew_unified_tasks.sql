-- FeedX Crew Operations: unified Tasks domain.
-- Forward-only compatibility layer over the established immutable Operations
-- templates/instances. Existing checklist and daily-task history is retained.

alter table public.crew_operation_templates
  add column if not exists task_type text,
  add column if not exists schedule_type text,
  add column if not exists schedule_config jsonb not null default '{}'::jsonb,
  add column if not exists assignment_type text not null default 'all_crew',
  add column if not exists applicable_employee_ids uuid[] not null default '{}',
  add column if not exists applicable_group_names text[] not null default '{}',
  add column if not exists on_duty_only boolean not null default false,
  add column if not exists priority text not null default 'normal',
  add column if not exists completion_rule text not null default 'one_for_team',
  add column if not exists allow_exception boolean not null default true,
  add column if not exists exception_requires_reason boolean not null default true,
  add column if not exists manager_review_required boolean not null default false,
  add column if not exists allow_late_completion boolean not null default true;

-- The established immutability trigger protects active historical revisions.
-- Use its existing transaction-local lifecycle gate only for this deterministic
-- metadata backfill; no published content or status is rewritten.
select set_config('feedx.operation_lifecycle','activate',true);
update public.crew_operation_templates
set task_type=case operation_type when 'health' then 'health_check' else 'checklist' end,
    schedule_type='recurring',
    schedule_config=jsonb_build_object('frequency','every_day')
where task_type is null or schedule_type is null;

alter table public.crew_operation_templates
  alter column task_type set not null,
  alter column schedule_type set not null,
  add constraint crew_operation_templates_task_type_check check(task_type in ('checklist','instruction','health_check','confirmation','sop_review')),
  add constraint crew_operation_templates_schedule_type_check check(schedule_type in ('one_time','recurring','shift_based')),
  add constraint crew_operation_templates_assignment_type_check check(assignment_type in ('all_crew','position','specific_crew','group')),
  add constraint crew_operation_templates_priority_check check(priority in ('normal','important','critical')),
  add constraint crew_operation_templates_completion_rule_check check(completion_rule in ('any_assigned','every_assigned','one_for_team'));

alter table public.crew_operation_template_items
  add column if not exists block_type text,
  add column if not exists block_config jsonb not null default '{}'::jsonb;
update public.crew_operation_template_items
set block_type=case when health_category is not null then 'health_rating' else 'checklist_item' end
where block_type is null;
select set_config('feedx.operation_lifecycle','',true);
alter table public.crew_operation_template_items alter column block_type set not null;
alter table public.crew_operation_template_items add constraint crew_operation_template_items_block_type_check
  check(block_type in ('text','checklist_item','key_point','image','sop_reference','yes_no','single_choice','number','temperature','short_text','health_rating'));

alter table public.crew_operation_instances
  add column if not exists task_type text,
  add column if not exists schedule_type text,
  add column if not exists priority text not null default 'normal',
  add column if not exists completion_rule text not null default 'one_for_team',
  add column if not exists assignment_type text not null default 'all_crew',
  add column if not exists applicable_employee_ids uuid[] not null default '{}',
  add column if not exists applicable_group_names text[] not null default '{}',
  add column if not exists on_duty_only boolean not null default false,
  add column if not exists allow_exception boolean not null default true,
  add column if not exists exception_requires_reason boolean not null default true,
  add column if not exists manager_review_required boolean not null default false,
  add column if not exists allow_late_completion boolean not null default true;
update public.crew_operation_instances i set
  task_type=coalesce(t.task_type,case i.operation_type when 'health' then 'health_check' else 'checklist' end),
  schedule_type=coalesce(t.schedule_type,'recurring'), priority=coalesce(t.priority,'normal'),
  completion_rule=coalesce(t.completion_rule,'one_for_team'), assignment_type=coalesce(t.assignment_type,'all_crew'),
  applicable_employee_ids=coalesce(t.applicable_employee_ids,'{}'), applicable_group_names=coalesce(t.applicable_group_names,'{}'),
  on_duty_only=coalesce(t.on_duty_only,false), allow_exception=coalesce(t.allow_exception,true),
  exception_requires_reason=coalesce(t.exception_requires_reason,true), manager_review_required=coalesce(t.manager_review_required,false),
  allow_late_completion=coalesce(t.allow_late_completion,true)
from public.crew_operation_templates t where t.id=i.template_id and (i.task_type is null or i.schedule_type is null);
alter table public.crew_operation_instances alter column task_type set not null, alter column schedule_type set not null;
alter table public.crew_operation_instances
  add constraint crew_operation_instances_task_type_check check(task_type in ('checklist','instruction','health_check','confirmation','sop_review')),
  add constraint crew_operation_instances_schedule_type_check check(schedule_type in ('one_time','recurring','shift_based')),
  add constraint crew_operation_instances_priority_check check(priority in ('normal','important','critical')),
  add constraint crew_operation_instances_completion_rule_check check(completion_rule in ('any_assigned','every_assigned','one_for_team'));

alter table public.crew_operation_instance_items
  add column if not exists block_type text,
  add column if not exists block_config jsonb not null default '{}'::jsonb;
update public.crew_operation_instance_items ii set block_type=coalesce(ti.block_type,case when ii.health_category is not null then 'health_rating' else 'checklist_item' end),block_config=coalesce(ti.block_config,'{}'::jsonb)
from public.crew_operation_template_items ti where ti.id=ii.snapshot_item_id and ii.block_type is null;
alter table public.crew_operation_instance_items alter column block_type set not null;

create table public.crew_task_instance_assignees(
  instance_id uuid not null references public.crew_operation_instances(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  status text not null default 'not_started' check(status in ('not_started','in_progress','completed','completed_with_exceptions','overdue','review_required')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(instance_id,employee_id)
);
create table public.crew_task_item_responses(
  id uuid primary key default gen_random_uuid(),
  instance_item_id uuid not null references public.crew_operation_instance_items(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  status text not null check(status in ('completed','exception','good','needs_attention','not_checked')),
  response jsonb not null default '{}'::jsonb,
  exception_reason text,
  note text,
  completed_at timestamptz not null default now(),
  unique(instance_item_id,employee_id)
);
create table public.crew_task_reviews(
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.crew_operation_instances(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  decision text not null check(decision in ('approved','changes_required')),
  note text,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);
create index crew_task_assignees_employee_idx on public.crew_task_instance_assignees(employee_id,status,instance_id);
create index crew_task_responses_employee_idx on public.crew_task_item_responses(employee_id,completed_at desc);
create index crew_task_reviews_instance_idx on public.crew_task_reviews(instance_id,employee_id,reviewed_at desc);
alter table public.crew_task_instance_assignees enable row level security;
alter table public.crew_task_item_responses enable row level security;
alter table public.crew_task_reviews enable row level security;
revoke all on public.crew_task_instance_assignees,public.crew_task_item_responses,public.crew_task_reviews from public,anon,authenticated;
grant select,insert,update,delete on public.crew_task_instance_assignees,public.crew_task_item_responses,public.crew_task_reviews to service_role;

create or replace function public.crew_tasks_schedule_matches(p_template public.crew_operation_templates,p_date date)
returns boolean language plpgsql stable set search_path=public as $$
declare frequency text:=coalesce(p_template.schedule_config->>'frequency','every_day'); weekdays int[]; interval_days int;
begin
  if p_template.schedule_type='one_time' then return p_date=p_template.effective_date; end if;
  if p_template.schedule_type='shift_based' then return p_date>=p_template.effective_date; end if;
  if p_date<p_template.effective_date then return false; end if;
  if frequency='every_day' then return true; end if;
  if frequency='specific_weekdays' then
    select coalesce(array_agg(value::int),'{}') into weekdays from jsonb_array_elements_text(coalesce(p_template.schedule_config->'weekdays','[]'::jsonb));
    return extract(isodow from p_date)::int=any(weekdays);
  end if;
  if frequency='weekly' then return extract(isodow from p_date)=coalesce((p_template.schedule_config->>'weekday')::int,extract(isodow from p_template.effective_date)); end if;
  if frequency='monthly' then return extract(day from p_date)=least(coalesce((p_template.schedule_config->>'day')::int,extract(day from p_template.effective_date)::int),extract(day from (date_trunc('month',p_date)+interval '1 month - 1 day'))::int); end if;
  interval_days:=greatest(coalesce((p_template.schedule_config->>'interval_days')::int,1),1);
  return ((p_date-p_template.effective_date)%interval_days)=0;
end; $$;
revoke all on function public.crew_tasks_schedule_matches(public.crew_operation_templates,date) from public,anon,authenticated;

create or replace function public.crew_tasks_employee_applies(p_template public.crew_operation_templates,p_employee public.employees,p_date date)
returns boolean language plpgsql stable set search_path=public as $$
declare group_name text;
begin
  if p_template.assignment_type='specific_crew' and not (p_employee.id=any(p_template.applicable_employee_ids)) then return false; end if;
  if p_template.assignment_type='position' and not public.crew_operations_applicable(p_employee.role_id,p_employee.position,p_template.applicable_role_ids,p_template.applicable_positions) then return false; end if;
  if p_template.assignment_type='group' then
    select g.group_name into group_name from public.job_positions jp join public.roster_position_groups g on g.position_id=jp.id where lower(jp.name)=lower(coalesce(p_employee.position,'')) limit 1;
    if group_name is null or not (lower(group_name)=any(select lower(x) from unnest(p_template.applicable_group_names)x)) then return false; end if;
  end if;
  if p_template.on_duty_only or p_template.schedule_type='shift_based' then
    if not exists(select 1 from public.duty_roster_published_entries r where r.employee_id=p_employee.id and r.outlet_id=p_template.outlet_id and r.roster_date=p_date and r.entry_type='working' and r.publication_id=(select p.id from public.duty_roster_publications p where p.outlet_id=r.outlet_id and p.week_start_date<=p_date and p.week_end_date>=p_date order by p.revision desc limit 1)) then return false; end if;
  end if;
  return true;
end; $$;
revoke all on function public.crew_tasks_employee_applies(public.crew_operation_templates,public.employees,date) from public,anon,authenticated;

-- Compatibility backfill: existing immutable instances and their completion state
-- remain visible through the unified Task read model without rewriting history.
insert into public.crew_task_instance_assignees(instance_id,employee_id,status,completed_at)
select i.id,e.id,
       case when i.status in ('completed','completed_with_exceptions') then i.status
            when i.status='overdue' then 'overdue'
            else 'not_started' end,
       i.completed_at
from public.crew_operation_instances i
join public.crew_operation_templates t on t.id=i.template_id
join public.employees e on e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
join public.crew_access ca on ca.employee_id=e.id and ca.access_state='active' and ca.primary_outlet_id=i.outlet_id
where public.crew_tasks_employee_applies(t,e,i.business_date)
on conflict do nothing;

insert into public.crew_task_item_responses(instance_item_id,employee_id,status,response,exception_reason,note,completed_at)
select i.id,i.completed_by,i.status,coalesce(i.evidence,'{}'::jsonb),i.exception_reason,i.note,coalesce(i.completed_at,now())
from public.crew_operation_instance_items i
where i.completed_by is not null and i.status<>'pending'
on conflict do nothing;

create or replace function public.crew_operations_ensure_instances(p_outlet_id uuid,p_business_date date)
returns void language plpgsql volatile security definer set search_path=public as $$
declare template public.crew_operation_templates%rowtype; instance_id uuid; snapshot jsonb; shift_start time; shift_end time; employee public.employees%rowtype;
begin
 for template in select * from public.crew_operation_templates t where t.outlet_id=p_outlet_id and t.status='active' and public.crew_tasks_schedule_matches(t,p_business_date) loop
   select min(r.start_time),max(r.end_time) into shift_start,shift_end from public.duty_roster_published_entries r where r.outlet_id=p_outlet_id and r.roster_date=p_business_date and r.entry_type='working';
   select jsonb_build_object('template_id',template.id,'series_id',template.series_id,'revision',template.revision,'name',template.name,'task_type',template.task_type,'schedule_type',template.schedule_type,'schedule_config',template.schedule_config,'priority',template.priority,'completion_rule',template.completion_rule,'assignment_type',template.assignment_type,'applicable_employee_ids',template.applicable_employee_ids,'applicable_positions',template.applicable_positions,'applicable_group_names',template.applicable_group_names,'on_duty_only',template.on_duty_only,'allow_exception',template.allow_exception,'exception_requires_reason',template.exception_requires_reason,'manager_review_required',template.manager_review_required,'allow_late_completion',template.allow_late_completion,'items',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'is_required',i.is_required,'sort_order',i.sort_order,'block_type',i.block_type,'block_config',i.block_config,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_snapshot) order by i.sort_order),'[]'::jsonb)) into snapshot from public.crew_operation_template_items i where i.template_id=template.id;
   insert into public.crew_operation_instances(template_id,template_series_id,template_revision,outlet_id,business_date,operation_type,name,applicable_role_ids,applicable_positions,available_from,available_until,template_snapshot,task_type,schedule_type,priority,completion_rule,assignment_type,applicable_employee_ids,applicable_group_names,on_duty_only,allow_exception,exception_requires_reason,manager_review_required,allow_late_completion)
   values(template.id,template.series_id,template.revision,template.outlet_id,p_business_date,template.operation_type,template.name,template.applicable_role_ids,template.applicable_positions,
     (p_business_date+coalesce(template.available_from,case template.schedule_config->>'shift_phase' when 'before_shift' then coalesce(shift_start,time '09:00')-interval '2 hours' else coalesce(shift_start,time '00:00') end)) at time zone 'Asia/Kuala_Lumpur',
     (p_business_date+coalesce(template.available_until,case template.schedule_config->>'shift_phase' when 'end_of_shift' then coalesce(shift_end,time '23:59') else time '23:59:59' end)) at time zone 'Asia/Kuala_Lumpur',snapshot,template.task_type,template.schedule_type,template.priority,template.completion_rule,template.assignment_type,template.applicable_employee_ids,template.applicable_group_names,template.on_duty_only,template.allow_exception,template.exception_requires_reason,template.manager_review_required,template.allow_late_completion)
   on conflict(template_id,business_date) do nothing returning id into instance_id;
   if instance_id is not null then
     insert into public.crew_operation_instance_items(instance_id,snapshot_item_id,title,description,is_required,sort_order,evidence_requirement,health_category,sop_reference,block_type,block_config)
     select instance_id,i.id,i.title,i.description,i.is_required,i.sort_order,i.evidence_requirement,i.health_category,i.sop_snapshot,i.block_type,i.block_config from public.crew_operation_template_items i where i.template_id=template.id order by i.sort_order;
     for employee in select e.* from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') loop
       if public.crew_tasks_employee_applies(template,employee,p_business_date) then insert into public.crew_task_instance_assignees(instance_id,employee_id) values(instance_id,employee.id) on conflict do nothing; end if;
     end loop;
   end if;
   instance_id:=null;
 end loop;
 update public.crew_daily_tasks set status='overdue',updated_at=now() where outlet_id=p_outlet_id and task_date=p_business_date and status='pending' and due_at<now();
end; $$;
revoke all on function public.crew_operations_ensure_instances(uuid,date) from public,anon,authenticated;

create or replace function public.crew_tasks_save(p_outlet_id uuid,p_task jsonb)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare mapped jsonb; item jsonb; mapped_items jsonb:='[]'::jsonb; task_id uuid; v_operation text; employee_ids uuid[]; group_names text[];
begin
 if not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Task management is unavailable for this outlet.'; end if;
 if jsonb_typeof(p_task)<>'object' or char_length(btrim(coalesce(p_task->>'name','')))<2 or jsonb_typeof(p_task->'blocks')<>'array' or jsonb_array_length(p_task->'blocks')=0 then raise exception using errcode='22023',message='Task name and at least one content block are required.'; end if;
 if coalesce(p_task->>'task_type','') not in ('checklist','instruction','health_check','confirmation','sop_review') or coalesce(p_task->>'schedule_type','') not in ('one_time','recurring','shift_based') then raise exception using errcode='22023',message='Task type or schedule is invalid.'; end if;
 if coalesce(p_task->>'assignment_type','') not in ('all_crew','position','specific_crew','group') or coalesce(p_task->>'priority','') not in ('normal','important','critical') or coalesce(p_task->>'completion_rule','') not in ('any_assigned','every_assigned','one_for_team') then raise exception using errcode='22023',message='Task assignment, priority or completion rule is invalid.'; end if;
 if p_task->>'assignment_type'='position' and jsonb_array_length(coalesce(p_task->'applicable_positions','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one position.'; end if;
 if p_task->>'assignment_type'='specific_crew' and jsonb_array_length(coalesce(p_task->'applicable_employee_ids','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one Crew employee.'; end if;
 if p_task->>'assignment_type'='group' and jsonb_array_length(coalesce(p_task->'applicable_group_names','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one Crew group.'; end if;
 if p_task->>'schedule_type'='recurring' and coalesce(p_task#>>'{schedule_config,frequency}','') not in ('every_day','specific_weekdays','weekly','monthly','custom_interval') then raise exception using errcode='22023',message='Recurring schedule is invalid.'; end if;
 if p_task#>>'{schedule_config,frequency}'='specific_weekdays' and jsonb_array_length(coalesce(p_task#>'{schedule_config,weekdays}','[]'::jsonb))=0 then raise exception using errcode='22023',message='Choose at least one weekday.'; end if;
 for item in select value from jsonb_array_elements(p_task->'blocks') loop
   if coalesce(item->>'block_type','') not in ('text','checklist_item','key_point','image','sop_reference','yes_no','single_choice','number','temperature','short_text','health_rating') then raise exception using errcode='22023',message='Task content block type is invalid.'; end if;
   if item->>'block_type'='image' then raise exception using errcode='0A000',message='Photo content remains disabled until the Operations media store is available.'; end if;
   if item->>'block_type'='sop_reference' and nullif(item->>'sop_version_id','') is null then raise exception using errcode='22023',message='Choose a published SOP for every SOP Reference block.'; end if;
   if item->>'block_type'='single_choice' and jsonb_array_length(coalesce(item#>'{config,options}','[]'::jsonb))<2 then raise exception using errcode='22023',message='Single Choice needs at least two options.'; end if;
   if item->>'block_type' in ('number','temperature') and nullif(item#>>'{config,min}','') is not null and nullif(item#>>'{config,max}','') is not null and (item#>>'{config,min}')::numeric>(item#>>'{config,max}')::numeric then raise exception using errcode='22023',message='Measurement minimum cannot exceed maximum.'; end if;
   mapped_items:=mapped_items||jsonb_build_array(jsonb_build_object('title',coalesce(nullif(btrim(item->>'title'),''),initcap(replace(item->>'block_type','_',' '))),'description',item->>'description','is_required',coalesce((item->>'is_required')::boolean,item->>'block_type' not in ('text','key_point','sop_reference')),'evidence_requirement',coalesce(item->>'evidence_requirement','none'),'health_category',case when item->>'block_type'='health_rating' then coalesce(item->>'health_category','front_of_house') end,'sop_version_id',coalesce(item->>'sop_version_id',''),'block_type',item->>'block_type','block_config',coalesce(item->'config','{}'::jsonb)));
 end loop;
 v_operation:=case p_task->>'task_type' when 'health_check' then 'health' else 'daily' end;
 mapped:=jsonb_build_object('id',p_task->>'id','series_id',p_task->>'series_id','name',p_task->>'name','operation_type',v_operation,'effective_date',coalesce(p_task->>'effective_date',timezone('Asia/Kuala_Lumpur',now())::date::text),'available_from',coalesce(p_task->>'start_time',''),'available_until',coalesce(p_task->>'due_time',''),'applicable_positions',coalesce(p_task->'applicable_positions','[]'::jsonb),'applicable_role_ids','[]'::jsonb,'items',mapped_items);
 task_id:=public.crew_operations_save_template(p_outlet_id,mapped);
 select coalesce(array_agg(value::uuid),'{}') into employee_ids from jsonb_array_elements_text(coalesce(p_task->'applicable_employee_ids','[]'::jsonb));
 select coalesce(array_agg(value),'{}') into group_names from jsonb_array_elements_text(coalesce(p_task->'applicable_group_names','[]'::jsonb));
 if p_task->>'assignment_type'='specific_crew' and exists(select 1 from unnest(employee_ids) employee_id where not exists(select 1 from public.crew_access ca join public.employees e on e.id=ca.employee_id where ca.employee_id=employee_id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated'))) then raise exception using errcode='22023',message='Specific Crew must belong to this outlet.'; end if;
 if p_task->>'assignment_type'='group' and exists(select 1 from unnest(group_names) group_name where lower(group_name) not in ('floor','kitchen','other')) then raise exception using errcode='22023',message='Crew group is invalid.'; end if;
 update public.crew_operation_templates set task_type=p_task->>'task_type',schedule_type=p_task->>'schedule_type',schedule_config=coalesce(p_task->'schedule_config','{}'::jsonb),assignment_type=coalesce(p_task->>'assignment_type','all_crew'),applicable_employee_ids=employee_ids,applicable_group_names=group_names,on_duty_only=coalesce((p_task->>'on_duty_only')::boolean,false),priority=coalesce(p_task->>'priority','normal'),completion_rule=coalesce(p_task->>'completion_rule','one_for_team'),allow_exception=coalesce((p_task->>'allow_exception')::boolean,true),exception_requires_reason=coalesce((p_task->>'exception_requires_reason')::boolean,true),manager_review_required=coalesce((p_task->>'manager_review_required')::boolean,false),allow_late_completion=coalesce((p_task->>'allow_late_completion')::boolean,true),updated_at=now() where id=task_id;
 update public.crew_operation_template_items i set block_type=x.block_type,block_config=x.config from (select (value->>'block_type') block_type,coalesce(value->'config','{}'::jsonb) config,(ordinality-1)::int sort_order from jsonb_array_elements(p_task->'blocks') with ordinality)x where i.template_id=task_id and i.sort_order=x.sort_order;
 return task_id;
end; $$;
revoke all on function public.crew_tasks_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_tasks_save(uuid,jsonb) to authenticated;

create or replace function public.crew_tasks_duplicate(p_template_id uuid)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare source public.crew_operation_templates%rowtype; target uuid;
begin
 select * into source from public.crew_operation_templates where id=p_template_id;
 if source.id is null or not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(source.outlet_id) then raise exception using errcode='42501',message='Task duplication is unavailable.'; end if;
 insert into public.crew_operation_templates(series_id,outlet_id,revision,name,operation_type,status,applicable_role_ids,applicable_positions,effective_date,available_from,available_until,created_by,task_type,schedule_type,schedule_config,assignment_type,applicable_employee_ids,applicable_group_names,on_duty_only,priority,completion_rule,allow_exception,exception_requires_reason,manager_review_required,allow_late_completion)
 values(gen_random_uuid(),source.outlet_id,1,source.name||' Copy',source.operation_type,'draft',source.applicable_role_ids,source.applicable_positions,source.effective_date,source.available_from,source.available_until,auth.uid(),source.task_type,source.schedule_type,source.schedule_config,source.assignment_type,source.applicable_employee_ids,source.applicable_group_names,source.on_duty_only,source.priority,source.completion_rule,source.allow_exception,source.exception_requires_reason,source.manager_review_required,source.allow_late_completion) returning id into target;
 insert into public.crew_operation_template_items(template_id,title,description,is_required,sort_order,evidence_requirement,health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config) select target,title,description,is_required,sort_order,evidence_requirement,health_category,sop_id,sop_version_id,sop_snapshot,block_type,block_config from public.crew_operation_template_items where template_id=source.id;
 return target;
end; $$;
revoke all on function public.crew_tasks_duplicate(uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_duplicate(uuid) to authenticated;

create or replace function public.crew_tasks_admin_data(p_outlet_id uuid,p_from date default timezone('Asia/Kuala_Lumpur',now())::date,p_to date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare definitions jsonb; instances jsonb; sops jsonb; employees jsonb; review_queue jsonb;
begin
 if not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Tasks are unavailable for this outlet.'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>92 then raise exception using errcode='22023',message='Choose a valid Task period of 93 days or fewer.'; end if;
 perform public.crew_operations_ensure_instances(p_outlet_id,d::date) from generate_series(p_from,p_to,interval '1 day')g(d);
 select coalesce(jsonb_agg((to_jsonb(t)-'created_by')||jsonb_build_object('blocks',coalesce((select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object('sop_reference',i.sop_snapshot,'config',i.block_config) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=t.id),'[]'::jsonb)) order by t.updated_at desc),'[]'::jsonb) into definitions from public.crew_operation_templates t where t.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg((to_jsonb(i)-'template_snapshot')||jsonb_build_object('assignee_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id),'completed_count',(select count(*) from public.crew_task_instance_assignees a where a.instance_id=i.id and a.status in ('completed','completed_with_exceptions'))) order by i.business_date,i.available_from,i.name),'[]'::jsonb) into instances from public.crew_operation_instances i where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to;
 select coalesce(jsonb_agg(jsonb_build_object('sop_id',s.id,'title',s.title,'version_id',v.id,'version',v.version) order by s.title),'[]'::jsonb) into sops from public.crew_sops s join lateral(select * from public.crew_sop_versions v where v.sop_id=s.id and v.status='published' order by v.version desc limit 1)v on true where s.outlet_id is null or s.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into employees from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 select coalesce(jsonb_agg(jsonb_build_object('instance_id',i.id,'employee_id',e.id,'task_name',i.name,'employee_name',e.full_name,'business_date',i.business_date,'status',a.status) order by i.business_date,e.full_name),'[]'::jsonb) into review_queue from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id join public.employees e on e.id=a.employee_id where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to and a.status='review_required';
 return jsonb_build_object('from',p_from,'to',p_to,'definitions',definitions,'instances',instances,'published_sops',sops,'employees',employees,'review_queue',review_queue);
end; $$;
revoke all on function public.crew_tasks_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_tasks_today(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; v_employee uuid; v_outlet uuid; v_position text; tasks jsonb; legacy jsonb; attendance jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid; v_outlet:=(ctx->>'outlet_id')::uuid; v_position:=ctx->>'position';
 perform public.crew_operations_ensure_instances(v_outlet,p_business_date);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source','instance','name',i.name,'task_type',i.task_type,'schedule_type',i.schedule_type,'priority',i.priority,'status',case when a.status='not_started' and i.available_until<now() then 'overdue' else a.status end,'available_from',i.available_from,'due_at',i.available_until,'completed_at',a.completed_at,'block_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and r.employee_id=v_employee and r.status not in ('not_checked')),'exception_count',(select count(*) from public.crew_task_item_responses r join public.crew_operation_instance_items x on x.id=r.instance_item_id where x.instance_id=i.id and r.employee_id=v_employee and r.status in ('exception','needs_attention'))) order by case i.priority when 'critical' then 1 when 'important' then 2 else 3 end,i.available_until,i.name),'[]'::jsonb) into tasks
 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee where i.outlet_id=v_outlet and i.business_date=p_business_date;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'source','legacy_daily','name',t.title,'description',t.description,'task_type','instruction','schedule_type','one_time','priority',case t.priority when 'high' then 'critical' when 'low' then 'normal' else 'normal' end,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'due_at',t.due_at,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by t.due_at nulls last,t.title),'[]'::jsonb) into legacy from public.crew_daily_tasks t where t.outlet_id=v_outlet and t.task_date=p_business_date and public.crew_operations_applicable(v_role,v_position,t.applicable_role_ids,t.applicable_positions);
 select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=v_employee and a.outlet_id=v_outlet and a.status='open')) into attendance;
 return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',v_outlet,'name',(select name from public.outlets where id=v_outlet)),'employee',jsonb_build_object('id',v_employee,'name',ctx->>'employee_name','position',v_position),'attendance_context',attendance,'tasks',tasks||legacy);
end; $$;
revoke all on function public.crew_tasks_today(text,date) from public,anon,authenticated;
grant execute on function public.crew_tasks_today(text,date) to anon,authenticated;

create or replace function public.crew_tasks_detail(p_token text,p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; v_employee uuid; instance public.crew_operation_instances%rowtype; blocks jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid;
 select i.* into instance from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee where i.id=p_instance_id;
 if instance.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid then raise exception using errcode='42501',message='Task is unavailable.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'block_type',i.block_type,'config',i.block_config,'required',i.is_required,'sort_order',i.sort_order,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_reference,'status',coalesce(r.status,nullif(i.status,'pending'),'pending'),'response',coalesce(r.response,i.evidence,'{}'::jsonb),'exception_reason',coalesce(r.exception_reason,i.exception_reason),'note',coalesce(r.note,i.note),'completed_at',coalesce(r.completed_at,i.completed_at)) order by i.sort_order),'[]'::jsonb) into blocks from public.crew_operation_instance_items i left join public.crew_task_item_responses r on r.instance_item_id=i.id and r.employee_id=v_employee where i.instance_id=instance.id;
 return jsonb_build_object('id',instance.id,'name',instance.name,'task_type',instance.task_type,'schedule_type',instance.schedule_type,'priority',instance.priority,'status',(select status from public.crew_task_instance_assignees where instance_id=instance.id and employee_id=v_employee),'available_from',instance.available_from,'due_at',instance.available_until,'allow_exception',instance.allow_exception,'exception_requires_reason',instance.exception_requires_reason,'manager_review_required',instance.manager_review_required,'completion_rule',instance.completion_rule,'blocks',blocks);
end; $$;
revoke all on function public.crew_tasks_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_detail(text,uuid) to anon,authenticated;

create or replace function public.crew_tasks_update_block(p_token text,p_block_id uuid,p_action text,p_response jsonb default '{}'::jsonb,p_reason text default null,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; v_employee uuid; block public.crew_operation_instance_items%rowtype; instance public.crew_operation_instances%rowtype; normalized text; numeric_value numeric; choices text[]; inserted_count integer;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid;
 select * into block from public.crew_operation_instance_items where id=p_block_id; select * into instance from public.crew_operation_instances where id=block.instance_id;
 if block.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not exists(select 1 from public.crew_task_instance_assignees a where a.instance_id=instance.id and a.employee_id=v_employee) then raise exception using errcode='42501',message='Task content is unavailable.'; end if;
 if now()<instance.available_from then raise exception using errcode='22023',message='This Task is not available yet.'; end if;
 if block.block_type in ('text','key_point','image','sop_reference') then raise exception using errcode='22023',message='This content block does not require a response.'; end if;
 if instance.completion_rule='one_for_team' and exists(select 1 from public.crew_task_item_responses r where r.instance_item_id=block.id and r.employee_id<>v_employee) then raise exception using errcode='55000',message='A teammate has already completed this item.'; end if;
 if p_action='exception' then
   if not instance.allow_exception then raise exception using errcode='22023',message='This Task does not allow exceptions.'; end if;
   if instance.exception_requires_reason and coalesce(p_reason,'') not in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other') then raise exception using errcode='22023',message='Choose an exception reason.'; end if;
   normalized:='exception';
 elsif block.block_type='health_rating' then
   if p_action not in ('good','needs_attention','not_checked') then raise exception using errcode='22023',message='Health rating is invalid.'; end if;
   if p_action='needs_attention' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required when attention is needed.'; end if; normalized:=p_action;
 elsif block.block_type in ('number','temperature') then
   begin numeric_value:=(p_response->>'value')::numeric; exception when others then raise exception using errcode='22023',message='A valid measurement is required.'; end;
   if (block.block_config ? 'min' and numeric_value<(block.block_config->>'min')::numeric) or (block.block_config ? 'max' and numeric_value>(block.block_config->>'max')::numeric) then
     if not instance.allow_exception then raise exception using errcode='22023',message='Measurement is outside the allowed range.'; end if;
   end if; normalized:='completed';
 elsif block.block_type='yes_no' then
   if coalesce(p_response->>'value','') not in ('yes','no') then raise exception using errcode='22023',message='Choose Yes or No.'; end if; normalized:='completed';
 elsif block.block_type='single_choice' then
   select coalesce(array_agg(value),'{}') into choices from jsonb_array_elements_text(coalesce(block.block_config->'options','[]'::jsonb));
   if not (p_response->>'value'=any(choices)) then raise exception using errcode='22023',message='Choose an available option.'; end if; normalized:='completed';
 elsif block.block_type='short_text' then
   if char_length(btrim(coalesce(p_response->>'value','')))<1 then raise exception using errcode='22023',message='A response is required.'; end if; normalized:='completed';
 else
   if p_action<>'completed' then raise exception using errcode='22023',message='Task action is invalid.'; end if;
   normalized:='completed';
 end if;
 if block.evidence_requirement='note' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required for this item.'; end if;
 insert into public.crew_task_item_responses(instance_item_id,employee_id,status,response,exception_reason,note,completed_at) values(block.id,v_employee,normalized,coalesce(p_response,'{}'::jsonb),case when normalized='exception' then p_reason end,nullif(btrim(p_note),''),now())
 on conflict(instance_item_id,employee_id) do nothing;
 get diagnostics inserted_count=row_count;
 update public.crew_task_instance_assignees a set status='in_progress',updated_at=now() where a.instance_id=instance.id and a.employee_id=v_employee and a.status='not_started';
 return jsonb_build_object('block_id',block.id,'status',(select status from public.crew_task_item_responses where instance_item_id=block.id and employee_id=v_employee),'idempotent',inserted_count=0);
end; $$;
revoke all on function public.crew_tasks_update_block(text,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.crew_tasks_update_block(text,uuid,text,jsonb,text,text) to anon,authenticated;

create or replace function public.crew_tasks_complete(p_token text,p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; v_employee uuid; instance public.crew_operation_instances%rowtype; final_status text; has_exception boolean;
begin
 ctx:=public.crew_operations_employee_context(p_token); v_employee:=(ctx->>'employee_id')::uuid; select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 if instance.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id and employee_id=v_employee) then raise exception using errcode='42501',message='Task is unavailable.'; end if;
 if now()>instance.available_until and not instance.allow_late_completion then raise exception using errcode='22023',message='This Task can no longer be completed.'; end if;
 if exists(select 1 from public.crew_operation_instance_items i where i.instance_id=instance.id and i.is_required and i.block_type not in ('text','key_point','image','sop_reference') and not exists(select 1 from public.crew_task_item_responses r where r.instance_item_id=i.id and r.employee_id=v_employee and r.status not in ('not_checked'))) then raise exception using errcode='22023',message='Complete every required Task item first.'; end if;
 select exists(select 1 from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=instance.id and r.employee_id=v_employee and r.status in ('exception','needs_attention')) into has_exception;
 final_status:=case when instance.manager_review_required then 'review_required' when has_exception then 'completed_with_exceptions' else 'completed' end;
 update public.crew_task_instance_assignees set status=final_status,completed_at=case when final_status<>'review_required' then now() end,updated_at=now() where instance_id=instance.id and employee_id=v_employee;
 if instance.completion_rule in ('any_assigned','one_for_team') and final_status<>'review_required' then
   update public.crew_task_instance_assignees set status=final_status,completed_at=coalesce(completed_at,now()),updated_at=now() where instance_id=instance.id and employee_id<>v_employee and status in ('not_started','in_progress');
 end if;
 if (instance.completion_rule in ('any_assigned','one_for_team') and final_status<>'review_required') or not exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id and status not in ('completed','completed_with_exceptions')) then update public.crew_operation_instances set status=case when has_exception then 'completed_with_exceptions' else 'completed' end,completed_at=now(),updated_at=now() where id=instance.id; end if;
 return jsonb_build_object('id',instance.id,'status',final_status,'completed_at',case when final_status<>'review_required' then now() end);
end; $$;
revoke all on function public.crew_tasks_complete(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_complete(text,uuid) to anon,authenticated;

create or replace function public.crew_tasks_review(p_instance_id uuid,p_employee_id uuid,p_decision text,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare instance public.crew_operation_instances%rowtype; assignee public.crew_task_instance_assignees%rowtype; approved_status text; has_exception boolean;
begin
 select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 select * into assignee from public.crew_task_instance_assignees where instance_id=p_instance_id and employee_id=p_employee_id for update;
 if instance.id is null or assignee.instance_id is null or assignee.status<>'review_required' or p_decision not in ('approved','changes_required') or not public.current_user_has_permission('crew_operations.review') or not public.current_user_can_access_outlet(instance.outlet_id) then raise exception using errcode='42501',message='Task review is unavailable.'; end if;
 if p_decision='changes_required' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='Explain the required changes.'; end if;
 select exists(select 1 from public.crew_task_item_responses r join public.crew_operation_instance_items i on i.id=r.instance_item_id where i.instance_id=instance.id and r.employee_id=p_employee_id and r.status in ('exception','needs_attention')) into has_exception;
 approved_status:=case when has_exception then 'completed_with_exceptions' else 'completed' end;
 insert into public.crew_task_reviews(instance_id,employee_id,decision,note,reviewed_by) values(instance.id,p_employee_id,p_decision,nullif(btrim(p_note),''),auth.uid());
 update public.crew_task_instance_assignees set status=case when p_decision='approved' then approved_status else 'in_progress' end,completed_at=case when p_decision='approved' then now() end,updated_at=now() where instance_id=instance.id and employee_id=p_employee_id;
 if p_decision='approved' and instance.completion_rule in ('any_assigned','one_for_team') then update public.crew_task_instance_assignees set status=approved_status,completed_at=coalesce(completed_at,now()),updated_at=now() where instance_id=instance.id and status in ('not_started','in_progress','review_required'); end if;
 if p_decision='approved' and (instance.completion_rule in ('any_assigned','one_for_team') or not exists(select 1 from public.crew_task_instance_assignees where instance_id=instance.id and status not in ('completed','completed_with_exceptions'))) then update public.crew_operation_instances set status=approved_status,completed_at=now(),updated_at=now() where id=instance.id; end if;
 return jsonb_build_object('instance_id',instance.id,'employee_id',p_employee_id,'decision',p_decision,'status',case when p_decision='approved' then approved_status else 'in_progress' end);
end; $$;
revoke all on function public.crew_tasks_review(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_tasks_review(uuid,uuid,text,text) to authenticated;

-- Keep legacy Admin/Crew authorities available for route and historical-data compatibility.
-- New UI uses the unified Task authorities above; old rows are never destructively migrated.
