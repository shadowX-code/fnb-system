-- Dedicated, filtered Job Order record listing. Production Overview continues
-- to use the operational snapshot RPC; this function is read-only history and
-- management data with the completed Production snapshot resolved before paging.

-- Summary-only boundary for Job Order viewers. It exposes no QC result rows and
-- retains the existing Factory Job Order permission contract.
create or replace function public.factory_get_job_order_qc_listing_status(
  p_job_order_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job_status text;
  v_snapshot_created_at timestamptz;
  v_completed_qc_status text;
  v_total integer;
  v_entered integer;
  v_failed integer;
  v_required_incomplete integer;
begin
  if not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Job Orders.';
  end if;

  select lower(coalesce(job.status, '')), job.qc_snapshot_created_at
  into v_job_status, v_snapshot_created_at
  from public.factory_job_orders job
  where job.id = p_job_order_id;

  if not found then return 'Metadata Unavailable'; end if;
  if v_job_status not in ('in_progress', 'completed') then return 'No Production'; end if;

  if v_job_status = 'completed' then
    select production.qc_status
    into v_completed_qc_status
    from public.factory_productions production
    where production.job_order_id = p_job_order_id
      and lower(coalesce(production.status, '')) = 'completed'
    order by production.completed_at desc nulls last,
      production.created_at desc,
      production.id desc
    limit 1;

    if not found then return 'Metadata Unavailable'; end if;
    case lower(btrim(coalesce(v_completed_qc_status, '')))
      when 'pass' then return 'Passed';
      when 'passed' then return 'Passed';
      when 'fail' then return 'Failed';
      when 'failed' then return 'Failed';
      when 'pending' then return 'In Progress';
      when 'in progress' then return 'In Progress';
      when 'in_progress' then return 'In Progress';
      when 'not started' then return 'Not Started';
      when 'not_started' then return 'Not Started';
      when 'no qc' then return 'No QC Required';
      when 'no qc required' then return 'No QC Required';
      when 'not required' then return 'No QC Required';
      else return 'Metadata Unavailable';
    end case;
  end if;

  if v_snapshot_created_at is null then return 'Metadata Unavailable'; end if;

  select
    count(*),
    count(*) filter (where
      (result.qc_type = 'checklist' and result.checklist_result is not null)
      or (result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is not null)
    ),
    count(*) filter (where result.qc_type = 'checklist' and lower(coalesce(result.checklist_result, '')) = 'fail'),
    count(*) filter (where result.is_required and (
      (result.qc_type = 'checklist' and (
        result.checklist_result is null
        or (lower(coalesce(result.checklist_result, '')) = 'na' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
      ))
      or (result.qc_type = 'remarks' and nullif(btrim(coalesce(result.remarks, '')), '') is null)
    ))
  into v_total, v_entered, v_failed, v_required_incomplete
  from public.factory_production_qc_results result
  where result.job_order_id = p_job_order_id;

  if v_total = 0 then return 'No QC Required'; end if;
  if v_entered = 0 then return 'Not Started'; end if;
  if v_failed > 0 then return 'Failed'; end if;
  if v_required_incomplete > 0 then return 'In Progress'; end if;
  return 'Passed';
end;
$$;

revoke all on function public.factory_get_job_order_qc_listing_status(uuid) from public, anon;
grant execute on function public.factory_get_job_order_qc_listing_status(uuid) to authenticated;

create or replace function public.factory_list_job_order_records(
  p_search text default null,
  p_status text default null,
  p_scheduled_date_from date default null,
  p_scheduled_date_to date default null,
  p_manufacturing_date_from date default null,
  p_manufacturing_date_to date default null,
  p_finished_good_id uuid default null,
  p_product_family_id uuid default null
)
returns table (
  id uuid,
  job_order_no text,
  finished_good_id uuid,
  product_name text,
  target_pack_qty numeric,
  target_production_qty numeric,
  target_quantity numeric,
  produced_quantity numeric,
  uom text,
  planned_date date,
  due_date date,
  priority text,
  status text,
  assigned_team text,
  remarks text,
  created_by uuid,
  released_at timestamptz,
  released_by uuid,
  started_at timestamptz,
  started_by uuid,
  production_operator_id uuid,
  production_operator_name text,
  production_date date,
  start_time time,
  production_sop_id uuid,
  sop_version text,
  qc_snapshot_created_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  product_code text,
  product_name_en text,
  product_name_cn text,
  product_name_bm text,
  finished_good_status text,
  product_family_id uuid,
  product_family_name text,
  variant_name text,
  packaging_type text,
  pack_size_qty numeric,
  pack_size_uom text,
  base_qty numeric,
  base_uom text,
  finished_good_uom text,
  manufacturing_date date,
  completed_production_id uuid,
  completed_production_status text,
  production_qc_status text,
  batch_no text,
  created_by_name text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Job Orders.';
  end if;

  return query
  select
    job.id,
    job.job_order_no,
    job.finished_good_id,
    job.product_name,
    job.target_pack_qty,
    job.target_production_qty,
    job.target_quantity,
    job.produced_quantity,
    job.uom,
    job.planned_date,
    job.due_date,
    job.priority,
    job.status,
    job.assigned_team,
    job.remarks,
    job.created_by,
    job.released_at,
    job.released_by,
    job.started_at,
    job.started_by,
    job.production_operator_id,
    job.production_operator_name,
    job.production_date,
    job.start_time,
    job.production_sop_id,
    job.sop_version,
    job.qc_snapshot_created_at,
    job.completed_at,
    job.completed_by,
    job.created_at,
    job.updated_at,
    finished_good.product_code,
    coalesce(finished_good.product_name_en, finished_good.product_name),
    finished_good.product_name_cn,
    finished_good.product_name_bm,
    finished_good.status,
    finished_good.product_family_id,
    product_family.name_en,
    finished_good.variant_name,
    finished_good.packaging_type,
    finished_good.pack_size_qty,
    finished_good.pack_size_uom,
    finished_good.base_qty,
    finished_good.base_uom,
    finished_good.uom,
    completed_production.manufacturing_date,
    completed_production.id,
    completed_production.status,
    public.factory_get_job_order_qc_listing_status(job.id),
    completed_production.batch_no,
    coalesce(creator.nickname, creator.full_name, job.created_by::text)
  from public.factory_job_orders job
  left join public.factory_finished_goods finished_good on finished_good.id = job.finished_good_id
  left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
  left join public.employees creator on creator.id = job.created_by
  left join lateral (
    select production.id, production.manufacturing_date, production.status,
      production.qc_status, production.batch_no, production.completed_at,
      production.created_at
    from public.factory_productions production
    where production.job_order_id = job.id
      and lower(coalesce(production.status, '')) = 'completed'
    order by production.completed_at desc nulls last,
      production.created_at desc,
      production.id desc
    limit 1
  ) completed_production on lower(coalesce(job.status, '')) = 'completed'
  where (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ',
        job.job_order_no,
        product_family.name_en,
        finished_good.product_name,
        finished_good.product_name_en,
        finished_good.product_name_cn,
        finished_good.product_name_bm,
        finished_good.product_code,
        finished_good.variant_name,
        completed_production.batch_no
      ) ilike '%' || btrim(p_search) || '%'
    )
    and (nullif(lower(btrim(p_status)), '') is null or lower(coalesce(job.status, '')) = lower(btrim(p_status)))
    and (p_scheduled_date_from is null or job.planned_date >= p_scheduled_date_from)
    and (p_scheduled_date_to is null or job.planned_date <= p_scheduled_date_to)
    and (p_manufacturing_date_from is null or completed_production.manufacturing_date >= p_manufacturing_date_from)
    and (p_manufacturing_date_to is null or completed_production.manufacturing_date <= p_manufacturing_date_to)
    and (p_finished_good_id is null or job.finished_good_id = p_finished_good_id)
    and (p_product_family_id is null or finished_good.product_family_id = p_product_family_id)
  order by job.planned_date desc nulls last, job.created_at desc, job.id desc;
end;
$$;

revoke all on function public.factory_list_job_order_records(text, text, date, date, date, date, uuid, uuid) from public;
grant execute on function public.factory_list_job_order_records(text, text, date, date, date, date, uuid, uuid) to authenticated;
