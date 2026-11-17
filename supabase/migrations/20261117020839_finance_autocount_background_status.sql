-- Device schedule evidence and book attempt times are separate from accounting acceptance.
alter table finance_private.autocount_devices
  add column background_mode text,
  add column next_poll_at timestamptz,
  add column schedule_reported_at timestamptz;
alter table finance_private.source_connections add column sync_attempt_at timestamptz;

create or replace function public.finance_autocount_device(p_action text, p_code text default null, p_book_key text default null,
  p_book text default null, p_company text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  headers jsonb := nullif(current_setting('request.headers',true),'')::jsonb;
  token text := headers->>'x-feedx-connector';
  device finance_private.autocount_devices;
  device_hash bytea;
  code text;
  expiry timestamptz;
  book finance_private.autocount_books;
begin
  if token is null or token !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT401' using message='Device authentication required'; end if;
  if p_action='issue' then
    if coalesce(p_company,'') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$' then
      raise sqlstate 'PT422' using message='Invalid computer name';
    end if;
    device_hash := extensions.digest(token,'sha256');
    perform pg_advisory_xact_lock(hashtextextended(encode(device_hash,'hex'),0));
    if exists (select 1 from finance_private.autocount_devices where token_hash=device_hash) then
      raise sqlstate 'PT409' using message='This computer is already registered';
    end if;
    delete from finance_private.autocount_pairings
      where device_token_hash=device_hash and used_at is null;
    code := upper(encode(extensions.gen_random_bytes(8),'hex'));
    expiry := clock_timestamp()+interval '15 minutes';
    insert into finance_private.autocount_pairings(code_hash,device_token_hash,device_label,expires_at)
      values(extensions.digest(code,'sha256'),device_hash,p_company,expiry);
    return jsonb_build_object('code',code,'expiresAt',expiry);
  end if;

  select * into device from finance_private.autocount_devices
    where token_hash=extensions.digest(token,'sha256') and active for update;
  if not found then raise sqlstate 'PT401' using message='Device is not paired or access was revoked'; end if;
  update finance_private.autocount_devices set last_seen_at=clock_timestamp() where id=device.id;
  if p_action in ('discover','authorization_required') then
    if coalesce(p_book_key,'') !~ '^[a-f0-9]{64}$' or coalesce(p_book,'') !~ '^[A-Z][A-Z0-9_]{0,63}$'
      or coalesce(length(btrim(p_company)),0) not between 1 and 180 or p_company ~ '[[:cntrl:]]' then
      raise sqlstate 'PT422' using message='Unsupported Account Book identity';
    end if;
    if (select count(*) from finance_private.autocount_books where device_id=device.id)>=50 and
      not exists (select 1 from finance_private.autocount_books where device_id=device.id and book_key=p_book_key) then
      raise sqlstate 'PT422' using message='Account Book limit reached';
    end if;
    insert into finance_private.autocount_books(device_id,book_key,book_name,company_name,ready)
      values(device.id,p_book_key,p_book,btrim(p_company),p_action='discover')
      on conflict(book_key) do update set company_name=excluded.company_name,ready=excluded.ready,seen_at=clock_timestamp()
      where autocount_books.device_id=excluded.device_id and autocount_books.book_name=excluded.book_name returning * into book;
    if not found then raise sqlstate 'PT409' using message='Book belongs to another connector; use Replace computer'; end if;
    if not book.ready then
      update finance_private.source_connections set verified_at=null,last_connected_at=null,sync_run=null,sync_state=null,
        sync_updated_at=null,sync_attempt_at=null,sync_error=null where autocount_book_id=book.id;
    end if;
    return jsonb_build_object('bookId',book.id);
  elsif p_action='source_error' then
    update finance_private.source_connections s set sync_state='failed',
      sync_error=case when p_code in ('source_login','source_unreachable','source_permissions','source_schema') then p_code else 'source_read' end,
      sync_attempt_at=clock_timestamp(),sync_updated_at=clock_timestamp()
      from finance_private.autocount_books b
      where b.device_id=device.id and b.book_key=p_book_key and b.id=s.autocount_book_id and s.active
        and exists(select 1 from public.legal_entities e where e.id=s.legal_entity_id and e.is_active);
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

-- Keep the legacy device signature available for already installed connectors.
create function public.finance_autocount_device(p_background_mode text, p_next_poll_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb;
  observed_at timestamptz := clock_timestamp();
begin
  result := public.finance_autocount_device(p_action => 'books');
  if p_background_mode is null or p_background_mode not in ('unattended','signed_in','disabled','missing') then
    raise sqlstate 'PT422' using message='Invalid connector schedule mode';
  end if;
  update finance_private.autocount_devices
     set background_mode=p_background_mode,
         schedule_reported_at=observed_at,
         next_poll_at=case when p_background_mode in ('unattended','signed_in')
              and p_next_poll_at between observed_at - interval '5 minutes' and observed_at + interval '15 minutes'
              then p_next_poll_at else null end
   where id=(result->>'deviceId')::uuid;
  return result;
end
$$;
revoke all on function public.finance_autocount_device(text,timestamptz) from public, anon, authenticated;
grant execute on function public.finance_autocount_device(text,timestamptz) to anon;

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
        ('source_read','scope_limit','upload_rejected','network','receipt','local',
         'upload_date_format','upload_envelope','upload_record_shape','upload_record_values','upload_request_conflict')) then
      raise sqlstate 'PT422' using message = 'Invalid connector outcome';
    end if;
    if v_state = 'running' and c.sync_run = v_run and c.sync_state <> 'running' then
      raise sqlstate 'PT409' using message = 'This sync run already finished';
    elsif v_state <> 'running' and (c.sync_run is distinct from v_run or c.sync_state <> 'running') then
      raise sqlstate 'PT409' using message = 'This sync run is no longer current';
    end if;
    update finance_private.source_connections set sync_run=v_run,sync_state=v_state,sync_updated_at=clock_timestamp(),
      sync_attempt_at=case when v_state='running' and sync_run is distinct from v_run then clock_timestamp() else sync_attempt_at end,
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

create or replace function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not finance_private.is_source_owner() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active and coalesce(d.active,true),'sourceBook',c.source_book,'bookId',b.id,'companyName',b.company_name,'entityActive',e.is_active,'legalEntityId',e.id,
    'legalEntityLabel',coalesce(nullif(e.display_name,''),e.legal_company_name),
    'verifiedAt',c.verified_at,'lastConnectedAt',c.last_connected_at,'lastSyncAt',c.last_sync_at,
    'lastAttemptAt',c.sync_attempt_at,'lastSyncReportAt',c.sync_updated_at,
    'deviceLastSeenAt',d.last_seen_at,
    'backgroundMode',case when d.schedule_reported_at >= d.paired_at then d.background_mode end,
    'nextPollAt',case when d.schedule_reported_at >= d.paired_at then d.next_poll_at end,
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
