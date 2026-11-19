-- Factory label evidence is additive: no Production, Job Order or inventory writes.
create table public.factory_label_templates (
 id uuid primary key default gen_random_uuid(), template_key text not null, version integer not null check(version>0),
 name text not null, definition jsonb not null check(jsonb_typeof(definition)='object'),
 created_by uuid references public.employees(id), created_at timestamptz not null default now(), unique(template_key,version)
);
create table public.factory_label_configs (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique, request_hash text not null, finished_good_id uuid not null references public.factory_finished_goods(id),
 version integer not null, template_id uuid not null references public.factory_label_templates(id),
 width_mm numeric not null check(width_mm between 20 and 120), height_mm numeric not null check(height_mm between 20 and 200),
 net_weight text not null check(length(btrim(net_weight)) between 1 and 100), storage_instructions text not null check(length(btrim(storage_instructions)) between 1 and 1000),
 shelf_life_days integer check(shelf_life_days between 1 and 3650), expiry_rule text not null check(expiry_rule in ('production','days_after','inclusive_days')),
 approval_note text not null check(length(btrim(approval_note)) between 3 and 1000), created_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(), unique(finished_good_id,version), check(expiry_rule='production' or shelf_life_days is not null)
);
create table public.factory_label_snapshots (
 id uuid primary key default gen_random_uuid(), production_id uuid not null unique references public.factory_productions(id),
 snapshot jsonb not null, created_by uuid not null references public.employees(id), created_at timestamptz not null default now()
);
create table public.factory_label_devices (
 id uuid primary key, owner uuid not null references auth.users(id), name text not null, printer_name text not null,
 transport text not null check(transport in ('spooler','tspl')), enabled boolean not null default true,
 status text not null default 'Offline', printers jsonb not null default '[]', last_seen timestamptz not null default now()
);
create table public.factory_label_jobs (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique, request_hash text not null,
 snapshot_id uuid not null references public.factory_label_snapshots(id), device_id uuid not null references public.factory_label_devices(id),
 quantity integer not null check(quantity between 1 and 10000), state text not null default 'Queued' check(state in ('Queued','Printing','Sent','Confirmed','Failed','Unknown')),
 reprint_of uuid references public.factory_label_jobs(id), reprint_reason text,
 raster jsonb not null, created_by uuid not null references public.employees(id), created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), lease_until timestamptz, claim_id uuid, detail text,
 check(reprint_of is null or length(btrim(reprint_reason)) between 3 and 1000)
);
create index factory_label_jobs_queue_idx on public.factory_label_jobs(device_id,created_at) where state in ('Queued','Printing');
create index factory_label_jobs_snapshot_idx on public.factory_label_jobs(snapshot_id,created_at desc);
create index factory_label_configs_sku_idx on public.factory_label_configs(finished_good_id,version desc);
create table public.factory_label_events (
 id bigint generated always as identity primary key, job_id uuid not null references public.factory_label_jobs(id), state text not null,
 actor uuid not null references public.employees(id), detail text, created_at timestamptz not null default now()
);
create index factory_label_events_job_idx on public.factory_label_events(job_id,id);

create function public.factory_label_actor(p_permission text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid;
begin
 if auth.uid() is null or public.current_user_has_permission(p_permission) is not true then raise exception using errcode='42501',message='Label printing permission is required.'; end if;
 select id into v_actor from public.employees where auth_user_id=auth.uid() and lower(employment_status)='active';
 if v_actor is null then raise exception using errcode='42501',message='An active employee profile is required.'; end if;
 return v_actor;
end $$;

create function public.factory_label_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Label evidence is immutable. Create a new version or a controlled reprint.'; end $$;
create trigger label_template_immutable before update or delete on public.factory_label_templates for each row execute function public.factory_label_immutable();
create trigger label_config_immutable before update or delete on public.factory_label_configs for each row execute function public.factory_label_immutable();
create trigger label_snapshot_immutable before update or delete on public.factory_label_snapshots for each row execute function public.factory_label_immutable();
create trigger label_event_immutable before update or delete on public.factory_label_events for each row execute function public.factory_label_immutable();

-- Layout coordinates and font sizes are millimetres; the browser freezes a 203 DPI monochrome raster.
insert into public.factory_label_templates(template_key,version,name,definition) values ('s08-sambal',1,'S08 Dried Shrimp Sambal — content approval required',
'{"reference_note": "Layout transcribed from supplied Labelife S08 screenshot. Regulatory text and certification artwork require approval before use.", "elements": [{"type": "rect", "x": 6.3, "y": 6, "w": 67.4, "h": 23.8, "radius": 1, "stroke": 0.3}, {"type": "text", "field": "product_code", "x": 10.3, "y": 9, "w": 60, "h": 3, "size": 2.4, "prefix": "(", "suffix": ")"}, {"type": "text", "field": "product_name", "x": 10, "y": 12.5, "w": 60, "h": 5.5, "size": 4.4, "bold": true}, {"type": "text", "field": "product_name_bm", "x": 10.4, "y": 18.2, "w": 59, "h": 3.6, "size": 2.65}, {"type": "text", "field": "product_name_cn", "x": 10.4, "y": 21.7, "w": 59, "h": 3.6, "size": 2.65}, {"type": "text", "field": "net_weight", "x": 42, "y": 25.7, "w": 27, "h": 3.2, "size": 2.2, "prefix": "Net Weight: ", "align": "right"}, {"type": "text", "text": "Ingredients:", "x": 6.6, "y": 34, "w": 67, "h": 3.6, "size": 2.6, "bold": true}, {"type": "text", "text": "Dried Shrimp, Dry Chili, Garlic, Shallots, Sugar, Chicken Stock, Ginger, Salt, Cooking Oil", "x": 6.6, "y": 38, "w": 67, "h": 6, "size": 2.15}, {"type": "text", "text": "Storage:", "x": 6.6, "y": 48, "w": 12, "h": 3.8, "size": 2.6, "bold": true}, {"type": "text", "field": "storage_instructions", "x": 19.2, "y": 48, "w": 47, "h": 6, "size": 2.3}, {"type": "text", "field": "batch_no", "x": 6.6, "y": 54, "w": 67, "h": 2.8, "size": 1.9, "prefix": "Batch: "}, {"type": "text", "field": "manufacturing_date", "x": 6.6, "y": 58, "w": 67, "h": 3.6, "size": 2.6, "prefix": "MFG:   ", "date_format": "dd/MM/yyyy"}, {"type": "text", "field": "expiry_date", "x": 6.6, "y": 65.3, "w": 67, "h": 3.6, "size": 2.6, "prefix": "EXP:   ", "date_format": "dd/MM/yyyy"}, {"type": "line", "x": 6.6, "y": 69.3, "w": 65.8, "h": 0.3, "stroke": 0.3}, {"type": "text", "text": "Manufactured by:", "x": 6.6, "y": 71.8, "w": 50, "h": 3.6, "size": 2.6, "bold": true}, {"type": "text", "text": "Idamans Food Industry Sdn Bhd (202401039599)", "x": 6.6, "y": 76.3, "w": 53, "h": 3, "size": 1.85}, {"type": "text", "text": "9, Jalan Menglembu Impiana 3,\nKawasan Perindustrian Menglembu Impian,\n31450 Menglembu, Perak", "x": 6.6, "y": 79.7, "w": 53, "h": 6.5, "size": 1.7}]}'::jsonb);

create function public.factory_label_settings(p_sku uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 return jsonb_build_object('config',(select to_jsonb(c) from public.factory_label_configs c where finished_good_id=p_sku order by version desc limit 1),
 'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by name,version desc),'[]') from public.factory_label_templates t));
end $$;

create function public.factory_label_save_config(p_sku uuid,p_config jsonb,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); v_version integer; v_saved public.factory_label_configs; v_template uuid; v_def jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('label-config:'||p_sku::text,0));
 select * into v_saved from public.factory_label_configs where request_id=p_request_id;
 if found then
  if v_saved.finished_good_id<>p_sku or v_saved.created_by<>v_actor or v_saved.request_hash<>md5(p_config::text) then raise exception 'Request already used. Reload before saving.'; end if;
  return to_jsonb(v_saved);
 end if;
 select coalesce(max(version),0) into v_version from public.factory_label_configs where finished_good_id=p_sku;
 if p_expected_version is distinct from v_version then raise exception 'Label configuration changed. Reload before saving.'; end if;
 if p_config->>'content_approved' is distinct from 'true' then raise exception 'Explicit label content approval is required.'; end if;
 if not exists(select 1 from public.factory_finished_goods where id=p_sku) then raise exception 'Packaging SKU unavailable.'; end if;
 v_template:=(p_config->>'template_id')::uuid;
 if p_config->'new_template' is not null and p_config->'new_template'<>'null'::jsonb then
  v_def:=p_config->'new_template';
  if jsonb_typeof(v_def->'elements') is distinct from 'array' or jsonb_array_length(v_def->'elements') not between 1 and 50 or length(v_def::text)>500000 then raise exception 'Template requires 1–50 elements and must be under 500 KB.'; end if;
  insert into public.factory_label_templates(template_key,version,name,definition,created_by) values('custom-'||p_request_id,1,'Custom '||to_char(now(),'YYYY-MM-DD HH24:MI'),v_def,v_actor) returning id into v_template;
 end if;
 insert into public.factory_label_configs(request_id,request_hash,finished_good_id,version,template_id,width_mm,height_mm,net_weight,storage_instructions,shelf_life_days,expiry_rule,approval_note,created_by)
 values(p_request_id,md5(p_config::text),p_sku,v_version+1,v_template,(p_config->>'width_mm')::numeric,(p_config->>'height_mm')::numeric,btrim(p_config->>'net_weight'),btrim(p_config->>'storage_instructions'),nullif(p_config->>'shelf_life_days','')::integer,p_config->>'expiry_rule',p_config->>'approval_note',v_actor) returning * into v_saved;
 return to_jsonb(v_saved);
end $$;

-- Internal candidate projection; missing historical evidence can only be supplied with explicit, audited confirmation.
create function public.factory_label_candidate(p_production uuid,p_overrides jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.factory_productions; f public.factory_finished_goods; c public.factory_label_configs; t public.factory_label_templates;
 v_snapshot jsonb; v_mfg date; v_exp date; v_units numeric; v_batch text; v_missing jsonb:='[]'; v_sources jsonb:='{}';
begin
 select snapshot into v_snapshot from public.factory_label_snapshots where production_id=p_production;
 if found then return v_snapshot; end if;
 select * into p from public.factory_productions where id=p_production and status='completed';
 if not found then raise exception 'A completed Production batch is required.'; end if;
 select * into f from public.factory_finished_goods where id=p.finished_good_id;
 select * into c from public.factory_label_configs where finished_good_id=f.id order by version desc limit 1;
 if not found then return jsonb_build_object('production_id',p.id,'missing',jsonb_build_array('label_configuration')); end if;
 select * into t from public.factory_label_templates where id=c.template_id;
 v_mfg:=coalesce(p.manufacturing_date,p.end_date); v_exp:=p.expiry_date; v_units:=p.actual_pack_qty; v_batch:=nullif(btrim(p.batch_no),'');
 if p_overrides<>'{}'::jsonb then
  if p_overrides->>'confirmed' is distinct from 'true' or length(btrim(coalesce(p_overrides->>'reason','')))<3 then raise exception 'Confirm missing batch information with a reason.'; end if;
  if (v_mfg is not null and nullif(p_overrides->>'manufacturing_date','') is not null) or (v_exp is not null and nullif(p_overrides->>'expiry_date','') is not null) or (v_units is not null and nullif(p_overrides->>'packaged_units','') is not null) or (v_batch is not null and nullif(p_overrides->>'batch_no','') is not null) then raise exception 'Recorded Production evidence cannot be overridden.'; end if;
  v_mfg:=coalesce(v_mfg,nullif(p_overrides->>'manufacturing_date','')::date); v_exp:=coalesce(v_exp,nullif(p_overrides->>'expiry_date','')::date);
  v_units:=coalesce(v_units,nullif(p_overrides->>'packaged_units','')::numeric); v_batch:=coalesce(v_batch,nullif(btrim(p_overrides->>'batch_no'),''));
  v_sources:=p_overrides;
 end if;
 if v_exp is null and v_mfg is not null and c.expiry_rule<>'production' then
  v_exp:=v_mfg+c.shelf_life_days-case when c.expiry_rule='inclusive_days' then 1 else 0 end;
  v_sources:=v_sources||jsonb_build_object('expiry_calculation',c.expiry_rule,'approved_shelf_life_days',c.shelf_life_days);
 end if;
 if v_mfg is null then v_missing:=v_missing||'"manufacturing_date"'; end if;
 if v_exp is null then v_missing:=v_missing||'"expiry_date"'; end if;
 if v_batch is null then v_missing:=v_missing||'"batch_no"'; end if;
 if v_units is null then v_missing:=v_missing||'"packaged_units"';
 elsif v_units<1 or v_units<>trunc(v_units) or v_units>1000000 then raise exception 'Confirmed packaged units must be a positive whole number.'; end if;
 if v_exp<v_mfg then raise exception 'Expiry cannot precede manufacturing date.'; end if;
 return jsonb_build_object('production_id',p.id,'job_order_id',p.job_order_id,'finished_good_id',f.id,
 'product_name',coalesce(nullif(p.product_name,''),nullif(f.product_name_en,''),f.product_name),'product_name_cn',coalesce(nullif(f.product_name_cn,''),(select name_cn from public.factory_product_families where id=f.product_family_id)),
 'product_name_bm',coalesce(nullif(f.product_name_bm,''),(select name_bm from public.factory_product_families where id=f.product_family_id)),
 'product_code',f.product_code,'variant_name',f.variant_name,'batch_no',v_batch,'manufacturing_date',v_mfg,'expiry_date',v_exp,'packaged_units',v_units,
 'config_id',c.id,'config_version',c.version,'template_id',t.id,'template_version',t.version,'template_name',t.name,'definition',t.definition,'shelf_life_days',coalesce(p.shelf_life_days_snapshot,c.shelf_life_days),
 'width_mm',c.width_mm,'height_mm',c.height_mm,'dpi',203,'net_weight',c.net_weight,'storage_instructions',c.storage_instructions,
 'sources',v_sources,'missing',v_missing);
end $$;

create function public.factory_label_context(p_job_order uuid,p_production uuid default null,p_overrides jsonb default '{}',p_page integer default 1) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
 return jsonb_build_object('batches',v_batches,'candidate',v_candidate,'history',v_history,'history_total',v_total,
 'allocated',coalesce((select sum(j.quantity) from public.factory_label_jobs j join public.factory_label_snapshots s on s.id=j.snapshot_id where s.production_id=p_production and j.reprint_of is null),0),
 'devices',(select coalesce(jsonb_agg(to_jsonb(d)-'owner'),'[]') from public.factory_label_devices d where enabled));
end $$;

create function public.factory_label_enqueue(p_request_id uuid,p_production uuid,p_device uuid,p_quantity integer,p_expected_snapshot jsonb,p_raster jsonb,p_overrides jsonb default '{}',p_reprint_of uuid default null,p_reason text default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
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

create function public.factory_label_device(p_device uuid,p_name text,p_printer text,p_transport text,p_status text,p_printers jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.factory_label_actor('factory_production.complete');
 if length(btrim(p_name)) not between 1 and 100 or length(btrim(p_printer)) not between 1 and 200 or p_transport not in ('spooler','tspl') or length(p_printers::text)>20000 or p_status not in ('Ready','Offline','Error') then raise exception 'Invalid bridge configuration.'; end if;
 insert into public.factory_label_devices(id,owner,name,printer_name,transport,status,printers) values(p_device,auth.uid(),p_name,p_printer,p_transport,p_status,p_printers)
 on conflict(id) do update set name=excluded.name,printer_name=excluded.printer_name,transport=excluded.transport,status=excluded.status,printers=excluded.printers,last_seen=now() where factory_label_devices.owner=auth.uid() and factory_label_devices.enabled;
 if not found then raise exception using errcode='42501',message='Bridge is disabled or belongs to another operator.'; end if;
 return jsonb_build_object('id',p_device);
end $$;

create function public.factory_label_claim(p_device uuid,p_claim uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_production.complete'); v_job public.factory_label_jobs; v_old public.factory_label_jobs;
begin
 perform 1 from public.factory_label_devices where id=p_device and owner=auth.uid() and enabled and status='Ready' and last_seen>now()-interval '90 seconds' for update;
 if not found or p_claim is null then raise exception using errcode='42501',message='An active, ready bridge is required.'; end if;
 for v_old in update public.factory_label_jobs set state='Unknown',detail='Bridge lease expired; inspect the printer before reprinting.',updated_at=now() where device_id=p_device and state='Printing' and lease_until<now() returning * loop
  insert into public.factory_label_events(job_id,state,actor,detail) values(v_old.id,'Unknown',v_actor,v_old.detail);
 end loop;
 select * into v_job from public.factory_label_jobs where device_id=p_device and claim_id=p_claim;
 if found then return to_jsonb(v_job)||jsonb_build_object('snapshot',(select snapshot from public.factory_label_snapshots where id=v_job.snapshot_id)); end if;
 if exists(select 1 from public.factory_label_jobs where device_id=p_device and state in ('Printing','Unknown')) then return null; end if;
 select * into v_job from public.factory_label_jobs where device_id=p_device and state='Queued' order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.factory_label_jobs set state='Printing',claim_id=p_claim,lease_until=now()+interval '10 minutes',updated_at=now() where id=v_job.id returning * into v_job;
 insert into public.factory_label_events(job_id,state,actor) values(v_job.id,'Printing',v_actor);
 return to_jsonb(v_job)||jsonb_build_object('snapshot',(select snapshot from public.factory_label_snapshots where id=v_job.snapshot_id));
end $$;

create function public.factory_label_report(p_device uuid,p_job uuid,p_claim uuid,p_state text,p_detail text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_production.complete'); v_job public.factory_label_jobs;
begin
 if p_state not in ('Sent','Failed','Unknown') or length(p_detail)>1000 then raise exception 'Invalid bridge outcome.'; end if;
 if not exists(select 1 from public.factory_label_devices where id=p_device and owner=auth.uid() and enabled) then raise exception using errcode='42501',message='Bridge access denied.'; end if;
 select * into v_job from public.factory_label_jobs where id=p_job and device_id=p_device and claim_id=p_claim for update;
 if not found then raise exception 'Print claim unavailable.'; end if;
 if v_job.state=p_state then return jsonb_build_object('state',p_state); end if;
 if v_job.state<>'Printing' then return jsonb_build_object('state',v_job.state,'resolved',true); end if;
 update public.factory_label_jobs set state=p_state,detail=p_detail,updated_at=now() where id=p_job;
 insert into public.factory_label_events(job_id,state,actor,detail) values(p_job,p_state,v_actor,p_detail);
 return jsonb_build_object('state',p_state);
end $$;

create function public.factory_label_resolve(p_job uuid,p_state text,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.factory_label_actor('factory_production.verify'); v_job public.factory_label_jobs;
begin
 if p_state not in ('Confirmed','Failed','Unknown') or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'A physical confirmation or recovery reason is required.'; end if;
 select * into v_job from public.factory_label_jobs where id=p_job for update;
 if not found then raise exception 'Print unavailable.'; end if;
 if v_job.state=p_state then return jsonb_build_object('state',p_state); end if;
 if v_job.state not in ('Sent','Unknown') and not (v_job.state='Queued' and p_state='Failed') and not (v_job.state='Printing' and p_state='Unknown' and v_job.lease_until<now()) then raise exception 'This print cannot be resolved in its current state.'; end if;
 update public.factory_label_jobs set state=p_state,detail=p_reason,updated_at=now() where id=p_job;
 insert into public.factory_label_events(job_id,state,actor,detail) values(p_job,p_state,v_actor,p_reason);
 return jsonb_build_object('state',p_state);
end $$;

-- Only the RPC boundary may write. Tables have RLS and no browser grants.
alter table public.factory_label_templates enable row level security;
alter table public.factory_label_configs enable row level security;
alter table public.factory_label_snapshots enable row level security;
alter table public.factory_label_devices enable row level security;
alter table public.factory_label_jobs enable row level security;
alter table public.factory_label_events enable row level security;
revoke all on public.factory_label_templates,public.factory_label_configs,public.factory_label_snapshots,public.factory_label_devices,public.factory_label_jobs,public.factory_label_events from public,anon,authenticated;
-- Explicit signatures avoid granting internal helpers to API callers.
revoke all on function public.factory_label_actor(text),public.factory_label_immutable(),public.factory_label_candidate(uuid,jsonb),public.factory_label_settings(uuid),public.factory_label_save_config(uuid,jsonb,integer,uuid),public.factory_label_context(uuid,uuid,jsonb,integer),public.factory_label_enqueue(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid,text),public.factory_label_device(uuid,text,text,text,text,jsonb),public.factory_label_claim(uuid,uuid),public.factory_label_report(uuid,uuid,uuid,text,text),public.factory_label_resolve(uuid,text,text) from public,anon,authenticated;
grant execute on function public.factory_label_settings(uuid),public.factory_label_save_config(uuid,jsonb,integer,uuid),public.factory_label_context(uuid,uuid,jsonb,integer),public.factory_label_enqueue(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,uuid,text),public.factory_label_device(uuid,text,text,text,text,jsonb),public.factory_label_claim(uuid,uuid),public.factory_label_report(uuid,uuid,uuid,text,text),public.factory_label_resolve(uuid,text,text) to authenticated;
