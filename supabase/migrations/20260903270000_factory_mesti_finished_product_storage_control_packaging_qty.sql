-- The batch opening quantity is Packaging SKU count, not the Finished Good base UOM.

create or replace function public.factory_mesti_finished_product_storage_control(
  p_date_from date default null,
  p_date_to date default null,
  p_product_family_id uuid default null,
  p_packaging_sku_id uuid default null,
  p_storage_location_id uuid default null,
  p_search text default null
)
returns table (
  id uuid, production_id uuid, job_order_id uuid, job_order_no text, production_no text,
  completed_at timestamptz, completion_date date, finished_good_id uuid, finished_good_name text,
  packaging_sku_id uuid, packaging_sku_code text, packaging_sku_name text, completed_qty numeric,
  completed_uom text, storage_location_id uuid, storage_location_name text, batch_no text,
  manufacturing_date date, expiry_date date, completed_by uuid, completed_by_name text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not (public.current_user_has_permission('factory_mesti_cleaning.view') or public.current_user_has_permission('factory_mesti_cleaning.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to view Finished Product Storage Control.';
  end if;
  return query
  select balance.id, production.id, job.id, job.job_order_no, production.production_no,
    production.completed_at, production.completed_at::date,
    product_family.id, coalesce(product_family.name_en, finished_good.product_name_en, finished_good.product_name),
    finished_good.id, finished_good.product_code, coalesce(finished_good.product_name_en, finished_good.product_name),
    balance.opening_qty, coalesce(nullif(btrim(finished_good.packaging_type), ''), 'Pack'), balance.storage_location_id,
    coalesce(location.location_name, balance.storage_location), balance.batch_no, balance.manufacturing_date,
    balance.expiry_date, production.created_by, coalesce(completer.nickname, completer.full_name, completer.email)
  from public.factory_finished_good_batch_balances balance
  join public.factory_productions production on production.id = balance.production_id
  join public.factory_finished_goods finished_good on finished_good.id = balance.finished_good_id
  left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
  left join public.factory_job_orders job on job.id = production.job_order_id
  left join public.factory_storage_locations location on location.id = balance.storage_location_id
  left join public.employees completer on completer.id = production.created_by
  where balance.source_type = 'production' and lower(coalesce(production.status, '')) = 'completed'
    and (p_date_from is null or production.completed_at::date >= p_date_from)
    and (p_date_to is null or production.completed_at::date <= p_date_to)
    and (p_product_family_id is null or finished_good.product_family_id = p_product_family_id)
    and (p_packaging_sku_id is null or finished_good.id = p_packaging_sku_id)
    and (p_storage_location_id is null or balance.storage_location_id = p_storage_location_id)
    and (nullif(btrim(p_search), '') is null or concat_ws(' ', job.job_order_no, production.production_no,
      balance.batch_no, product_family.name_en, finished_good.product_code, finished_good.product_name_en,
      finished_good.product_name, coalesce(location.location_name, balance.storage_location)) ilike '%' || btrim(p_search) || '%')
  order by production.completed_at desc, balance.created_at desc, balance.id desc;
end;
$$;
