select jsonb_build_object(
 'templates',(select jsonb_agg(x order by x.operation_type) from (
   select t.name,t.operation_type,t.revision,t.status,count(i.id) item_count
   from public.crew_operation_templates t join public.crew_operation_template_items i on i.template_id=t.id
   where t.outlet_id='e804c48d-6343-4bf8-99d7-9893c473948f' and t.name in ('Opening Checklist','Closing Checklist','Store Health Check') and t.status='active'
   group by t.id
 ) x),
 'instances',(select jsonb_agg(x order by x.operation_type) from (
   select o.name,o.operation_type,o.status,count(i.id) item_count,count(*) filter(where i.status='completed') completed,count(*) filter(where i.status='exception') exceptions,count(*) filter(where i.status='good') good,count(*) filter(where i.status='needs_attention') needs_attention,count(*) filter(where i.status in ('pending','not_checked')) pending
   from public.crew_operation_instances o join public.crew_operation_instance_items i on i.instance_id=o.id
   where o.outlet_id='e804c48d-6343-4bf8-99d7-9893c473948f' and o.business_date=timezone('Asia/Kuala_Lumpur',now())::date group by o.id
 ) x),
 'daily_tasks',(select jsonb_agg(jsonb_build_object('title',title,'priority',priority,'status',status,'exception_reason',exception_reason,'note',note) order by created_at) from public.crew_daily_tasks where outlet_id='e804c48d-6343-4bf8-99d7-9893c473948f' and task_date=timezone('Asia/Kuala_Lumpur',now())::date),
 'qa_crew',(select jsonb_agg(jsonb_build_object('employee_code',e.employee_code,'name',e.full_name,'position',e.position) order by e.employee_code) from public.employees e where e.employee_code in ('QA-CREW-CO-01','QA-CREW-NA-01'))
) verification;
