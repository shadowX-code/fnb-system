-- Extend the active AED_TEST GL projection only. Legacy queued payloads retain their exact fingerprints.
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
  optional_gl_fields text[] := array['description','refNo1','refNo2','journalType','sourceType','sourceKey',
    'sourceDtlKey','paymentDocType','paymentDocKey'];
  allowed_fields text[];
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
  allowed_fields := fields;
  if p_dataset = 'GL' and connection.source_book = 'AED_TEST'
    and connection.autocount_book_id = '3037f4f7-94e6-4050-a6c0-a790559fb056'::uuid then
    allowed_fields := fields || optional_gl_fields;
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
    where name <> all(allowed_fields) or (
      case when name = 'active' then jsonb_typeof(item) <> 'boolean'
      when name in ('debit','credit','homeDebit','homeCredit')
        then jsonb_typeof(item) not in ('string','null') or (item #>> '{}') !~ '^-?[0-9]{1,38}(\.[0-9]{1,38})?$'
      when name in ('sourceKey','sourceDtlKey','paymentDocKey')
        then jsonb_typeof(item) not in ('string','null') or (item #>> '{}') !~ '^-?[0-9]{1,19}$'
      when name = any(optional_gl_fields)
        then jsonb_typeof(item) not in ('string','null') or length(item #>> '{}') > case name
          when 'description' then 100 when 'journalType' then 10
          when 'sourceType' then 2 when 'paymentDocType' then 2 else 30 end
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
