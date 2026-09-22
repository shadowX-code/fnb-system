-- Correct Daily Operations' default business date for Malaysia midnight.
create or replace function public.crew_operations_business_date()
returns date
language sql
stable
set search_path=public
as $$ select timezone('Asia/Kuala_Lumpur',now())::date $$;
revoke all on function public.crew_operations_business_date() from public,anon,authenticated;

create or replace function public.crew_operations_today(p_token text,p_business_date date default public.crew_operations_business_date())
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

create or replace function public.crew_operations_admin_data(p_outlet_id uuid,p_business_date date default public.crew_operations_business_date())
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
