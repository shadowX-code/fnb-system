-- Current account eligibility for normal-mode formats; legacy grants/leases remain immutable.
-- Runtime normal mode is independently required at every Worker submission boundary.
CREATE OR REPLACE FUNCTION marketing_private.format_authorizations(c public.marketing_connections)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare eligible boolean; fb boolean; ig boolean; k text; routine boolean; temporary boolean; result jsonb:='{}';t timestamptz:=clock_timestamp();
begin
 eligible:=c.status in ('test_authorized','production_authorized') and c.expires_at>t
  and c.capabilities->>'publishing'='true' and c.capabilities->>'execution_enabled'='true';
 fb:=coalesce(c.channel='facebook' and c.facebook_video_generation=c.credential_generation
  and c.facebook_video_authorized_at<=t and c.facebook_video_expires_at>t
  and c.facebook_video_expires_at<=c.facebook_video_authorized_at+interval '30 minutes',false);
 ig:=coalesce(c.channel='instagram' and c.instagram_extended_enabled and c.instagram_extended_generation=c.credential_generation
  and c.instagram_extended_authorized_at<=t and c.instagram_extended_expires_at>t
  and c.instagram_extended_expires_at<=c.instagram_extended_authorized_at+interval '20 minutes',false);
 foreach k in array array['facebook_video','facebook_reel','instagram_mixed_carousel','instagram_video_carousel'] loop
  routine:=coalesce(c.routine_publishing_generation=c.credential_generation and k=any(c.routine_publishing_formats),false);
  temporary:=case when k like 'facebook_%' then fb else ig end;
  result:=result||jsonb_build_object(k,case when eligible and routine<>temporary
   and (case k when 'facebook_video' then c.channel='facebook' and c.capabilities->'formats' ? 'video'
    when 'facebook_reel' then c.channel='facebook' and c.capabilities->'formats' ? 'reel'
    else c.channel='instagram' and c.capabilities->'formats' ? 'carousel' end)
   then case when routine then 'routine' else 'temporary' end else null end);
 end loop;
 return result||jsonb_build_object('normal_formats',case when eligible then
  (select coalesce(jsonb_agg(candidate.format_key),'[]'::jsonb) from unnest(array['facebook_video','facebook_reel','instagram_mixed_carousel']) candidate(format_key)
   where case candidate.format_key when 'facebook_video' then c.channel='facebook' and c.capabilities->'formats' ? 'video'
    when 'facebook_reel' then c.channel='facebook' and c.capabilities->'formats' ? 'reel'
    else c.channel='instagram' and c.capabilities->'formats' ? 'carousel' end)
  else '[]'::jsonb end); -- Stories are deliberately absent; conflicting authority fails closed.
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_job_guard(p_job uuid, p_lease uuid, p_submission boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j public.marketing_jobs; result jsonb; video_allowed boolean; instagram_allowed boolean; checked_at timestamptz; formats jsonb; format_key text;
begin
 select * into j from public.marketing_jobs where id=p_job;
 if not found or j.state not in ('leased','reconciling') or j.lease_token is distinct from p_lease or p_lease is null or j.lease_expires_at<=now()
 or not marketing_private.job_authorized(j) then raise exception 'Publishing authority or lease expired.';end if;
 select to_jsonb(conn) into result from public.marketing_connections conn join public.marketing_content c on c.id=j.content_id
 where conn.id=j.connection_id and conn.credential_generation=j.connection_generation and conn.status in ('test_authorized','production_authorized')
 and conn.expires_at>now() and conn.capabilities->>'publishing'='true' and conn.capabilities->>'execution_enabled'='true'
 and c.revision=j.revision and c.approved_revision=j.revision and c.status in ('scheduled','failed') for share of conn;
 if result is null then raise exception 'Connection or approved revision changed.';end if;
 checked_at:=clock_timestamp();
 video_allowed:=coalesce((result->>'facebook_video_generation')::integer=j.connection_generation
  and (result->>'facebook_video_authorized_at')::timestamptz<=checked_at
  and (result->>'facebook_video_expires_at')::timestamptz>checked_at
  and (result->>'facebook_video_expires_at')::timestamptz<=(result->>'facebook_video_authorized_at')::timestamptz+interval '30 minutes',false);
 instagram_allowed:=coalesce((result->>'instagram_extended_enabled')::boolean
  and (result->>'instagram_extended_generation')::integer=j.connection_generation
  and (result->>'instagram_extended_authorized_at')::timestamptz<=checked_at
  and (result->>'instagram_extended_expires_at')::timestamptz>checked_at
  and (result->>'instagram_extended_expires_at')::timestamptz<=(result->>'instagram_extended_authorized_at')::timestamptz+interval '20 minutes',false);
 select marketing_private.format_authorizations(conn) into formats from public.marketing_connections conn where conn.id=j.connection_id;
 select case when v->>'channel'='facebook' and v->>'format'='video' then 'facebook_video'
  when v->>'channel'='facebook' and v->>'format'='reel' then 'facebook_reel'
  when v->>'channel'='instagram' and v->>'format'='story' then 'instagram_story'
  when v->>'channel'='instagram' and v->>'format'='carousel' and exists(select 1 from jsonb_array_elements_text(v->'asset_ids') a join public.marketing_assets m on m.id=a.value::uuid where m.mime_type='video/mp4') then case when exists(select 1 from jsonb_array_elements_text(v->'asset_ids') a join public.marketing_assets m on m.id=a.value::uuid where m.mime_type like 'image/%') then 'instagram_mixed_carousel' else 'instagram_video_carousel' end end
 into format_key from public.marketing_content_revisions r cross join jsonb_array_elements(r.payload->'variants') v
 where r.content_id=j.content_id and r.revision=j.revision and v->>'channel'=j.channel;
 if p_submission and format_key is not null and not coalesce((j.provider_state->>'format_authorization_kind'='routine'
   and (formats->>format_key='routine' or formats->'normal_formats' ? format_key))
   or (j.provider_state->>'format_authorization_kind'='temporary' and formats->>format_key='temporary'),false) then raise exception 'Current publishing eligibility or prepared format changed. Recheck the account and saved revision.';end if;
 return result||jsonb_build_object('facebook_video_authorized',video_allowed,'instagram_extended_authorized',instagram_allowed,'format_authorizations',formats);
end;$function$;

revoke all on function marketing_private.format_authorizations(public.marketing_connections) from public,anon,authenticated;
revoke all on function public.marketing_job_guard(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.marketing_job_guard(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
