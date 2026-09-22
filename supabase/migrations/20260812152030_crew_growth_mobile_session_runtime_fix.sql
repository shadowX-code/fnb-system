-- crew_session_employee refreshes session last_seen_at. The Crew Growth
-- boundary must therefore be VOLATILE rather than STABLE so PostgREST does
-- not execute it in a read-only transaction.
alter function public.crew_growth_mobile(text) volatile;

revoke all on function public.crew_growth_mobile(text) from public, anon, authenticated;
grant execute on function public.crew_growth_mobile(text) to anon, authenticated;
