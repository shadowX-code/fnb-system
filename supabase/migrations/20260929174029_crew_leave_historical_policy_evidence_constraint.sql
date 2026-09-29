-- SQL CHECK treats NULL as passing. Require a non-null reference for every
-- historical version as defense in depth behind the trusted save RPC.
alter table public.crew_leave_policy_versions
  drop constraint crew_leave_policy_historical_evidence_check;
alter table public.crew_leave_policy_versions
  add constraint crew_leave_policy_historical_evidence_check
    check (source_kind<>'historical_baseline' or
      (length(btrim(reason)) between 3 and 500 and
       evidence_reference is not null and
       length(btrim(evidence_reference)) between 3 and 500 and
       next_verified_version_id is not null));
