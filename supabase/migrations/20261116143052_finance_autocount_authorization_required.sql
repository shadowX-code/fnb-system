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
        sync_updated_at=null,sync_error=null where autocount_book_id=book.id;
    end if;
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
