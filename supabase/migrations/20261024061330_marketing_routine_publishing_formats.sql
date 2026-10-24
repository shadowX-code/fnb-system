-- Default-off routine format grants; existing QA leases and account gates remain independent.
alter table public.marketing_connections
 add column routine_publishing_formats text[] not null default '{}',
 add column routine_publishing_generation integer,
 add constraint marketing_routine_format_scope check (
  array_position(routine_publishing_formats,null) is null
  and ((cardinality(routine_publishing_formats)=0 and routine_publishing_generation is null)
   or(cardinality(routine_publishing_formats)>0 and routine_publishing_generation is not null and routine_publishing_generation>0))
  and case channel when 'facebook' then routine_publishing_formats<@array['facebook_video','facebook_reel']::text[]
   when 'instagram' then routine_publishing_formats<@array['instagram_mixed_carousel']::text[]
   else cardinality(routine_publishing_formats)=0 end);

create function marketing_private.format_authorizations(c public.marketing_connections) returns jsonb
language plpgsql volatile set search_path=public as $$
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
 return result; -- Stories are deliberately absent; conflicting authority fails closed.
end;$$;
revoke all on function marketing_private.format_authorizations(public.marketing_connections) from public,anon,authenticated;

-- Six explicit arguments cannot conflict with the existing defaulted three/five-argument API.
create function public.marketing_meta_execution_policy(p_connection uuid,p_generation integer,p_enabled boolean,
 p_format text,p_expires_at timestamptz,p_authorization text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; formats text[]; accepted uuid; temporary jsonb;
begin
 if p_authorization is distinct from 'routine' or p_enabled is null or p_expires_at is not null
  or p_format not in('facebook_video','facebook_reel','instagram_mixed_carousel') or p_format is null then raise exception 'Invalid routine format policy.';end if;
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found or c.credential_generation is distinct from p_generation
  or (c.channel='facebook' and p_format not in('facebook_video','facebook_reel'))
  or (c.channel='instagram' and p_format<>'instagram_mixed_carousel')
  or c.channel not in('facebook','instagram') then raise exception 'Connection or format authority changed.';end if;
 formats:=case when c.routine_publishing_generation=p_generation then c.routine_publishing_formats else '{}'::text[] end;
 if p_enabled then
  if c.status not in('test_authorized','production_authorized') or c.expires_at<=clock_timestamp() or c.expires_at is null
   or c.capabilities->>'publishing' is distinct from 'true' or c.capabilities->>'execution_enabled' is distinct from 'true'
   or not coalesce(c.capabilities->'formats' ? case p_format when 'facebook_video' then 'video' when 'facebook_reel' then 'reel' else 'carousel' end,false)
   then raise exception 'Current publishing eligibility is required.';end if;
  if (c.channel='facebook' and c.facebook_video_generation=p_generation and c.facebook_video_expires_at>clock_timestamp())
   or(c.channel='instagram' and c.instagram_extended_generation=p_generation and c.instagram_extended_enabled and c.instagram_extended_expires_at>clock_timestamp())
   then raise exception 'Revoke the overlapping QA authorization first.';end if;
  select j.id into accepted from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
   where j.connection_id=c.id and j.connection_generation=p_generation and j.channel=c.channel and j.state='succeeded'
   and j.provider_post_id is not null and j.provider_post_id=j.provider_state->>'post_id'
   and exists(select 1 from jsonb_array_elements(r.payload->'variants') v where v->>'channel'=c.channel
    and v->>'format'=case p_format when 'facebook_video' then 'video' when 'facebook_reel' then 'reel' else 'carousel' end
    and (p_format<>'instagram_mixed_carousel' or
     (exists(select 1 from jsonb_array_elements_text(v->'asset_ids') a join public.marketing_assets m on m.id=a.value::uuid where m.mime_type='video/mp4')
      and exists(select 1 from jsonb_array_elements_text(v->'asset_ids') a join public.marketing_assets m on m.id=a.value::uuid where m.mime_type like 'image/%'))))
   order by j.updated_at desc,j.id limit 1;
  if accepted is null then raise exception 'Verified same-generation format publication receipt required.';end if;
  if p_format=any(formats) then return;end if;
  select array_agg(distinct f order by f) into formats from unnest(formats||p_format) f;
 else
  formats:=array_remove(formats,p_format);
  if formats=c.routine_publishing_formats and c.routine_publishing_generation is not distinct from (case when cardinality(formats)>0 then p_generation end) then return;end if;
 end if;
 update public.marketing_connections set routine_publishing_formats=formats,
  routine_publishing_generation=case when cardinality(formats)>0 then p_generation end where id=c.id;
 insert into public.marketing_events(organization_id,brand_id,action,details)
 values(c.organization_id,c.brand_id,case when p_enabled then 'routine_format_authorized' else 'routine_format_revoked' end,
  jsonb_build_object('connection_id',c.id,'generation',p_generation,'format',p_format,'receipt_job_id',accepted));
end;$$;
revoke all on function public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz,text) to service_role;

CREATE OR REPLACE FUNCTION public.marketing_meta_execution_policy(p_connection uuid, p_generation integer, p_enabled boolean, p_format text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_connections; granted_at timestamptz:=clock_timestamp();
begin
 if p_format is null then
  if p_expires_at is not null then raise exception 'Format is required for temporary authorization.';end if;
  -- Existing ordinary Publishing callers retain the three-argument contract.
  update public.marketing_connections set capabilities=capabilities||jsonb_build_object('execution_enabled',p_enabled),
   facebook_video_authorized_at=case when p_enabled then facebook_video_authorized_at end,
   facebook_video_expires_at=case when p_enabled then facebook_video_expires_at end,
   facebook_video_generation=case when p_enabled then facebook_video_generation end,
   instagram_extended_enabled=case when p_enabled then instagram_extended_enabled else false end,
   sync_requested_at=coalesce(sync_requested_at,now())
  where id=p_connection and credential_generation=p_generation;
  return;
 end if;
 if p_format='instagram_extended' then
  if p_enabled is null then raise exception 'Invalid temporary format policy.';end if;
  select * into c from public.marketing_connections where id=p_connection for update;
  if not found or c.channel<>'instagram' or c.credential_generation is distinct from p_generation then raise exception 'Connection authority changed.';end if;
  if p_enabled and c.routine_publishing_generation=p_generation and cardinality(c.routine_publishing_formats)>0 then raise exception 'Revoke overlapping routine formats before QA authorization.';end if;
  granted_at:=clock_timestamp();
  if p_enabled then
   if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=granted_at or p_expires_at>granted_at+interval '20 minutes'
    or c.status not in ('test_authorized','production_authorized') or c.expires_at is null or c.expires_at<=granted_at
    or c.capabilities->>'publishing' is distinct from 'true' or c.capabilities->>'execution_enabled' is distinct from 'true'
    or not coalesce(c.capabilities->'formats' ?| array['carousel','story'],false) then
    raise exception 'Temporary Instagram Extended authorization requires current eligibility and an expiry within 20 minutes.';
   end if;
   if c.instagram_extended_generation=p_generation and c.instagram_extended_authorized_at is not null then
    if c.instagram_extended_enabled and p_expires_at=c.instagram_extended_expires_at then return;end if;
    raise exception 'Instagram Extended test window is non-renewable for this connection generation.';
   end if;
   update public.marketing_connections set instagram_extended_enabled=true,instagram_extended_authorized_at=granted_at,
    instagram_extended_expires_at=p_expires_at,instagram_extended_generation=p_generation where id=c.id;
  else
   if p_expires_at is not null then raise exception 'Revocation does not accept an expiry.';end if;
   if not c.instagram_extended_enabled then return;end if;
   -- Retain the used window so revocation cannot restart its clock.
   update public.marketing_connections set instagram_extended_enabled=false where id=c.id;
  end if;
  insert into public.marketing_events(organization_id,brand_id,action,details)
  values(c.organization_id,c.brand_id,case when p_enabled then 'instagram_extended_authorization_granted' else 'instagram_extended_authorization_revoked' end,
   jsonb_build_object('connection_id',c.id,'generation',p_generation,'expires_at',case when p_enabled then p_expires_at else c.instagram_extended_expires_at end));
  return;
 end if;
 if p_format<>'facebook_video' or p_enabled is null then raise exception 'Invalid temporary format policy.';end if;
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found or c.channel<>'facebook' or c.credential_generation is distinct from p_generation then raise exception 'Connection authority changed.';end if;
 -- Evaluate the cap after any row-lock wait, using database wall time.
 if p_enabled and c.routine_publishing_generation=p_generation and cardinality(c.routine_publishing_formats)>0 then raise exception 'Revoke overlapping routine formats before QA authorization.';end if;
 granted_at:=clock_timestamp();
 if p_enabled and (p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=granted_at
  or p_expires_at>granted_at+interval '30 minutes'
  or c.status not in ('test_authorized','production_authorized') or c.expires_at is null or c.expires_at<=granted_at
  or c.capabilities->>'publishing' is distinct from 'true' or c.capabilities->>'execution_enabled' is distinct from 'true'
  or not coalesce(c.capabilities->'formats' @> '["video","reel"]'::jsonb,false)) then
  raise exception 'Temporary Facebook video authorization requires current eligibility and an expiry within 30 minutes.';
 end if;
 if not p_enabled and p_expires_at is not null then raise exception 'Revocation does not accept an expiry.';end if;
 update public.marketing_connections set
  facebook_video_authorized_at=case when p_enabled then granted_at end,
  facebook_video_expires_at=case when p_enabled then p_expires_at end,
  facebook_video_generation=case when p_enabled then p_generation end
 where id=c.id;
 insert into public.marketing_events(organization_id,brand_id,action,details)
 values(c.organization_id,c.brand_id,case when p_enabled then 'facebook_video_authorization_granted' else 'facebook_video_authorization_revoked' end,
  jsonb_build_object('connection_id',c.id,'generation',p_generation,'expires_at',case when p_enabled then p_expires_at end));
end;$function$
;
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
 if p_submission and format_key is not null and (formats->>format_key is null
  or j.provider_state->>'format_authorization_kind' is distinct from formats->>format_key) then raise exception 'Format authorization missing, changed or disabled.';end if;
 return result||jsonb_build_object('facebook_video_authorized',video_allowed,'instagram_extended_authorized',instagram_allowed,'format_authorizations',formats);
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_integrations(p_org uuid, p_brand uuid DEFAULT NULL::uuid, p_surface text DEFAULT 'settings'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; connections jsonb; posts jsonb; total integer; health jsonb;
begin
 if p_surface not in ('settings','analytics','content') or p_page not between 1 and 100000 then raise exception 'Invalid integration view.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,case p_surface when 'settings' then 'marketing_settings.view' when 'analytics' then 'marketing_analytics.view' else 'marketing_content.view' end);
 select coalesce(jsonb_agg((to_jsonb(c)||jsonb_build_object('format_authorizations',marketing_private.format_authorizations(c)))-array['sync_after','sync_lease','sync_lease_until'] order by c.brand_id,c.channel),'[]') into connections from public.marketing_connections c
 where c.channel in ('facebook','instagram') and c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 if p_surface='analytics' then
  select count(*) into total from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id);
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into posts from (select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id) order by s.published_at desc nulls last,s.id limit 20 offset (p_page-1)*20) q;
 end if;
 select jsonb_build_object('last_seen_at',last_seen_at,'last_completed_at',last_completed_at,'error_code',error_code) into health from marketing_private.worker_health;
 return jsonb_build_object('connections',connections,'posts',coalesce(posts,'[]'),'total',coalesce(total,0),'worker',health);
end;$function$
;
CREATE OR REPLACE FUNCTION public.marketing_authorize_execution(p_request uuid, p_content uuid, p_revision integer, p_connections uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.marketing_content; actor uuid; conn public.marketing_connections; j public.marketing_jobs; fp text; prior public.marketing_requests; result jsonb; count_jobs integer;
begin
 select * into c from public.marketing_content where id=p_content for update;
 if not found then raise exception 'Content unavailable.';end if;
 actor:=marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.execute');
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_content.publish');
 fp:=encode(extensions.digest(jsonb_build_object('command','external_execution','content',p_content,'revision',p_revision,'connections',p_connections)::text,'sha256'),'hex');
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then
  if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Request identity conflicts with an earlier intent.';end if;
  return prior.result;
 end if;
 if p_request is null or c.status not in ('scheduled','failed') or c.revision<>p_revision or c.approved_revision is distinct from p_revision then raise exception 'Only the exact approved scheduled revision can execute.';end if;
 select count(*) into count_jobs from public.marketing_jobs where content_id=c.id and revision=p_revision and state in ('blocked','queued','retry');
 if count_jobs=0 or cardinality(p_connections)<>count_jobs or cardinality(p_connections)>2 then raise exception 'Select one connected account for each pending channel.';end if;
 for j in select * from public.marketing_jobs where content_id=c.id and revision=p_revision and state in ('blocked','queued','retry') for update loop
  select * into conn from public.marketing_connections where id=any(p_connections) and brand_id=c.brand_id and channel=j.channel;
  if not found or conn.status not in ('test_authorized','production_authorized') or conn.expires_at<=now()
  or conn.capabilities->>'publishing' is distinct from 'true' or conn.capabilities->>'execution_enabled' is distinct from 'true'
  or not exists(select 1 from marketing_private.credentials where connection_id=conn.id) then raise exception 'This account is not enabled for external publishing. Configure an approved test account first.';end if;
  if j.connection_id is not null and (j.connection_id<>conn.id or j.connection_generation is distinct from conn.credential_generation) then raise exception 'Connection generation changed. Existing preparation cannot be transferred.';end if;
  if not (conn.capabilities->'formats') ? (select value->>'format' from public.marketing_content_revisions r cross join jsonb_array_elements(r.payload->'variants') where r.content_id=c.id and r.revision=p_revision and value->>'channel'=j.channel) then raise exception 'Channel format is unavailable for this connection.';end if;
  if exists(select 1 from public.marketing_content_revisions r cross join jsonb_array_elements(r.payload->'variants') v where r.content_id=c.id and r.revision=p_revision and v->>'channel'=j.channel and v->>'format'='story') then raise exception 'Instagram Story execution is disabled.';end if;
  update public.marketing_jobs set connection_id=conn.id,connection_generation=conn.credential_generation,external_authorized_at=now(),authorized_by=actor,state='queued',error_code=null where id=j.id;
 end loop;
 result:=jsonb_build_object('content_id',c.id,'revision',p_revision,'external_authorized_at',now());
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details)
 values(c.organization_id,c.brand_id,c.id,'external_execution_authorized',actor,jsonb_build_object('revision',p_revision,'connections',p_connections));
 return result;
end;$function$
;

create or replace function public.marketing_job_checkpoint(p_job uuid,p_lease uuid,p_state jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare prior jsonb;
begin
 perform public.marketing_job_guard(p_job,p_lease);
 if jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>16000 or p_state::text ~* '(access_token|signedurl|https?://|ciphertext)' then raise exception 'Invalid publishing checkpoint.';end if;
 select provider_state into prior from public.marketing_jobs where id=p_job for update;
 if (p_state ? 'format_authorization_kind' and coalesce(p_state->>'format_authorization_kind','') not in('routine','temporary'))
  or(prior ? 'format_authorization_kind' and prior->>'format_authorization_kind' is distinct from p_state->>'format_authorization_kind')
  or(not prior ? 'format_authorization_kind' and (prior ? 'pending' or prior ? 'post_id' or coalesce(prior->'objects','{}'::jsonb)<>'{}'::jsonb) and p_state ? 'format_authorization_kind')
  then raise exception 'Publishing authorization kind cannot be transferred.';end if;
 update public.marketing_jobs set provider_state=p_state,updated_at=now() where id=p_job and lease_token=p_lease and state in('leased','reconciling');
end;$$;
notify pgrst,'reload schema';
