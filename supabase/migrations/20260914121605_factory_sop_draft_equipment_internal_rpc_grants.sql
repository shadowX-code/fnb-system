-- Keep the renamed lifecycle implementations internal.  The public wrappers
-- are the canonical authority boundaries for Draft save and activation.
revoke all on function public.factory_save_production_sop_structure_impl_20260914(
  uuid,
  uuid,
  text,
  date,
  text,
  uuid,
  text,
  jsonb,
  uuid,
  uuid[]
) from public, anon, authenticated;

revoke all on function public.factory_activate_production_sop_impl_20260914(uuid)
  from public, anon, authenticated;
