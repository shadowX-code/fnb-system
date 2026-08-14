alter table public.factory_raw_materials
  add column if not exists par_level numeric;

alter table public.factory_raw_materials
  drop constraint if exists factory_raw_materials_par_level_nonnegative;

alter table public.factory_raw_materials
  add constraint factory_raw_materials_par_level_nonnegative
  check (par_level is null or par_level >= 0);
