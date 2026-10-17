-- Routine event objects may be compacted only after review, never by age alone.
-- Minimal replay/authority evidence is intentionally retained and reviewed every 30 days.
create table marketing_private.privacy_compactions (
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 manifest jsonb not null, object_path text not null,
 created_at timestamptz not null default now(), reviewed_at timestamptz not null,
 checkpoint_verified_at timestamptz, completed_at timestamptz
);
create table marketing_private.privacy_retention_reviews (
 id bigint generated always as identity primary key,
 batch_id text not null references marketing_private.privacy_compactions(id),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 reviewed_at timestamptz not null default now()
);
alter table marketing_private.privacy_compactions enable row level security;
alter table marketing_private.privacy_retention_reviews enable row level security;
revoke all on marketing_private.privacy_compactions,marketing_private.privacy_retention_reviews from public,anon,authenticated,service_role;
alter table marketing_private.privacy_recovery_intents
 add column compaction_id text references marketing_private.privacy_compactions(id),
 add column routine_deleted_at timestamptz;
create index privacy_compaction_pending on marketing_private.privacy_recovery_intents(compaction_id) where routine_deleted_at is null;

create function public.marketing_privacy_retention(p_action text,p_ids text[] default null,p_evidence text default null,p_batch text default null)
returns jsonb language plpgsql security definer set search_path=public set statement_timeout='8s' as $$
declare ids text[]; i marketing_private.privacy_recovery_intents; b marketing_private.privacy_compactions; m jsonb; batch text; prefix text;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Privacy operator service required.';end if;
 if p_action='status' then
  return jsonb_build_object('routine_days',90,'review_days',30,
   'routine_due',(select count(*) from marketing_private.privacy_recovery_intents where created_at<=now()-interval '90 days' and routine_deleted_at is null),
   'reviews_due',(select count(*) from marketing_private.privacy_compactions where reviewed_at<=now()-interval '30 days'),
   'pending_batches',(select coalesce(jsonb_agg(id),'[]') from marketing_private.privacy_compactions where completed_at is null));
 end if;
 if p_action='prepare' then
  if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 25 or coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' then raise exception 'Bounded scope and review evidence required.';end if;
  select array_agg(distinct v order by v) into ids from unnest(p_ids) v where v ~ '^[a-f0-9]{64}$';
  if cardinality(ids) is distinct from cardinality(p_ids) then raise exception 'Invalid or duplicate event scope.';end if;
  perform 1 from marketing_private.privacy_recovery_intents where id=any(ids) order by id for update;
  if (select count(*) from marketing_private.privacy_recovery_intents where id=any(ids))<>cardinality(ids) then raise exception 'Journal scope missing.';end if;
  for i in select * from marketing_private.privacy_recovery_intents where id=any(ids) order by id loop
   if i.created_at>now()-interval '90 days' or i.stored_at is null or i.stored_at>now()-interval '90 days' or i.digest is null or
    i.digest<>encode(extensions.digest(i.payload::text,'sha256'),'hex') then raise exception 'Routine evidence is not eligible.';end if;
   if i.payload->>'method'='hold_release' then
    if exists(select 1 from marketing_private.inbox_legal_holds where conversation_id=(i.payload->>'conversation_id')::uuid) then raise exception 'Legal hold remains active.';end if;
   elsif not exists(select 1 from marketing_private.privacy_cases c where c.case_hash=i.payload->>'case_hash' and c.local_completed_at is not null and c.completed_at is not null
    and c.backup_state<>'pending' and c.processor_state<>'pending' and c.held_conversations=0 and c.followup_evidence_hash is not null) then raise exception 'Verified privacy follow-up required.';
   end if;
   if exists(select 1 from marketing_private.inbox_legal_holds h where h.case_hash=i.payload->>'case_hash' or h.conversation_id in
    (select (v->>'conversation_id')::uuid from jsonb_array_elements(coalesce(i.payload->'peers','[]')) v)) then raise exception 'Legal hold remains active.';end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',id,'digest',digest) order by id),
   encode(extensions.digest(string_agg(id||':'||digest,E'\n' order by id),'sha256'),'hex'),
   min(split_part(object_path,'/erasure/',1)||'/erasure/checkpoints/v1/')
   into m,batch,prefix from marketing_private.privacy_recovery_intents where id=any(ids);
  if exists(select 1 from marketing_private.privacy_recovery_intents where id=any(ids) and (compaction_id is not null and compaction_id<>batch or object_path<>split_part(prefix,'/checkpoints/',1)||'/v1/'||id||'.json')) then raise exception 'Compaction scope changed.';end if;
  insert into marketing_private.privacy_compactions(id,manifest,object_path,reviewed_at) values(batch,m,prefix||batch||'.json',now())
   on conflict(id) do update set reviewed_at=now();
  update marketing_private.privacy_recovery_intents set compaction_id=batch where id=any(ids);
  insert into marketing_private.privacy_retention_reviews(batch_id,evidence_hash) values(batch,p_evidence);
  return jsonb_build_object('batch_id',batch);
 end if;
 select * into b from marketing_private.privacy_compactions where id=p_batch for update;
 if b.id is null then raise exception 'Compaction not found.';end if;
 if p_action='review' then
  if coalesce(p_evidence,'') !~ '^[a-f0-9]{64}$' then raise exception 'Review evidence required.';end if;
  insert into marketing_private.privacy_retention_reviews(batch_id,evidence_hash) values(b.id,p_evidence);
  update marketing_private.privacy_compactions set reviewed_at=now() where id=b.id;
  return jsonb_build_object('review_due',now()+interval '30 days');
 end if;
 if b.reviewed_at<=now()-interval '30 days' then raise exception 'Retention review expired.';end if;
 if p_action in ('material','ack','finish') then
  -- Checkpoint contains all replay evidence, including holds, even if a hold is added later.
  -- Current holds still stop routine deletion. Recovery never depends on this SQL manifest.
  if exists(select 1 from marketing_private.privacy_recovery_intents x join marketing_private.inbox_legal_holds h on
   h.case_hash=x.payload->>'case_hash' or h.conversation_id=(x.payload->>'conversation_id')::uuid or
   h.conversation_id in(select (v->>'conversation_id')::uuid from jsonb_array_elements(coalesce(x.payload->'peers','[]')) v)
   where x.compaction_id=b.id) then raise exception 'Legal hold remains active.';end if;
  if p_action='ack' then update marketing_private.privacy_compactions set checkpoint_verified_at=coalesce(checkpoint_verified_at,now()) where id=b.id;
  elsif p_action='finish' then
   if b.checkpoint_verified_at is null then raise exception 'Verified checkpoint required.';end if;
   update marketing_private.privacy_recovery_intents set routine_deleted_at=coalesce(routine_deleted_at,now()) where compaction_id=b.id;
   update marketing_private.privacy_compactions set completed_at=coalesce(completed_at,now()) where id=b.id;
   return jsonb_build_object('status','compacted','review_due',b.reviewed_at+interval '30 days');
  end if;
  return jsonb_build_object('batch_id',b.id,'path',b.object_path,'manifest',b.manifest,'verified',b.checkpoint_verified_at is not null,
   'records',(select jsonb_agg(jsonb_build_object('id',id,'raw',payload::text,'path',object_path) order by id) from marketing_private.privacy_recovery_intents where compaction_id=b.id));
 end if;
 raise exception 'Unknown retention action.';
end;$$;
revoke all on function public.marketing_privacy_retention(text,text[],text,text) from public,anon,authenticated;
grant execute on function public.marketing_privacy_retention(text,text[],text,text) to service_role;
