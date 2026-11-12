alter table finance_private.autocount_devices add column device_label text;
alter table finance_private.autocount_pairings
  alter column actor_auth_id drop not null,
  add column device_token_hash bytea check (octet_length(device_token_hash)=32),
  add column device_label text;
create index autocount_pairings_device_idx on finance_private.autocount_pairings(device_token_hash) where used_at is null;

drop function public.finance_autocount_owner(text,uuid,uuid,uuid);
create function public.finance_autocount_owner(p_action text, p_device_id uuid default null,
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
      where b.device_id=d.id)) order by d.paired_at desc),'[]'::jsonb) from finance_private.autocount_devices d);
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
        where autocount_book_id in (select id from finance_private.autocount_books where device_id=device.id);
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
revoke all on function public.finance_autocount_owner(text,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finance_autocount_owner(text,uuid,uuid,uuid,text) to authenticated;

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
