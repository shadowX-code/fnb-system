do $$begin
 if to_regprocedure('google_business_private.allowed(uuid,uuid,boolean)') is null
  or md5(pg_get_functiondef('google_business_private.allowed(uuid,uuid,boolean)'::regprocedure))<>'7c355b2b6fb3cd78b92e85ad4d6b3321'
  or md5(pg_get_functiondef('public.crew_google_business_server(text,uuid,uuid,jsonb)'::regprocedure))<>'eaa6e6e34e1f3c4a73cbe206cdc61acd' then raise exception 'Reviewed Google Business Profile Phase 1 baseline changed.';end if;
end;$$;
-- Owner-reply intents and outcomes remain separate from Customer/Performance evidence.
create table google_business_private.reply_requests (
 id uuid primary key, actor uuid not null references auth.users(id), outlet_id uuid not null references public.outlets(id),
 review_name text not null, generation integer not null, mapping_revision uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'), desired_hash text not null check(desired_hash ~ '^[a-f0-9]{64}$'),
 operation text not null check(operation in ('publish','update')), sealed_intent jsonb, sealed_remote jsonb,
 status text not null default 'ready' check(status in ('ready','sending','uncertain','confirmed','rejected','conflict')),
 remote_time timestamptz, lease uuid, lease_actor uuid references auth.users(id), lease_until timestamptz, outcome_code text,
 content_expires_at timestamptz not null default now()+interval '24 hours', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index google_reply_review_history on google_business_private.reply_requests(outlet_id,review_name,created_at desc);
create unique index google_reply_one_unresolved on google_business_private.reply_requests(review_name) where status in ('sending','uncertain');
alter table google_business_private.reply_requests enable row level security;
revoke all on google_business_private.reply_requests from public,anon,authenticated;

create function google_business_private.reply_allowed(p_user uuid,p_outlet uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);ok boolean;
begin
 if not google_business_private.allowed(p_user,p_outlet) then return false;end if;
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 ok:=public.current_user_has_permission('crew_performance.review');
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return coalesce(ok,false);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end;$$;
revoke all on function google_business_private.reply_allowed(uuid,uuid) from public,anon,authenticated;

create function public.crew_google_business_reply_server(p_action text,p_user uuid,p_outlet uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r google_business_private.reply_requests;c google_business_private.connection;m public.crew_google_outlet_locations;
 review text:=p_data->>'review';request_id uuid;attempt uuid;can_reply boolean;history jsonb;
begin
 if p_action='finish' then
  select * into r from google_business_private.reply_requests where id=(p_data->>'id')::uuid for update;
  if not found or r.outlet_id is distinct from p_outlet or r.lease_actor is distinct from p_user then raise exception 'Reply attempt unavailable.';end if;
  if r.status='confirmed' then return jsonb_build_object('status','confirmed','id',r.id);end if;
  if r.status<>'sending' or r.lease is distinct from (p_data->>'lease')::uuid then raise exception 'Reply attempt changed. Check status.';end if;
  if p_data->>'status' not in ('confirmed','rejected','uncertain','conflict') then raise exception 'Invalid reply outcome.';end if;
  if p_data->>'status'='confirmed' and (p_data->'sealed_remote' is null or p_data->>'remote_hash' is null or p_data->>'remote_time' is null) then raise exception 'Verified Google reply evidence is required.';end if;
  update google_business_private.reply_requests set status=p_data->>'status',operation=coalesce(p_data->>'operation',r.operation),outcome_code=p_data->>'code',
   sealed_remote=p_data->'sealed_remote',remote_time=(p_data->>'remote_time')::timestamptz,content_expires_at=now()+interval '24 hours',lease=null,lease_until=null,updated_at=now() where id=r.id;
  if p_data->>'status'='confirmed' then
   -- Patch only the exact complete snapshot; preserve its rating evidence and expiry.
   update google_business_private.inbox_cache set sealed_reviews=p_data->'sealed_projection'
    where location_resource_name=split_part(r.review_name,'/reviews/',1) and status='complete' and expires_at>now()
     and generation=r.generation and mapping_revision=r.mapping_revision and sealed_reviews=p_data->'expected_cache' and p_data->'sealed_projection' is not null;
   if not found then
    -- Invalidate concurrent sync leases too; they cannot restore pre-reply evidence.
    delete from google_business_private.inbox_cache where location_resource_name=split_part(r.review_name,'/reviews/',1);
   end if;
  end if;
  insert into google_business_private.events(action,actor,outlet_id,details) values('reply_outcome',p_user,p_outlet,
   jsonb_build_object('request_id',r.id,'review',r.review_name,'operation',coalesce(p_data->>'operation',r.operation),'status',p_data->>'status','code',p_data->>'code','remote_hash',p_data->>'remote_hash','remote_time',p_data->>'remote_time','moderation',p_data->>'moderation'));
  return jsonb_build_object('id',r.id,'status',p_data->>'status');
 end if;
 if not google_business_private.allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Google Reviews is unavailable for this outlet.';end if;
 can_reply:=google_business_private.reply_allowed(p_user,p_outlet);
 if p_action in ('prepare','claim','check') and not can_reply then raise exception using errcode='42501',message='Reply management permission is required for this outlet.';end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 if p_action in ('status','claim','check') then
  select * into r from google_business_private.reply_requests where id=(p_data->>'id')::uuid and outlet_id=p_outlet for update;
  if not found then raise exception 'Reply request unavailable.';end if;
  review:=r.review_name;
 end if;
 if p_action='status' then
  return jsonb_build_object('id',r.id,'status',r.status,'code',r.outcome_code,'review',r.review_name,'generation',r.generation,'mapping_revision',r.mapping_revision,
   'sealed_remote',case when r.content_expires_at>now() and m.location_resource_name=split_part(r.review_name,'/reviews/',1) then r.sealed_remote end);
 end if;
 if m.outlet_id is null or review !~ '^accounts/[A-Za-z0-9_-]+/locations/[A-Za-z0-9_-]+/reviews/[A-Za-z0-9_-]+$'
  or split_part(review,'/reviews/',1) is distinct from m.location_resource_name then raise exception 'Review does not belong to this outlet mapping.';end if;
 if p_action in ('access','history') then
  select coalesce(jsonb_agg(jsonb_build_object('request_id',x.id,'operation',x.operation,'status',x.status,'code',x.outcome_code,'actor',coalesce(e.full_name,'Admin'),'created_at',x.created_at,'updated_at',x.updated_at) order by x.created_at desc),'[]') into history
  from (select * from google_business_private.reply_requests where outlet_id=p_outlet and review_name=review order by created_at desc limit 20) x left join public.employees e on e.auth_user_id=x.actor;
  return jsonb_build_object('can_reply',can_reply,'generation',c.generation,'revision',m.revision,'history',history);
 end if;
 if c.status<>'connected' then raise exception 'Reconnect Google Business Profile before managing replies.';end if;
 if p_action='prepare' then
  if c.generation is distinct from (p_data->>'generation')::integer or m.revision is distinct from (p_data->>'revision')::uuid then raise exception 'Connection or mapping changed. Reload Review Detail.';end if;
  if p_data->>'confirmed' is distinct from 'true' or p_data->'sealed_intent' is null or p_data->>'operation' not in ('publish','update')
   or coalesce(p_data->>'payload_hash','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'desired_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Confirm a complete reply intent.';end if;
  request_id:=(p_data->>'id')::uuid;
  insert into google_business_private.reply_requests(id,actor,outlet_id,review_name,generation,mapping_revision,payload_hash,desired_hash,operation,sealed_intent)
   values(request_id,p_user,p_outlet,review,c.generation,m.revision,p_data->>'payload_hash',p_data->>'desired_hash',p_data->>'operation',p_data->'sealed_intent') on conflict(id) do nothing;
  select * into r from google_business_private.reply_requests where id=request_id for update;
  if r.actor is distinct from p_user or r.outlet_id is distinct from p_outlet or r.review_name is distinct from review or r.payload_hash is distinct from p_data->>'payload_hash' then raise exception 'Reply request ID was already used for a different intent.';end if;
  return jsonb_build_object('id',r.id,'status',r.status);
 elsif p_action in ('claim','check') then
  if p_action='claim' and r.actor is distinct from p_user then raise exception 'Only the confirming Admin can retry this reply.';end if;
  if r.status in ('confirmed','conflict') then return jsonb_build_object('claimed',false,'id',r.id,'status',r.status,'code',r.outcome_code);end if;
  if r.status='sending' and r.lease_until>now() then return jsonb_build_object('claimed',false,'id',r.id,'status','sending','code','reply_busy');end if;
  if c.generation<>r.generation or m.revision<>r.mapping_revision then
   if p_action='claim' then raise exception 'Reply authority changed. Check status, then reload Review Detail.';end if;
  end if;
  -- Serialize different intent IDs for one review; an uncertain outcome must be reconciled first.
  perform pg_advisory_xact_lock(hashtextextended(review,619));
  if exists(select 1 from google_business_private.reply_requests where review_name=review and id<>r.id and status in ('sending','uncertain')) then raise exception 'Another reply update is unresolved. Check its status in Reply History.';end if;
  attempt:=gen_random_uuid();
  update google_business_private.reply_requests set status='sending',lease=attempt,lease_actor=p_user,lease_until=now()+interval '2 minutes',updated_at=now() where id=r.id;
  insert into google_business_private.events(action,actor,outlet_id,details) values('reply_attempt',p_user,p_outlet,jsonb_build_object('request_id',r.id,'review',review,'operation',r.operation,'reconcile_only',p_action='check'));
  return to_jsonb(r)||jsonb_build_object('claimed',true,'lease',attempt,'read_only',p_action='check' or r.content_expires_at<=now() or r.sealed_intent is null);
 end if;
 raise exception 'Unsupported Google reply action.';
end;$$;
revoke all on function public.crew_google_business_reply_server(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_google_business_reply_server(text,uuid,uuid,jsonb) to service_role;

create function google_business_private.purge_reply_content() returns void language sql security definer set search_path=public,pg_temp as $$
 update google_business_private.reply_requests set sealed_intent=null,sealed_remote=null where content_expires_at<=now() and (sealed_intent is not null or sealed_remote is not null);
$$;
revoke all on function google_business_private.purge_reply_content() from public,anon,authenticated;
select cron.schedule('crew-google-business-reply-content-purge','19 * * * *',$job$select google_business_private.purge_reply_content();$job$);
