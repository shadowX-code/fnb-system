-- Trusted hybrid, row-atomic Sales/Purchase import authority.
-- A request owns one batch; each canonical target row owns one authoritative outcome.

alter table public.import_batches
  add column if not exists request_id uuid,
  add column if not exists payload_fingerprint text;

create unique index if not exists import_batches_request_id_unique
  on public.import_batches (request_id) where request_id is not null;

alter table public.import_batch_rows
  add column if not exists row_request_key text,
  add column if not exists outcome jsonb;

create unique index if not exists import_batch_rows_request_key_unique
  on public.import_batch_rows (batch_id, row_request_key)
  where row_request_key is not null;

create or replace function public.import_begin_request(
  p_request_id uuid,
  p_import_type text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_type text := lower(coalesce(nullif(btrim(p_import_type), ''), ''));
  v_outlet_id uuid := nullif(p_payload->>'outlet_id', '')::uuid;
  v_fingerprint text := md5(coalesce(p_payload, '{}'::jsonb)::text);
  v_batch public.import_batches%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_request_id is null or v_type not in ('sales', 'purchase') then raise exception 'A request ID and valid import type are required.'; end if;
  if v_type = 'sales' and not public.current_user_has_permission('sales_input.import') then raise exception using errcode = '42501', message = 'Missing permission to import sales.'; end if;
  if v_type = 'purchase' and not public.current_user_has_permission('purchase_input.import') then raise exception using errcode = '42501', message = 'Missing permission to import purchases.'; end if;
  if v_outlet_id is not null and not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot import for this outlet.'; end if;

  perform pg_advisory_xact_lock(hashtext('import_request_' || p_request_id::text));
  select * into v_batch from public.import_batches where request_id = p_request_id;
  if found then
    if lower(v_batch.import_type) = v_type and v_batch.created_by = v_actor and v_batch.payload_fingerprint = v_fingerprint then
      return jsonb_build_object('batch', to_jsonb(v_batch), 'reused', true);
    end if;
    raise exception 'Request ID was already used for a different import intent.';
  end if;

  insert into public.import_batches(
    request_id, payload_fingerprint, import_type, outlet_id, year, month_start, month_end,
    source_filename, total_rows, status, created_by, imported_by
  ) values (
    p_request_id, v_fingerprint, v_type, v_outlet_id,
    nullif(p_payload->>'year', '')::integer, nullif(p_payload->>'month_start', '')::integer, nullif(p_payload->>'month_end', '')::integer,
    nullif(btrim(p_payload->>'source_filename'), ''), 0, 'validating', v_actor, v_actor
  ) returning * into v_batch;
  return jsonb_build_object('batch', to_jsonb(v_batch), 'reused', false);
end; $$;

create or replace function public.import_apply_sales_row(p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_batch public.import_batches%rowtype; v_row public.import_batch_rows%rowtype;
  v_outlet_id uuid := nullif(p_payload->>'outlet_id','')::uuid; v_year integer := nullif(p_payload->>'year','')::integer;
  v_month integer := nullif(p_payload->>'month','')::integer; v_channel_id uuid := nullif(p_payload->>'channel_id','')::uuid;
  v_key text; v_existing boolean; v_saved public.sales_records%rowtype; v_result jsonb; v_error text;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if not public.current_user_has_permission('sales_input.import') then raise exception using errcode='42501', message='Missing permission to import sales.'; end if;
  if p_request_id is null or v_outlet_id is null or v_year is null or v_month is null or v_channel_id is null then raise exception 'Sales import row requires a complete canonical target key.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501', message='You cannot import for this outlet.'; end if;
  select * into v_batch from public.import_batches where request_id=p_request_id and lower(import_type)='sales' for update;
  if not found then raise exception 'Import request was not initialized.'; end if;
  v_key := 'sales:' || v_outlet_id || ':' || v_year || ':' || v_month || ':' || v_channel_id;
  select * into v_row from public.import_batch_rows where batch_id=v_batch.id and row_request_key=v_key for update;
  if found and v_row.validation_result='success' then return coalesce(v_row.outcome, '{}'::jsonb); end if;
  begin
    select exists(select 1 from public.sales_records where outlet_id=v_outlet_id and year=v_year and month=v_month and channel_id=v_channel_id) into v_existing;
    insert into public.sales_records(outlet_id,year,month,channel_id,channel_name,amount,remark,updated_at)
    values(v_outlet_id,v_year,v_month,v_channel_id,coalesce(p_payload->>'channel_name',''),coalesce((p_payload->>'amount')::numeric,0),coalesce(p_payload->>'remark',''),now())
    on conflict (outlet_id,year,month,channel_id) do update set channel_name=excluded.channel_name, amount=excluded.amount, remark=excluded.remark, updated_at=excluded.updated_at
    returning * into v_saved;
    v_result := jsonb_build_object('success',true,'row_request_key',v_key,'action',case when v_existing then 'update' else 'create' end,'record',to_jsonb(v_saved));
  exception when others then v_error := sqlerrm; end;
  if v_error is not null then
    v_result := jsonb_build_object('success',false,'row_request_key',v_key,'error',v_error);
    insert into public.import_batch_rows(batch_id,row_request_key,source_row,raw_row,action,validation_result,failure_reason,outcome)
    values(v_batch.id,v_key,nullif(p_payload->>'source_row','')::integer,p_payload->'raw_row','failed','failed',v_error,v_result)
    on conflict (batch_id,row_request_key) do update set source_row=excluded.source_row,raw_row=excluded.raw_row,action='failed',validation_result='failed',failure_reason=excluded.failure_reason,outcome=excluded.outcome;
    return v_result;
  end if;
  insert into public.import_batch_rows(batch_id,row_request_key,source_row,raw_row,action,validation_result,imported_record_id,outcome)
  values(v_batch.id,v_key,nullif(p_payload->>'source_row','')::integer,p_payload->'raw_row',v_result->>'action','success',v_saved.id,v_result)
  on conflict (batch_id,row_request_key) do update set source_row=excluded.source_row,raw_row=excluded.raw_row,action=excluded.action,validation_result='success',imported_record_id=excluded.imported_record_id,failure_reason=null,outcome=excluded.outcome;
  return v_result;
end; $$;

create or replace function public.import_apply_purchase_row(p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_batch public.import_batches%rowtype; v_row public.import_batch_rows%rowtype;
  v_outlet_id uuid := nullif(p_payload->>'outlet_id','')::uuid; v_year integer := nullif(p_payload->>'year','')::integer;
  v_month integer := nullif(p_payload->>'month','')::integer; v_supplier_id uuid := nullif(p_payload->>'supplier_id','')::uuid; v_category_id uuid := nullif(p_payload->>'category_id','')::uuid;
  v_key text; v_existing boolean; v_saved public.purchase_records%rowtype; v_result jsonb; v_error text;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  if not public.current_user_has_permission('purchase_input.import') then raise exception using errcode='42501', message='Missing permission to import purchases.'; end if;
  if p_request_id is null or v_outlet_id is null or v_year is null or v_month is null or v_supplier_id is null or v_category_id is null then raise exception 'Purchase import row requires a complete canonical target key.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501', message='You cannot import for this outlet.'; end if;
  select * into v_batch from public.import_batches where request_id=p_request_id and lower(import_type)='purchase' for update;
  if not found then raise exception 'Import request was not initialized.'; end if;
  v_key := 'purchase:' || v_outlet_id || ':' || v_year || ':' || v_month || ':' || v_supplier_id || ':' || v_category_id;
  select * into v_row from public.import_batch_rows where batch_id=v_batch.id and row_request_key=v_key for update;
  if found and v_row.validation_result='success' then return coalesce(v_row.outcome, '{}'::jsonb); end if;
  begin
    select exists(select 1 from public.purchase_records where outlet_id=v_outlet_id and year=v_year and month=v_month and supplier_id=v_supplier_id and category_id=v_category_id) into v_existing;
    insert into public.purchase_records(outlet_id,year,month,supplier_id,category_id,amount,remark,updated_at)
    values(v_outlet_id,v_year,v_month,v_supplier_id,v_category_id,coalesce((p_payload->>'amount')::numeric,0),coalesce(p_payload->>'remark',''),now())
    on conflict (outlet_id,year,month,supplier_id,category_id) do update set amount=excluded.amount,remark=excluded.remark,updated_at=excluded.updated_at
    returning * into v_saved;
    v_result := jsonb_build_object('success',true,'row_request_key',v_key,'action',case when v_existing then 'update' else 'create' end,'record',to_jsonb(v_saved));
  exception when others then v_error := sqlerrm; end;
  if v_error is not null then
    v_result := jsonb_build_object('success',false,'row_request_key',v_key,'error',v_error);
    insert into public.import_batch_rows(batch_id,row_request_key,source_row,raw_row,action,validation_result,failure_reason,outcome)
    values(v_batch.id,v_key,nullif(p_payload->>'source_row','')::integer,p_payload->'raw_row','failed','failed',v_error,v_result)
    on conflict (batch_id,row_request_key) do update set source_row=excluded.source_row,raw_row=excluded.raw_row,action='failed',validation_result='failed',failure_reason=excluded.failure_reason,outcome=excluded.outcome;
    return v_result;
  end if;
  insert into public.import_batch_rows(batch_id,row_request_key,source_row,raw_row,action,validation_result,imported_record_id,outcome)
  values(v_batch.id,v_key,nullif(p_payload->>'source_row','')::integer,p_payload->'raw_row',v_result->>'action','success',v_saved.id,v_result)
  on conflict (batch_id,row_request_key) do update set source_row=excluded.source_row,raw_row=excluded.raw_row,action=excluded.action,validation_result='success',imported_record_id=excluded.imported_record_id,failure_reason=null,outcome=excluded.outcome;
  return v_result;
end; $$;

create or replace function public.import_finalize_batch(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_batch public.import_batches%rowtype; v_total integer; v_success integer; v_failed integer; v_created integer; v_updated integer; v_status text;
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication is required.'; end if;
  select * into v_batch from public.import_batches where request_id=p_request_id for update;
  if not found then raise exception 'Import request was not initialized.'; end if;
  if (lower(v_batch.import_type)='sales' and not public.current_user_has_permission('sales_input.import')) or (lower(v_batch.import_type)='purchase' and not public.current_user_has_permission('purchase_input.import')) then raise exception using errcode='42501', message='Missing permission to finalize this import.'; end if;
  select count(*), count(*) filter(where validation_result='success'), count(*) filter(where validation_result='failed'), count(*) filter(where action='create' and validation_result='success'), count(*) filter(where action='update' and validation_result='success') into v_total,v_success,v_failed,v_created,v_updated from public.import_batch_rows where batch_id=v_batch.id and row_request_key is not null;
  v_status := case when v_success > 0 and v_failed > 0 then 'partial_failed' when v_success > 0 then 'completed' else 'failed' end;
  update public.import_batches set total_rows=v_total,created_count=v_created,updated_count=v_updated,failed_count=v_failed,status=v_status,imported_at=now(),completed_at=now(),failure_reason=case when v_failed>0 then 'One or more authoritative rows failed.' else null end where id=v_batch.id returning * into v_batch;
  return jsonb_build_object('batch',to_jsonb(v_batch),'total',v_total,'successful',v_success,'failed',v_failed,'created',v_created,'updated',v_updated);
end; $$;

revoke all on function public.import_begin_request(uuid,text,jsonb) from public,anon;
revoke all on function public.import_apply_sales_row(uuid,jsonb) from public,anon;
revoke all on function public.import_apply_purchase_row(uuid,jsonb) from public,anon;
revoke all on function public.import_finalize_batch(uuid) from public,anon;
grant execute on function public.import_begin_request(uuid,text,jsonb) to authenticated;
grant execute on function public.import_apply_sales_row(uuid,jsonb) to authenticated;
grant execute on function public.import_apply_purchase_row(uuid,jsonb) to authenticated;
grant execute on function public.import_finalize_batch(uuid) to authenticated;
