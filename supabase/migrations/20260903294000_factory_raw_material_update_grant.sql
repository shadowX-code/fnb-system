-- Raw Material master data intentionally uses the established authenticated
-- table mutation path. RLS already enforces factory_raw_inventory.edit; this
-- restores the matching table ACL required by that policy.
grant update on table public.factory_raw_materials to authenticated;
