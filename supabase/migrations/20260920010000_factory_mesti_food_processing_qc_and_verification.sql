-- Food Processing Control must distinguish an SOP with no QC points from
-- missing evidence for a Production whose pinned SOP did require QC.

create or replace function public.factory_mesti_food_processing_control(
  p_date_from date default null,
  p_date_to date default null,
  p_finished_good_id uuid default null,
  p_qc_status text default null,
  p_verification_status text default null,
  p_search text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(record) order by record.operational_completion_at desc, record.id desc), '[]'::jsonb)
  from (
    select
      production.id,
      production.job_order_id,
      production.finished_good_id,
      job.job_order_no,
      production.production_no,
      production.batch_no,
      production.end_date as production_date,
      coalesce(production.production_date, production.manufacturing_date) as start_date,
      production.end_date as completion_date,
      production.end_time as completion_time,
      public.factory_production_operational_completion_at(production.end_date, production.end_time) as operational_completion_at,
      coalesce(finished_good.product_name_en, finished_good.product_name, production.product_name) as product_name,
      finished_good.product_code,
      finished_good.variant_name,
      finished_good.packaging_type,
      production.start_time,
      production.completed_at,
      production.good_output_qty,
      production.actual_output_qty,
      production.uom,
      production.expiry_date,
      production.notes,
      production.qc_status,
      production.verification_status,
      production.verified_at,
      coalesce(completer.nickname, completer.full_name, '') as completed_by_name,
      coalesce(verifier.nickname, verifier.full_name, '') as verified_by_name,
      coalesce(requirement.qc_required_count, 0) as qc_required_count,
      coalesce(evidence.qc_evidence_count, 0) as qc_evidence_count,
      case
        when coalesce(requirement.qc_required_count, 0) = 0 then 'no_qc_required'
        when coalesce(evidence.qc_evidence_count, 0) < requirement.qc_required_count then 'evidence_unavailable'
        else 'evidence_available'
      end as qc_requirement_status,
      case
        when coalesce(requirement.qc_required_count, 0) = 0 then 'No QC Required'
        when coalesce(evidence.qc_evidence_count, 0) < requirement.qc_required_count then 'Evidence unavailable'
        when evidence.failed_count > 0 then 'Failed · ' || evidence.failed_count || '/' || evidence.qc_evidence_count
        when evidence.completed_count = evidence.qc_evidence_count then 'Passed · ' || evidence.qc_evidence_count || '/' || evidence.qc_evidence_count
        else 'Complete · ' || evidence.completed_count || '/' || evidence.qc_evidence_count
      end as qc_summary
    from public.factory_productions production
    left join public.factory_finished_goods finished_good on finished_good.id = production.finished_good_id
    left join public.factory_job_orders job on job.id = production.job_order_id
    left join public.employees completer on completer.id = production.created_by
    left join public.employees verifier on verifier.id = production.verified_by
    left join lateral (
      select count(*)::integer as qc_required_count
      from (
        select qc.id::text as qc_point
        from public.factory_production_sop_steps step
        join public.factory_production_sop_step_qc_checks qc on qc.sop_step_id = step.id
        where step.sop_id = production.production_sop_id
        union all
        select 'legacy:' || step.id::text
        from public.factory_production_sop_steps step
        where step.sop_id = production.production_sop_id
          and (
            coalesce(step.is_qc_checkpoint, false)
            or coalesce(step.qc_required_before_completion, false)
            or step.qc_measurement_type is not null
          )
          and not exists (
            select 1
            from public.factory_production_sop_step_qc_checks qc
            where qc.sop_step_id = step.id
          )
      ) required_point
    ) requirement on true
    left join lateral (
      select
        count(*)::integer as qc_evidence_count,
        count(*) filter (
          where (qc_result.qc_type = 'checklist' and qc_result.checklist_result is not null)
             or (qc_result.qc_type = 'remarks' and nullif(btrim(coalesce(qc_result.remarks, '')), '') is not null)
        )::integer as completed_count,
        count(*) filter (
          where qc_result.qc_type = 'checklist' and qc_result.checklist_result = 'fail'
        )::integer as failed_count
      from public.factory_production_qc_results qc_result
      where qc_result.production_id = production.id
         or (qc_result.production_id is null and qc_result.job_order_id = production.job_order_id)
    ) evidence on true
    where auth.uid() is not null
      and public.current_user_has_permission('factory_production.view')
      and production.status = 'completed'
      and (p_date_from is null or production.end_date >= p_date_from)
      and (p_date_to is null or production.end_date <= p_date_to)
      and (p_finished_good_id is null or production.finished_good_id = p_finished_good_id)
      and (p_qc_status is null or production.qc_status = p_qc_status)
      and (p_verification_status is null or production.verification_status = p_verification_status)
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', production.production_no, production.batch_no, production.product_name, finished_good.product_name_en, finished_good.product_code, job.job_order_no)
          ilike '%' || btrim(p_search) || '%'
      )
  ) record;
$$;

revoke all on function public.factory_mesti_food_processing_control(date, date, uuid, text, text, text) from public, anon;
grant execute on function public.factory_mesti_food_processing_control(date, date, uuid, text, text, text) to authenticated;

-- Role Settings is the sole verification authority. The completed Production
-- evidence is updated in place; no Production or QC evidence is duplicated.
create or replace function public.factory_verify_production_record(p_production_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.factory_current_active_employee_id();
  v_production public.factory_productions%rowtype;
begin
  if not public.current_user_has_permission('factory_production.verify') then
    raise exception using errcode = '42501', message = 'Missing permission to verify Production Record.';
  end if;

  select production.* into v_production
  from public.factory_productions production
  where production.id = p_production_id
  for update;

  if v_production.id is null then
    raise exception using errcode = 'P0002', message = 'Production Record was not found.';
  end if;
  if v_production.verification_status = 'verified' then
    return to_jsonb(v_production);
  end if;
  if v_production.status <> 'completed' or v_production.verification_status <> 'awaiting_verification' then
    raise exception using errcode = '55000', message = 'Only completed Production awaiting verification can be verified.';
  end if;

  update public.factory_productions
  set verification_status = 'verified',
      verified_by = v_actor_id,
      verified_at = now(),
      updated_at = now()
  where id = v_production.id
  returning * into v_production;

  return to_jsonb(v_production);
end;
$$;

revoke all on function public.factory_verify_production_record(uuid) from public, anon;
grant execute on function public.factory_verify_production_record(uuid) to authenticated;
