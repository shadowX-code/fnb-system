alter table finance_private.source_connections
  add column superseded_by_connection_id uuid references finance_private.source_connections(id),
  add column superseded_at timestamptz,
  add constraint source_connection_supersession_valid check (
    (superseded_by_connection_id is null and superseded_at is null) or
    (superseded_by_connection_id is not null and superseded_at is not null
      and superseded_by_connection_id <> id and autocount_book_id is not null
      and not active and retry_requested_at is null)
  );
create index source_connections_superseded_by_idx on finance_private.source_connections(superseded_by_connection_id)
  where superseded_by_connection_id is not null;

-- Privileged, explicit transition for an independently verified replacement. A display name never selects a successor.
create function finance_private.supersede_autocount_connection(p_previous uuid, p_current uuid) returns void
language plpgsql set search_path = '' as $$
declare
  previous finance_private.source_connections;
  current_connection finance_private.source_connections;
  paired_device uuid;
  current_device uuid;
begin
  if p_previous is null or p_current is null or p_previous = p_current then
    raise sqlstate 'PT422' using message='Select two distinct Account Book bindings';
  end if;

  -- Lock in the same order as the device, bind and upload contracts.
  select d.id into paired_device from finance_private.autocount_devices d
    join finance_private.autocount_books b on b.device_id=d.id
    join finance_private.source_connections c on c.autocount_book_id=b.id
    where c.id=p_previous and d.active for update of d;
  if not found then raise sqlstate 'PT409' using message='Previous binding must belong to an active paired device'; end if;
  select * into strict previous from finance_private.source_connections where id=p_previous for update;
  select * into current_connection from finance_private.source_connections where id=p_current for update;
  select device_id into current_device from finance_private.autocount_books where id=current_connection.autocount_book_id and ready;
  if current_device is distinct from paired_device or current_connection.legal_entity_id is distinct from previous.legal_entity_id then
    raise sqlstate 'PT409' using message='Bindings must belong to the same device and Legal Entity';
  end if;
  if previous.superseded_by_connection_id = p_current then return; end if;
  if not previous.active or not current_connection.active or current_connection.verified_at is null
    or current_connection.last_sync_at is null or previous.last_sync_at is null
    or not exists (select 1 from finance_private.source_receipts where connection_id=p_current)
    or not exists (select 1 from finance_private.source_receipts where connection_id=p_previous) then
    raise sqlstate 'PT409' using message='Both bindings must be active with accepted sync evidence';
  end if;
  update finance_private.source_connections
    set active=false, retry_requested_at=null, superseded_at=clock_timestamp(), superseded_by_connection_id=p_current
    where id=p_previous;
end
$$;
revoke all on function finance_private.supersede_autocount_connection(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.finance_autocount_owner(p_action text, p_device_id uuid default null,
  p_book_id uuid default null, p_legal_entity_id uuid default null, p_code text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  pairing finance_private.autocount_pairings;
  pending_hash bytea;
  book finance_private.autocount_books;
  c finance_private.source_connections;
  device finance_private.autocount_devices;
  outcome jsonb;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  if p_action='catalog' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'active',d.active,'pairedAt',d.paired_at,
      'label',d.device_label,'lastSeenAt',d.last_seen_at,'books',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',b.id,'name',b.book_name,'company',b.company_name,'ready',b.ready,'connectionId',s.id
      ) order by b.company_name,b.book_name),'[]'::jsonb)
      from finance_private.autocount_books b left join finance_private.source_connections s on s.autocount_book_id=b.id
      where b.device_id=d.id and s.superseded_by_connection_id is null)) order by d.paired_at desc),'[]'::jsonb) from finance_private.autocount_devices d);
  elsif p_action in ('preview','confirm') then
    if p_code is null or p_code !~ '^[A-F0-9]{16}$' then
      raise sqlstate 'PT422' using message='Invalid pairing code';
    end if;
    select device_token_hash into pending_hash from finance_private.autocount_pairings
      where code_hash=extensions.digest(p_code,'sha256') and expires_at>clock_timestamp() and used_at is null;
    if pending_hash is null then raise sqlstate 'PT404' using message='Pairing code expired or used'; end if;

    if p_action='preview' then
      select * into pairing from finance_private.autocount_pairings
        where code_hash=extensions.digest(p_code,'sha256') and device_token_hash=pending_hash
        and expires_at>clock_timestamp() and used_at is null;
      if not found then raise sqlstate 'PT404' using message='Pairing code expired or used'; end if;
      return jsonb_build_object('deviceLabel',pairing.device_label,'expiresAt',pairing.expires_at);
    end if;

    perform pg_advisory_xact_lock(hashtextextended(encode(pending_hash,'hex'),0));
    select * into pairing from finance_private.autocount_pairings
      where code_hash=extensions.digest(p_code,'sha256') and device_token_hash=pending_hash
      and expires_at>clock_timestamp() and used_at is null for update;
    if not found then raise sqlstate 'PT404' using message='Pairing code expired or used'; end if;
    if exists (select 1 from finance_private.autocount_devices where token_hash=pending_hash) then
      raise sqlstate 'PT409' using message='This computer is already registered';
    end if;
    if p_device_id is null then
      insert into finance_private.autocount_devices(token_hash,device_label)
        values(pending_hash,pairing.device_label) returning * into device;
    else
      update finance_private.autocount_devices set token_hash=pending_hash,device_label=pairing.device_label,
        active=true,paired_at=clock_timestamp(),last_seen_at=null,pairing_epoch=pairing_epoch+1
        where id=p_device_id returning * into device;
      if not found then raise sqlstate 'PT404' using message='Connector unavailable'; end if;
      update finance_private.autocount_books set ready=false where device_id=device.id;
      update finance_private.source_connections set verified_at=null,last_connected_at=null,sync_run=null,sync_state=null,
        retry_requested_at=case when active then clock_timestamp() end
        where superseded_by_connection_id is null
          and autocount_book_id in (select id from finance_private.autocount_books where device_id=device.id);
    end if;
    update finance_private.autocount_pairings set used_at=clock_timestamp(),actor_auth_id=auth.uid()
      where code_hash=pairing.code_hash;
    insert into finance_private.autocount_device_events(device_id,actor_auth_id,action)
      values(device.id,auth.uid(),case when p_device_id is null then 'pair' else 'replace' end);
    return jsonb_build_object('deviceId',device.id);
  elsif p_action='revoke_device' then
    select * into device from finance_private.autocount_devices where id=p_device_id for update;
    if not found then raise sqlstate 'PT404' using message='Connector unavailable'; end if;
    if device.active then
      update finance_private.autocount_devices set active=false,pairing_epoch=pairing_epoch+1 where id=device.id;
      update finance_private.autocount_books set ready=false where device_id=device.id;
      update finance_private.source_connections set verified_at=null,last_connected_at=null,sync_run=null,sync_state=null
        where superseded_by_connection_id is null
          and autocount_book_id in (select id from finance_private.autocount_books where device_id=device.id);
      insert into finance_private.autocount_device_events(device_id,actor_auth_id,action) values(device.id,auth.uid(),'revoke');
    end if;
    return jsonb_build_object('state','Revoked');
  elsif p_action='bind' then
    select d.* into device from finance_private.autocount_devices d join finance_private.autocount_books b
      on b.device_id=d.id where b.id=p_book_id for update of d;
    if not found or not device.active then raise sqlstate 'PT409' using message='Pair an active connector first'; end if;
    select * into book from finance_private.autocount_books where id=p_book_id for update;
    if not book.ready then raise sqlstate 'PT409' using message='Authorize this account book on Windows'; end if;
    if not exists (select 1 from public.legal_entities where id=p_legal_entity_id and is_active) then
      raise sqlstate 'PT422' using message='Select an active Legal Entity';
    end if;
    select * into c from finance_private.source_connections where autocount_book_id=book.id for update;
    if not found then
      -- Legacy history must be reviewed before attaching it to a newly observed physical book.
      if exists(select 1 from finance_private.source_connections where autocount_book_id is null and source_book=book.book_name) then
        raise sqlstate 'PT409' using message='Legacy binding requires a history review';
      end if;
      insert into finance_private.source_connections(provider,source_book,legal_entity_id,managed,autocount_book_id,retry_requested_at)
        values('autocount',book.book_name,p_legal_entity_id,true,book.id,clock_timestamp()) returning * into c;
      insert into finance_private.source_management_events(connection_id,actor_auth_id,action) values(c.id,auth.uid(),'enroll');
    elsif c.superseded_by_connection_id is not null then
      raise sqlstate 'PT409' using message='This Account Book binding is retained in connection history';
    elsif c.legal_entity_id<>p_legal_entity_id then
      raise sqlstate 'PT409' using message='Accepted history belongs to the existing Legal Entity';
    elsif not c.active then
      update finance_private.source_connections set active=true,verified_at=null,last_connected_at=null,sync_run=null,
        sync_state=null,sync_updated_at=null,retry_requested_at=clock_timestamp(),sync_error=null where id=c.id;
      insert into finance_private.source_management_events(connection_id,actor_auth_id,action) values(c.id,auth.uid(),'reenroll');
    end if;
    outcome := jsonb_build_object('connectionId',c.id,'state','Bound');
    return outcome;
  end if;
  raise sqlstate 'PT422' using message='Unknown connector action';
end
$$;

create or replace function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not finance_private.is_source_owner() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active and coalesce(d.active,true),'sourceBook',c.source_book,'bookId',b.id,'companyName',b.company_name,'entityActive',e.is_active,'legalEntityId',e.id,
    'supersededByConnectionId',c.superseded_by_connection_id,'supersededAt',c.superseded_at,
    'legalEntityLabel',coalesce(nullif(e.display_name,''),e.legal_company_name),
    'verifiedAt',c.verified_at,'lastConnectedAt',c.last_connected_at,'lastSyncAt',c.last_sync_at,
    'lastAttemptAt',c.sync_attempt_at,'lastSyncReportAt',c.sync_updated_at,
    'deviceLastSeenAt',case when c.active and d.active then d.last_seen_at end,
    'backgroundMode',case when c.active and d.active and d.schedule_reported_at >= d.paired_at then d.background_mode end,
    'nextPollAt',case when c.active and d.active and d.schedule_reported_at >= d.paired_at then d.next_poll_at end,
    'retryRequestedAt',case when c.active then c.retry_requested_at end,'pendingRetries',c.pending_retries,'sourceRows',c.source_rows,
    'syncState',case when not c.active then null when c.sync_state='running' and c.sync_updated_at < now() - interval '1 hour'
      then 'interrupted' else c.sync_state end,'syncError',case when c.active then c.sync_error end,
    'datasets',(select coalesce(jsonb_agg(to_jsonb(d) order by d.dataset),'[]'::jsonb) from (
      select distinct on (s.dataset) s.dataset,s.scope_date as "scopeDate",r.received_at as "acceptedAt",jsonb_array_length(s.rows) as "acceptedRows"
      from finance_private.source_receipts r join finance_private.source_snapshots s on s.id=r.snapshot_id
      where r.connection_id=c.id order by s.dataset,r.received_at desc,s.id desc
    ) d)
  )),'[]'::jsonb) into result
  from finance_private.source_connections c join public.legal_entities e on e.id=c.legal_entity_id
  left join finance_private.autocount_books b on b.id=c.autocount_book_id
  left join finance_private.autocount_devices d on d.id=b.device_id
  where c.provider='autocount';
  return result;
end
$$;
