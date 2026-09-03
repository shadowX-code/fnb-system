-- Cleaning of Equipment has two sources only: Scheduled requirements and
-- completed Production using Equipment explicitly bound to its SOP.

create table if not exists public.factory_production_sop_equipment (
  sop_id uuid not null references public.factory_production_sops(id) on delete cascade,
  equipment_id uuid not null references public.factory_equipment(id) on delete restrict,
  primary key (sop_id, equipment_id)
);
alter table public.factory_production_sop_equipment enable row level security;
revoke all on public.factory_production_sop_equipment from authenticated;
grant select on public.factory_production_sop_equipment to authenticated;
create policy "factory production SOP equipment view" on public.factory_production_sop_equipment for select to authenticated using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production_sop.manage')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_production.view')
);

-- The configurable QA-only After Operation lineage is retired. Scheduled
-- evidence remains untouched; old usage-triggered QA evidence is not carried
-- as a compatibility branch into the SOP-bound model.
delete from public.factory_mesti_equipment_cleaning_occurrences where production_equipment_usage_id is not null;
delete from public.factory_mesti_equipment_cleaning_requirements where trigger_type = 'after_operation';

drop index if exists public.factory_mesti_equipment_cleaning_after_operation_identity_key;
drop index if exists public.factory_mesti_equipment_cleaning_scheduled_identity_key;
alter table public.factory_mesti_equipment_cleaning_occurrences add column if not exists source_type text not null default 'scheduled' check (source_type in ('scheduled', 'after_production'));
alter table public.factory_mesti_equipment_cleaning_occurrences add column if not exists production_id uuid references public.factory_productions(id) on delete restrict;
alter table public.factory_mesti_equipment_cleaning_occurrences alter column requirement_id drop not null;
alter table public.factory_mesti_equipment_cleaning_occurrences alter column logical_requirement_id drop not null;
alter table public.factory_mesti_equipment_cleaning_requirements drop constraint if exists factory_mesti_equipment_cleaning_schedule_valid;
alter table public.factory_mesti_equipment_cleaning_requirements add constraint factory_mesti_equipment_cleaning_schedule_valid check (
  recurrence_type in ('daily', 'weekly') and (recurrence_type = 'daily' or (cardinality(recurrence_weekdays) > 0 and recurrence_weekdays <@ array[1,2,3,4,5,6,7]))
);
create unique index factory_mesti_equipment_cleaning_scheduled_identity_key on public.factory_mesti_equipment_cleaning_occurrences(logical_requirement_id, equipment_id, due_date) where source_type = 'scheduled';
create unique index factory_mesti_equipment_cleaning_after_production_identity_key on public.factory_mesti_equipment_cleaning_occurrences(production_id, equipment_id) where source_type = 'after_production';

create or replace function public.factory_save_mesti_equipment_cleaning_requirement(p_requirement jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee public.employees%rowtype:=public.factory_mesti_current_employee(); v_current public.factory_mesti_equipment_cleaning_requirements%rowtype; v_saved public.factory_mesti_equipment_cleaning_requirements%rowtype; v_ids uuid[]:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(p_requirement->'equipment_ids','[]'::jsonb)) value order by 1); v_existing uuid[]; v_weekdays integer[]:=array(select distinct value::integer from jsonb_array_elements_text(coalesce(p_requirement->'recurrence_weekdays','[]'::jsonb)) value order by 1); v_effective date:=coalesce(nullif(p_requirement->>'effective_from','')::date,current_date); v_created boolean:=false;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.manage') or public.current_user_has_permission(case when nullif(p_requirement->>'id','') is null then 'factory_mesti_equipment_cleaning.create' else 'factory_mesti_equipment_cleaning.edit' end)) then raise exception using errcode='42501',message='Missing permission to manage Equipment Cleaning Requirements.'; end if;
  if nullif(btrim(p_requirement->>'task_name'),'') is null or cardinality(v_ids)=0 then raise exception using errcode='22023',message='Task Name and at least one active Equipment item are required.'; end if;
  if coalesce(p_requirement->>'recurrence_type','daily') not in ('daily','weekly') or (coalesce(p_requirement->>'recurrence_type','daily')='weekly' and cardinality(v_weekdays)=0) then raise exception using errcode='22023',message='Select a valid Scheduled recurrence.'; end if;
  if exists(select 1 from unnest(v_ids) id left join public.factory_equipment e on e.id=id and e.status='active' where e.id is null) then raise exception using errcode='22023',message='Only active Equipment can be scheduled.'; end if;
  if nullif(p_requirement->>'id','') is not null then select * into v_current from public.factory_mesti_equipment_cleaning_requirements where id=(p_requirement->>'id')::uuid and effective_until is null for update; if v_current.id is null then raise exception 'Cleaning Requirement was not found.'; end if; end if;
  if v_current.id is not null then
    select coalesce(array_agg(equipment_id order by equipment_id),'{}'::uuid[]) into v_existing from public.factory_mesti_equipment_cleaning_requirement_equipment where requirement_id=v_current.id;
    if v_current.task_name=btrim(p_requirement->>'task_name') and v_current.recurrence_type=coalesce(p_requirement->>'recurrence_type','daily') and v_current.recurrence_weekdays=v_weekdays and v_current.status=coalesce(p_requirement->>'status','active') and v_existing=v_ids then v_saved:=v_current;
    else update public.factory_mesti_equipment_cleaning_requirements set effective_until=v_effective,superseded_by=null,updated_at=now() where id=v_current.id; insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,version_no,created_by) values(v_current.logical_requirement_id,btrim(p_requirement->>'task_name'),coalesce(p_requirement->>'recurrence_type','daily'),v_weekdays,coalesce(p_requirement->>'status','active'),v_effective,v_current.version_no+1,v_employee.id) returning * into v_saved; update public.factory_mesti_equipment_cleaning_requirements set superseded_by=v_saved.id where id=v_current.id; v_created:=true; end if;
  else insert into public.factory_mesti_equipment_cleaning_requirements(logical_requirement_id,task_name,recurrence_type,recurrence_weekdays,status,effective_from,version_no,created_by) values(gen_random_uuid(),btrim(p_requirement->>'task_name'),coalesce(p_requirement->>'recurrence_type','daily'),v_weekdays,coalesce(p_requirement->>'status','active'),v_effective,1,v_employee.id) returning * into v_saved; v_created:=true; end if;
  if v_created then insert into public.factory_mesti_equipment_cleaning_requirement_equipment(requirement_id,equipment_id) select v_saved.id,id from unnest(v_ids) id on conflict do nothing; end if;
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(v_effective,v_effective);
  return jsonb_build_object('id',v_saved.id,'logical_requirement_id',v_saved.logical_requirement_id,'task_name',v_saved.task_name,'recurrence_type',v_saved.recurrence_type,'recurrence_weekdays',v_saved.recurrence_weekdays,'status',v_saved.status,'effective_from',v_saved.effective_from,'version_no',v_saved.version_no,'equipment_ids',to_jsonb(v_ids),'version_created',v_created);
end; $$;

create or replace function public.factory_mesti_materialize_equipment_cleaning_scheduled(p_from date, p_to date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inserted integer;
begin
  if not (public.current_user_has_permission('factory_mesti_equipment_cleaning.view') or public.current_user_has_permission('factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to view Factory MeSTI Cleaning of Equipment.'; end if;
  insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id,logical_requirement_id,equipment_id,due_date,source_type,requirement_snapshot)
  select requirement.id, requirement.logical_requirement_id, equipment.id, due.day::date, 'scheduled', jsonb_build_object('task_name',requirement.task_name,'source_type','scheduled','recurrence_type',requirement.recurrence_type,'recurrence_weekdays',requirement.recurrence_weekdays,'version_no',requirement.version_no,'equipment_id',equipment.id,'equipment_code',equipment.equipment_code,'equipment_name',equipment.name,'location_id',location.id,'location_name',location.location_name)
  from public.factory_mesti_equipment_cleaning_requirements requirement
  join public.factory_mesti_equipment_cleaning_requirement_equipment link on link.requirement_id=requirement.id
  join public.factory_equipment equipment on equipment.id=link.equipment_id and equipment.status='active'
  join public.factory_storage_locations location on location.id=equipment.current_location_id
  cross join generate_series(p_from,p_to,interval '1 day') due(day)
  where requirement.status='active' and due.day::date >= requirement.effective_from and (requirement.effective_until is null or due.day::date < requirement.effective_until) and public.factory_mesti_recurrence_due(requirement.recurrence_type,requirement.recurrence_weekdays,due.day::date)
  on conflict (logical_requirement_id,equipment_id,due_date) where source_type='scheduled' do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end; $$;

create or replace function public.factory_mesti_equipment_cleaning_day(p_due_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(p_due_date,p_due_date);
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'due_date',o.due_date,'status',o.status,'requirement_id',o.requirement_id,'logical_requirement_id',o.logical_requirement_id,'task_name',o.requirement_snapshot->>'task_name','source_type',o.source_type,'recurrence_type',o.requirement_snapshot->>'recurrence_type','recurrence_weekdays',o.requirement_snapshot->'recurrence_weekdays','equipment_id',o.equipment_id,'equipment_code',o.requirement_snapshot->>'equipment_code','equipment_name',o.requirement_snapshot->>'equipment_name','location_name',o.requirement_snapshot->>'location_name','production_id',o.production_id,'production_snapshot',o.requirement_snapshot->'production_snapshot','completed_by',o.completed_by,'completed_by_name',coalesce(c.nickname,c.full_name,c.email),'completed_at',o.completed_at,'verified_by',o.verified_by,'verified_by_name',coalesce(v.nickname,v.full_name,v.email),'verified_at',o.verified_at) order by o.created_at) from public.factory_mesti_equipment_cleaning_occurrences o left join public.employees c on c.id=o.completed_by left join public.employees v on v.id=o.verified_by where o.due_date=p_due_date),'[]'::jsonb);
end; $$;

create or replace function public.factory_mesti_equipment_cleaning_month(p_month date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from date:=date_trunc('month',p_month)::date; v_to date:=(date_trunc('month',p_month)::date+interval '1 month - 1 day')::date;
begin
  perform public.factory_mesti_materialize_equipment_cleaning_scheduled(v_from,v_to);
  return coalesce((with cells as (select coalesce(o.logical_requirement_id::text,'after-production') as group_key,coalesce(o.requirement_snapshot->>'task_name','After Production Cleaning') as task_name,o.source_type,o.requirement_snapshot->>'recurrence_type' as recurrence_type,o.due_date,count(*)::integer total_count,count(*) filter(where o.status='verified')::integer verified_count,case when count(distinct o.status)>1 then 'mixed' else min(o.status) end status,jsonb_agg(jsonb_build_object('id',o.id,'due_date',o.due_date,'status',o.status,'task_name',o.requirement_snapshot->>'task_name','source_type',o.source_type,'equipment_code',o.requirement_snapshot->>'equipment_code','equipment_name',o.requirement_snapshot->>'equipment_name','location_name',o.requirement_snapshot->>'location_name','production_id',o.production_id,'production_snapshot',o.requirement_snapshot->'production_snapshot','completed_by_name',coalesce(c.nickname,c.full_name,c.email),'completed_at',o.completed_at,'verified_by_name',coalesce(v.nickname,v.full_name,v.email),'verified_at',o.verified_at)) occurrences from public.factory_mesti_equipment_cleaning_occurrences o left join public.employees c on c.id=o.completed_by left join public.employees v on v.id=o.verified_by where o.due_date between v_from and v_to group by group_key,task_name,o.source_type,recurrence_type,o.due_date) select jsonb_agg(jsonb_build_object('logical_requirement_id',group_key,'task_name',task_name,'source_type',source_type,'recurrence_type',recurrence_type,'days',days) order by task_name) from (select group_key,min(task_name) task_name,min(source_type) source_type,min(recurrence_type) recurrence_type,jsonb_agg(jsonb_build_object('due_date',due_date,'status',status,'total_count',total_count,'verified_count',verified_count,'occurrences',occurrences) order by due_date) days from cells group by group_key) groups),'[]'::jsonb);
end; $$;

drop function if exists public.factory_mesti_materialize_equipment_cleaning_after_operation(date,date);
drop function if exists public.factory_mesti_equipment_cleaning_snapshot(public.factory_mesti_equipment_cleaning_requirements,public.factory_equipment,public.factory_production_equipment_usage);
drop function if exists public.factory_record_production_equipment_usage(uuid,uuid[]);
alter table public.factory_mesti_equipment_cleaning_occurrences drop column if exists production_equipment_usage_id;
alter table public.factory_mesti_equipment_cleaning_requirements drop column if exists trigger_type;
drop table if exists public.factory_production_equipment_usage;
delete from public.role_permissions where permission_id in (select id from public.permissions where code = 'factory_production_equipment_usage.view');
delete from public.permissions where code = 'factory_production_equipment_usage.view';

create or replace function public.factory_save_production_sop_structure(
  p_sop_id uuid, p_finished_good_id uuid, p_title text, p_effective_date date, p_remarks text,
  p_recipe_id uuid, p_recipe_version text, p_steps jsonb, p_created_by uuid, p_equipment_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_saved jsonb; v_sop_id uuid; v_equipment_id uuid;
begin
  if cardinality(coalesce(p_equipment_ids, '{}'::uuid[])) = 0 then
    raise exception using errcode = '22023', message = 'Bind at least one active Equipment item to a Production SOP.';
  end if;
  if exists (select 1 from unnest(coalesce(p_equipment_ids, '{}'::uuid[])) equipment_id left join public.factory_equipment equipment on equipment.id = equipment_id and equipment.status = 'active' where equipment.id is null) then
    raise exception using errcode = '22023', message = 'Only active Equipment can be bound to a Production SOP.';
  end if;
  v_saved := public.factory_save_production_sop_structure(p_sop_id, p_finished_good_id, p_title, p_effective_date, p_remarks, p_recipe_id, p_recipe_version, p_steps, p_created_by);
  v_sop_id := (v_saved->>'sop_id')::uuid;
  delete from public.factory_production_sop_equipment where sop_id = v_sop_id;
  insert into public.factory_production_sop_equipment(sop_id, equipment_id)
  select v_sop_id, equipment_id from unnest(coalesce(p_equipment_ids, '{}'::uuid[])) equipment_id on conflict do nothing;
  return v_saved;
end;
$$;
revoke all on function public.factory_save_production_sop_structure(uuid,uuid,text,date,text,uuid,text,jsonb,uuid,uuid[]) from public, anon;
grant execute on function public.factory_save_production_sop_structure(uuid,uuid,text,date,text,uuid,text,jsonb,uuid,uuid[]) to authenticated;

create or replace function public.factory_mesti_materialize_equipment_cleaning_after_production(p_production_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inserted integer := 0;
begin
  insert into public.factory_mesti_equipment_cleaning_occurrences(requirement_id, logical_requirement_id, equipment_id, due_date, source_type, production_id, requirement_snapshot)
  select null, null, equipment.id, (production.completed_at at time zone 'Asia/Kuala_Lumpur')::date, 'after_production', production.id,
    jsonb_build_object(
      'task_name', 'After Production Cleaning', 'source_type', 'after_production',
      'equipment_id', equipment.id, 'equipment_code', equipment.equipment_code, 'equipment_name', equipment.name,
      'location_id', location.id, 'location_name', location.location_name,
      'production_id', production.id, 'job_order_id', production.job_order_id,
      'production_snapshot', jsonb_build_object('production_no', production.production_no, 'batch_no', production.batch_no, 'product_name', production.product_name, 'production_sop_id', production.production_sop_id, 'sop_version', production.sop_version, 'completed_at', production.completed_at)
    )
  from public.factory_productions production
  join public.factory_production_sop_equipment binding on binding.sop_id = production.production_sop_id
  join public.factory_equipment equipment on equipment.id = binding.equipment_id
  join public.factory_storage_locations location on location.id = equipment.current_location_id
  where production.id = p_production_id and lower(production.status) = 'completed'
  on conflict (production_id, equipment_id) where source_type = 'after_production' do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
revoke all on function public.factory_mesti_materialize_equipment_cleaning_after_production(uuid) from public, anon, authenticated;

create or replace function public.factory_complete_production_with_raw_batch_allocations(p_request_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee_id uuid; v_employee_name text; v_production_id uuid;
begin
  v_employee_id := public.factory_current_active_employee_id();
  v_employee_name := public.factory_current_active_employee_name();
  v_production_id := public.factory_complete_production_with_raw_batch_allocations_impl_050031(p_request_id, (p_payload - 'operator_id' - 'operator_name') || jsonb_build_object('operator_id', v_employee_id, 'operator_name', v_employee_name));
  perform public.factory_mesti_materialize_equipment_cleaning_after_production(v_production_id);
  return v_production_id;
end;
$$;
revoke all on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) from public, anon;
grant execute on function public.factory_complete_production_with_raw_batch_allocations(uuid,jsonb) to authenticated;
