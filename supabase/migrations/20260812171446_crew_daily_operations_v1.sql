-- FeedX Crew Daily Operations v1
-- Outlet-scoped, versioned checklist templates; immutable daily snapshots;
-- token-bound Crew execution; and permission-scoped Admin read/write authorities.

insert into public.permissions(code,module,description) values
 ('crew_operations.view','Crew Operations','View outlet-scoped Daily Operations and execution history.'),
 ('crew_operations.manage','Crew Operations','Manage checklist templates and daily tasks.'),
 ('crew_operations.review','Crew Operations','Review exceptions and Store Health results.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin')
  and p.code in ('crew_operations.view','crew_operations.manage','crew_operations.review')
on conflict do nothing;

create table public.crew_operation_templates (
 id uuid primary key default gen_random_uuid(),
 series_id uuid not null default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 revision integer not null default 1 check(revision>0),
 name text not null check(char_length(btrim(name)) between 2 and 120),
 operation_type text not null check(operation_type in ('opening','closing','daily','health')),
 status text not null default 'draft' check(status in ('draft','active','archived')),
 applicable_role_ids uuid[] not null default '{}',
 applicable_positions text[] not null default '{}',
 effective_date date not null default current_date,
 available_from time,
 available_until time,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 activated_at timestamptz,
 archived_at timestamptz,
 unique(series_id,revision),
 check(available_from is null or available_until is null or available_from<available_until)
);

create table public.crew_operation_template_items (
 id uuid primary key default gen_random_uuid(),
 template_id uuid not null references public.crew_operation_templates(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 2 and 160),
 description text,
 is_required boolean not null default true,
 sort_order integer not null check(sort_order>=0),
 evidence_requirement text not null default 'none' check(evidence_requirement in ('none','note','photo')),
 health_category text check(health_category is null or health_category in ('front_of_house','cleanliness','equipment','safety','stock_setup')),
 sop_id uuid references public.crew_sops(id) on delete restrict,
 sop_version_id uuid references public.crew_sop_versions(id) on delete restrict,
 sop_snapshot jsonb,
 unique(template_id,sort_order),
 check((sop_id is null and sop_version_id is null and sop_snapshot is null) or (sop_id is not null and sop_version_id is not null and sop_snapshot is not null))
);

create table public.crew_operation_instances (
 id uuid primary key default gen_random_uuid(),
 template_id uuid not null references public.crew_operation_templates(id) on delete restrict,
 template_series_id uuid not null,
 template_revision integer not null,
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 business_date date not null,
 operation_type text not null check(operation_type in ('opening','closing','daily','health')),
 name text not null,
 applicable_role_ids uuid[] not null default '{}',
 applicable_positions text[] not null default '{}',
 available_from timestamptz,
 available_until timestamptz,
 status text not null default 'not_started' check(status in ('not_started','in_progress','completed','completed_with_exceptions','overdue')),
 template_snapshot jsonb not null,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(template_id,business_date)
);

create table public.crew_operation_instance_items (
 id uuid primary key default gen_random_uuid(),
 instance_id uuid not null references public.crew_operation_instances(id) on delete restrict,
 snapshot_item_id uuid not null,
 title text not null,
 description text,
 is_required boolean not null,
 sort_order integer not null,
 evidence_requirement text not null,
 health_category text,
 sop_reference jsonb,
 status text not null default 'pending' check(status in ('pending','completed','exception','good','needs_attention','not_checked')),
 exception_reason text check(exception_reason is null or exception_reason in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other')),
 note text,
 evidence jsonb,
 completed_by uuid references public.employees(id) on delete restrict,
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(instance_id,snapshot_item_id)
);

create table public.crew_daily_tasks (
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 task_date date not null,
 title text not null check(char_length(btrim(title)) between 2 and 160),
 description text,
 applicable_role_ids uuid[] not null default '{}',
 applicable_positions text[] not null default '{}',
 priority text not null default 'normal' check(priority in ('low','normal','high')),
 due_at timestamptz,
 sop_id uuid references public.crew_sops(id) on delete restrict,
 sop_version_id uuid references public.crew_sop_versions(id) on delete restrict,
 sop_snapshot jsonb,
 status text not null default 'pending' check(status in ('pending','completed','exception','overdue')),
 exception_reason text check(exception_reason is null or exception_reason in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other')),
 note text,
 completed_by uuid references public.employees(id) on delete restrict,
 completed_at timestamptz,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((sop_id is null and sop_version_id is null and sop_snapshot is null) or (sop_id is not null and sop_version_id is not null and sop_snapshot is not null))
);

create index crew_operation_templates_outlet_status_idx on public.crew_operation_templates(outlet_id,status,operation_type);
create index crew_operation_template_items_template_idx on public.crew_operation_template_items(template_id,sort_order);
create index crew_operation_instances_outlet_date_idx on public.crew_operation_instances(outlet_id,business_date,status);
create index crew_operation_instance_items_instance_idx on public.crew_operation_instance_items(instance_id,sort_order,status);
create index crew_operation_instance_items_employee_idx on public.crew_operation_instance_items(completed_by,completed_at desc);
create index crew_daily_tasks_outlet_date_idx on public.crew_daily_tasks(outlet_id,task_date,status,priority);

alter table public.crew_operation_templates enable row level security;
alter table public.crew_operation_template_items enable row level security;
alter table public.crew_operation_instances enable row level security;
alter table public.crew_operation_instance_items enable row level security;
alter table public.crew_daily_tasks enable row level security;
revoke all on public.crew_operation_templates,public.crew_operation_template_items,public.crew_operation_instances,public.crew_operation_instance_items,public.crew_daily_tasks from public,anon,authenticated;
grant select,insert,update,delete on public.crew_operation_templates,public.crew_operation_template_items,public.crew_operation_instances,public.crew_operation_instance_items,public.crew_daily_tasks to service_role;

create or replace function public.crew_operations_template_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='crew_operation_templates' and old.status<>'draft' then
   raise exception using errcode='55000',message='Active and archived checklist revisions are immutable.';
 end if;
 if tg_table_name='crew_operation_template_items' and exists(select 1 from public.crew_operation_templates t where t.id=old.template_id and t.status<>'draft') then
   raise exception using errcode='55000',message='Active and archived checklist items are immutable.';
 end if;
 return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.crew_operations_template_guard() from public,anon,authenticated;
create trigger crew_operation_template_immutable before update or delete on public.crew_operation_templates for each row execute function public.crew_operations_template_guard();
create trigger crew_operation_template_item_immutable before update or delete on public.crew_operation_template_items for each row execute function public.crew_operations_template_guard();

create or replace function public.crew_operations_employee_context(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee_id uuid; employee public.employees%rowtype; access public.crew_access%rowtype;
begin
 employee_id:=public.crew_session_employee(p_token);
 select * into employee from public.employees where id=employee_id and is_active and coalesce(employment_status,'active') not in ('resigned','terminated');
 select * into access from public.crew_access where employee_id=employee.id and access_state='active';
 if employee.id is null or access.employee_id is null then raise exception using errcode='42501',message='Crew Operations access is unavailable.'; end if;
 return jsonb_build_object('employee_id',employee.id,'employee_name',employee.full_name,'position',employee.position,'role_id',employee.role_id,'outlet_id',access.primary_outlet_id);
end; $$;
revoke all on function public.crew_operations_employee_context(text) from public,anon,authenticated;

create or replace function public.crew_operations_applicable(p_role_id uuid,p_position text,p_roles uuid[],p_positions text[])
returns boolean language sql immutable set search_path=public as $$
 select (coalesce(cardinality(p_roles),0)=0 or p_role_id=any(p_roles))
    and (coalesce(cardinality(p_positions),0)=0 or lower(coalesce(p_position,''))=any(select lower(x) from unnest(p_positions) x));
$$;
revoke all on function public.crew_operations_applicable(uuid,text,uuid[],text[]) from public,anon,authenticated;

create or replace function public.crew_operations_save_template(p_outlet_id uuid,p_template jsonb)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare v_template_id uuid; series uuid; next_revision int; item jsonb; item_order int:=0; v_sop_id uuid; v_sop_version_id uuid; v_sop_title text; v_sop_version int; positions text[]; role_ids uuid[];
begin
 if not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Checklist management is unavailable for this outlet.'; end if;
 if jsonb_typeof(p_template)<>'object' or jsonb_typeof(p_template->'items')<>'array' or jsonb_array_length(p_template->'items')=0 then raise exception using errcode='22023',message='A checklist with at least one item is required.'; end if;
 if coalesce(p_template->>'operation_type','') not in ('opening','closing','daily','health') then raise exception using errcode='22023',message='Checklist type is invalid.'; end if;
 select coalesce(array_agg(value), '{}') into positions from jsonb_array_elements_text(coalesce(p_template->'applicable_positions','[]'::jsonb));
 select coalesce(array_agg(value::uuid), '{}') into role_ids from jsonb_array_elements_text(coalesce(p_template->'applicable_role_ids','[]'::jsonb));
 if nullif(p_template->>'id','') is not null then
   v_template_id:=(p_template->>'id')::uuid;
   update public.crew_operation_templates set name=btrim(p_template->>'name'),operation_type=p_template->>'operation_type',applicable_role_ids=role_ids,applicable_positions=positions,effective_date=coalesce((p_template->>'effective_date')::date,current_date),available_from=nullif(p_template->>'available_from','')::time,available_until=nullif(p_template->>'available_until','')::time,updated_at=now()
   where id=v_template_id and outlet_id=p_outlet_id and status='draft';
   if not found then raise exception using errcode='42501',message='Only an outlet-scoped Draft checklist can be edited.'; end if;
   delete from public.crew_operation_template_items i where i.template_id=v_template_id;
 else
   series:=coalesce(nullif(p_template->>'series_id','')::uuid,gen_random_uuid());
   select coalesce(max(revision),0)+1 into next_revision from public.crew_operation_templates where series_id=series;
   insert into public.crew_operation_templates(series_id,outlet_id,revision,name,operation_type,applicable_role_ids,applicable_positions,effective_date,available_from,available_until,created_by)
   values(series,p_outlet_id,next_revision,btrim(p_template->>'name'),p_template->>'operation_type',role_ids,positions,coalesce((p_template->>'effective_date')::date,current_date),nullif(p_template->>'available_from','')::time,nullif(p_template->>'available_until','')::time,auth.uid()) returning id into v_template_id;
 end if;
 for item in select value from jsonb_array_elements(p_template->'items') loop
   if char_length(btrim(coalesce(item->>'title','')))<2 then raise exception using errcode='22023',message='Every checklist item needs a title.'; end if;
   if coalesce(item->>'evidence_requirement','none')='photo' then raise exception using errcode='0A000',message='Photo evidence is not available until a dedicated Operations evidence store is enabled.'; end if;
   v_sop_id:=null; v_sop_version_id:=null; v_sop_title:=null; v_sop_version:=null;
   if nullif(item->>'sop_version_id','') is not null then
     select s.id,v.id,s.title,v.version into v_sop_id,v_sop_version_id,v_sop_title,v_sop_version from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id
     where v.id=(item->>'sop_version_id')::uuid and v.status='published' and (s.outlet_id is null or s.outlet_id=p_outlet_id);
     if v_sop_version_id is null then raise exception using errcode='22023',message='SOP reference must use a published version from this outlet.'; end if;
   end if;
   insert into public.crew_operation_template_items(template_id,title,description,is_required,sort_order,evidence_requirement,health_category,sop_id,sop_version_id,sop_snapshot)
   values(v_template_id,btrim(item->>'title'),nullif(btrim(item->>'description'),''),coalesce((item->>'is_required')::boolean,true),item_order,coalesce(item->>'evidence_requirement','none'),case when (p_template->>'operation_type')='health' then coalesce(item->>'health_category','front_of_house') else null end,v_sop_id,v_sop_version_id,case when v_sop_version_id is null then null else jsonb_build_object('sop_id',v_sop_id,'sop_version_id',v_sop_version_id,'title',v_sop_title,'version',v_sop_version) end);
   item_order:=item_order+1;
 end loop;
 return v_template_id;
end; $$;
revoke all on function public.crew_operations_save_template(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_operations_save_template(uuid,jsonb) to authenticated;

create or replace function public.crew_operations_activate_template(p_template_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_operation_templates%rowtype;
begin
 select * into row from public.crew_operation_templates where id=p_template_id for update;
 if row.id is null or row.status<>'draft' or not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Draft checklist activation is unavailable.'; end if;
 if not exists(select 1 from public.crew_operation_template_items where template_id=row.id) then raise exception using errcode='22023',message='Checklist needs at least one item.'; end if;
 perform set_config('feedx.operation_lifecycle','activate',true);
 update public.crew_operation_templates set status='archived',archived_at=now() where series_id=row.series_id and status='active';
 update public.crew_operation_templates set status='active',activated_at=now(),updated_at=now() where id=row.id returning * into row;
 perform set_config('feedx.operation_lifecycle','',true);
 return jsonb_build_object('id',row.id,'status',row.status,'revision',row.revision,'activated_at',row.activated_at);
end; $$;
revoke all on function public.crew_operations_activate_template(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_activate_template(uuid) to authenticated;

create or replace function public.crew_operations_archive_template(p_template_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare row public.crew_operation_templates%rowtype;
begin
 select * into row from public.crew_operation_templates where id=p_template_id for update;
 if row.id is null or row.status<>'active' or not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Checklist archive is unavailable.'; end if;
 -- Bypass the immutable guard only through a session-local flag read by the trigger.
 perform set_config('feedx.operation_lifecycle','archive',true);
 update public.crew_operation_templates set status='archived',archived_at=now(),updated_at=now() where id=row.id returning * into row;
 perform set_config('feedx.operation_lifecycle','',true);
 return jsonb_build_object('id',row.id,'status',row.status,'archived_at',row.archived_at);
end; $$;
revoke all on function public.crew_operations_archive_template(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_archive_template(uuid) to authenticated;

-- Allow controlled lifecycle authorities to transition non-draft revisions while
-- still rejecting ordinary mutations of immutable revisions.
create or replace function public.crew_operations_template_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 if current_setting('feedx.operation_lifecycle',true) in ('activate','archive') then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='crew_operation_templates' and old.status<>'draft' then raise exception using errcode='55000',message='Active and archived checklist revisions are immutable.'; end if;
 if tg_table_name='crew_operation_template_items' and exists(select 1 from public.crew_operation_templates t where t.id=old.template_id and t.status<>'draft') then raise exception using errcode='55000',message='Active and archived checklist items are immutable.'; end if;
 return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.crew_operations_ensure_instances(p_outlet_id uuid,p_business_date date)
returns void language plpgsql volatile security definer set search_path=public as $$
declare template record; instance_id uuid; snapshot jsonb;
begin
 for template in select * from public.crew_operation_templates where outlet_id=p_outlet_id and status='active' and effective_date<=p_business_date loop
   select jsonb_build_object('template_id',template.id,'series_id',template.series_id,'revision',template.revision,'name',template.name,'operation_type',template.operation_type,'items',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'is_required',i.is_required,'sort_order',i.sort_order,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_snapshot) order by i.sort_order),'[]'::jsonb)) into snapshot
   from public.crew_operation_template_items i where i.template_id=template.id;
   insert into public.crew_operation_instances(template_id,template_series_id,template_revision,outlet_id,business_date,operation_type,name,applicable_role_ids,applicable_positions,available_from,available_until,template_snapshot)
   values(template.id,template.series_id,template.revision,template.outlet_id,p_business_date,template.operation_type,template.name,template.applicable_role_ids,template.applicable_positions,case when template.available_from is null then p_business_date::timestamp at time zone 'Asia/Kuala_Lumpur' else (p_business_date+template.available_from) at time zone 'Asia/Kuala_Lumpur' end,case when template.available_until is null then ((p_business_date+1)::timestamp at time zone 'Asia/Kuala_Lumpur')-interval '1 second' else (p_business_date+template.available_until) at time zone 'Asia/Kuala_Lumpur' end,snapshot)
   on conflict(template_id,business_date) do nothing returning id into instance_id;
   if instance_id is not null then
     insert into public.crew_operation_instance_items(instance_id,snapshot_item_id,title,description,is_required,sort_order,evidence_requirement,health_category,sop_reference)
     select instance_id,i.id,i.title,i.description,i.is_required,i.sort_order,i.evidence_requirement,i.health_category,i.sop_snapshot from public.crew_operation_template_items i where i.template_id=template.id order by i.sort_order;
   end if;
   instance_id:=null;
 end loop;
 update public.crew_daily_tasks set status='overdue',updated_at=now() where outlet_id=p_outlet_id and task_date=p_business_date and status='pending' and due_at<now();
end; $$;
revoke all on function public.crew_operations_ensure_instances(uuid,date) from public,anon,authenticated;

create or replace function public.crew_operations_refresh_instance(p_instance_id uuid)
returns text language plpgsql volatile security definer set search_path=public as $$
declare next_status text; instance public.crew_operation_instances%rowtype; required_pending int; touched int; exceptions int;
begin
 select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 select count(*) filter(where is_required and status in ('pending','not_checked')),count(*) filter(where status<>'pending'),count(*) filter(where status in ('exception','needs_attention')) into required_pending,touched,exceptions from public.crew_operation_instance_items where instance_id=p_instance_id;
 next_status:=case when required_pending=0 then case when exceptions>0 then 'completed_with_exceptions' else 'completed' end when instance.available_until<now() then 'overdue' when touched>0 then 'in_progress' else 'not_started' end;
 update public.crew_operation_instances set status=next_status,completed_at=case when next_status in ('completed','completed_with_exceptions') then coalesce(completed_at,now()) else null end,updated_at=now() where id=p_instance_id;
 return next_status;
end; $$;
revoke all on function public.crew_operations_refresh_instance(uuid) from public,anon,authenticated;

create or replace function public.crew_operations_today(p_token text,p_business_date date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; outlet uuid; employee uuid; role_id uuid; position text; instances jsonb; tasks jsonb; shift jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); outlet:=(ctx->>'outlet_id')::uuid; employee:=(ctx->>'employee_id')::uuid; role_id:=nullif(ctx->>'role_id','')::uuid; position:=ctx->>'position';
 perform public.crew_operations_ensure_instances(outlet,p_business_date);
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'type',i.operation_type,'status',public.crew_operations_refresh_instance(i.id),'available_from',i.available_from,'available_until',i.available_until,'completed_at',i.completed_at,'item_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id),'completed_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status not in ('pending','not_checked')),'exception_count',(select count(*) from public.crew_operation_instance_items x where x.instance_id=i.id and x.status in ('exception','needs_attention'))) order by case i.operation_type when 'opening' then 1 when 'daily' then 2 when 'health' then 3 else 4 end,i.name),'[]'::jsonb) into instances
 from public.crew_operation_instances i where i.outlet_id=outlet and i.business_date=p_business_date and public.crew_operations_applicable(role_id,position,i.applicable_role_ids,i.applicable_positions);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'priority',t.priority,'due_at',t.due_at,'status',case when t.status='pending' and t.due_at<now() then 'overdue' else t.status end,'sop_reference',t.sop_snapshot,'completed_at',t.completed_at) order by case t.priority when 'high' then 1 when 'normal' then 2 else 3 end,t.due_at nulls last,t.title),'[]'::jsonb) into tasks
 from public.crew_daily_tasks t where t.outlet_id=outlet and t.task_date=p_business_date and public.crew_operations_applicable(role_id,position,t.applicable_role_ids,t.applicable_positions);
 select jsonb_build_object('on_shift',exists(select 1 from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open'),'clock_in_at',(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=employee and a.outlet_id=outlet and a.status='open')) into shift;
 return jsonb_build_object('date',p_business_date,'outlet',jsonb_build_object('id',outlet,'name',(select name from public.outlets where id=outlet)),'employee',jsonb_build_object('id',employee,'name',ctx->>'employee_name','position',position),'attendance_context',shift,'checklists',instances,'daily_tasks',tasks);
end; $$;
revoke all on function public.crew_operations_today(text,date) from public,anon,authenticated;
grant execute on function public.crew_operations_today(text,date) to anon,authenticated;

create or replace function public.crew_operations_detail(p_token text,p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; instance public.crew_operation_instances%rowtype; items jsonb;
begin
 ctx:=public.crew_operations_employee_context(p_token); select * into instance from public.crew_operation_instances where id=p_instance_id;
 if instance.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist is unavailable.'; end if;
 perform public.crew_operations_refresh_instance(instance.id); select * into instance from public.crew_operation_instances where id=instance.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'required',i.is_required,'sort_order',i.sort_order,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,'sop_reference',i.sop_reference,'status',i.status,'exception_reason',i.exception_reason,'note',i.note,'completed_by',case when e.id is null then null else jsonb_build_object('id',e.id,'name',e.full_name) end,'completed_at',i.completed_at) order by i.sort_order),'[]'::jsonb) into items from public.crew_operation_instance_items i left join public.employees e on e.id=i.completed_by where i.instance_id=instance.id;
 return jsonb_build_object('id',instance.id,'name',instance.name,'type',instance.operation_type,'date',instance.business_date,'status',instance.status,'available_from',instance.available_from,'available_until',instance.available_until,'items',items);
end; $$;
revoke all on function public.crew_operations_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_detail(text,uuid) to anon,authenticated;

create or replace function public.crew_operations_update_item(p_token text,p_item_id uuid,p_action text,p_reason text default null,p_note text default null,p_evidence jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; item public.crew_operation_instance_items%rowtype; instance public.crew_operation_instances%rowtype; employee uuid; next_status text;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid;
 select * into item from public.crew_operation_instance_items where id=p_item_id for update; select * into instance from public.crew_operation_instances where id=item.instance_id;
 if item.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist item is unavailable.'; end if;
 if now()<instance.available_from then raise exception using errcode='22023',message='This checklist is not available yet.'; end if;
 if p_evidence is not null then raise exception using errcode='0A000',message='Photo evidence is not enabled for Daily Operations v1.'; end if;
 if instance.operation_type='health' then
   if p_action not in ('good','needs_attention','not_checked') then raise exception using errcode='22023',message='Health Check result is invalid.'; end if;
   if p_action='needs_attention' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required when an area needs attention.'; end if;
 else
   if p_action not in ('completed','exception') then raise exception using errcode='22023',message='Checklist action is invalid.'; end if;
   if p_action='exception' and coalesce(p_reason,'') not in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other') then raise exception using errcode='22023',message='Choose a reason for Unable to Complete.'; end if;
   if item.evidence_requirement='note' and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='A note is required for this item.'; end if;
 end if;
 if item.status not in ('pending','not_checked') then next_status:=public.crew_operations_refresh_instance(instance.id); return jsonb_build_object('item_id',item.id,'status',item.status,'instance_status',next_status,'completed_by',item.completed_by,'completed_at',item.completed_at,'idempotent',true); end if;
 update public.crew_operation_instance_items set status=p_action,exception_reason=case when p_action='exception' then p_reason else null end,note=nullif(btrim(p_note),''),evidence=null,completed_by=employee,completed_at=now(),updated_at=now() where id=item.id;
 next_status:=public.crew_operations_refresh_instance(instance.id);
 return jsonb_build_object('item_id',item.id,'status',p_action,'instance_status',next_status,'completed_by',employee,'completed_at',now(),'idempotent',false);
end; $$;
revoke all on function public.crew_operations_update_item(text,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_operations_update_item(text,uuid,text,text,text,jsonb) to anon,authenticated;

create or replace function public.crew_operations_complete_checklist(p_token text,p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; instance public.crew_operation_instances%rowtype; next_status text;
begin
 ctx:=public.crew_operations_employee_context(p_token); select * into instance from public.crew_operation_instances where id=p_instance_id for update;
 if instance.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',instance.applicable_role_ids,instance.applicable_positions) then raise exception using errcode='42501',message='Checklist is unavailable.'; end if;
 if exists(select 1 from public.crew_operation_instance_items where instance_id=instance.id and is_required and status in ('pending','not_checked')) then raise exception using errcode='22023',message='Complete every required item before finishing this checklist.'; end if;
 next_status:=public.crew_operations_refresh_instance(instance.id);
 return jsonb_build_object('id',instance.id,'status',next_status,'completed_at',(select completed_at from public.crew_operation_instances where id=instance.id));
end; $$;
revoke all on function public.crew_operations_complete_checklist(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_complete_checklist(text,uuid) to anon,authenticated;

create or replace function public.crew_operations_save_daily_task(p_outlet_id uuid,p_task jsonb)
returns uuid language plpgsql volatile security definer set search_path=public as $$
declare task_id uuid; v_sop_id uuid; v_sop_version_id uuid; v_sop_title text; v_sop_version int; positions text[]; role_ids uuid[];
begin
 if not public.current_user_has_permission('crew_operations.manage') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Daily Task management is unavailable.'; end if;
 if char_length(btrim(coalesce(p_task->>'title','')))<2 then raise exception using errcode='22023',message='Task title is required.'; end if;
 select coalesce(array_agg(value), '{}') into positions from jsonb_array_elements_text(coalesce(p_task->'applicable_positions','[]'::jsonb));
 select coalesce(array_agg(value::uuid), '{}') into role_ids from jsonb_array_elements_text(coalesce(p_task->'applicable_role_ids','[]'::jsonb));
 if nullif(p_task->>'sop_version_id','') is not null then select s.id,v.id,s.title,v.version into v_sop_id,v_sop_version_id,v_sop_title,v_sop_version from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id where v.id=(p_task->>'sop_version_id')::uuid and v.status='published' and (s.outlet_id is null or s.outlet_id=p_outlet_id); if v_sop_version_id is null then raise exception using errcode='22023',message='SOP reference is unavailable.'; end if; end if;
 insert into public.crew_daily_tasks(outlet_id,task_date,title,description,applicable_role_ids,applicable_positions,priority,due_at,sop_id,sop_version_id,sop_snapshot,created_by)
 values(p_outlet_id,coalesce((p_task->>'task_date')::date,current_date),btrim(p_task->>'title'),nullif(btrim(p_task->>'description'),''),role_ids,positions,coalesce(p_task->>'priority','normal'),nullif(p_task->>'due_at','')::timestamptz,v_sop_id,v_sop_version_id,case when v_sop_version_id is null then null else jsonb_build_object('sop_id',v_sop_id,'sop_version_id',v_sop_version_id,'title',v_sop_title,'version',v_sop_version) end,auth.uid()) returning id into task_id;
 return task_id;
end; $$;
revoke all on function public.crew_operations_save_daily_task(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_operations_save_daily_task(uuid,jsonb) to authenticated;

create or replace function public.crew_operations_update_daily_task(p_token text,p_task_id uuid,p_action text,p_reason text default null,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; task public.crew_daily_tasks%rowtype; employee uuid;
begin
 ctx:=public.crew_operations_employee_context(p_token); employee:=(ctx->>'employee_id')::uuid; select * into task from public.crew_daily_tasks where id=p_task_id for update;
 if task.id is null or task.outlet_id<>(ctx->>'outlet_id')::uuid or not public.crew_operations_applicable(nullif(ctx->>'role_id','')::uuid,ctx->>'position',task.applicable_role_ids,task.applicable_positions) then raise exception using errcode='42501',message='Daily Task is unavailable.'; end if;
 if p_action not in ('completed','exception') then raise exception using errcode='22023',message='Daily Task action is invalid.'; end if;
 if p_action='exception' and coalesce(p_reason,'') not in ('equipment_issue','stock_unavailable','area_unavailable','manager_instruction','other') then raise exception using errcode='22023',message='Choose an exception reason.'; end if;
 if task.status in ('completed','exception') then return jsonb_build_object('id',task.id,'status',task.status,'completed_by',task.completed_by,'completed_at',task.completed_at,'idempotent',true); end if;
 update public.crew_daily_tasks set status=p_action,exception_reason=case when p_action='exception' then p_reason else null end,note=nullif(btrim(p_note),''),completed_by=employee,completed_at=now(),updated_at=now() where id=task.id;
 return jsonb_build_object('id',task.id,'status',p_action,'completed_by',employee,'completed_at',now());
end; $$;
revoke all on function public.crew_operations_update_daily_task(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crew_operations_update_daily_task(text,uuid,text,text,text) to anon,authenticated;

create or replace function public.crew_operations_admin_data(p_outlet_id uuid,p_business_date date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare templates jsonb; instances jsonb; tasks jsonb; activity jsonb; summary jsonb; sops jsonb;
begin
 if not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Daily Operations is unavailable for this outlet.'; end if;
 perform public.crew_operations_ensure_instances(p_outlet_id,p_business_date);
 perform public.crew_operations_refresh_instance(id) from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=p_business_date;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=t.id),'[]'::jsonb)) order by t.updated_at desc),'[]'::jsonb) into templates from public.crew_operation_templates t where t.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(to_jsonb(i) order by case i.operation_type when 'opening' then 1 when 'daily' then 2 when 'health' then 3 else 4 end,i.name),'[]'::jsonb) into instances from public.crew_operation_instances i where i.outlet_id=p_outlet_id and i.business_date=p_business_date;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('completed_by_name',e.full_name) order by t.created_at),'[]'::jsonb) into tasks from public.crew_daily_tasks t left join public.employees e on e.id=t.completed_by where t.outlet_id=p_outlet_id and t.task_date=p_business_date;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'instance_id',x.id,'checklist',x.name,'item',i.title,'status',i.status,'reason',i.exception_reason,'note',i.note,'employee',e.full_name,'completed_at',i.completed_at) order by i.completed_at desc),'[]'::jsonb) into activity from public.crew_operation_instance_items i join public.crew_operation_instances x on x.id=i.instance_id left join public.employees e on e.id=i.completed_by where x.outlet_id=p_outlet_id and x.business_date=p_business_date and i.status<>'pending';
 select jsonb_build_object('total',count(*),'completed',count(*) filter(where status='completed'),'with_exceptions',count(*) filter(where status='completed_with_exceptions'),'in_progress',count(*) filter(where status='in_progress'),'overdue',count(*) filter(where status='overdue'),'needs_attention',(select count(*) from public.crew_operation_instance_items ii join public.crew_operation_instances xi on xi.id=ii.instance_id where xi.outlet_id=p_outlet_id and xi.business_date=p_business_date and ii.status in ('exception','needs_attention'))) into summary from public.crew_operation_instances where outlet_id=p_outlet_id and business_date=p_business_date;
 select coalesce(jsonb_agg(jsonb_build_object('sop_id',s.id,'title',s.title,'version_id',v.id,'version',v.version) order by s.title),'[]'::jsonb) into sops from public.crew_sops s join lateral(select * from public.crew_sop_versions v where v.sop_id=s.id and v.status='published' order by v.version desc limit 1)v on true where s.outlet_id is null or s.outlet_id=p_outlet_id;
 return jsonb_build_object('date',p_business_date,'summary',summary,'templates',templates,'instances',instances,'daily_tasks',tasks,'activity',activity,'published_sops',sops);
end; $$;
revoke all on function public.crew_operations_admin_data(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_operations_admin_data(uuid,date) to authenticated;

create or replace function public.crew_operations_admin_detail(p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare instance public.crew_operation_instances%rowtype; items jsonb;
begin
 select * into instance from public.crew_operation_instances where id=p_instance_id;
 if instance.id is null or not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(instance.outlet_id) then raise exception using errcode='42501',message='Checklist detail is unavailable.'; end if;
 perform public.crew_operations_refresh_instance(instance.id); select * into instance from public.crew_operation_instances where id=instance.id;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('completed_by_name',e.full_name) order by i.sort_order),'[]'::jsonb) into items from public.crew_operation_instance_items i left join public.employees e on e.id=i.completed_by where i.instance_id=instance.id;
 return jsonb_build_object('instance',to_jsonb(instance)-('template_snapshot'::text),'items',items,'template_snapshot',instance.template_snapshot);
end; $$;
revoke all on function public.crew_operations_admin_detail(uuid) from public,anon,authenticated;
grant execute on function public.crew_operations_admin_detail(uuid) to authenticated;
