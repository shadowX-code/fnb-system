create schema if not exists finance_private;
revoke all on schema finance_private from public, anon, authenticated;

create table finance_private.source_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'autocount'),
  source_book text not null check (source_book = 'AED_TEST'),
  legal_entity_id uuid not null references public.legal_entities(id),
  token_hash bytea not null check (octet_length(token_hash) = 32),
  active boolean not null default true,
  last_connected_at timestamptz,
  unique (provider, source_book)
);

create table finance_private.source_snapshots (
  id bigint generated always as identity primary key,
  connection_id uuid not null references finance_private.source_connections(id),
  dataset text not null check (dataset in ('COA', 'GL', 'Department', 'Project')),
  scope_date date,
  accepted_at timestamptz not null default clock_timestamp(),
  rows jsonb not null,
  fingerprint bytea not null
);
create index finance_source_snapshot_history on finance_private.source_snapshots
  (connection_id, dataset, scope_date, id desc);

create table finance_private.source_receipts (
  connection_id uuid not null references finance_private.source_connections(id),
  request_id uuid not null,
  fingerprint bytea not null,
  snapshot_id bigint not null references finance_private.source_snapshots(id),
  received_at timestamptz not null default clock_timestamp(),
  primary key (connection_id, request_id)
);

alter table finance_private.source_connections enable row level security;
alter table finance_private.source_snapshots enable row level security;
alter table finance_private.source_receipts enable row level security;

create function public.finance_accept_accounting_snapshot(
  p_request_id uuid default null, p_dataset text default null,
  p_scope_date date default null, p_rows jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  connection finance_private.source_connections;
  receipt finance_private.source_receipts;
  snapshot finance_private.source_snapshots;
  token text := (nullif(current_setting('request.headers', true), '')::jsonb)->>'x-feedx-connector';
  fingerprint bytea;
  row_count integer;
  fields text[];
  duplicate boolean;
begin
  if token is null or token !~ '^[0-9a-f]{64}$' then
    raise sqlstate 'PT401' using message = 'Connector authentication required';
  end if;
  select * into connection from finance_private.source_connections
    where provider = 'autocount' and source_book = 'AED_TEST' and active
    and token_hash = extensions.digest(token, 'sha256')
    and exists (select 1 from public.legal_entities where id = source_connections.legal_entity_id and is_active)
    for update;
  if not found then raise sqlstate 'PT401' using message = 'Connector authentication failed'; end if;

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
revoke all on function public.finance_accept_accounting_snapshot(uuid,text,date,jsonb) from public, anon, authenticated;
grant execute on function public.finance_accept_accounting_snapshot(uuid,text,date,jsonb) to anon;

create function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  -- Test-book information is workspace-wide. Outlet-scoped report grants are insufficient.
  if auth.uid() is null or not exists (select 1 from public.roles where id = public.current_user_role_id() and lower(name) = 'owner') then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active,'legalEntityId',e.id,
    'legalEntityLabel',coalesce(nullif(e.display_name,''),e.legal_company_name),'lastConnectedAt',c.last_connected_at,
    'datasets',(select coalesce(jsonb_agg(to_jsonb(d) order by d.dataset),'[]'::jsonb) from (
      select distinct on (s.dataset) s.dataset,s.scope_date as "scopeDate",r.received_at as "acceptedAt",jsonb_array_length(s.rows) as "acceptedRows"
      from finance_private.source_receipts r
      join finance_private.source_snapshots s on s.id = r.snapshot_id
      where r.connection_id = c.id
      order by s.dataset,r.received_at desc,s.id desc
    ) d)
  )),'[]'::jsonb) into result
  from finance_private.source_connections c join public.legal_entities e on e.id = c.legal_entity_id
  where c.provider = 'autocount' and c.source_book = 'AED_TEST';
  return result;
end
$$;
revoke all on function public.finance_accounting_source_status() from public, anon, authenticated;
grant execute on function public.finance_accounting_source_status() to authenticated;
