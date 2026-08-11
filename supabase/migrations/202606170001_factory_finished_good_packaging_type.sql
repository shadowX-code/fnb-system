alter table public.factory_finished_goods
  add column if not exists packaging_type text not null default 'Pack';

update public.factory_finished_goods
set packaging_type = 'Pack'
where packaging_type is null or trim(packaging_type) = '';

