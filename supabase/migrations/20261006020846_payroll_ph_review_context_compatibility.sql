-- Schema-only absent -> null additions are not a PH evidence change.
-- Keep original snapshots/hashes immutable and current-save concurrency exact.
create function public.payroll_ph_review_context_matches(p_saved jsonb, p_fingerprint text, p_current jsonb)
returns boolean language sql immutable set search_path = public as $$
 select coalesce(
   p_fingerprint = md5(p_saved::text)
   and (case when p_saved #> '{employment,employment_jurisdiction}' is null
                   or p_saved #> '{employment,employment_jurisdiction}' = 'null'::jsonb
        then p_saved #- '{employment,employment_jurisdiction}' else p_saved end)
       = (case when p_current #> '{employment,employment_jurisdiction}' is null
                   or p_current #> '{employment,employment_jurisdiction}' = 'null'::jsonb
          then p_current #- '{employment,employment_jurisdiction}' else p_current end), false);
$$;
revoke all on function public.payroll_ph_review_context_matches(jsonb,text,jsonb) from public, anon, authenticated;

-- Patch only the persisted-review lifecycle checks. Keep raw context/quote
-- fingerprints and the confirm command's optimistic concurrency checks intact.
do $$
declare original text; patched text;
begin
 original := pg_get_functiondef('public.payroll_ph_statutory_project(uuid,uuid,date)'::regprocedure);
 patched := replace(original,
   'review.context_fingerprint is distinct from md5(context::text)',
   'not public.payroll_ph_review_context_matches(review.context,review.context_fingerprint,context)');
 if patched = original then raise exception 'PH project lifecycle definition drift'; end if;
 execute patched;
 original := pg_get_functiondef('public.payroll_ph_treatment_quote_legacy(uuid,uuid,date,jsonb)'::regprocedure);
 if (length(original)-length(replace(original,'prior.context_fingerprint=md5(original::text)','')))
    / length('prior.context_fingerprint=md5(original::text)') <> 2 then
   raise exception 'PH legacy quote lifecycle definition drift';
 end if;
 execute replace(original,'prior.context_fingerprint=md5(original::text)',
   'public.payroll_ph_review_context_matches(prior.context,prior.context_fingerprint,original)');
end $$;
