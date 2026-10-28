-- Preserve provider-specific failures, public metadata and one in-flight read per identity.
do $patch$
declare original text;body text;needle text;
begin
 select pg_get_functiondef('public.marketing_creator_enrichment_begin(uuid,text,uuid)'::regprocedure) into original;
 needle:=' r:=public.marketing_creator_inspection_access(p_org,null,true);';
 if strpos(original,needle)=0 then raise exception 'Enrichment begin boundary changed';end if;
 body:=replace(original,needle,$new$
 if not pg_try_advisory_xact_lock(hashtextextended('creator-enrichment:'||p_org::text||':'||p_handle,0)) then return jsonb_build_object('eligible',false,'reason','profile_refresh_in_progress');end if;
 if exists(select 1 from marketing_private.creator_enrichment_requests where organization_id=p_org and handle=p_handle and delegation_epoch=(s->>'epoch')::uuid and generation=(s->>'generation')::int and state='pending' and expires_at>clock_timestamp()) then
  return jsonb_build_object('eligible',false,'reason','profile_refresh_in_progress');
 end if;
 r:=public.marketing_creator_inspection_access(p_org,null,true);$new$);execute body;
 select pg_get_functiondef('public.marketing_creator_followers_claim()'::regprocedure) into original;
 needle:=' if s is not null then perform marketing_private.creator_enrichment_lock(a.organization_id';
 if strpos(original,needle)=0 then raise exception 'Worker enrichment boundary changed';end if;
 body:=replace(original,needle,$new$
 if a.platform='instagram' then
  if not pg_try_advisory_xact_lock(hashtextextended('creator-enrichment:'||a.organization_id::text||':'||a.handle,0)) then return null;end if;
  if exists(select 1 from marketing_private.creator_enrichment_requests where organization_id=a.organization_id and handle=a.handle and delegation_epoch=(s->>'epoch')::uuid and generation=(s->>'generation')::int and state='pending' and expires_at>clock_timestamp()) then return null;end if;
 end if;
 if s is not null then perform marketing_private.creator_enrichment_lock(a.organization_id$new$);execute body;
 select pg_get_functiondef('public.marketing_creator_enrichment_finish(uuid,uuid,jsonb,text)'::regprocedure) into original;
 needle:='''provider_identity_mismatch'',''provider_profile_unavailable'',''provider_read_failed'',''meta_permission_or_token_invalid''';
 if strpos(original,needle)=0 then raise exception 'Enrichment failure boundary changed';end if;
 body:=replace(original,needle,needle||$reasons$,'profile_not_available_with_current_meta_access','meta_token_invalid','meta_permission_required','provider_rate_limited','provider_temporarily_unavailable'$reasons$);
 body:=replace(body,'followers_sync_status=''failed'',followers_sync_reason=''provider_read_failed''','followers_sync_status=case when p_error in (''profile_not_available_with_current_meta_access'',''provider_profile_unavailable'',''meta_token_invalid'',''meta_permission_required'',''meta_permission_or_token_invalid'') then ''unavailable'' else ''failed'' end,followers_sync_reason=p_error');
 body:=replace(body,'jsonb_build_object(''state'',''failed'',''reason'',''provider_read_failed'')','jsonb_build_object(''state'',''failed'',''reason'',p_error)');
 needle:=' if image is not null then o:=o||';
 if strpos(body,needle)=0 then raise exception 'Enrichment metadata boundary changed';end if;
 body:=replace(body,needle,$new$
 if jsonb_typeof(p_observation->'name')='string' then o:=o||jsonb_build_object('name',left(p_observation->>'name',160));end if;
 if jsonb_typeof(p_observation->'biography')='string' then o:=o||jsonb_build_object('biography',left(p_observation->>'biography',2000));end if;
 if jsonb_typeof(p_observation->'website')='string' then o:=o||jsonb_build_object('website',left(p_observation->>'website',500));end if;
 if jsonb_typeof(p_observation->'media_count')='number' and p_observation->>'media_count' ~ '^[0-9]{1,12}$' then o:=o||jsonb_build_object('media_count',p_observation->'media_count');end if;
 if image is not null then o:=o||$new$);
 execute body;
end;$patch$;
