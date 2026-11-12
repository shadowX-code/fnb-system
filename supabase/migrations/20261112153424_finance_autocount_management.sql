alter table finance_private.source_connections
  add column managed boolean not null default false,
  add column verified_at timestamptz,
  add column sync_run uuid,
  add column sync_state text check (sync_state in ('running','succeeded','failed')),
  add column sync_updated_at timestamptz,
  add column last_sync_at timestamptz,
  add column retry_requested_at timestamptz,
  add column pending_retries integer check (pending_retries >= 0),
  add column source_rows integer check (source_rows >= 0),
  add column sync_error text;

create table finance_private.source_management_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null references finance_private.source_connections(id),
  actor_auth_id uuid not null,
  action text not null check (action in ('enroll','reenroll','retry','revoke')),
  occurred_at timestamptz not null default clock_timestamp()
);
alter table finance_private.source_management_events enable row level security;

create function finance_private.is_source_owner() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.roles where id = public.current_user_role_id() and lower(name) = 'owner'
  )
$$;
revoke all on function finance_private.is_source_owner() from public, anon, authenticated;

create function public.finance_accounting_connector_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not finance_private.is_source_owner() then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label) order by label,id),'[]'::jsonb)
    from (select id, coalesce(nullif(display_name,''),legal_company_name) label from public.legal_entities where is_active) entities);
end
$$;
revoke all on function public.finance_accounting_connector_options() from public, anon, authenticated;
grant execute on function public.finance_accounting_connector_options() to authenticated;

create function public.finance_manage_accounting_connector(
  p_action text, p_connection_id uuid default null, p_legal_entity_id uuid default null,
  p_enrollment_fingerprint text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c finance_private.source_connections;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message = 'Owner access required'; end if;
  if p_action in ('enroll','reenroll') and
    (p_enrollment_fingerprint is null or p_enrollment_fingerprint !~ '^[0-9a-f]{64}$') then
    raise sqlstate 'PT422' using message = 'Invalid enrollment fingerprint';
  end if;

  if p_action = 'enroll' then
    if not exists (select 1 from public.legal_entities where id=p_legal_entity_id and is_active) then
      raise sqlstate 'PT422' using message = 'Select an active legal entity';
    end if;
    insert into finance_private.source_connections(provider,source_book,legal_entity_id,token_hash,managed)
      values ('autocount','AED_TEST',p_legal_entity_id,decode(p_enrollment_fingerprint,'hex'),true)
      on conflict (provider,source_book) do nothing returning * into c;
    if not found then raise sqlstate 'PT409' using message = 'AED_TEST already has a connection'; end if;
  elsif p_action in ('reenroll','retry','revoke') then
    select * into c from finance_private.source_connections
      where id=p_connection_id and provider='autocount' and source_book='AED_TEST' for update;
    if not found then raise sqlstate 'PT404' using message = 'Connection unavailable'; end if;
    if p_action = 'reenroll' then
      if c.token_hash = decode(p_enrollment_fingerprint,'hex') then
        raise sqlstate 'PT422' using message = 'Use a fresh enrollment fingerprint';
      end if;
      if not exists (select 1 from public.legal_entities where id=c.legal_entity_id and is_active) then
        raise sqlstate 'PT422' using message = 'The bound legal entity is inactive';
      end if;
      update finance_private.source_connections set managed=true,active=true,token_hash=decode(p_enrollment_fingerprint,'hex'),
        verified_at=null,last_connected_at=null,sync_run=null,sync_state=null,sync_updated_at=null,
        retry_requested_at=null,pending_retries=null,source_rows=null,sync_error=null where id=c.id;
    elsif p_action = 'retry' then
      if not c.active or c.verified_at is null or not exists
        (select 1 from public.legal_entities where id=c.legal_entity_id and is_active) then
        raise sqlstate 'PT409' using message = 'A verified active connector is required';
      end if;
      if c.retry_requested_at is not null then return c.id; end if;
      update finance_private.source_connections set retry_requested_at=clock_timestamp() where id=c.id;
    else
      if not c.active then return c.id; end if;
      update finance_private.source_connections set active=false,retry_requested_at=null where id=c.id;
    end if;
  else
    raise sqlstate 'PT422' using message = 'Unsupported connection action';
  end if;

  insert into finance_private.source_management_events(connection_id,actor_auth_id,action)
    values(c.id,auth.uid(),p_action);
  return c.id;
end
$$;
revoke all on function public.finance_manage_accounting_connector(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finance_manage_accounting_connector(text,uuid,uuid,text) to authenticated;

-- Keep the established validation, receipts and snapshots behind the same public RPC name.
alter function public.finance_accept_accounting_snapshot(uuid,text,date,jsonb) set schema finance_private;
revoke all on function finance_private.finance_accept_accounting_snapshot(uuid,text,date,jsonb) from public, anon, authenticated;

create function public.finance_accept_accounting_snapshot(
  p_request_id uuid default null, p_dataset text default null, p_scope_date date default null,
  p_rows jsonb default null, p_progress jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  token text := headers->>'x-feedx-connector';
  source_verified boolean := coalesce(headers->>'x-feedx-source-book' = 'AED_TEST',false);
  c finance_private.source_connections;
  v_run uuid;
  v_state text;
  v_error text;
  v_pending integer;
  v_rows integer;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    raise sqlstate 'PT401' using message = 'Connector authentication required';
  end if;
  select * into c from finance_private.source_connections
    where provider='autocount' and source_book='AED_TEST' and active and token_hash=extensions.digest(token,'sha256')
    and exists (select 1 from public.legal_entities where id=source_connections.legal_entity_id and is_active)
    for update;
  if not found then raise sqlstate 'PT401' using message = 'Connector authentication failed'; end if;
  if c.managed and not source_verified then
    raise sqlstate 'PT422' using message = 'Use the current connector to verify AED_TEST';
  end if;

  if p_progress is not null then
    if not source_verified or c.verified_at is null or p_request_id is not null or p_dataset is not null or
      p_scope_date is not null or p_rows is not null or jsonb_typeof(p_progress) <> 'object' or
      octet_length(p_progress::text) > 1000 or
      coalesce(p_progress->>'runId','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or
      coalesce(p_progress->>'pending','') !~ '^[0-9]{1,6}$' or
      coalesce(p_progress->>'sourceRows','') !~ '^[0-9]{1,7}$' then
      raise sqlstate 'PT422' using message = 'Invalid connector progress';
    end if;
    v_run := (p_progress->>'runId')::uuid;
    v_state := p_progress->>'state';
    v_pending := (p_progress->>'pending')::integer;
    v_rows := (p_progress->>'sourceRows')::integer;
    v_error := p_progress->>'error';
    if v_state is null or v_state not in ('running','succeeded','failed') or
      (v_state = 'failed') <> (v_error is not null) or (v_state = 'succeeded' and v_pending <> 0) or
      (v_error is not null and v_error not in
        ('source_read','scope_limit','upload_rejected','network','receipt','local')) then
      raise sqlstate 'PT422' using message = 'Invalid connector outcome';
    end if;
    if v_state = 'running' and c.sync_run = v_run and c.sync_state <> 'running' then
      raise sqlstate 'PT409' using message = 'This sync run already finished';
    elsif v_state <> 'running' and (c.sync_run is distinct from v_run or c.sync_state <> 'running') then
      raise sqlstate 'PT409' using message = 'This sync run is no longer current';
    end if;
    update finance_private.source_connections set sync_run=v_run,sync_state=v_state,sync_updated_at=clock_timestamp(),
      last_sync_at=case when v_state='succeeded' then clock_timestamp() else last_sync_at end,
      retry_requested_at=case when v_state='running' and sync_run is distinct from v_run then null else retry_requested_at end,
      pending_retries=v_pending,source_rows=v_rows,sync_error=v_error where id=c.id;
    return jsonb_build_object('state','Recorded');
  end if;

  if p_request_id is null and p_dataset is null and p_scope_date is null and p_rows is null then
    if source_verified then
      update finance_private.source_connections set verified_at=coalesce(verified_at,clock_timestamp()) where id=c.id;
    end if;
  elsif c.managed and c.verified_at is null then
    raise sqlstate 'PT409' using message = 'Run the connector connection test before uploading';
  end if;
  return finance_private.finance_accept_accounting_snapshot(p_request_id,p_dataset,p_scope_date,p_rows);
end
$$;
revoke all on function public.finance_accept_accounting_snapshot(uuid,text,date,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.finance_accept_accounting_snapshot(uuid,text,date,jsonb,jsonb) to anon;

create or replace function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not finance_private.is_source_owner() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active,'entityActive',e.is_active,'legalEntityId',e.id,
    'legalEntityLabel',coalesce(nullif(e.display_name,''),e.legal_company_name),
    'verifiedAt',c.verified_at,'lastConnectedAt',c.last_connected_at,'lastSyncAt',c.last_sync_at,
    'retryRequestedAt',c.retry_requested_at,'pendingRetries',c.pending_retries,'sourceRows',c.source_rows,
    'syncState',case when c.sync_state='running' and c.sync_updated_at < now() - interval '1 hour'
      then 'interrupted' else c.sync_state end,'syncError',c.sync_error,
    'datasets',(select coalesce(jsonb_agg(to_jsonb(d) order by d.dataset),'[]'::jsonb) from (
      select distinct on (s.dataset) s.dataset,s.scope_date as "scopeDate",r.received_at as "acceptedAt",jsonb_array_length(s.rows) as "acceptedRows"
      from finance_private.source_receipts r join finance_private.source_snapshots s on s.id=r.snapshot_id
      where r.connection_id=c.id order by s.dataset,r.received_at desc,s.id desc
    ) d)
  )),'[]'::jsonb) into result
  from finance_private.source_connections c join public.legal_entities e on e.id=c.legal_entity_id
  where c.provider='autocount' and c.source_book='AED_TEST';
  return result;
end
$$;
