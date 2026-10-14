-- Ads reporting automation reuses canonical credentials/jobs; it creates no execution authority.
alter table marketing_private.ads_accounts
 add column initial_date_from date,
 add column initial_date_to date,
 add column next_sync_at timestamptz default now(),
 add column automatic_error text,
 add column granted_scopes jsonb not null default '[]';
alter table marketing_private.ads_sync_jobs add column source text not null default 'manual'
 check(source in ('manual','initial','refresh'));

create function marketing_private.ads_reset_schedule() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' or new.generation is distinct from old.generation then
  new.initial_date_from:=null;new.initial_date_to:=null;new.next_sync_at:=now();new.automatic_error:=null;
 end if;
 return new;
end;$$;
create trigger ads_reset_schedule before insert or update of generation on marketing_private.ads_accounts
for each row execute function marketing_private.ads_reset_schedule();

create function public.marketing_ads_schedule(p_connection uuid default null) returns integer
language plpgsql security definer set search_path=public as $$
declare a marketing_private.ads_accounts;c public.marketing_connections; local_day date;source_name text; queued integer:=0;offset_days integer;
begin
 -- One account per invocation, coalesced with active work. Never infer a brand from an account.
 select h.* into a from marketing_private.ads_accounts h join marketing_connections x on x.id=h.connection_id
 where h.generation=x.credential_generation and x.channel='ad_account' and x.status in ('test_authorized','production_authorized')
 and x.expires_at>now() and h.next_sync_at<=now() and (p_connection is null or h.connection_id=p_connection)
 and exists(select 1 from marketing_private.credentials s where s.connection_id=x.id and s.sealed_token is not null)
 order by h.next_sync_at,h.connection_id limit 1;
 if a.connection_id is null then return 0;end if;
 -- Match binding lock order: connection first, account second. Concurrent ticks skip claimed rows.
 select * into c from marketing_connections where id=a.connection_id for share skip locked;
 if c.id is null then return 0;end if;
 select * into a from marketing_private.ads_accounts where connection_id=c.id and generation=c.credential_generation and next_sync_at<=now() for update skip locked;
 if a.connection_id is null then return 0;end if;
 if not marketing_private.ads_org_allowed(c.connected_by,c.organization_id,'marketing_ads.view') then
  update marketing_private.ads_accounts set automatic_error='ads_reporting_actor_unavailable',next_sync_at=now()+interval '6 hours' where connection_id=c.id;return 0;
 end if;
 if not exists(select 1 from pg_timezone_names where name=a.timezone) then
  update marketing_private.ads_accounts set automatic_error='ads_timezone_unavailable',next_sync_at=null where connection_id=c.id;return 0;
 end if;
 if exists(select 1 from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and state in ('queued','leased','retry')) then
  update marketing_private.ads_accounts set next_sync_at=now()+interval '5 minutes' where connection_id=c.id;return 0;
 end if;
 if (select count(*) from marketing_private.ads_sync_jobs where connection_id=c.id and created_at>now()-interval '1 hour')>18 then
  update marketing_private.ads_accounts set next_sync_at=now()+interval '1 hour' where connection_id=c.id;return 0;
 end if;
 local_day:=(now() at time zone a.timezone)::date;
 source_name:=case when a.initial_date_to is null then 'initial' else 'refresh' end;
 if source_name='initial' then
  update marketing_private.ads_accounts set initial_date_from=local_day-29,initial_date_to=local_day where connection_id=c.id;
 end if;
 -- Two independent provider periods preserve non-additive reach and genuine comparisons.
 foreach offset_days in array array[0,30] loop
  insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to,source)
  values(c.id,c.credential_generation,c.connected_by,local_day-29-offset_days,local_day-offset_days,source_name) on conflict do nothing;
  queued:=queued+1;
 end loop;
 update marketing_private.ads_accounts set next_sync_at=now()+interval '6 hours',automatic_error=null where connection_id=c.id;
 return queued;
end;$$;

create function marketing_private.ads_sync_status(p_connection uuid,p_generation integer) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('active_jobs',(select count(*) from marketing_private.ads_sync_jobs where connection_id=p_connection and generation=p_generation and state in ('queued','leased','retry')),
 'initial_completed',(select count(*) from marketing_private.ads_sync_jobs where connection_id=p_connection and generation=p_generation and source='initial' and state='succeeded'),
 'initial_total',(select count(*) from marketing_private.ads_sync_jobs where connection_id=p_connection and generation=p_generation and source='initial'),
 'latest_job',(select to_jsonb(j)-array['actor_employee_id','lease','lease_until'] from marketing_private.ads_sync_jobs j where connection_id=p_connection and generation=p_generation order by created_at desc,id limit 1),
 'worker_available',exists(select 1 from marketing_private.worker_health where last_completed_at>now()-interval '10 minutes' and error_code is null));
$$;

-- Amend owning authorities rather than introducing an alternate binding or finish path.
do $$ declare f text;begin
 select pg_get_functiondef('public.marketing_ads_claim()'::regprocedure) into f;
 f:=replace(f,'update marketing_private.ads_sync_jobs set state=''failed'',error_code=''sync_retry_limit'',lease=null,lease_until=null where state=''leased'' and lease_until<now() and attempts>=4;',
 'with failed as (update marketing_private.ads_sync_jobs set state=''failed'',error_code=''sync_retry_limit'',lease=null,lease_until=null where state=''leased'' and lease_until<now() and attempts>=4 returning connection_id,generation) update marketing_private.ads_accounts a set sync_error=''sync_retry_limit'',automatic_error=''sync_retry_limit'',next_sync_at=greatest(next_sync_at,now()+interval ''6 hours'') from failed f where a.connection_id=f.connection_id and a.generation=f.generation;');execute f;
 select pg_get_functiondef('public.marketing_ads_session(uuid,uuid)'::regprocedure) into f;
 f:=replace(f,'s.sealed_discovery is null','(s.sealed_discovery is null and s.selected_at is null)');execute f;
 select pg_get_functiondef('public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer)'::regprocedure) into f;
 f:=replace(f,' perform public.marketing_ads_preview_session(p_session,p_auth_user);',
 ' select * into s from marketing_private.oauth_sessions where id=p_session for update;
 if s.selected_at is not null then
  if s.expires_at<=now() or s.purpose<>''ads'' or p_brand is not null or s.actor_employee_id is distinct from (select id from employees where auth_user_id=p_auth_user)
  or not marketing_private.ads_org_allowed(s.actor_employee_id,s.organization_id,''marketing_ads.connect'') or s.selection->>''account'' is distinct from p_account
  or (s.selection->>''expected_generation'')::integer is distinct from p_expected_generation then raise exception ''Connection confirmation changed.'';end if;
  select * into c from marketing_connections where id=(s.selection->>''connection_id'')::uuid and credential_generation=(s.selection->>''generation'')::integer and provider_account_id=p_account and organization_id=s.organization_id and channel=''ad_account'' and status in (''test_authorized'',''production_authorized'') and expires_at>now();
  if c.id is null then raise exception ''Connection changed. Review again.'';end if;
  return to_jsonb(c);
 end if;
 perform public.marketing_ads_preview_session(p_session,p_auth_user);');
 f:=replace(f,'selection=jsonb_build_object(''account'',p_account)','selection=jsonb_build_object(''account'',p_account,''connection_id'',c.id,''generation'',c.credential_generation,''expected_generation'',p_expected_generation)');
 f:=replace(f,' return to_jsonb(c);'||chr(10)||'end;',' update marketing_private.ads_accounts set granted_scopes=coalesce(p_account_evidence->''granted_scopes'',''[]''::jsonb) where connection_id=c.id; perform public.marketing_ads_schedule(c.id); return to_jsonb(c);'||chr(10)||'end;');
 execute f;
 select pg_get_functiondef('public.marketing_ads_finish(uuid,uuid,jsonb,text)'::regprocedure) into f;
 f:=replace(f,'retry_at=now()+interval ''5 minutes''','retry_at=now()+make_interval(mins=>power(2,least(attempts-1,2))::integer)');
 f:=replace(f,'sync_error=left(p_error,100),read_verified=false,manage_verified=false','sync_error=left(p_error,100),automatic_error=left(p_error,100),next_sync_at=case when p_error in (''meta_permission_or_token_invalid'',''ads_read_not_granted'',''ad_account_identity_mismatch'',''ad_authorizer_changed'',''ad_account_access_unverified'') then null else greatest(next_sync_at,now()+interval ''6 hours'') end,read_verified=case when p_error in (''meta_permission_or_token_invalid'',''ads_read_not_granted'',''ad_account_identity_mismatch'',''ad_authorizer_changed'',''ad_account_access_unverified'') then false else read_verified end,manage_verified=case when p_error in (''meta_permission_or_token_invalid'',''ads_read_not_granted'',''ad_account_identity_mismatch'',''ad_authorizer_changed'',''ad_account_access_unverified'') then false else manage_verified end');
 f:=replace(f,'''ad_authorizer_changed'') then ''failed''','''ad_authorizer_changed'',''ad_account_access_unverified'') then ''failed''');
 f:=replace(f,'where connection_id=c.id;return;','where connection_id=c.id; if p_error in (''meta_permission_or_token_invalid'',''ads_read_not_granted'',''ad_account_identity_mismatch'',''ad_authorizer_changed'',''ad_account_access_unverified'') then update marketing_private.ads_sync_jobs set state=''cancelled'',error_code=''authorization_changed'' where connection_id=c.id and generation=j.generation and id<>j.id and state in (''queued'',''retry'');end if;return;');
 f:=replace(f,'checked_at=now(),sync_error=null','checked_at=now(),sync_error=null,automatic_error=null,next_sync_at=coalesce(next_sync_at,now()+interval ''6 hours''),granted_scopes=coalesce(p_report#>''{account,granted_scopes}'',''[]''::jsonb)');
 execute f;
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 f:=replace(f,'''health'',case when a.generation=c.credential_generation','''sync'',marketing_private.ads_sync_status(c.id,c.credential_generation),''health'',case when a.generation=c.credential_generation');
 f:=replace(f,'and j.date_from=p_from and j.date_to=p_to and j.created_at>now()-interval ''1 day''','and (j.state in (''queued'',''leased'',''retry'') or j.created_at>now()-interval ''1 day'')');
 execute f;
end $$;
revoke all on function marketing_private.ads_reset_schedule(),marketing_private.ads_sync_status(uuid,integer),public.marketing_ads_schedule(uuid) from public,anon,authenticated;
grant execute on function public.marketing_ads_schedule(uuid) to service_role;
