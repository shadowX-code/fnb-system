-- The selectable catalog contains active versions. Older assignments remain available for rendering.
create or replace function public.factory_label_editor(p_kind text,p_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 published jsonb;
 sku jsonb;
 templates jsonb;
 active_template_ids jsonb;
 history jsonb;
 draft jsonb;
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
 select to_jsonb(d) into draft
 from public.factory_label_drafts d where kind=p_kind and entity_key=p_key;

 with pinned as (
  select t.id,t.template_key from public.factory_label_templates t
  where p_kind='product' and (
   t.id::text=published->>'template_id'
   or (draft->>'state'='draft' and t.id::text=draft->'payload'->>'template_id')
  )
 ), catalog as (
  select distinct on (template_key) id
  from public.factory_label_templates order by template_key,version desc limit 100
 ), active as (
  select id from catalog
  union
  select newest.id from (select distinct template_key from pinned) p
  cross join lateral (
   select t.id from public.factory_label_templates t
   where t.template_key=p.template_key order by t.version desc limit 1
  ) newest
 ), available as (
  select id from active
  union
  select id from pinned
 )
 select
  coalesce(jsonb_agg(to_jsonb(t) order by (a.id is not null) desc,t.name,t.id),'[]'),
  coalesce(jsonb_agg(t.id order by t.name,t.id) filter (where a.id is not null),'[]')
 into templates,active_template_ids
 from available v
 join public.factory_label_templates t on t.id=v.id
 left join active a on a.id=v.id;

 return jsonb_build_object('published',published,'sku',sku,'draft',draft,
  'templates',templates,'active_template_ids',active_template_ids,'history',history);
end $$;
