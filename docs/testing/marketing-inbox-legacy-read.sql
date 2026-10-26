-- Staging-only contract, inside the atomic release rehearsal after applying the candidate.
-- The harness must remove both Staging-only columns and restore all DDL/data on rollback.
do $legacy_contract$
declare org_ uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1';v jsonb;r jsonb;queue_ text;
begin
 assert exists(select 1 from organizations where id=org_),'Wrong test environment';
 assert not exists(select 1 from information_schema.columns where table_schema='public' and table_name='marketing_inbox_reads' and column_name='remind_at'),'Reminder column masks legacy-schema incompatibility';
 assert not exists(select 1 from information_schema.columns where table_schema='marketing_private' and table_name='inbox_automatic_turns' and column_name='batch_first_sequence'),'Batch column masks legacy-schema incompatibility';
 perform set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 v:=public.marketing_inbox_read(org_);
 assert v->>'view'='all','Default All read unavailable';
 foreach queue_ in array array['all','needs_reply','mine','ai_handoff'] loop
  r:=public.marketing_inbox_read(p_org=>org_,p_view=>queue_);
  assert r->>'view'=queue_ and (r->>'total')::integer=(v->'view_counts'->>queue_)::integer,'Legacy-schema queue/count mismatch';
 end loop;
end;$legacy_contract$;
