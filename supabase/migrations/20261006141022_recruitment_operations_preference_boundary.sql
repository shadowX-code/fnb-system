-- Keep this UX refinement outside Interview Intelligence and provider runtime.
-- The observer was never deployed/called by an Edge Function; application data is preserved.
drop function public.recruitment_observe_preference(text,uuid,text,integer);
