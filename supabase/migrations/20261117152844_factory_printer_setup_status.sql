create or replace function public.factory_label_management(p_section text default 'products',p_page integer default 1,p_search text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb; total integer; offset_rows integer:=(greatest(coalesce(p_page,1),1)-1)*20;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_section='products' then
  select count(*) into total from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where concat_ws(' ',f.product_code,f.product_name,fa.name_en) ilike '%'||p_search||'%';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name,x.id),'[]') into rows from (
   select f.id,f.product_code,coalesce(fa.name_en,f.product_name_en,f.product_name) product_name,f.variant_name,f.status,
   c.id config_id,c.version config_version,c.template_id,t.name template_name,t.version template_version,
   case when d.state='draft' then 'Draft' when c.id is not null then 'Approved' else 'Not configured' end configuration_status
   from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id
   left join lateral(select * from public.factory_label_configs where finished_good_id=f.id order by version desc limit 1)c on true
   left join public.factory_label_templates t on t.id=c.template_id
   left join public.factory_label_drafts d on d.kind='product' and d.entity_key=f.id::text
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
   (select count(*) from public.factory_label_jobs j where j.device_id=d.id and j.state='Unknown') unresolved_jobs
   from public.factory_label_devices d where concat_ws(' ',d.name,d.printer_name) ilike '%'||p_search||'%' order by name,id limit 20 offset offset_rows)x;
 else raise exception 'Unknown Label Management section.'; end if;
 return jsonb_build_object('rows',rows,'total',total);
end $$;

-- The computer may inspect its own queue before changing printers or running a local test.
create function public.factory_label_setup_queue(p_device uuid) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.factory_label_actor('factory_production.complete');
  if not exists (
    select 1 from public.factory_label_devices where id=p_device and owner=auth.uid() and enabled
  ) then raise exception using errcode='42501',message='Bridge access denied.'; end if;
  return (select count(*) from public.factory_label_jobs
    where device_id=p_device and state in ('Queued','Printing','Unknown'));
end $$;
revoke all on function public.factory_label_setup_queue(uuid) from public,anon,authenticated;
grant execute on function public.factory_label_setup_queue(uuid) to authenticated;

create index factory_label_jobs_unknown_device_idx on public.factory_label_jobs(device_id) where state='Unknown';
