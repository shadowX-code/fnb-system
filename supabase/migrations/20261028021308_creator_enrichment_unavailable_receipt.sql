-- URL-only saves may carry one current diagnostic receipt, never provider facts from a failed lookup.
do $patch$
declare body text;needle text;
begin
 select pg_get_functiondef('public.marketing_creator_enrichment_finish(uuid,uuid,jsonb,text)'::regprocedure) into body;
 needle:='return jsonb_build_object(''state'',''failed'',''reason'',p_error);';
 if strpos(body,needle)=0 then raise exception 'Enrichment failure acknowledgement changed';end if;
 body:=replace(body,needle,$new$
  update marketing_private.creator_enrichment_requests set expires_at=clock_timestamp()+interval '5 minutes' where id=r.id;
  return jsonb_build_object('state','failed','reason',p_error,'enrichment_receipt',case when r.account_id is null then r.id end);$new$);execute body;
 select pg_get_functiondef('marketing_private.creator_enrichment_payload(uuid,text,uuid,jsonb,boolean)'::regprocedure) into body;
 needle:='r.state<>''ready''';if strpos(body,needle)=0 then raise exception 'Profile receipt eligibility changed';end if;
 body:=replace(body,needle,'r.state not in (''ready'',''failed'')');
 needle:='if (a.identity_verified';if strpos(body,needle)=0 then raise exception 'Verified profile boundary changed';end if;
 body:=replace(body,needle,'if r.state=''ready'' and (a.identity_verified');execute body;
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into body;
 needle:='followers_sync_reason=case when q.observation?''followers'' then null else ''followers_not_returned'' end';
 if strpos(body,needle)=0 then raise exception 'Saved receipt status projection changed';end if;
 body:=replace(body,needle,'followers_sync_reason=case when q.state=''failed'' then q.failure_reason when q.observation?''followers'' then null else ''followers_not_returned'' end');
 -- Existing successful observations stay on their daily schedule; transient failures can retry through the same queue later.
 needle:='followers_due_at=clock_timestamp()+interval ''1 day''';
 if strpos(body,needle)=0 then raise exception 'Saved receipt refresh schedule changed';end if;
 body:=replace(body,needle,'followers_due_at=clock_timestamp()+case when q.state=''failed'' and q.failure_reason in (''provider_rate_limited'',''provider_temporarily_unavailable'',''provider_read_failed'') then interval ''1 hour'' else interval ''1 day'' end');execute body;
end;$patch$;
