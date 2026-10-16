-- Creator identity remains unchanged; only trusted adapters may write follower evidence.
alter table public.marketing_creator_accounts
 add column followers_source text,
 add column followers_sync_status text not null default 'queued' check(followers_sync_status in ('queued','syncing','ready','unavailable','unsupported','failed')),
 add column followers_sync_reason text,
 add column followers_attempted_at timestamptz,
 add column followers_due_at timestamptz not null default now(),
 add column followers_lease uuid,
 add column followers_lease_until timestamptz;
create index marketing_creator_followers_due on public.marketing_creator_accounts(followers_due_at) where not archived and platform in ('facebook','instagram');
-- Keep legacy staff observations in place, but never label/display them as system evidence.
update public.marketing_creator_accounts set followers_sync_status='unsupported',followers_sync_reason='creator_oauth_or_approved_profile_api_required' where platform in ('tiktok','xhs');
do $patch$
declare definition text; original text;
begin
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into original;
 definition:=regexp_replace(original,' if profile->>''followers'' is not null and .*?end if;\n','', 'g');
 definition:=replace(definition,'profile:=marketing_private.creator_profile(p_payload);','if nullif(p_payload->>''followers'','''') is not null then raise exception ''Followers are system-sourced only.'';end if; profile:=marketing_private.creator_profile(p_payload);');
 definition:=replace(definition,'update public.marketing_creator_accounts set followers=nullif(profile->>''followers'','''')::bigint,followers_captured_at=case when profile->>''followers'' is not null then (profile->>''followers_captured_at'')::timestamptz end,archived=false','update public.marketing_creator_accounts set archived=false');
 if definition=original or definition like '%set followers=nullif%' then raise exception 'Follower command patch does not match canonical contract';end if;
 execute definition;
end;$patch$;
create function marketing_private.creator_followers_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then
  if TG_OP='INSERT' then
   if new.followers is not null or new.followers_source is not null then raise exception using errcode='42501',message='Followers are system-sourced only.';end if;
  elsif (new.followers,new.followers_captured_at,new.followers_source,new.followers_attempted_at,new.followers_lease,new.followers_lease_until) is distinct from (old.followers,old.followers_captured_at,old.followers_source,old.followers_attempted_at,old.followers_lease,old.followers_lease_until) then
   raise exception using errcode='42501',message='Followers are system-sourced only.';
  end if;
 end if;
 if TG_OP='INSERT' or (new.platform,new.handle,new.external_id,new.profile_url,new.archived,new.revision) is distinct from (old.platform,old.handle,old.external_id,old.profile_url,old.archived,old.revision) then
  if TG_OP='UPDATE' and (new.platform,new.handle,new.external_id,new.profile_url) is distinct from (old.platform,old.handle,old.external_id,old.profile_url) then
   new.followers:=null;new.followers_captured_at:=null;new.followers_source:=null;new.followers_lease:=null;new.followers_lease_until:=null;
  end if;
  if new.followers_lease_until is null or new.followers_lease_until<now() then
   new.followers_sync_status:=case when new.platform in ('instagram','facebook') then 'queued' else 'unsupported' end;
   new.followers_sync_reason:=case when new.platform not in ('instagram','facebook') then 'creator_oauth_or_approved_profile_api_required' end;
   new.followers_due_at:=now();
  end if;
 end if;return new;
end;$$;
revoke all on function marketing_private.creator_followers_guard() from public,anon,authenticated;
create trigger creator_followers_guard before insert or update on public.marketing_creator_accounts for each row execute function marketing_private.creator_followers_guard();
create function public.marketing_creator_followers_refresh(p_org uuid,p_account uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_creator_accounts;
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.manage');
 select * into a from public.marketing_creator_accounts where id=p_account and organization_id=p_org for update;
 if a.id is null or a.archived or not marketing_private.creator_visible(p_org,a.creator_id) or not marketing_private.creator_editable(p_org,a.creator_id) then raise exception using errcode='42501',message='Profile unavailable in your Brand scope.';end if;
 if a.platform not in ('facebook','instagram') then return to_jsonb(a);end if;
 -- No duplicate queueing while leased or within the five-minute refresh cooldown.
 if a.followers_lease_until>now() or a.followers_sync_status='queued' or a.followers_attempted_at>now()-interval '5 minutes' then return to_jsonb(a);end if;
 update public.marketing_creator_accounts set followers_due_at=now(),followers_sync_status='queued',followers_sync_reason=null where id=a.id returning * into a;
 return to_jsonb(a);
end;$$;
-- Refresh only queues; provider evidence and leases remain service-only.
create function public.marketing_creator_followers_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_creator_accounts; c public.marketing_connections;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Worker required.';end if;
 select ca.* into a from public.marketing_creator_accounts ca join public.marketing_creators cr on cr.id=ca.creator_id
 where not ca.archived and not cr.archived and ca.platform in ('facebook','instagram') and ca.followers_due_at<=now() and (ca.followers_lease_until is null or ca.followers_lease_until<now())
 order by ca.followers_due_at,ca.id limit 1 for update of ca skip locked;
 if a.id is null then return null;end if;
 select mc.* into c from public.marketing_connections mc join public.marketing_creator_brands cb on cb.organization_id=mc.organization_id and cb.brand_id=mc.brand_id
 where cb.creator_id=a.creator_id and mc.organization_id=a.organization_id and mc.channel=a.platform and mc.status in ('test_authorized','production_authorized') and mc.expires_at>now()
 order by mc.id limit 1;
 update public.marketing_creator_accounts set followers_sync_status='syncing',followers_sync_reason=null,followers_lease=gen_random_uuid(),followers_lease_until=now()+interval '90 seconds',followers_attempted_at=now() where id=a.id returning * into a;
 return to_jsonb(a)||jsonb_build_object('connection_id',c.id,'connection_generation',c.credential_generation,'connection_brand',c.brand_id);
end;$$;
create function public.marketing_creator_followers_finish(p_account uuid,p_lease uuid,p_connection uuid,p_generation integer,p_count bigint default null,p_source text default null,p_status text default 'failed',p_reason text default null) returns boolean language plpgsql security definer set search_path=public as $$
declare a public.marketing_creator_accounts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Worker required.';end if;
 select * into a from public.marketing_creator_accounts where id=p_account and followers_lease=p_lease and followers_lease_until>now() and not archived for update;
 if a.id is null then return false;end if;
 if not exists(select 1 from public.marketing_creators where id=a.creator_id and not archived) then return false;end if;
 if p_count is not null then
 if p_count<0 or p_count>1000000000000000 or p_source not in ('meta_instagram_business_discovery','meta_facebook_page') or p_source is null or p_status<>'ready' then raise exception 'Invalid follower evidence.';end if;
 if not exists(select 1 from public.marketing_connections c join public.marketing_creator_brands b on b.organization_id=c.organization_id and b.brand_id=c.brand_id where c.id=p_connection and c.organization_id=a.organization_id and b.creator_id=a.creator_id and c.channel=a.platform and c.credential_generation=p_generation and c.status in ('test_authorized','production_authorized') and c.expires_at>now()) then p_count:=null;p_status:='unavailable';p_reason:='connection_changed';end if;
 end if;
 if p_status not in ('ready','unavailable','unsupported','failed') or (p_status='ready' and p_count is null) then raise exception 'Invalid follower result.';end if;
 update public.marketing_creator_accounts set followers=case when p_count is not null then p_count else followers end,followers_captured_at=case when p_count is not null then now() else followers_captured_at end,followers_source=case when p_count is not null then p_source else followers_source end,
 followers_sync_status=p_status,followers_sync_reason=left(p_reason,120),followers_due_at=now()+case when p_status='failed' then interval '1 hour' else interval '1 day' end,followers_lease=null,followers_lease_until=null where id=a.id;
 return true;
end;$$;
revoke all on function public.marketing_creator_followers_refresh(uuid,uuid),public.marketing_creator_followers_claim(),public.marketing_creator_followers_finish(uuid,uuid,uuid,integer,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.marketing_creator_followers_refresh(uuid,uuid) to authenticated;
grant execute on function public.marketing_creator_followers_claim(),public.marketing_creator_followers_finish(uuid,uuid,uuid,integer,bigint,text,text,text) to service_role;
create function public.marketing_creator_followers_status(p_org uuid,p_account uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.marketing_creator_accounts;
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.view');
 select * into a from public.marketing_creator_accounts where id=p_account and organization_id=p_org;
 if a.id is null or a.archived or not marketing_private.creator_visible(p_org,a.creator_id) then raise exception using errcode='42501',message='Profile unavailable in your Brand scope.';end if;
 return jsonb_build_object('followers',case when a.followers_source is not null then a.followers end,'followers_source',a.followers_source,'followers_captured_at',case when a.followers_source is not null then a.followers_captured_at end,'followers_sync_status',a.followers_sync_status,'followers_sync_reason',a.followers_sync_reason,'followers_attempted_at',a.followers_attempted_at);
end;$$;
revoke all on function public.marketing_creator_followers_status(uuid,uuid) from public,anon;
grant execute on function public.marketing_creator_followers_status(uuid,uuid) to authenticated;
