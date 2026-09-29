-- This trusted role authority requires auth.uid(); the legacy explicit anon
-- EXECUTE grant is unnecessary even though the function rejects anonymous calls.
revoke execute on function public.save_role_configuration(uuid,jsonb,text[],uuid[])
  from public, anon;
grant execute on function public.save_role_configuration(uuid,jsonb,text[],uuid[])
  to authenticated;
