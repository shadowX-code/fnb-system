-- Follow an exact print job and the selected bridge's oldest Unknown independently of paged history.
create function public.factory_label_print_status(p_job_order uuid, p_job uuid, p_device uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_blocking uuid;
begin
 perform public.factory_label_actor('factory_job_orders.view');
 if public.current_user_has_permission('factory_production.view') is not true then
   raise exception using errcode = '42501', message = 'Production view permission is required.';
 end if;

 select j.id into v_blocking
 from public.factory_label_jobs j
 join public.factory_label_devices d on d.id = j.device_id
 where d.enabled and j.device_id = p_device and j.state = 'Unknown'
 order by j.created_at, j.id
 limit 1;

 return (
   with evidence as (
     select j.id, jo.id as job_order_id, jsonb_build_object(
       'id', j.id, 'state', j.state, 'quantity', j.quantity, 'detail', j.detail,
       'created_at', j.created_at, 'updated_at', j.updated_at, 'device_id', d.id,
       'printer_name', d.printer_name, 'job_order_no', jo.job_order_no,
       'batch_no', s.snapshot->>'batch_no', 'template_version', s.snapshot->>'template_version',
       'label_name', coalesce(s.snapshot->>'label_name', 'Product Label'),
       'operator_name', coalesce(owner.nickname, owner.full_name),
       'reprint_of', j.reprint_of, 'reprint_reason', j.reprint_reason,
       'events', (
         select jsonb_agg(jsonb_build_object(
           'id', ev.id, 'state', ev.state, 'created_at', ev.created_at, 'detail', ev.detail,
           'usable_quantity', ev.usable_quantity, 'actor_name', coalesce(actor.nickname, actor.full_name)
         ) order by ev.id)
         from public.factory_label_events ev
         left join public.employees actor on actor.id = ev.actor
         where ev.job_id = j.id
       )
     ) as payload
     from public.factory_label_jobs j
     join public.factory_label_devices d on d.id = j.device_id
     join public.factory_label_snapshots s on s.id = j.snapshot_id
     join public.factory_productions p on p.id = s.production_id
     join public.factory_job_orders jo on jo.id = p.job_order_id
     left join public.employees owner on owner.id = j.created_by
     where j.id = v_blocking or (j.id = p_job and jo.id = p_job_order)
   )
   select jsonb_build_object(
     'submitted', (select h.payload from evidence h where h.id = p_job and h.job_order_id = p_job_order),
     'blocking', (select h.payload from evidence h where h.id = v_blocking)
   )
 );
end;
$$;

revoke all on function public.factory_label_print_status(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.factory_label_print_status(uuid, uuid, uuid) to authenticated;
