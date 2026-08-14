-- 202608050028 intentionally grants Raw Material master metadata by column so
-- authenticated callers can never write current_balance directly. par_level was
-- added later, so it needs the same narrow grant; the existing RLS UPDATE policy
-- remains the authoritative factory_raw_inventory.edit guard.
grant update (par_level) on table public.factory_raw_materials to authenticated;
