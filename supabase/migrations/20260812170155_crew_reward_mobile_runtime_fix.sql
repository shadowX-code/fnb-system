-- PostgREST maps STABLE RPCs to read-only transactions. Crew session
-- resolution records token activity, so this token-bound RPC must be VOLATILE.
alter function public.crew_reward_mobile(text,date) volatile;
