-- Drafts retain access to their pinned historical layout even after a newer shared version is published.
create or replace function public.factory_label_editor(p_kind text,p_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare published jsonb; sku jsonb; templates jsonb; history jsonb;
begin
 perform public.factory_label_actor('factory_finished_goods.view');
 if p_kind='product' then
  select to_jsonb(c) into published from public.factory_label_configs c where finished_good_id=p_key::uuid order by version desc limit 1;
  select jsonb_build_object('id',f.id,'product_code',f.product_code,'product_name',coalesce(fa.name_en,f.product_name_en,f.product_name),'product_name_cn',coalesce(fa.name_cn,f.product_name_cn,''),'product_name_bm',coalesce(fa.name_bm,f.product_name_bm,''),'pack_size_qty',f.pack_size_qty,'pack_size_uom',f.pack_size_uom,'shelf_life_days',f.shelf_life_days) into sku from public.factory_finished_goods f left join public.factory_product_families fa on fa.id=f.product_family_id where f.id=p_key::uuid;
  if sku is null then raise exception 'Packaging SKU unavailable.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,template_id,approval_note,created_at,created_by from public.factory_label_configs where finished_good_id=p_key::uuid order by version desc limit 20)x;
 elsif p_kind='template' then
  select to_jsonb(t) into published from public.factory_label_templates t where template_key=p_key order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x) order by version desc),'[]') into history from(select id,version,name,created_at,created_by from public.factory_label_templates where template_key=p_key order by version desc limit 20)x;
 else raise exception 'Unknown label editor.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by name),'[]') into templates from (
  select distinct on (template_key) * from public.factory_label_templates order by template_key,version desc limit 100
 )x;
 -- Include an older pinned assignment without silently upgrading to the latest template.
 if p_kind='product' and published is not null and not exists(select 1 from jsonb_array_elements(templates) t where t->>'id'=published->>'template_id') then
  templates:=templates||coalesce((select jsonb_build_array(to_jsonb(t)) from public.factory_label_templates t where id=(published->>'template_id')::uuid),'[]');
 end if;
 if p_kind='product' then
  templates:=templates||coalesce((select jsonb_agg(to_jsonb(t)) from public.factory_label_templates t join public.factory_label_drafts d on d.kind='product' and d.entity_key=p_key and d.state='draft' and t.id=(d.payload->>'template_id')::uuid where not exists(select 1 from jsonb_array_elements(templates) existing where existing->>'id'=t.id::text)),'[]'::jsonb);
 end if;
 return jsonb_build_object('published',published,'sku',sku,'draft',(select to_jsonb(d) from public.factory_label_drafts d where kind=p_kind and entity_key=p_key),'templates',templates,'history',history);
end $$;
