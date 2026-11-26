-- Present book authorization and accepted content changes separately from polling and sync outcomes.
create or replace function public.finance_accounting_source_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not finance_private.is_source_owner() then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'active',c.active and coalesce(d.active,true),'sourceBook',c.source_book,'bookId',b.id,'companyName',b.company_name,'entityActive',e.is_active,'legalEntityId',e.id,
    'supersededByConnectionId',c.superseded_by_connection_id,'supersededAt',c.superseded_at,
    'legalEntityLabel',coalesce(nullif(e.display_name,''),e.legal_company_name),
    'bookAuthorized',b.ready,'verifiedAt',c.verified_at,'lastConnectedAt',c.last_connected_at,'lastSyncAt',c.last_sync_at,
    'lastDataUpdateAt',case when c.active and coalesce(d.active,true) then (
      select max(s.accepted_at) from finance_private.source_snapshots s
      where s.connection_id=c.id and exists (
        select 1 from finance_private.source_receipts r where r.connection_id=s.connection_id and r.snapshot_id=s.id
      )
    ) end,
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
