-- Keep connector progress backward compatible and permit only sanitized upload rejection categories.
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
