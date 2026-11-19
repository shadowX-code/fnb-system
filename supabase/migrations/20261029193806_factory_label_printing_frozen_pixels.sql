-- Freeze the initial bitmap for all later initial prints and historical previews, independent of browser fonts.
create or replace function public.factory_label_context(p_job_order uuid,p_production uuid default null,p_overrides jsonb default '{}',p_page integer default 1) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batches jsonb; v_candidate jsonb; v_history jsonb; v_total integer;
begin
 perform public.factory_label_actor('factory_job_orders.view');
 if public.current_user_has_permission('factory_production.view') is not true then raise exception using errcode='42501',message='Production view permission is required.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'batch_no',p.batch_no,'packaged_units',p.actual_pack_qty,'product_name',p.product_name) order by p.created_at desc),'[]') into v_batches from public.factory_productions p where p.job_order_id=p_job_order and p.status='completed';
 if p_production is not null then
  if not exists(select 1 from public.factory_productions where id=p_production and job_order_id=p_job_order) then raise exception 'Batch does not belong to this Job Order.'; end if;
  v_candidate:=public.factory_label_candidate(p_production,p_overrides);
 end if;
 select count(*) into v_total from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]') into v_history from (
  select j.id,j.quantity,j.state,j.created_at,j.updated_at,j.reprint_of,j.reprint_reason,j.detail,j.device_id,j.created_by,
   coalesce(e.nickname,e.full_name) operator_name,s.snapshot->>'batch_no' batch_no,s.snapshot->>'template_version' template_version,
   (select jsonb_agg(to_jsonb(ev) order by ev.id) from public.factory_label_events ev where ev.job_id=j.id) events
  from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id left join public.employees e on e.id=j.created_by
  where s.production_id=p_production order by j.created_at desc limit 20 offset (greatest(coalesce(p_page,1),1)-1)*20
 ) h;
 return jsonb_build_object('batches',v_batches,'candidate',v_candidate,'history',v_history,'history_total',v_total,'saved_raster',(select j.raster from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production order by j.created_at,j.id limit 1),
 'allocated',coalesce((select sum(j.quantity) from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production and j.reprint_of is null),0),
 'devices',(select coalesce(jsonb_agg(to_jsonb(d)-'owner'),'[]') from public.factory_label_devices d where enabled));
end $$;

create or replace function public.factory_label_enqueue(p_request_id uuid,p_production uuid,p_device uuid,p_quantity integer,p_expected_snapshot jsonb,p_raster jsonb,p_overrides jsonb default '{}',p_reprint_of uuid default null,p_reason text default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_production.complete'); v_snapshot jsonb; v_snap_id uuid; v_hash text; v_job public.factory_label_jobs; v_source public.factory_label_jobs; v_allocated integer; v_bitmap bytea;
begin
 if public.current_user_has_permission('factory_production.view') is not true or public.current_user_has_permission('factory_job_orders.view') is not true then raise exception using errcode='42501',message='Production and Job Order view permissions are required.'; end if;
 if p_quantity is null or p_quantity not between 1 and 10000 or p_request_id is null then raise exception 'Confirm a label quantity between 1 and 10,000.'; end if;
 v_hash:=md5(jsonb_build_object('production',p_production,'device',p_device,'quantity',p_quantity,'snapshot',p_expected_snapshot,'raster',p_raster,'overrides',p_overrides,'source',p_reprint_of,'reason',p_reason)::text);
 perform pg_advisory_xact_lock(hashtextextended('label-request:'||p_request_id::text,0));
 select * into v_job from public.factory_label_jobs where request_id=p_request_id;
 if found then
  if v_job.request_hash<>v_hash or v_job.created_by<>v_actor then raise exception 'Print request already used with different details.'; end if;
  return v_job.id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('label-batch:'||p_production::text,0));
 if not exists(select 1 from public.factory_label_devices where id=p_device and enabled) then raise exception 'Select an enabled print bridge.'; end if;
 if p_reprint_of is not null then
  perform public.factory_label_actor('factory_production.verify');
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'A reprint reason is required.'; end if;
  select * into v_source from public.factory_label_jobs where id=p_reprint_of for update;
  if not found or v_source.state not in ('Sent','Confirmed','Failed','Unknown') then raise exception 'Resolve the original print before reprinting.'; end if;
  select id,snapshot into v_snap_id,v_snapshot from public.factory_label_snapshots where id=v_source.snapshot_id and production_id=p_production;
  if not found then raise exception 'Original print belongs to another batch.'; end if;
  if exists(select 1 from public.factory_label_jobs where snapshot_id=v_snap_id and state in ('Queued','Printing')) then raise exception 'Resolve pending batch prints before reprinting.'; end if;
  p_raster:=v_source.raster;
 else
  v_snapshot:=public.factory_label_candidate(p_production,p_overrides);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'Batch or label configuration changed. Review the preview again.'; end if;
  if jsonb_array_length(v_snapshot->'missing')>0 then raise exception 'Confirm missing label information before printing.'; end if;
  select id into v_snap_id from public.factory_label_snapshots where production_id=p_production;
  if v_snap_id is not null then select raster into p_raster from public.factory_label_jobs where snapshot_id=v_snap_id order by created_at,id limit 1; end if;
  if v_snap_id is null then insert into public.factory_label_snapshots(production_id,snapshot,created_by) values(p_production,v_snapshot,v_actor) returning id into v_snap_id; end if;
  select coalesce(sum(quantity),0) into v_allocated from public.factory_label_jobs where snapshot_id=v_snap_id and reprint_of is null;
  if v_allocated+p_quantity>(v_snapshot->>'packaged_units')::integer then raise exception 'Label quantity exceeds confirmed packaged units. Use an authorized reprint.'; end if;
  if p_raster->>'format' is distinct from 'mono1' or (p_raster->>'width')::integer is distinct from round((v_snapshot->>'width_mm')::numeric*203/25.4)::integer or (p_raster->>'height')::integer is distinct from round((v_snapshot->>'height_mm')::numeric*203/25.4)::integer then raise exception 'Label raster dimensions do not match the approved configuration.'; end if;
  if length(p_raster->>'data')>500000 then raise exception 'Label bitmap is too large.'; end if;
  v_bitmap:=decode(p_raster->>'data','base64');
  if v_bitmap is null or octet_length(v_bitmap)<>ceil((p_raster->>'width')::numeric/8)::integer*(p_raster->>'height')::integer then raise exception 'Invalid label bitmap.'; end if;
 end if;
 insert into public.factory_label_jobs(request_id,request_hash,snapshot_id,device_id,quantity,reprint_of,reprint_reason,raster,created_by)
 values(p_request_id,v_hash,v_snap_id,p_device,p_quantity,p_reprint_of,p_reason,p_raster,v_actor) returning * into v_job;
 insert into public.factory_label_events(job_id,state,actor,detail) values(v_job.id,'Queued',v_actor,case when p_reprint_of is null then 'Operator confirmed preview and quantity' else p_reason end);
 return v_job.id;
end $$;
