-- Retain the last reported calibration separately from transient queue discovery.
alter table public.factory_label_devices add column last_reported_calibration text;

create function public.factory_label_reported_calibration(p_printers jsonb,p_printer text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select item->>'Calibration'
 from jsonb_array_elements(case when jsonb_typeof(p_printers)='array' then p_printers else '[]'::jsonb end) discovery(item)
 where item->>'Name'=p_printer and item->>'Calibration' in ('Passed','Pending','Needs review','Single label passed')
 limit 1
$$;
revoke all on function public.factory_label_reported_calibration(jsonb,text) from public,anon,authenticated;

create or replace function public.factory_label_device(p_device uuid,p_name text,p_printer text,p_transport text,p_status text,p_printers jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.factory_label_actor('factory_production.complete');
 if length(btrim(p_name)) not between 1 and 100 or length(btrim(p_printer)) not between 1 and 200 or p_transport not in ('spooler','tspl') or length(p_printers::text)>20000 or p_status not in ('Ready','Offline','Error') then raise exception 'Invalid bridge configuration.'; end if;
 insert into public.factory_label_devices(id,owner,name,printer_name,transport,status,printers,last_reported_calibration) values(p_device,auth.uid(),p_name,p_printer,p_transport,p_status,p_printers,public.factory_label_reported_calibration(p_printers,p_printer))
 on conflict(id) do update set name=excluded.name,printer_name=excluded.printer_name,transport=excluded.transport,status=excluded.status,printers=excluded.printers,last_seen=now(),
 last_reported_calibration=coalesce(excluded.last_reported_calibration,case
   when factory_label_devices.printer_name=excluded.printer_name and factory_label_devices.transport=excluded.transport
   then coalesce(factory_label_devices.last_reported_calibration,public.factory_label_reported_calibration(factory_label_devices.printers,factory_label_devices.printer_name))
 end)
 where factory_label_devices.owner=auth.uid() and factory_label_devices.enabled;
 if not found then raise exception using errcode='42501',message='Bridge is disabled or belongs to another operator.'; end if;
 return jsonb_build_object('id',p_device);
end $$;

create or replace function public.factory_label_management(p_section text default 'products',p_page integer default 1,p_search text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; total integer; offset_rows integer:=(greatest(coalesce(p_page,1),1)-1)*20;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_section='products' then
  select count(*) into total from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name,x.id),'[]') into rows from (
   select f.id,f.product_code,coalesce(fa.name_en,f.product_name_en,f.product_name) product_name,f.variant_name,f.status,
   c.id config_id,c.version config_version,c.template_id,t.name template_name,t.version template_version,
   d.revision draft_revision, dt.name draft_template_name, dt.version draft_template_version,
   case when t.id is not null then 'Ready' when d.id is not null then 'Draft' else 'Not Configured' end configuration_status
   from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id
   left join lateral(select * from public.factory_label_configs where finished_good_id=f.id order by version desc limit 1)c on true
   left join public.factory_label_templates t on t.id=c.template_id
   left join public.factory_label_drafts d on d.kind='product' and d.entity_key=f.id::text and d.state='draft'
   left join public.factory_label_templates dt on dt.id::text=d.payload->>'template_id'
   where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%' order by product_name,f.id limit 20 offset offset_rows
  )x;
 elsif p_section='templates' then
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template') select count(*) into total from families where template_key ilike '%'||p_search||'%' or exists(select 1 from public.factory_label_templates where template_key=families.template_key and name ilike '%'||p_search||'%');
  with families as(select distinct template_key from public.factory_label_templates union select entity_key from public.factory_label_drafts where kind='template')
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.template_key),'[]') into rows from (
   select fam.template_key,coalesce(t.name,d.payload->>'name','New template') name,t.version,t.id,
    case when d.state='draft' then 'Draft' else 'Approved' end configuration_status,
    (select count(*) from public.factory_label_configs c where c.template_id=t.id and c.version=(select max(c2.version) from public.factory_label_configs c2 where c2.finished_good_id=c.finished_good_id)) assignments
   from families fam left join lateral(select * from public.factory_label_templates where template_key=fam.template_key order by version desc limit 1)t on true
   left join public.factory_label_drafts d on d.kind='template' and d.entity_key=fam.template_key
   where fam.template_key ilike '%'||p_search||'%' or t.name ilike '%'||p_search||'%' or d.payload->>'name' ilike '%'||p_search||'%' order by name,fam.template_key limit 20 offset offset_rows
  )x;
 elsif p_section='printers' then
  select count(*) into total from public.factory_label_devices where concat_ws(' ',name,printer_name) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into rows from (select d.id,d.name,d.printer_name,d.transport,d.enabled,d.status,d.printers,d.last_seen,
   coalesce(d.last_reported_calibration,public.factory_label_reported_calibration(d.printers,d.printer_name)) calibration_status,
   (select count(*) from public.factory_label_jobs j where j.device_id=d.id and j.state='Unknown') unresolved_jobs
   from public.factory_label_devices d where concat_ws(' ',d.name,d.printer_name) ilike '%'||p_search||'%' order by name,id limit 20 offset offset_rows)x;
 else raise exception 'Unknown Label Management section.'; end if;
 return jsonb_build_object('rows',rows,'total',total);
end $$;
