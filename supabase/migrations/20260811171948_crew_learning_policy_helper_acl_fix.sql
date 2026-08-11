
-- RLS policy predicates execute as the request role, so these two scope-only
-- helpers need an explicit authenticated grant. Both helpers return only a
-- boolean and independently enforce the matching manage permission.
revoke all on function public.crew_learning_admin_can_access_journey(uuid) from public, anon, authenticated;
grant execute on function public.crew_learning_admin_can_access_journey(uuid) to authenticated;
revoke all on function public.crew_sop_admin_can_access_sop(uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_admin_can_access_sop(uuid) to authenticated;
