-- Temporary format authorization is part of the existing connection execution policy.
-- No existing connection is enabled by this migration.
alter table public.marketing_connections
 add column facebook_video_authorized_at timestamptz,
 add column facebook_video_expires_at timestamptz,
 add column facebook_video_generation integer,
 add constraint marketing_facebook_video_window check (
  (facebook_video_authorized_at is null and facebook_video_expires_at is null and facebook_video_generation is null)
  or (facebook_video_authorized_at is not null and facebook_video_expires_at is not null and facebook_video_generation is not null
   and isfinite(facebook_video_authorized_at) and isfinite(facebook_video_expires_at)
   and facebook_video_generation>0 and channel='facebook'
   and facebook_video_expires_at>facebook_video_authorized_at
   and facebook_video_expires_at<=facebook_video_authorized_at+interval '30 minutes')
 );

drop function public.marketing_meta_execution_policy(uuid,integer,boolean);
create function public.marketing_meta_execution_policy(p_connection uuid,p_generation integer,p_enabled boolean,
 p_format text default null,p_expires_at timestamptz default null) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; granted_at timestamptz:=clock_timestamp();
begin
 if p_format is null then
  if p_expires_at is not null then raise exception 'Format is required for temporary authorization.';end if;
  -- Existing ordinary Publishing callers retain the three-argument contract.
  update public.marketing_connections set capabilities=capabilities||jsonb_build_object('execution_enabled',p_enabled),
   facebook_video_authorized_at=case when p_enabled then facebook_video_authorized_at end,
   facebook_video_expires_at=case when p_enabled then facebook_video_expires_at end,
   facebook_video_generation=case when p_enabled then facebook_video_generation end,
   sync_requested_at=coalesce(sync_requested_at,now())
  where id=p_connection and credential_generation=p_generation;
  return;
 end if;
 if p_format<>'facebook_video' or p_enabled is null then raise exception 'Invalid temporary format policy.';end if;
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found or c.channel<>'facebook' or c.credential_generation is distinct from p_generation then raise exception 'Connection authority changed.';end if;
 -- Evaluate the cap after any row-lock wait, using database wall time.
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
end;$$;
revoke all on function public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_meta_execution_policy(uuid,integer,boolean,text,timestamptz) to service_role;

drop function public.marketing_job_guard(uuid,uuid);
create function public.marketing_job_guard(p_job uuid,p_lease uuid,p_submission boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; result jsonb; video_allowed boolean; checked_at timestamptz;
begin
 select * into j from public.marketing_jobs where id=p_job;
 if not found or j.state not in ('leased','reconciling') or j.lease_token is distinct from p_lease or p_lease is null or j.lease_expires_at<=now()
 or not marketing_private.job_authorized(j) then raise exception 'Publishing authority or lease expired.';end if;
 select to_jsonb(conn) into result from public.marketing_connections conn join public.marketing_content c on c.id=j.content_id
 where conn.id=j.connection_id and conn.credential_generation=j.connection_generation and conn.status in ('test_authorized','production_authorized')
 and conn.expires_at>now() and conn.capabilities->>'publishing'='true' and conn.capabilities->>'execution_enabled'='true'
 and c.revision=j.revision and c.approved_revision=j.revision and c.status in ('scheduled','failed');
 if result is null then raise exception 'Connection or approved revision changed.';end if;
 checked_at:=clock_timestamp();
 video_allowed:=coalesce((result->>'facebook_video_generation')::integer=j.connection_generation
  and (result->>'facebook_video_authorized_at')::timestamptz<=checked_at
  and (result->>'facebook_video_expires_at')::timestamptz>checked_at
  and (result->>'facebook_video_expires_at')::timestamptz<=(result->>'facebook_video_authorized_at')::timestamptz+interval '30 minutes',false);
 if p_submission and j.channel='facebook' and exists (
  select 1 from public.marketing_content_revisions r cross join lateral jsonb_array_elements(r.payload->'variants') v
  where r.content_id=j.content_id and r.revision=j.revision and v->>'channel'='facebook' and v->>'format' in ('video','reel')
 ) and not video_allowed then raise exception 'Temporary Facebook video authorization missing, expired or revoked.';end if;
 return result||jsonb_build_object('facebook_video_authorized',video_allowed);
end;$$;
revoke all on function public.marketing_job_guard(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.marketing_job_guard(uuid,uuid,boolean) to service_role;
