-- Factory Finished Goods UI master fields.

alter table public.factory_finished_goods
  add column if not exists product_name_en text,
  add column if not exists product_name_cn text,
  add column if not exists product_name_bm text;

update public.factory_finished_goods
set product_name_en = coalesce(nullif(trim(product_name_en), ''), product_name)
where product_name is not null;
