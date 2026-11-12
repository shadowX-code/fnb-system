create table finance_private.autocount_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash)=32),
  active boolean not null default true,
  pairing_epoch integer not null default 0,
  paired_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz
);
create table finance_private.autocount_pairings (
  code_hash bytea primary key,
  actor_auth_id uuid not null,
  replaces_device_id uuid references finance_private.autocount_devices,
  expires_at timestamptz not null,
  expected_epoch integer,
  used_at timestamptz
);
create table finance_private.autocount_books (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references finance_private.autocount_devices,
  book_key text not null unique check (book_key ~ '^[a-f0-9]{64}$'),
  book_name text not null check (book_name ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  company_name text not null check (length(company_name) between 1 and 180),
  ready boolean not null default false,
  seen_at timestamptz not null default clock_timestamp()
);
create index autocount_books_device_idx on finance_private.autocount_books(device_id);
create table finance_private.autocount_device_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references finance_private.autocount_devices,
  actor_auth_id uuid not null,
  action text not null check (action in ('pair','replace','revoke')),
  occurred_at timestamptz not null default clock_timestamp()
);
alter table finance_private.autocount_devices enable row level security;
alter table finance_private.autocount_pairings enable row level security;
alter table finance_private.autocount_books enable row level security;
alter table finance_private.autocount_device_events enable row level security;
alter table finance_private.source_connections
  drop constraint source_connections_source_book_check,
  drop constraint source_connections_provider_source_book_key,
  alter column token_hash drop not null,
  add column autocount_book_id uuid unique references finance_private.autocount_books,
  add check (source_book ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  add check ((autocount_book_id is null and source_book='AED_TEST' and token_hash is not null)
    or (autocount_book_id is not null and token_hash is null));
create unique index finance_legacy_autocount_book on finance_private.source_connections(provider,source_book)
  where autocount_book_id is null;

create function public.finance_autocount_owner(p_action text, p_device_id uuid default null,
  p_book_id uuid default null, p_legal_entity_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  code text;
  expiry timestamptz;
  book finance_private.autocount_books;
  c finance_private.source_connections;
  device finance_private.autocount_devices;
  outcome jsonb;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  if p_action='catalog' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'active',d.active,'pairedAt',d.paired_at,
      'lastSeenAt',d.last_seen_at,'books',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',b.id,'name',b.book_name,'company',b.company_name,'ready',b.ready,'connectionId',s.id
      ) order by b.company_name,b.book_name),'[]'::jsonb)
      from finance_private.autocount_books b left join finance_private.source_connections s on s.autocount_book_id=b.id
      where b.device_id=d.id)) order by d.paired_at desc),'[]'::jsonb) from finance_private.autocount_devices d);
  elsif p_action='pair' then
    if p_device_id is not null then
      select * into device from finance_private.autocount_devices where id=p_device_id;
      if not found then raise sqlstate 'PT404' using message='Connector unavailable'; end if;
    end if;
    delete from finance_private.autocount_pairings where expires_at < now() - interval '1 day';
    if (select count(*) from finance_private.autocount_pairings where actor_auth_id=auth.uid() and expires_at>now() and used_at is null)>=12 then
      raise sqlstate 'PT429' using message='Too many active pairing codes';
    end if;
    code := upper(encode(extensions.gen_random_bytes(8),'hex'));
    expiry := clock_timestamp()+interval '10 minutes';
    insert into finance_private.autocount_pairings(code_hash,actor_auth_id,replaces_device_id,expires_at,expected_epoch)
      values(extensions.digest(code,'sha256'),auth.uid(),p_device_id,expiry,device.pairing_epoch);
    return jsonb_build_object('code',code,'expiresAt',expiry);
  elsif p_action='revoke_device' then
    select * into device from finance_private.autocount_devices where id=p_device_id for update;
    if not found then raise sqlstate 'PT404' using message='Connector unavailable'; end if;
    if device.active then
      update finance_private.autocount_devices set active=false,pairing_epoch=pairing_epoch+1 where id=device.id;
      update finance_private.autocount_books set ready=false where device_id=device.id;
      update finance_private.source_connections set verified_at=null,last_connected_at=null,sync_run=null,sync_state=null
        where autocount_book_id in (select id from finance_private.autocount_books where device_id=device.id);
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
revoke all on function public.finance_autocount_owner(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_autocount_owner(text,uuid,uuid,uuid) to authenticated;

create function public.finance_autocount_device(p_action text, p_code text default null, p_book_key text default null,
  p_book text default null, p_company text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  token text := headers->>'x-feedx-connector';
  device finance_private.autocount_devices;
  pairing finance_private.autocount_pairings;
  book finance_private.autocount_books;
begin
  if token is null or token !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT401' using message='Device authentication required'; end if;
  if p_action='pair' then
    if p_code is null or p_code !~ '^[A-F0-9]{16}$' then raise sqlstate 'PT422' using message='Invalid pairing code'; end if;
    select * into pairing from finance_private.autocount_pairings
      where code_hash=extensions.digest(p_code,'sha256') and expires_at>clock_timestamp() and used_at is null for update;
    if not found then raise sqlstate 'PT401' using message='Pairing code expired or used'; end if;
    if pairing.replaces_device_id is null then
      insert into finance_private.autocount_devices(token_hash,last_seen_at)
        values(extensions.digest(token,'sha256'),clock_timestamp()) returning * into device;
    else
      update finance_private.autocount_devices set token_hash=extensions.digest(token,'sha256'),
        active=true,paired_at=clock_timestamp(),last_seen_at=clock_timestamp(),pairing_epoch=pairing_epoch+1
        where id=pairing.replaces_device_id and pairing_epoch=pairing.expected_epoch returning * into device;
      if not found then raise sqlstate 'PT409' using message='Generate a new replacement code'; end if;
      update finance_private.autocount_books set ready=false where device_id=device.id;
      update finance_private.source_connections set verified_at=null,last_connected_at=null,sync_run=null,sync_state=null,
        retry_requested_at=case when active then clock_timestamp() end
        where autocount_book_id in (select id from finance_private.autocount_books where device_id=device.id);
    end if;
    update finance_private.autocount_pairings set used_at=clock_timestamp() where code_hash=pairing.code_hash;
    insert into finance_private.autocount_device_events(device_id,actor_auth_id,action)
      values(device.id,pairing.actor_auth_id,case when pairing.replaces_device_id is null then 'pair' else 'replace' end);
    return jsonb_build_object('deviceId',device.id);
  end if;

  select * into device from finance_private.autocount_devices
    where token_hash=extensions.digest(token,'sha256') and active for update;
  if not found then raise sqlstate 'PT401' using message='Device is not paired or access was revoked'; end if;
  update finance_private.autocount_devices set last_seen_at=clock_timestamp() where id=device.id;
  if p_action='discover' then
    if coalesce(p_book_key,'') !~ '^[a-f0-9]{64}$' or coalesce(p_book,'') !~ '^[A-Z][A-Z0-9_]{0,63}$'
      or coalesce(length(btrim(p_company)),0) not between 1 and 180 or p_company ~ '[[:cntrl:]]' then
      raise sqlstate 'PT422' using message='Unsupported Account Book identity';
    end if;
    if (select count(*) from finance_private.autocount_books where device_id=device.id)>=50 and
      not exists (select 1 from finance_private.autocount_books where device_id=device.id and book_key=p_book_key) then
      raise sqlstate 'PT422' using message='Account Book limit reached';
    end if;
    insert into finance_private.autocount_books(device_id,book_key,book_name,company_name,ready)
      values(device.id,p_book_key,p_book,btrim(p_company),true)
      on conflict(book_key) do update set company_name=excluded.company_name,ready=true,seen_at=clock_timestamp()
      where autocount_books.device_id=excluded.device_id and autocount_books.book_name=excluded.book_name returning * into book;
    if not found then raise sqlstate 'PT409' using message='Book belongs to another connector; use Replace computer'; end if;
    return jsonb_build_object('bookId',book.id);
  elsif p_action='source_error' then
    update finance_private.source_connections s set sync_state='failed',sync_error='source_read',sync_updated_at=clock_timestamp()
      from finance_private.autocount_books b
      where b.device_id=device.id and b.book_key=p_book_key and b.id=s.autocount_book_id and s.active;
    if not found then raise sqlstate 'PT409' using message='Book is not bound'; end if;
    return jsonb_build_object('state','Recorded');
  elsif p_action='books' then
    return jsonb_build_object('deviceId',device.id,'books',(select coalesce(jsonb_agg(jsonb_build_object(
      'bookId',b.id,'ready',b.ready,'connectionId',s.id,'bound',coalesce(s.active and e.is_active,false),
      'requested',s.retry_requested_at is not null,'needsRetry',coalesce(s.sync_state in ('failed','running'),false),'lastSyncAt',s.last_sync_at) order by b.id),'[]'::jsonb)
      from finance_private.autocount_books b left join finance_private.source_connections s on s.autocount_book_id=b.id
      left join public.legal_entities e on e.id=s.legal_entity_id where b.device_id=device.id));
  end if;
  raise sqlstate 'PT422' using message='Unknown connector action';
end
$$;
revoke all on function public.finance_autocount_device(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finance_autocount_device(text,text,text,text,text) to anon;

create function finance_private.accounting_request_connection(p_headers jsonb) returns uuid
language plpgsql set search_path='' as $$
declare
  token text := p_headers->>'x-feedx-connector';
  book_id text := p_headers->>'x-feedx-book';
  source_name text := p_headers->>'x-feedx-source-book';
  result uuid;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT401' using message='Connector authentication required'; end if;
  if book_id is not null then
    if book_id !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise sqlstate 'PT422' using message='Invalid Account Book identity'; end if;
    -- Always lock the device first so replacement and revocation serialize with uploads.
    perform 1 from finance_private.autocount_devices d join finance_private.autocount_books b on b.device_id=d.id
      where b.id=book_id::uuid and d.active and d.token_hash=extensions.digest(token,'sha256') for update of d;
    if not found then raise sqlstate 'PT401' using message='Device authentication failed'; end if;
    select c.id into result from finance_private.source_connections c join finance_private.autocount_books b on b.id=c.autocount_book_id
      join public.legal_entities e on e.id=c.legal_entity_id
      where b.id=book_id::uuid and b.ready and b.book_name=source_name and c.active and e.is_active for update of c;
  else
    select c.id into result from finance_private.source_connections c join public.legal_entities e on e.id=c.legal_entity_id
      where c.provider='autocount' and c.source_book='AED_TEST' and c.autocount_book_id is null and c.active
      and c.token_hash=extensions.digest(token,'sha256') and e.is_active for update of c;
  end if;
  if result is null then raise sqlstate 'PT401' using message='Book is not verified and bound'; end if;
  return result;
end
$$;
revoke all on function finance_private.accounting_request_connection(jsonb) from public,anon,authenticated;


create or replace function finance_private.finance_accept_accounting_snapshot(
  p_request_id uuid default null, p_dataset text default null,
  p_scope_date date default null, p_rows jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  connection finance_private.source_connections;
  target_connection_id uuid;
  receipt finance_private.source_receipts;
  snapshot finance_private.source_snapshots;
  fingerprint bytea;
  row_count integer;
  fields text[];
  duplicate boolean;
begin
  target_connection_id := finance_private.accounting_request_connection(nullif(current_setting('request.headers',true),'')::jsonb);
  select * into strict connection from finance_private.source_connections where id=target_connection_id;

  if p_request_id is null and p_dataset is null and p_scope_date is null and p_rows is null then
    update finance_private.source_connections set last_connected_at = clock_timestamp() where id = connection.id;
    return jsonb_build_object('connectionId', connection.id, 'state', 'Connected');
  end if;

  fields := case p_dataset
    when 'COA' then array['key','parent','description','type','currency']
    when 'GL' then array['key','account','department','project','currency','debit','credit','homeDebit','homeCredit']
    when 'Department' then array['key','parent','description','active']
    when 'Project' then array['key','parent','description','active']
  end;
  if p_request_id is null or fields is null or (p_dataset = 'GL') <> (p_scope_date is not null)
    or p_scope_date < date '2000-01-01' or p_scope_date > (now() at time zone 'Asia/Kuala_Lumpur')::date
    or jsonb_typeof(p_rows) is distinct from 'array' or octet_length(p_rows::text) > 2000000 then
    raise sqlstate 'PT422' using message = 'Invalid accounting snapshot envelope';
  end if;
  row_count := jsonb_array_length(p_rows);
  if row_count > 5000 or (p_dataset = 'COA' and row_count = 0)
    or exists (select 1 from jsonb_array_elements(p_rows) as r(value)
      where jsonb_typeof(value) <> 'object' or not (value ?& fields)
      or coalesce(length(value->>'key'), 0) not between 1 and 128) then
    raise sqlstate 'PT422' using message = 'Invalid accounting record shape';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) as r(value)
    cross join lateral jsonb_each(value) as f(name, item)
    where name <> all(fields) or (
      case when name = 'active' then jsonb_typeof(item) <> 'boolean'
      when name in ('debit','credit','homeDebit','homeCredit')
        then jsonb_typeof(item) not in ('string','null') or (item #>> '{}') !~ '^-?[0-9]{1,38}(\.[0-9]{1,38})?$'
      else jsonb_typeof(item) not in ('string','null') or length(item #>> '{}') > 512 end
    )) or (select count(distinct value->>'key') from jsonb_array_elements(p_rows) as r(value)) <> row_count
    or exists (select 1 from jsonb_array_elements(p_rows) as r(value) where p_dataset = 'GL'
      and ((value->>'key') !~ '^-?[0-9]{1,19}$' or coalesce(length(value->>'account'),0) not between 1 and 128
      or coalesce(length(value->>'currency'),0) not between 1 and 16)) then
    raise sqlstate 'PT422' using message = 'Invalid or duplicate accounting record';
  end if;

  fingerprint := extensions.digest(jsonb_build_array(p_dataset,p_scope_date,p_rows)::text,'sha256');
  select * into receipt from finance_private.source_receipts
    where connection_id = connection.id and request_id = p_request_id;
  if found then
    if receipt.fingerprint <> fingerprint then raise sqlstate 'PT409' using message = 'Request identifier payload conflict'; end if;
    return jsonb_build_object('connectionId',connection.id,'requestId',p_request_id,
      'snapshotId',receipt.snapshot_id,'acceptedRows',row_count,'duplicate',true,'state','Accepted');
  end if;

  select * into snapshot from finance_private.source_snapshots
    where connection_id = connection.id and dataset = p_dataset and scope_date is not distinct from p_scope_date
    order by id desc limit 1;
  duplicate := snapshot.fingerprint is not distinct from fingerprint;
  if not duplicate then
    insert into finance_private.source_snapshots(connection_id,dataset,scope_date,rows,fingerprint)
      values(connection.id,p_dataset,p_scope_date,p_rows,fingerprint) returning * into snapshot;
  end if;
  insert into finance_private.source_receipts(connection_id,request_id,fingerprint,snapshot_id)
    values(connection.id,p_request_id,fingerprint,snapshot.id);
  return jsonb_build_object('connectionId',connection.id,'requestId',p_request_id,
    'snapshotId',snapshot.id,'acceptedRows',row_count,'duplicate',duplicate,'state','Accepted');
end
$$;

create or replace function public.finance_accept_accounting_snapshot(
  p_request_id uuid default null, p_dataset text default null, p_scope_date date default null,
  p_rows jsonb default null, p_progress jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  source_verified boolean := coalesce(headers->>'x-feedx-source-book' = 'AED_TEST',false);
  c finance_private.source_connections;
  target_connection_id uuid;
  v_run uuid;
  v_state text;
  v_error text;
  v_pending integer;
  v_rows integer;
begin
  target_connection_id := finance_private.accounting_request_connection(headers);
  select * into strict c from finance_private.source_connections where id=target_connection_id;
  source_verified := coalesce(headers->>'x-feedx-source-book'=c.source_book,false);
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

create or replace function public.finance_manage_accounting_connector(
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
      on conflict (provider,source_book) where autocount_book_id is null do nothing returning * into c;
    if not found then raise sqlstate 'PT409' using message = 'AED_TEST already has a connection'; end if;
  elsif p_action in ('reenroll','retry','revoke') then
    select * into c from finance_private.source_connections
      where id=p_connection_id and provider='autocount' for update;
    if not found then raise sqlstate 'PT404' using message = 'Connection unavailable'; end if;
    if p_action = 'reenroll' then
      if c.autocount_book_id is not null then raise sqlstate 'PT422' using message='Use device pairing to reconnect'; end if;
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

create or replace function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not finance_private.is_source_owner() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active and coalesce(d.active,true),'sourceBook',c.source_book,'bookId',b.id,'companyName',b.company_name,'entityActive',e.is_active,'legalEntityId',e.id,
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
  left join finance_private.autocount_books b on b.id=c.autocount_book_id
  left join finance_private.autocount_devices d on d.id=b.device_id
  where c.provider='autocount';
  return result;
end
$$;
