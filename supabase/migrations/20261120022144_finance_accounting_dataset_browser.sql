-- Project accepted day scopes for coverage. Repeated receipts must not multiply source rows.
create function finance_private.accepted_gl_coverage(p_connection_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  with accepted_days as (
    select distinct on (s.scope_date) s.scope_date, jsonb_array_length(s.rows) as row_count, r.received_at
    from finance_private.source_receipts r
    join finance_private.source_snapshots s on s.connection_id=r.connection_id and s.id=r.snapshot_id
    where r.connection_id=p_connection_id and s.dataset='GL' and s.scope_date is not null
    order by s.scope_date, r.received_at desc, s.id desc
  )
  select jsonb_build_object('firstDate',min(scope_date),'throughDate',max(scope_date),
    'acceptedDays',count(*),'emptyDays',count(*) filter (where row_count=0),
    'missingDays',coalesce(max(scope_date)-min(scope_date)+1-count(*),0),
    'acceptedRows',coalesce(sum(row_count),0),'lastAcceptedAt',max(received_at))
  from accepted_days;
$$;
revoke all on function finance_private.accepted_gl_coverage(uuid) from public, anon, authenticated, service_role;

-- Pin a receipt-backed snapshot across requests so page boundaries survive automatic sync.
create function public.finance_accounting_dataset(
  p_connection_id uuid, p_dataset text, p_scope_date date default null,
  p_snapshot_id bigint default null, p_search text default '', p_offset integer default 0, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  connection_record record;
  accepted_snapshot record;
  filtered_count integer;
  page_rows jsonb;
  search_text text := lower(btrim(coalesce(p_search,'')));
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  if p_dataset is null or p_dataset not in ('COA','GL','Department','Project')
    or (p_dataset <> 'GL' and p_scope_date is not null) or length(search_text)>128
    or p_offset is null or p_offset not between 0 and 5000 or p_limit is null or p_limit not between 1 and 100
    or p_snapshot_id < 1 then
    raise sqlstate 'PT422' using message='Invalid dataset, scope or page';
  end if;
  select c.source_book,b.id as book_id,b.company_name,coalesce(nullif(e.display_name,''),e.legal_company_name) as entity_label
    into connection_record
    from finance_private.source_connections c
    join public.legal_entities e on e.id=c.legal_entity_id
    left join finance_private.autocount_books b on b.id=c.autocount_book_id
    left join finance_private.autocount_devices d on d.id=b.device_id
    where c.id=p_connection_id and c.provider='autocount' and c.active and c.verified_at is not null
      and c.superseded_by_connection_id is null and e.is_active and coalesce(d.active and b.ready,true);
  if not found then raise sqlstate 'PT404' using message='Current accounting connection unavailable'; end if;

  select s.id, s.scope_date, s.accepted_at, r.received_at, s.rows into accepted_snapshot
    from finance_private.source_snapshots s
    join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
    where s.connection_id=p_connection_id and s.dataset=p_dataset
      and (p_scope_date is null or s.scope_date=p_scope_date)
      and (p_snapshot_id is null or s.id=p_snapshot_id)
    order by s.scope_date desc nulls last, r.received_at desc, s.id desc limit 1;
  if not found and p_snapshot_id is not null then raise sqlstate 'PT404' using message='Accepted snapshot unavailable'; end if;

  with matches as materialized (
    select item.value as row, item.ordinality as position
    from jsonb_array_elements(coalesce(accepted_snapshot.rows,'[]'::jsonb)) with ordinality as item(value, ordinality)
    where search_text='' or exists (select 1 from jsonb_each_text(item.value) f where strpos(lower(f.value),search_text)>0)
  )
  select (select count(*) from matches), coalesce(jsonb_agg(page.row order by page.position),'[]'::jsonb)
    into filtered_count,page_rows
    from (select row,position from matches order by position offset p_offset limit p_limit) page;

  return jsonb_build_object('connectionId',p_connection_id,'bookId',connection_record.book_id,
    'sourceBook',connection_record.source_book,'companyName',connection_record.company_name,'legalEntityLabel',connection_record.entity_label,
    'dataset',p_dataset,'scopeDate',coalesce(accepted_snapshot.scope_date,p_scope_date),
    'snapshotId',accepted_snapshot.id::text,'snapshotAt',accepted_snapshot.accepted_at,'lastAcceptedAt',accepted_snapshot.received_at,
    'acceptedRows',jsonb_array_length(accepted_snapshot.rows),'filteredRows',filtered_count,'rows',page_rows);
end
$$;
revoke all on function public.finance_accounting_dataset(uuid,text,date,bigint,text,integer,integer) from public, anon, authenticated, service_role;
grant execute on function public.finance_accounting_dataset(uuid,text,date,bigint,text,integer,integer) to authenticated;

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
    'glCoverage',case when c.active and coalesce(d.active,true) then finance_private.accepted_gl_coverage(c.id) end,
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
