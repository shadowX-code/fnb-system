-- Management-facing, read-only Factory Audit Trail projection.

create or replace function public.factory_audit_try_uuid(p_value text)
returns uuid
language sql
immutable
strict
set search_path = public
as $$
  select case
    when btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then btrim(p_value)::uuid
    else null
  end;
$$;

create or replace function public.factory_audit_try_date(p_value text)
returns date
language sql
immutable
strict
set search_path = public
as $$
  select case
    when btrim(p_value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then btrim(p_value)::date
    else null
  end;
$$;

create or replace function public.factory_audit_event_label(p_action text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_action, '')) like '%qc%passed%' then 'QC Passed'
    when lower(coalesce(p_action, '')) like '%qc%failed%' then 'QC Failed'
    when lower(coalesce(p_action, '')) like '%released%' then 'Released'
    when lower(coalesce(p_action, '')) like '%started%' then 'Started'
    when lower(coalesce(p_action, '')) like '%completed%' then 'Completed'
    when lower(coalesce(p_action, '')) like '%submitted%' then 'Submitted'
    when lower(coalesce(p_action, '')) like '%approved%' then 'Approved'
    when lower(coalesce(p_action, '')) like '%archived%' then 'Archived'
    when lower(coalesce(p_action, '')) like '%deleted%' then 'Deleted'
    when lower(coalesce(p_action, '')) like '%cancelled%' then 'Cancelled'
    when lower(coalesce(p_action, '')) like '%restored%' then 'Restored'
    when lower(coalesce(p_action, '')) like '%activated%' then 'Activated'
    when lower(coalesce(p_action, '')) like '%updated%' then 'Updated'
    when lower(coalesce(p_action, '')) like '%saved%' then 'Saved'
    when lower(coalesce(p_action, '')) like '%received%' then 'Completed'
    when lower(coalesce(p_action, '')) like '%created%' then 'Created'
    else 'Updated'
  end;
$$;

create or replace function public.factory_audit_module_label(p_action text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_action, '')) like '%raw_receiving%' then 'Receiving'
    when lower(coalesce(p_action, '')) like '%stock_check%' then 'Stock Check'
    when lower(coalesce(p_action, '')) like '%finished_good_dispatch%' then 'Dispatch'
    when lower(coalesce(p_action, '')) like '%job_order%' then 'Job Order'
    when lower(coalesce(p_action, '')) like '%qc%' then 'QC'
    when lower(coalesce(p_action, '')) like '%production_sop%' then 'Production'
    when lower(coalesce(p_action, '')) like '%production%' then 'Production'
    when lower(coalesce(p_action, '')) like '%product_recipe%' then 'Finished Goods'
    when lower(coalesce(p_action, '')) like '%raw_material%' then 'Raw Material'
    when lower(coalesce(p_action, '')) like '%supplier%' then 'Raw Material'
    when lower(coalesce(p_action, '')) like '%storage_location%' then 'Raw Material'
    when lower(coalesce(p_action, '')) like '%finished_good%' then 'Finished Goods'
    when lower(coalesce(p_action, '')) like '%product_group%' then 'Finished Goods'
    when lower(coalesce(p_action, '')) like '%customer%' then 'Dispatch'
    else 'Production'
  end;
$$;

create or replace function public.factory_audit_trail_rows()
returns table (
  id uuid,
  action text,
  module text,
  event_label text,
  module_label text,
  user_id uuid,
  actor_name text,
  actor_email text,
  actor_kind text,
  description text,
  business_reference text,
  reference_type text,
  reference_id uuid,
  result text,
  attention_required boolean,
  metadata jsonb,
  before_values jsonb,
  after_values jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with audit_source as (
    select
      log.*,
      public.factory_audit_try_uuid(log.metadata ->> 'job_order_id') as metadata_job_order_id,
      public.factory_audit_try_uuid(log.metadata ->> 'production_id') as metadata_production_id,
      public.factory_audit_try_uuid(log.metadata #>> '{after,id}') as after_id,
      public.factory_audit_try_uuid(log.metadata #>> '{before,id}') as before_id,
      lower(coalesce(log.action, '')) as action_token,
      nullif(btrim(log.metadata ->> 'target'), '') as metadata_target
    from public.audit_logs log
    where log.module = 'factory'
  ),
  resolved_ids as (
    select
      source.*,
      coalesce(
        source.metadata_job_order_id,
        public.factory_audit_try_uuid(source.metadata #>> '{after,job_order_id}'),
        public.factory_audit_try_uuid(source.metadata #>> '{before,job_order_id}'),
        case when source.action_token like '%job_order%' then coalesce(source.after_id, source.before_id) end
      ) as job_order_id,
      coalesce(
        source.metadata_production_id,
        public.factory_audit_try_uuid(source.metadata #>> '{after,production_id}'),
        public.factory_audit_try_uuid(source.metadata #>> '{before,production_id}'),
        case
          when source.action_token like 'factory_production_%'
           and source.action_token not like '%production_sop%'
           and source.action_token not like '%production_qc%'
          then coalesce(source.after_id, source.before_id)
        end
      ) as production_id,
      case when source.action_token like '%raw_receiving%' then coalesce(source.after_id, source.before_id) end as receiving_id,
      case when source.action_token like '%finished_good_dispatch%' then coalesce(source.after_id, source.before_id) end as dispatch_id,
      case when source.action_token like '%product_stock_check%' then coalesce(source.after_id, source.before_id) end as product_stock_check_id,
      case when source.action_token like '%raw_stock_check%' then coalesce(source.after_id, source.before_id) end as raw_stock_check_id
    from audit_source source
  ),
  enriched as (
    select
      source.*,
      production.batch_no as production_batch_no,
      coalesce(job.job_order_no, production_job.job_order_no) as job_order_no,
      receiving.batch_no as receiving_no,
      dispatch.dispatch_no,
      product_check.check_no as product_check_no,
      raw_check.check_no as raw_check_no,
      actor.nickname as actor_nickname,
      actor.full_name as actor_full_name,
      actor.email as employee_email
    from resolved_ids source
    left join public.factory_productions production on production.id = source.production_id
    left join public.factory_job_orders job on job.id = source.job_order_id
    left join public.factory_job_orders production_job on production_job.id = production.job_order_id
    left join public.factory_raw_material_receiving_batches receiving on receiving.id = source.receiving_id
    left join public.factory_finished_good_dispatches dispatch on dispatch.id = source.dispatch_id
    left join public.factory_product_stock_checks product_check on product_check.id = source.product_stock_check_id
    left join public.factory_raw_material_stock_checks raw_check on raw_check.id = source.raw_stock_check_id
    left join lateral (
      select employee.nickname, employee.full_name, employee.email
      from public.employees employee
      where employee.auth_user_id = source.user_id or employee.id = source.user_id
      order by case when employee.auth_user_id = source.user_id then 0 else 1 end, employee.id
      limit 1
    ) actor on true
  ),
  projected as (
    select
      source.*,
      public.factory_audit_event_label(source.action) as resolved_event_label,
      public.factory_audit_module_label(source.action) as resolved_module_label,
      case
        when source.production_batch_no is not null then source.production_batch_no
        when source.job_order_no is not null then source.job_order_no
        when source.receiving_no is not null then source.receiving_no
        when source.dispatch_no is not null then source.dispatch_no
        when source.product_check_no is not null then source.product_check_no
        when source.raw_check_no is not null then source.raw_check_no
        when source.metadata_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then null
        when source.metadata_target ~* '^PRD-' then null
        when source.metadata_target ~* '^(FGRCP|SOP)-' then null
        else source.metadata_target
      end as resolved_reference,
      case
        when source.production_id is not null then 'production'
        when source.job_order_id is not null then 'job_order'
        when source.receiving_id is not null then 'receiving'
        when source.dispatch_id is not null then 'dispatch'
        when source.product_stock_check_id is not null then 'product_stock_check'
        when source.raw_stock_check_id is not null then 'raw_stock_check'
        else null
      end as resolved_reference_type,
      coalesce(
        source.production_id,
        source.job_order_id,
        source.receiving_id,
        source.dispatch_id,
        source.product_stock_check_id,
        source.raw_stock_check_id
      ) as resolved_reference_id,
      case
        when lower(coalesce(source.metadata ->> 'status', '')) in ('failed', 'failure', 'error')
          or source.action_token ~ '(failed|failure|error)'
          then 'Failed'
        when lower(coalesce(source.metadata ->> 'status', '')) in ('attention', 'warning', 'permission_denied', 'reconciliation_required', 'inventory_exception', 'override')
          or concat_ws(' ', source.action, source.description, source.metadata ->> 'status') ~* '(permission denied|reconciliation required|inventory exception|override)'
          then 'Attention'
        else 'Success'
      end as resolved_result
    from enriched source
  )
  select
    source.id,
    source.action,
    source.module,
    source.resolved_event_label,
    source.resolved_module_label,
    source.user_id,
    case
      when source.user_id is null or lower(coalesce(source.user_name, '')) = 'system' then 'System'
      else coalesce(
        nullif(btrim(source.actor_nickname), ''),
        nullif(btrim(source.actor_full_name), ''),
        case
          when coalesce(source.user_name, '') !~* '^[^@[:space:]]+@[^@[:space:]]+$'
           and public.factory_audit_try_uuid(source.user_name) is null
          then nullif(btrim(source.user_name), '')
        end,
        '—'
      )
    end as actor_name,
    case
      when source.user_id is null or lower(coalesce(source.user_name, '')) = 'system' then null
      else coalesce(
        nullif(btrim(source.employee_email), ''),
        case when coalesce(source.user_name, '') ~* '^[^@[:space:]]+@[^@[:space:]]+$' then btrim(source.user_name) end
      )
    end as actor_email,
    case when source.user_id is null or lower(coalesce(source.user_name, '')) = 'system' then 'system' else 'user' end as actor_kind,
    source.description,
    coalesce(source.resolved_reference, '—'),
    source.resolved_reference_type,
    source.resolved_reference_id,
    source.resolved_result,
    source.resolved_result in ('Failed', 'Attention'),
    coalesce(source.metadata, '{}'::jsonb),
    source.metadata -> 'before',
    source.metadata -> 'after',
    source.created_at
  from projected source;
$$;

create or replace function public.factory_list_audit_trail(
  p_date_from date default null,
  p_date_to date default null,
  p_module_label text default null,
  p_event_label text default null,
  p_user_name text default null,
  p_search text default null
)
returns table (
  id uuid,
  action text,
  module text,
  event_label text,
  module_label text,
  user_id uuid,
  actor_name text,
  actor_email text,
  actor_kind text,
  description text,
  business_reference text,
  reference_type text,
  reference_id uuid,
  result text,
  attention_required boolean,
  metadata jsonb,
  before_values jsonb,
  after_values jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select trail.*
  from public.factory_audit_trail_rows() trail
  where (p_date_from is null or timezone('Asia/Kuala_Lumpur', trail.created_at)::date >= p_date_from)
    and (p_date_to is null or timezone('Asia/Kuala_Lumpur', trail.created_at)::date <= p_date_to)
    and (nullif(btrim(p_module_label), '') is null or trail.module_label = btrim(p_module_label))
    and (nullif(btrim(p_event_label), '') is null or trail.event_label = btrim(p_event_label))
    and (nullif(btrim(p_user_name), '') is null or trail.actor_name = btrim(p_user_name))
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(
        ' ',
        trail.business_reference,
        trail.event_label,
        trail.module_label,
        trail.actor_name,
        trail.actor_email,
        trail.description
      ) ilike '%' || btrim(p_search) || '%'
    )
  order by trail.created_at desc, trail.id desc;
$$;

create or replace function public.factory_audit_trail_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select trail.*
    from public.factory_list_audit_trail(
      public.factory_audit_try_date(p_filters ->> 'dateFrom'),
      public.factory_audit_try_date(p_filters ->> 'dateTo'),
      nullif(btrim(p_filters ->> 'module'), ''),
      nullif(btrim(p_filters ->> 'action'), ''),
      nullif(btrim(p_filters ->> 'user'), ''),
      nullif(btrim(p_filters ->> 'search'), '')
    ) trail
  )
  select jsonb_build_object(
    'events', count(*),
    'today', count(*) filter (
      where timezone('Asia/Kuala_Lumpur', created_at)::date = timezone('Asia/Kuala_Lumpur', now())::date
    ),
    'users', count(distinct actor_name) filter (where actor_kind = 'user' and actor_name <> '—'),
    'attention_required', count(*) filter (where attention_required),
    'module_values', coalesce((select jsonb_agg(value order by value) from (select distinct module_label as value from filtered) modules), '[]'::jsonb),
    'event_values', coalesce((select jsonb_agg(value order by value) from (select distinct event_label as value from filtered) events), '[]'::jsonb),
    'user_values', coalesce((select jsonb_agg(value order by value) from (select distinct actor_name as value from filtered where actor_name <> '—') users), '[]'::jsonb)
  )
  from filtered;
$$;

revoke all on function public.factory_audit_try_uuid(text) from public, anon;
revoke all on function public.factory_audit_try_date(text) from public, anon;
revoke all on function public.factory_audit_event_label(text) from public, anon;
revoke all on function public.factory_audit_module_label(text) from public, anon;
revoke all on function public.factory_audit_trail_rows() from public, anon;
revoke all on function public.factory_list_audit_trail(date, date, text, text, text, text) from public, anon;
revoke all on function public.factory_audit_trail_summary(jsonb) from public, anon;

grant execute on function public.factory_audit_try_uuid(text) to authenticated;
grant execute on function public.factory_audit_try_date(text) to authenticated;
grant execute on function public.factory_audit_event_label(text) to authenticated;
grant execute on function public.factory_audit_module_label(text) to authenticated;
grant execute on function public.factory_audit_trail_rows() to authenticated;
grant execute on function public.factory_list_audit_trail(date, date, text, text, text, text) to authenticated;
grant execute on function public.factory_audit_trail_summary(jsonb) to authenticated;
