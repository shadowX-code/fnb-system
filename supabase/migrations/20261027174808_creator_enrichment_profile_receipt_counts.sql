-- Persist the already-authorized one-use profile receipt's follower evidence at the same canonical save boundary.
do $patch$
declare original text;needle text;body text;
begin
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into original;
 needle:=$old$  if p_payload?'public_observation' then
  update public.marketing_creator_accounts set public_observation=public_observation||jsonb_build_object('request_id',p_payload->>'profile_enrichment_receipt','connection_id',p_payload->'public_observation'->'connection_id','connection_generation',p_payload->'public_observation'->'connection_generation','delegation_epoch',p_payload->'public_observation'->'delegation_epoch') where id=a.id returning * into a;
  end if;
$old$;
 if strpos(original,needle)=0 then raise exception 'Delegated profile receipt boundary changed.';end if;
 body:=replace(original,needle,$new$  update public.marketing_creator_accounts ca set
   public_observation=case when p_payload?'public_observation' then ca.public_observation||jsonb_build_object('request_id',q.id,'connection_id',q.connection_id,'connection_generation',q.generation,'delegation_epoch',q.delegation_epoch) else ca.public_observation end,
   followers=coalesce((q.observation->>'followers')::bigint,ca.followers),
   followers_source=case when q.observation?'followers' then 'meta_instagram_business_discovery' else ca.followers_source end,
   followers_captured_at=case when q.observation?'followers' then (q.observation->>'captured_at')::timestamptz else ca.followers_captured_at end,
   followers_sync_status=case when q.observation?'followers' then 'ready' else 'unavailable' end,
   followers_sync_reason=case when q.observation?'followers' then null else 'followers_not_returned' end,
   followers_due_at=clock_timestamp()+interval '1 day'
  from marketing_private.creator_enrichment_requests q where ca.id=a.id and q.id=(p_payload->>'profile_enrichment_receipt')::uuid returning ca.* into a;
$new$);
 execute body;
end;$patch$;
