-- External execution is a separate, version-bound approval. Connecting never releases a backlog.
alter table marketing_private.oauth_sessions add column bindings jsonb not null default '{}';
create or replace function public.marketing_meta_bind(p_session uuid,p_auth_user uuid,p_account_id text,p_channel text,p_sealed jsonb,p_expiry timestamptz,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s marketing_private.oauth_sessions; a jsonb; c public.marketing_connections; prior public.marketing_connections; binding jsonb;
begin
 perform public.marketing_meta_session_material(p_session,p_auth_user);
 select * into s from marketing_private.oauth_sessions where id=p_session for update;
 binding:=s.bindings->p_channel;
 if binding is not null then
  select * into c from public.marketing_connections where id=(binding->>'connection_id')::uuid;
  if binding->>'account_id'<>p_account_id or c.credential_generation<>(binding->>'generation')::integer or c.status not in ('test_authorized','production_authorized') then raise exception 'Reconnect Meta before changing this account selection.';end if;
  return to_jsonb(c);
 end if;
 select value into a from jsonb_array_elements(s.accounts) where value->>'id'=p_account_id and value->>'channel'=p_channel;
 if a is null or p_sealed is null or p_expiry is null or p_expiry<=now() or p_mode not in ('test','production') then raise exception 'Choose a verified Meta account.';end if;
 select * into prior from public.marketing_connections where brand_id=s.brand_id and channel=p_channel for update;
 if prior.id is not null and exists(select 1 from public.marketing_jobs where connection_id=prior.id and state in ('leased','reconciling')) then raise exception 'Resolve pending delivery before replacing this connection.';end if;
 insert into public.marketing_connections(organization_id,brand_id,channel,provider_account_id,account_name,status,capabilities,expires_at,connected_by,connected_at,last_checked_at,credential_generation)
 values(s.organization_id,s.brand_id,p_channel,p_account_id,a->>'name',case p_mode when 'test' then 'test_authorized' else 'production_authorized' end,a->'capabilities',p_expiry,s.actor_employee_id,now(),now(),1)
 on conflict(brand_id,channel) do update set provider_account_id=excluded.provider_account_id,account_name=excluded.account_name,status=excluded.status,capabilities=excluded.capabilities,
 expires_at=excluded.expires_at,connected_by=excluded.connected_by,connected_at=now(),last_checked_at=now(),error_code=null,credential_generation=marketing_connections.credential_generation+1 returning * into c;
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at)
 values(c.id,'encrypted-meta:'||c.id,p_sealed,s.meta_user_id,p_expiry)
 on conflict(connection_id) do update set credential_reference=excluded.credential_reference,sealed_token=excluded.sealed_token,meta_user_id=excluded.meta_user_id,expires_at=excluded.expires_at;
 update public.marketing_jobs set state='blocked',external_authorized_at=null,error_code='connection_changed',updated_at=now() where connection_id=c.id and state in ('queued','retry','blocked');
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(c.organization_id,c.brand_id,'meta_connected',s.actor_employee_id,jsonb_build_object('connection_id',c.id,'channel',c.channel,'mode',p_mode,'generation',c.credential_generation));
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(c.id,c.credential_generation,s.meta_user_id);
 update marketing_private.oauth_sessions set bindings=bindings||jsonb_build_object(p_channel,jsonb_build_object('account_id',p_account_id,'connection_id',c.id,'generation',c.credential_generation)) where id=s.id;
 -- Permit selecting the other channel from the same short-lived discovery, never return tokens.
 return to_jsonb(c);
end;$$;

insert into public.permissions(code,module,description,requires_restaurant_outlet_scope)
values('marketing_content.execute','Marketing Content','Authorize external publishing to explicitly enabled accounts.',false) on conflict(code) do nothing;
alter table public.marketing_jobs add column failures integer not null default 0;
alter table public.marketing_connections add column sync_requested_at timestamptz,
 add column sync_after text, add column sync_lease uuid, add column sync_lease_until timestamptz,
 add column sync_attempts integer not null default 0, add column sync_retry_at timestamptz,
 add column sync_error_code text, add column sync_pages integer not null default 0, add column sync_truncated boolean not null default false;
create table marketing_private.worker_health(id boolean primary key default true check(id),last_seen_at timestamptz,last_completed_at timestamptz,error_code text);
alter table marketing_private.worker_health enable row level security;
revoke all on marketing_private.worker_health from public,anon,authenticated;
create table public.marketing_social_posts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,
 connection_id uuid not null references public.marketing_connections(id), connection_generation integer not null,
 provider_post_id text not null,channel text not null,caption text,permalink text,published_at timestamptz,
 observed_at timestamptz not null default now(),metrics jsonb not null default '{}',unavailable_metrics jsonb not null default '{}',
 foreign key(organization_id,brand_id) references public.brands(organization_id,id),
 unique(connection_id,connection_generation,provider_post_id)
);
create index marketing_social_posts_scope on public.marketing_social_posts(organization_id,brand_id,published_at desc,id);
alter table public.marketing_social_posts enable row level security;
revoke all on public.marketing_social_posts from public,anon,authenticated;

create function public.marketing_meta_execution_policy(p_connection uuid,p_generation integer,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$begin
 update public.marketing_connections set capabilities=capabilities||jsonb_build_object('execution_enabled',p_enabled),sync_requested_at=coalesce(sync_requested_at,now())
 where id=p_connection and credential_generation=p_generation;
end;$$;
create or replace function marketing_private.job_authorized(j public.marketing_jobs) returns boolean language sql stable security definer set search_path=public as $$
 select j.external_authorized_at is not null and marketing_private.actor_allowed(j.authorized_by,j.organization_id,j.brand_id,'marketing_content.publish')
 and marketing_private.actor_allowed(j.authorized_by,j.organization_id,j.brand_id,'marketing_content.execute');
$$;
create function public.marketing_authorize_execution(p_request uuid,p_content uuid,p_revision integer,p_connections uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
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
 if p_request is null or c.status<>'scheduled' or c.revision<>p_revision or c.approved_revision is distinct from p_revision then raise exception 'Only the exact approved scheduled revision can execute.';end if;
 select count(*) into count_jobs from public.marketing_jobs where content_id=c.id and revision=p_revision and state in ('blocked','queued','retry');
 if count_jobs=0 or cardinality(p_connections)<>count_jobs or cardinality(p_connections)>2 then raise exception 'Select one connected account for each pending channel.';end if;
 for j in select * from public.marketing_jobs where content_id=c.id and revision=p_revision and state in ('blocked','queued','retry') for update loop
  select * into conn from public.marketing_connections where id=any(p_connections) and brand_id=c.brand_id and channel=j.channel;
  if not found or conn.status not in ('test_authorized','production_authorized') or conn.expires_at<=now()
  or conn.capabilities->>'publishing' is distinct from 'true' or conn.capabilities->>'execution_enabled' is distinct from 'true'
  or not exists(select 1 from marketing_private.credentials where connection_id=conn.id) then raise exception 'This account is not enabled for external publishing. Configure an approved test account first.';end if;
  if not (conn.capabilities->'formats') ? (select value->>'format' from public.marketing_content_revisions r cross join jsonb_array_elements(r.payload->'variants') where r.content_id=c.id and r.revision=p_revision and value->>'channel'=j.channel) then raise exception 'Channel format is unavailable for this connection.';end if;
  update public.marketing_jobs set connection_id=conn.id,connection_generation=conn.credential_generation,external_authorized_at=now(),authorized_by=actor,state='queued',error_code=null where id=j.id;
 end loop;
 result:=jsonb_build_object('content_id',c.id,'revision',p_revision,'external_authorized_at',now());
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,content_id,action,actor_employee_id,details)
 values(c.organization_id,c.brand_id,c.id,'external_execution_authorized',actor,jsonb_build_object('revision',p_revision,'connections',p_connections));
 return result;
end;$$;
create or replace function public.marketing_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs;
begin
 update public.marketing_jobs set state='reconciling',error_code='lease_expired',updated_at=now() where state='leased' and lease_expires_at<now();
 select x.* into j from public.marketing_jobs x join public.marketing_content c on c.id=x.content_id
 join public.marketing_connections conn on conn.id=x.connection_id and conn.credential_generation=x.connection_generation
 where x.state in ('queued','retry') and x.due_at<=now() and x.failures<5
 and c.status='scheduled' and c.revision=x.revision and c.approved_revision=x.revision
 and conn.status in ('test_authorized','production_authorized') and conn.expires_at>now()
 and conn.capabilities->>'publishing'='true' and conn.capabilities->>'execution_enabled'='true'
 and exists(select 1 from marketing_private.credentials where connection_id=conn.id)
 and marketing_private.job_authorized(x) order by x.due_at,x.id for update of c skip locked limit 1;
 if not found then return null;end if;
 select * into j from public.marketing_jobs where id=j.id for update;
 update public.marketing_jobs set state='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',error_code=null,updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('payload',(select payload from public.marketing_content_revisions where content_id=j.content_id and revision=j.revision));
end;$$;
create function public.marketing_job_guard(p_job uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; result jsonb;
begin
 select * into j from public.marketing_jobs where id=p_job;
 if not found or j.state not in ('leased','reconciling') or j.lease_token is distinct from p_lease or p_lease is null or j.lease_expires_at<=now()
 or not marketing_private.job_authorized(j) then raise exception 'Publishing authority or lease expired.';end if;
 select to_jsonb(conn) into result from public.marketing_connections conn join public.marketing_content c on c.id=j.content_id
 where conn.id=j.connection_id and conn.credential_generation=j.connection_generation and conn.status in ('test_authorized','production_authorized')
 and conn.expires_at>now() and conn.capabilities->>'publishing'='true' and conn.capabilities->>'execution_enabled'='true'
 and c.revision=j.revision and c.approved_revision=j.revision and c.status in ('scheduled','failed');
 if result is null then raise exception 'Connection or approved revision changed.';end if;
 return result;
end;$$;
create function public.marketing_job_checkpoint(p_job uuid,p_lease uuid,p_state jsonb) returns void language plpgsql security definer set search_path=public as $$begin
 perform public.marketing_job_guard(p_job,p_lease);
 if jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>16000 or p_state::text ~* '(access_token|signedurl|https?://|ciphertext)' then raise exception 'Invalid publishing checkpoint.';end if;
 update public.marketing_jobs set provider_state=p_state,updated_at=now() where id=p_job and lease_token=p_lease and state in ('leased','reconciling');
end;$$;
create function public.marketing_defer_job(p_job uuid,p_lease uuid,p_seconds integer,p_code text) returns void language plpgsql security definer set search_path=public as $$begin
 perform public.marketing_job_guard(p_job,p_lease);
 update public.marketing_jobs set state='retry',due_at=now()+make_interval(secs=>greatest(30,least(300,p_seconds))),lease_expires_at=null,error_code=left(p_code,100),updated_at=now() where id=p_job and lease_token=p_lease;
end;$$;
create or replace function public.marketing_finish_job(p_job uuid,p_lease uuid,p_outcome text,p_provider_post_id text default null,p_error_code text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; c public.marketing_content; next_state text;
begin
 -- Lock content before job, matching authoring/cancellation order to avoid deadlocks.
 select c0.* into c from public.marketing_content c0 join public.marketing_jobs j0 on j0.content_id=c0.id where j0.id=p_job for update of c0;
 select * into j from public.marketing_jobs where id=p_job for update;
 if found and j.lease_token=p_lease and j.state='succeeded' and p_outcome='published' and j.provider_post_id=p_provider_post_id then return to_jsonb(j); end if;
 if not found or j.lease_token is distinct from p_lease or p_lease is null or j.state not in ('leased','reconciling') then raise exception 'Publishing lease is unavailable.'; end if;
 if c.revision<>j.revision or c.approved_revision is distinct from j.revision then raise exception 'Approved publishing revision changed.'; end if;
 if p_outcome='published' and (j.provider_state->>'post_id' is distinct from p_provider_post_id or j.connection_id is null) then raise exception 'Checkpointed provider evidence required.';end if;
 next_state:=case p_outcome when 'published' then 'succeeded' when 'uncertain' then 'reconciling' when 'retryable_failure' then case when j.failures>=4 then 'failed' else 'retry' end when 'permanent_failure' then 'failed' end;
 if next_state is null or (next_state='succeeded' and length(trim(coalesce(p_provider_post_id,'')))=0) then raise exception 'Verified provider receipt or failure outcome is required.'; end if;
 update public.marketing_jobs set state=next_state,failures=failures+case when p_outcome='retryable_failure' then 1 else 0 end,provider_post_id=case when next_state='succeeded' then p_provider_post_id else null end,
 error_code=case when next_state='succeeded' then null else left(coalesce(p_error_code,'provider_failure'),100) end,
 due_at=case when next_state='retry' then now()+make_interval(secs=>least(3600,30*(2^least(j.attempts,7))::integer)) else due_at end,
 lease_expires_at=null,updated_at=now() where id=p_job returning * into j;
 if not exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state<>'succeeded') then
   update public.marketing_content set status='published',updated_at=now() where id=c.id;
 elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then
   update public.marketing_content set status='failed',updated_at=now() where id=c.id;
 end if;
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details) values(j.organization_id,j.brand_id,j.content_id,'publishing_'||next_state,jsonb_build_object('job_id',j.id,'revision',j.revision,'channel',j.channel,'provider_post_id',j.provider_post_id,'error_code',j.error_code));
 return to_jsonb(j);
end; $$;
create function public.marketing_claim_reconciliation() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs;
begin
 select x.* into j from public.marketing_jobs x join public.marketing_content c on c.id=x.content_id
 where x.state='reconciling' and x.due_at<=now() and (x.lease_expires_at is null or x.lease_expires_at<now())
 and x.provider_state<>'{}' and marketing_private.job_authorized(x)
 and exists(select 1 from public.marketing_connections conn join marketing_private.credentials cr on cr.connection_id=conn.id where conn.id=x.connection_id and conn.credential_generation=x.connection_generation and conn.expires_at>now())
 order by x.due_at,x.id for update of c skip locked limit 1;
 if not found then return null;end if;
 update public.marketing_jobs set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',due_at=now()+interval '5 minutes' where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('payload',(select payload from public.marketing_content_revisions where content_id=j.content_id and revision=j.revision));
end;$$;
create function public.marketing_job_assets(p_job uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; result jsonb;
begin
 perform public.marketing_job_guard(p_job,p_lease);select * into j from public.marketing_jobs where id=p_job;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from public.marketing_assets a
 join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
 where a.brand_id=j.brand_id and a.organization_id=j.organization_id and a.state='ready'
 and exists(select 1 from jsonb_array_elements(r.payload->'variants') v cross join jsonb_array_elements_text(v->'asset_ids') aid where v->>'channel'=j.channel and aid::uuid=a.id);
 return result;
end;$$;
create function public.marketing_worker_health(p_error text default null,p_completed boolean default false) returns void language plpgsql security definer set search_path=public as $$begin
 insert into marketing_private.worker_health(id,last_seen_at,last_completed_at,error_code) values(true,now(),case when p_completed then now() end,left(p_error,100))
 on conflict(id) do update set last_seen_at=now(),last_completed_at=case when p_completed then now() else worker_health.last_completed_at end,error_code=left(p_error,100);
end;$$;
create function public.marketing_meta_request_sync(p_connection uuid) returns void language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not found then raise exception 'Connection unavailable.';end if;
 perform marketing_private.require_access(c.organization_id,c.brand_id,'marketing_settings.configure');
 if c.status not in ('test_authorized','production_authorized') or c.expires_at<=now() or c.capabilities->>'posts' is distinct from 'true' then raise exception 'Post synchronization is unavailable.';end if;
 update public.marketing_connections set sync_requested_at=now(),sync_retry_at=null,sync_attempts=0,sync_error_code=null where id=c.id;
end;$$;
create function public.marketing_meta_sync_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;
begin
 select * into c from public.marketing_connections x where x.status in ('test_authorized','production_authorized') and x.expires_at>now()
 and x.capabilities->>'posts'='true' and (x.sync_lease_until is null or x.sync_lease_until<now()) and x.sync_attempts<5
 and (x.sync_retry_at is null or x.sync_retry_at<=now())
 and (x.sync_requested_at is not null or x.last_synced_at is null or x.last_synced_at<now()-interval '30 minutes')
 and marketing_private.actor_allowed(x.connected_by,x.organization_id,x.brand_id,'marketing_settings.configure')
 order by x.last_synced_at nulls first,x.id for update skip locked limit 1;
 if not found then return null;end if;
 update public.marketing_connections set sync_lease=gen_random_uuid(),sync_lease_until=now()+interval '3 minutes',sync_attempts=sync_attempts+1 where id=c.id returning * into c;
 return to_jsonb(c);
end;$$;
create function public.marketing_meta_sync_guard(p_connection uuid,p_generation integer,p_lease uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.marketing_connections c join marketing_private.credentials s on s.connection_id=c.id
 where c.id=p_connection and c.credential_generation=p_generation and c.sync_lease=p_lease and c.sync_lease_until>now()
 and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
 and marketing_private.actor_allowed(c.connected_by,c.organization_id,c.brand_id,'marketing_settings.configure'));
$$;
create function public.marketing_meta_sync_finish(p_connection uuid,p_generation integer,p_lease uuid,p_posts jsonb,p_after text,p_error text) returns void
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections; post jsonb;
begin
 select * into c from public.marketing_connections where id=p_connection for update;
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 if jsonb_typeof(p_posts)<>'array' or jsonb_array_length(p_posts)>25 or octet_length(p_posts::text)>1000000 then raise exception 'Invalid post evidence.';end if;
 for post in select value from jsonb_array_elements(p_posts) loop
  if coalesce(post->>'id','') !~ '^[0-9]+(_[0-9]+)?$' then raise exception 'Invalid provider post identity.';end if;
  insert into public.marketing_social_posts(organization_id,brand_id,connection_id,connection_generation,provider_post_id,channel,caption,permalink,published_at,metrics,unavailable_metrics)
  values(c.organization_id,c.brand_id,c.id,p_generation,post->>'id',c.channel,left(post->>'caption',63206),case when post->>'permalink' ~ '^https://' then post->>'permalink' end,(post->>'published_at')::timestamptz,coalesce(post->'metrics','{}'),coalesce(post->'unavailable_metrics','{}'))
  on conflict(connection_id,connection_generation,provider_post_id) do update set caption=excluded.caption,permalink=excluded.permalink,published_at=excluded.published_at,metrics=excluded.metrics,unavailable_metrics=excluded.unavailable_metrics,observed_at=now();
 end loop;
 update public.marketing_connections set sync_lease_until=null,sync_after=case when p_error is null then case when sync_pages>=39 then null else p_after end else sync_after end,
 sync_pages=case when p_error is null and (p_after is null or sync_pages>=39) then 0 when p_error is null then sync_pages+1 else sync_pages end,
 sync_truncated=case when p_error is null and sync_pages>=39 and p_after is not null then true when p_error is null and sync_after is null then false else sync_truncated end,
 sync_requested_at=case when p_error is null and (p_after is null or sync_pages>=39) then null else coalesce(sync_requested_at,now()) end,
 last_synced_at=case when p_error is null then now() else last_synced_at end,last_checked_at=now(),
 sync_attempts=case when p_error is null then 0 else sync_attempts end,sync_retry_at=case when p_error is not null then now()+make_interval(secs=>least(3600,60*(2^sync_attempts)::integer)) end,
 sync_error_code=left(p_error,100),status=case when p_error='meta_permission_or_token_invalid' then 'error' else status end,error_code=case when p_error='meta_permission_or_token_invalid' then p_error else error_code end where id=c.id;
end;$$;
create function public.marketing_integrations(p_org uuid,p_brand uuid default null,p_surface text default 'settings',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid; connections jsonb; posts jsonb; total integer; health jsonb;
begin
 if p_surface not in ('settings','analytics','content') or p_page not between 1 and 100000 then raise exception 'Invalid integration view.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,case p_surface when 'settings' then 'marketing_settings.view' when 'analytics' then 'marketing_analytics.view' else 'marketing_content.view' end);
 select coalesce(jsonb_agg(to_jsonb(c)-array['sync_after','sync_lease','sync_lease_until'] order by c.brand_id,c.channel),'[]') into connections from public.marketing_connections c
 where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 if p_surface='analytics' then
  select count(*) into total from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id);
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into posts from (select s.* from public.marketing_social_posts s where s.organization_id=p_org and (p_brand is null or s.brand_id=p_brand) and marketing_private.brand_allowed(p_org,s.brand_id) order by s.published_at desc nulls last,s.id limit 20 offset (p_page-1)*20) q;
 end if;
 select jsonb_build_object('last_seen_at',last_seen_at,'last_completed_at',last_completed_at,'error_code',error_code) into health from marketing_private.worker_health;
 return jsonb_build_object('connections',connections,'posts',coalesce(posts,'[]'),'total',coalesce(total,0),'worker',health);
end;$$;
revoke all on function public.marketing_authorize_execution(uuid,uuid,integer,uuid[]),public.marketing_integrations(uuid,uuid,text,integer),public.marketing_meta_request_sync(uuid) from public,anon,authenticated;
grant execute on function public.marketing_authorize_execution(uuid,uuid,integer,uuid[]),public.marketing_integrations(uuid,uuid,text,integer),public.marketing_meta_request_sync(uuid) to authenticated;
revoke all on function public.marketing_meta_execution_policy(uuid,integer,boolean),public.marketing_job_guard(uuid,uuid),public.marketing_job_checkpoint(uuid,uuid,jsonb),public.marketing_defer_job(uuid,uuid,integer,text),public.marketing_claim_reconciliation(),public.marketing_job_assets(uuid,uuid),public.marketing_worker_health(text,boolean),public.marketing_meta_sync_claim(),public.marketing_meta_sync_guard(uuid,integer,uuid),public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.marketing_meta_execution_policy(uuid,integer,boolean),public.marketing_job_guard(uuid,uuid),public.marketing_job_checkpoint(uuid,uuid,jsonb),public.marketing_defer_job(uuid,uuid,integer,text),public.marketing_claim_reconciliation(),public.marketing_job_assets(uuid,uuid),public.marketing_worker_health(text,boolean),public.marketing_meta_sync_claim(),public.marketing_meta_sync_guard(uuid,integer,uuid),public.marketing_meta_sync_finish(uuid,integer,uuid,jsonb,text,text) to service_role;

create or replace function public.marketing_meta_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_settings.configure'); result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'accounts',(select coalesce(jsonb_agg(a),'[]') from jsonb_array_elements(s.accounts) a where not s.bindings ? (a->>'channel')),'expires_at',s.expires_at) order by s.consumed_at desc),'[]') into result
 from marketing_private.oauth_sessions s where s.organization_id=p_org and s.brand_id=p_brand and s.actor_employee_id=actor and s.expires_at>now() and s.sealed_discovery is not null;
 return result;
end;$$;
