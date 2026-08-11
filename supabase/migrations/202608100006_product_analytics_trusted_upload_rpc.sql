-- Trusted, atomic Product Analytics report upload and replacement.
-- The browser supplies report intent; this RPC owns the report/item transaction.

create table if not exists public.product_analytics_lifecycle_requests (
  request_id uuid primary key,
  operation text not null check (operation in ('new','replace')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  report_month integer not null check (report_month between 1 and 12),
  report_year integer not null check (report_year between 2020 and 2100),
  payload_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.product_analytics_lifecycle_requests from public, anon, authenticated;

create or replace function public.product_analytics_save_report(
  p_request_id uuid,
  p_operation text,
  p_payload jsonb,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_operation text := lower(coalesce(nullif(btrim(p_operation),''), ''));
  v_outlet_id uuid := nullif(p_payload->>'outlet_id','')::uuid;
  v_month integer := nullif(p_payload->>'report_month','')::integer;
  v_year integer := nullif(p_payload->>'report_year','')::integer;
  v_file_name text := nullif(btrim(p_payload->>'file_name'),'');
  v_metadata jsonb := coalesce(p_payload->'raw_metadata','{}'::jsonb);
  v_fingerprint text := md5(coalesce(p_operation,'') || '|' || coalesce(p_payload,'{}'::jsonb)::text || '|' || coalesce(p_items,'[]'::jsonb)::text);
  v_result jsonb;
  v_existing public.product_sales_reports%rowtype;
  v_report public.product_sales_reports%rowtype;
  v_total_quantity numeric := 0;
  v_total_net_sales numeric := 0;
  v_total_discount numeric := 0;
  v_now timestamptz := now();
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_request_id is null or v_outlet_id is null or v_month is null or v_year is null or v_file_name is null then raise exception 'Request, outlet, reporting period and file name are required.'; end if;
  if v_operation not in ('new','replace') then raise exception 'Invalid product report save operation.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A product report requires at least one item.'; end if;
  if not public.current_user_has_permission('product_analytics.upload') then raise exception using errcode = '42501', message = 'Missing permission to upload product reports.'; end if;
  if v_operation = 'replace' and not public.current_user_has_permission('product_analytics.manage') then raise exception using errcode = '42501', message = 'Missing permission to replace product reports.'; end if;
  if not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode = '42501', message = 'You cannot upload product reports for this outlet.'; end if;

  perform pg_advisory_xact_lock(hashtext('product_analytics_request_' || p_request_id::text));
  select result into v_result from public.product_analytics_lifecycle_requests where request_id = p_request_id;
  if found then
    if exists (
      select 1 from public.product_analytics_lifecycle_requests
      where request_id = p_request_id and operation = v_operation and actor_id = v_actor and outlet_id = v_outlet_id
        and report_month = v_month and report_year = v_year and payload_fingerprint = v_fingerprint
    ) then return v_result; end if;
    raise exception 'Request ID was already used for a different product report action.';
  end if;

  perform pg_advisory_xact_lock(hashtext('product_analytics_period_' || v_outlet_id::text || ':' || v_year::text || ':' || v_month::text));
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(
      category_name text, product_name text, variant_name text, quantity numeric, gross_sales numeric,
      discount numeric, sst numeric, service_charge numeric, nett_sales numeric
    )
    where nullif(btrim(item.category_name),'') is null or nullif(btrim(item.product_name),'') is null
  ) then raise exception 'Every product report item requires a category and product name.'; end if;

  select * into v_existing from public.product_sales_reports
  where outlet_id = v_outlet_id and report_month = v_month and report_year = v_year for update;
  if v_operation = 'new' and found then raise exception using errcode = '23505', message = 'A product report already exists for this outlet and period.'; end if;
  if v_operation = 'replace' and not found then raise exception 'There is no product report to replace for this outlet and period.'; end if;

  select
    coalesce(sum(coalesce(item.quantity,0)),0),
    coalesce(sum(coalesce(item.nett_sales,0)),0),
    coalesce(sum(coalesce(item.discount,0)),0)
  into v_total_quantity, v_total_net_sales, v_total_discount
  from jsonb_to_recordset(p_items) as item(
    category_name text, product_name text, variant_name text, quantity numeric, gross_sales numeric,
    discount numeric, sst numeric, service_charge numeric, nett_sales numeric
  );

  if v_operation = 'replace' then delete from public.product_sales_reports where id = v_existing.id; end if;

  insert into public.product_sales_reports(
    outlet_id, report_month, report_year, file_name, uploaded_by, uploaded_at, status,
    total_net_sales, total_quantity, total_discount, raw_metadata
  ) values (
    v_outlet_id, v_month, v_year, v_file_name, v_actor, v_now, 'completed',
    v_total_net_sales, v_total_quantity, v_total_discount, v_metadata
  ) returning * into v_report;

  insert into public.product_sales_items(
    report_id, outlet_id, category_name, product_name, variant_name, quantity, gross_sales,
    discount, sst, service_charge, nett_sales, created_at
  )
  select v_report.id, v_outlet_id, item.category_name, item.product_name, nullif(btrim(item.variant_name),''),
    coalesce(item.quantity,0), coalesce(item.gross_sales,0), coalesce(item.discount,0),
    coalesce(item.sst,0), coalesce(item.service_charge,0), coalesce(item.nett_sales,0), v_now
  from jsonb_to_recordset(p_items) as item(
    category_name text, product_name text, variant_name text, quantity numeric, gross_sales numeric,
    discount numeric, sst numeric, service_charge numeric, nett_sales numeric
  );

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'operation', v_operation,
    'report', jsonb_build_object(
      'id', v_report.id, 'outlet_id', v_report.outlet_id, 'report_month', v_report.report_month,
      'report_year', v_report.report_year, 'file_name', v_report.file_name, 'uploaded_by', v_report.uploaded_by,
      'uploaded_at', v_report.uploaded_at, 'status', v_report.status, 'total_net_sales', v_report.total_net_sales,
      'total_quantity', v_report.total_quantity, 'total_discount', v_report.total_discount, 'raw_metadata', v_report.raw_metadata
    )
  );
  insert into public.product_analytics_lifecycle_requests(
    request_id, operation, actor_id, outlet_id, report_month, report_year, payload_fingerprint, result
  ) values (p_request_id, v_operation, v_actor, v_outlet_id, v_month, v_year, v_fingerprint, v_result);
  return v_result;
end; $$;

revoke all on function public.product_analytics_save_report(uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.product_analytics_save_report(uuid,text,jsonb,jsonb) to authenticated;
