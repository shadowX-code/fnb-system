-- Restore the SOP/QC snapshot work inadvertently omitted when the trusted
-- Start Production RPC was hardened in 050031. This remains stock-neutral.
create or replace function public.factory_start_job_order(
  p_job_order_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_production_date date,
  p_start_time time,
  p_remarks text,
  p_started_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_product_family_id uuid;
  v_sop public.factory_production_sops%rowtype;
  v_step public.factory_production_sop_steps%rowtype;
  v_step_execution_id uuid;
  v_actor_id uuid;
  v_actor_name text;
begin
  v_actor_id := public.factory_current_active_employee_id();
  v_actor_name := public.factory_current_active_employee_name();

  if not public.current_user_has_permission('factory_production.complete') then
    raise exception using errcode = '42501', message = 'Missing permission to start Production.';
  end if;

  select job_order.* into v_job_order
  from public.factory_job_orders job_order
  where job_order.id = p_job_order_id
  for update;

  if v_job_order.id is null then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'released' then
    raise exception 'Only Released Job Orders can start Production.';
  end if;

  select finished_good.product_family_id into v_product_family_id
  from public.factory_finished_goods finished_good
  where finished_good.id = v_job_order.finished_good_id;

  if v_product_family_id is not null then
    select sop.* into v_sop
    from public.factory_production_sops sop
    where sop.finished_good_id = v_product_family_id
      and lower(coalesce(sop.status, '')) = 'active'
    order by sop.updated_at desc, sop.id desc
    limit 1;
  end if;

  update public.factory_job_orders job_order
  set status = 'in_progress',
      started_at = now(),
      started_by = v_actor_id,
      production_operator_id = v_actor_id,
      production_operator_name = v_actor_name,
      production_date = coalesce(p_production_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
      start_time = p_start_time,
      production_sop_id = v_sop.id,
      sop_version = v_sop.version,
      qc_snapshot_created_at = now(),
      remarks = case
        when coalesce(btrim(p_remarks), '') = '' then job_order.remarks
        when coalesce(btrim(job_order.remarks), '') = '' then btrim(p_remarks)
        else job_order.remarks || E'\n' || btrim(p_remarks)
      end,
      updated_at = now()
  where job_order.id = p_job_order_id;

  delete from public.factory_production_step_executions execution
  where execution.job_order_id = p_job_order_id;

  if v_sop.id is null then return; end if;

  for v_step in
    select step.* from public.factory_production_sop_steps step
    where step.sop_id = v_sop.id
    order by step.step_no, step.id
  loop
    insert into public.factory_production_step_executions (
      job_order_id, production_sop_id, sop_step_id, step_no, step_name,
      description, sub_steps, status, updated_at
    ) values (
      p_job_order_id, v_sop.id, v_step.id, v_step.step_no,
      coalesce(nullif(v_step.process_name, ''), nullif(v_step.instruction, ''), 'Step ' || v_step.step_no),
      coalesce(v_step.description, v_step.instruction),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sequence_no', sub_step.sequence_no,
          'instruction', sub_step.instruction,
          'estimated_minutes', sub_step.estimated_minutes,
          'remarks', sub_step.remarks
        ) order by sub_step.sequence_no, sub_step.id)
        from public.factory_production_sop_sub_steps sub_step
        where sub_step.sop_step_id = v_step.id
      ), '[]'::jsonb),
      'pending', now()
    ) returning id into v_step_execution_id;

    insert into public.factory_production_qc_results (
      job_order_id, production_step_execution_id, sop_qc_check_id,
      sequence_no, qc_type, qc_name, instructions, is_required, updated_at
    )
    select p_job_order_id, v_step_execution_id, qc_check.id,
      qc_check.sequence_no, qc_check.qc_type, qc_check.qc_name,
      qc_check.instructions, qc_check.is_required, now()
    from public.factory_production_sop_step_qc_checks qc_check
    where qc_check.sop_step_id = v_step.id
    order by qc_check.sequence_no, qc_check.id;

    if v_step.is_qc_checkpoint = true and not exists (
      select 1
      from public.factory_production_qc_results result
      where result.production_step_execution_id = v_step_execution_id
    ) then
      insert into public.factory_production_qc_results (
        job_order_id, production_step_execution_id, sequence_no, qc_type,
        qc_name, instructions, is_required, updated_at
      ) values (
        p_job_order_id, v_step_execution_id, 1, 'checklist',
        coalesce(nullif(v_step.qc_label, ''), nullif(v_step.control_point, ''), 'QC Check'),
        nullif(v_step.qc_target_value, ''), true, now()
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.factory_start_job_order(uuid, uuid, text, date, time without time zone, text, uuid)
from public, anon;
grant execute on function public.factory_start_job_order(uuid, uuid, text, date, time without time zone, text, uuid)
to authenticated;
