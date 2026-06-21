-- Factory raw material image URL support.
-- URL-only field; no file storage or receiving logic changes.

alter table public.factory_raw_materials
  add column if not exists image_url text;
