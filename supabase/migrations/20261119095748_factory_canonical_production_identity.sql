-- Existing reference text and batch values are retained as historical evidence.
-- Only fill a missing UUID when the original reference and linked evidence agree.
update public.factory_raw_material_movements m
set reference_id = p.id
from public.factory_productions p
where lower(m.reference_type) = 'production' and m.reference_id is null
  and m.reference_no = p.production_no and nullif(btrim(p.batch_no), '') is not null
  and (m.production_material_usage_id is null or exists (
    select 1 from public.factory_production_material_usage u
    where u.id = m.production_material_usage_id
      and u.production_id = p.id and u.raw_material_id = m.raw_material_id
  ));

update public.factory_product_stock_movements m
set reference_id = p.id
from public.factory_productions p
where lower(m.reference_type) = 'production' and m.reference_id is null
  and m.reference_no = p.production_no and nullif(btrim(p.batch_no), '') is not null
  and m.finished_good_id = p.finished_good_id
  and (m.finished_good_batch_balance_id is null or exists (
    select 1 from public.factory_finished_good_batch_balances b
    where b.id = m.finished_good_batch_balance_id and b.production_id = p.id
  ));

-- A candidate must match the original batch and SKU. Multiple candidates or
-- an already linked balance leave the relationship unresolved for review.
with candidates as (
  select b.id as balance_id, p.id as production_id,
         count(*) over (partition by p.id) as eligible_balances
  from public.factory_finished_good_batch_balances b
  join public.factory_productions p on p.finished_good_id = b.finished_good_id
    and p.batch_no = b.batch_no and nullif(btrim(p.batch_no), '') is not null
    and (p.id = b.source_reference_id or
         (b.source_reference_id is null and p.production_no = b.source_reference_no))
    and (b.source_reference_no is null or b.source_reference_no in (p.production_no, p.batch_no))
  where b.source_type = 'production' and b.production_id is null
    and not exists (select 1 from public.factory_finished_good_batch_balances x where x.production_id = p.id)
)
update public.factory_finished_good_batch_balances b
set production_id = c.production_id, source_reference_id = c.production_id
from candidates c
where b.id = c.balance_id and c.eligible_balances = 1;

update public.factory_finished_good_batch_balances b
set source_reference_id = p.id
from public.factory_productions p
where b.source_type = 'production' and b.source_reference_id is null
  and b.production_id = p.id and b.finished_good_id = p.finished_good_id
  and b.batch_no = p.batch_no
  and (b.source_reference_no is null or b.source_reference_no in (p.production_no, p.batch_no));

-- Patch the deployed function definitions in place to retain grants, guards and
-- all unrelated lifecycle/query logic. Abort on a missing expected clause.
do $migration$
declare
  edits record;
  clause record;
  definition text;
begin
  for edits in
    select target, jsonb_agg(jsonb_build_array(before_clause, after_clause) order by position) as clauses
    from (
      select target, before_clause, after_clause, position
      from (values
    (1, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$v_production_no text;$old$, $new$v_batch_no text;$new$),
    (2, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$  v_production_no := coalesce(nullif(btrim(p_payload->>'production_no'), ''), 'PRD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));
$old$, $new$$new$),
    (3, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$job_order_id, finished_good_id, production_no, product_name, batch_no,$old$, $new$job_order_id, finished_good_id, product_name,$new$),
    (4, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$    v_job.id, v_finished_good.id, v_production_no, v_finished_good.product_name,
    nullif(btrim(p_payload->>'batch_no'), ''), v_actual_pack_qty, v_expected_output_qty,$old$, $new$    v_job.id, v_finished_good.id, v_finished_good.product_name,
    v_actual_pack_qty, v_expected_output_qty,$new$),
    (5, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$) returning id into v_production_id;$old$, $new$) returning id, batch_no into v_production_id, v_batch_no;$new$),
    (6, 'feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)', $old$'production', v_production_id, v_production_no,$old$, $new$'production', v_production_id, v_batch_no,$new$),
    (7, 'public.factory_capture_completed_production_batch()', $old$new.id, new.production_no,$old$, $new$new.id, new.batch_no,$new$),
    (8, 'feedx_integrations.factory_get_production_monthly_performance_core(date,text)', $old$p.production_no, p.batch_no,$old$, $new$p.batch_no,$new$),
    (9, 'feedx_integrations.factory_get_production_monthly_performance_core(date,text)', $old$'production_id', id, 'production_no', production_no,$old$, $new$'production_id', id, 'batch_no', batch_no,$new$),
    (10, 'feedx_integrations.factory_get_production_monthly_performance_core(date,text)', $old$) || case when p_gateway_token is null then jsonb_build_object('batch_no', batch_no)
             else '{}'::jsonb end order by end_at, id)$old$, $new$) order by end_at, id)$new$),
    (11, 'feedx_integrations.factory_resource_rows(text,text,date,date)', $old$select r.id,r.production_no,r.batch_no$old$, $new$select r.id,r.batch_no$new$),
    (12, 'feedx_integrations.factory_resource_rows(text,text,date,date)', $old$r.production_no safe_label$old$, $new$coalesce(nullif(btrim(r.batch_no),''),'Batch number missing') safe_label$new$),
    (13, 'feedx_integrations.factory_resource_rows(text,text,date,date)', $old$when 'product_movements' then return query select to_jsonb(s)||jsonb_build_object('id',s.id::text,'label',s.safe_label,'module','Warehouse','business_date',s.business_date) - 'safe_label' from (select r.id,r.finished_good_id,r.movement_type,r.quantity,r.uom,r.movement_date,r.finished_good_batch_balance_id,r.internal_transfer_id,r.movement_type safe_label,r.movement_date business_date from public.factory_product_stock_movements r where (r.movement_date) between p_from and p_to limit 5001)s;$old$, $new$when 'product_movements' then return query select to_jsonb(s)||jsonb_build_object('id',s.id::text,'label',s.safe_label,'module','Warehouse','business_date',s.business_date) - 'safe_label' from (select r.id,r.finished_good_id,r.movement_type,r.quantity,r.uom,r.movement_date,r.finished_good_batch_balance_id,r.internal_transfer_id,p.id production_id,nullif(btrim(p.batch_no),'') production_batch_no,case when lower(coalesce(r.reference_type,''))='production' then coalesce(nullif(btrim(p.batch_no),''),'Batch number missing') else r.movement_type end safe_label,r.movement_date business_date from public.factory_product_stock_movements r left join public.factory_productions p on lower(coalesce(r.reference_type,''))='production' and p.id=r.reference_id where (r.movement_date) between p_from and p_to limit 5001)s;$new$),
    (14, 'feedx_integrations.factory_resource_rows(text,text,date,date)', $old$when 'raw_movements' then return query select to_jsonb(s)||jsonb_build_object('id',s.id::text,'label',s.safe_label,'module','Raw Materials','business_date',s.business_date) - 'safe_label' from (select r.id,r.raw_material_id,r.movement_type,r.quantity,r.uom,r.movement_date,r.production_material_usage_id,r.raw_material_batch_balance_id,r.internal_transfer_id,r.movement_type safe_label,r.movement_date business_date from public.factory_raw_material_movements r where (r.movement_date) between p_from and p_to limit 5001)s;$old$, $new$when 'raw_movements' then return query select to_jsonb(s)||jsonb_build_object('id',s.id::text,'label',s.safe_label,'module','Raw Materials','business_date',s.business_date) - 'safe_label' from (select r.id,r.raw_material_id,r.movement_type,r.quantity,r.uom,r.movement_date,r.production_material_usage_id,r.raw_material_batch_balance_id,r.internal_transfer_id,p.id production_id,nullif(btrim(p.batch_no),'') production_batch_no,case when lower(coalesce(r.reference_type,''))='production' then coalesce(nullif(btrim(p.batch_no),''),'Batch number missing') else r.movement_type end safe_label,r.movement_date business_date from public.factory_raw_material_movements r left join public.factory_productions p on lower(coalesce(r.reference_type,''))='production' and p.id=r.reference_id where (r.movement_date) between p_from and p_to limit 5001)s;$new$),
    (15, 'feedx_integrations.navigation_reference_context(text,text,text)', $old$jsonb_build_object('id',id,'label',production_no,'status',status)$old$, $new$jsonb_build_object('id',id,'label',coalesce(nullif(btrim(batch_no),''),'Batch number missing'),'status',status)$new$),
    (16, 'feedx_integrations.navigation_production_compliance(text,text,text,date,date)', $old$'production_no',$old$, $new$$new$),
    (17, 'feedx_integrations.mesti_rows(date,date)', $old$'production_id',id,'production_no',production_no,'batch_no',batch_no$old$, $new$'production_id',id,'batch_no',batch_no$new$),
    (18, 'feedx_integrations.mesti_rows(date,date)', $old$'production_id',id,'production_no',production_no,'batch_balance_count'$old$, $new$'production_id',id,'batch_no',batch_no,'batch_balance_count'$new$),
    (19, 'feedx_integrations.factory_mesti_finished_product_storage_control_core(date,date,uuid,uuid,uuid,text,text)', $old$select balance.id, production.id, job.id, job.job_order_no, production.production_no,$old$, $new$select balance.id, production.id, job.id, job.job_order_no, null::text,$new$),
    (20, 'feedx_integrations.factory_mesti_finished_product_storage_control_core(date,date,uuid,uuid,uuid,text,text)', $old$concat_ws(' ', job.job_order_no, production.production_no, balance.batch_no,$old$, $new$concat_ws(' ', job.job_order_no, production.batch_no,$new$),
    (21, 'feedx_integrations.factory_mesti_food_processing_control_core(date,date,uuid,text,text,text,text)', $old$      production.production_no,$old$, $new$      null::text,$new$),
    (22, 'feedx_integrations.factory_mesti_food_processing_control_core(date,date,uuid,text,text,text,text)', $old$concat_ws(' ', production.production_no, production.batch_no,$old$, $new$concat_ws(' ', production.batch_no,$new$),
    (23, 'public.factory_mesti_materialize_equipment_cleaning_after_production(uuid)', $old$'production_no', production.production_no, 'batch_no', production.batch_no,$old$, $new$'batch_no', production.batch_no,$new$),
    (24, 'public.factory_get_production_control_snapshot(date,boolean)', $old$        'production_no', production.production_no,
$old$, $new$$new$),
    (25, 'public.factory_listing_summary(text,jsonb)', $old$nullif(btrim(production_row.production_no), '') is null$old$, $new$nullif(btrim(production_row.batch_no), '') is null$new$),
    (26, 'public.factory_list_raw_material_movements_v1(uuid,date,date,uuid,text,text,text)', $old$when production.id is not null then coalesce(nullif(btrim(production.production_no), ''), nullif(btrim(job_order.job_order_no), ''))$old$, $new$when lower(coalesce(movement.reference_type, '')) = 'production' then coalesce(nullif(btrim(production.batch_no), ''), 'Batch number missing')$new$),
    (27, 'public.factory_list_raw_material_movements_v1(uuid,date,date,uuid,text,text,text)', $old$    left join lateral (
      select production_row.id, production_row.production_no, production_row.job_order_id
      from public.factory_productions production_row
      where lower(coalesce(movement.reference_type, '')) = 'production'
        and (
          (movement.reference_id is not null and production_row.id = movement.reference_id)
          or (
            movement.reference_id is null
            and production_row.production_no = movement.reference_no
            and 1 = (
              select count(*)
              from public.factory_productions fallback_production
              where fallback_production.production_no = movement.reference_no
            )
          )
        )
      limit 1
    ) production on true
$old$, $new$    left join public.factory_productions production
      on lower(coalesce(movement.reference_type, '')) = 'production' and production.id = movement.reference_id
$new$),
    (28, 'public.factory_list_raw_material_movements(uuid,date,date,uuid,text,text,text)', $old$nullif(btrim(linked_job.job_order_no), '')
        )$old$, $new$'Batch number missing'
        )$new$),
    (29, 'public.factory_list_raw_material_movements(uuid,date,date,uuid,text,text,text)', $old$linked_production.id = coalesce(
       source.reference_id,
       nullif(ledger.raw_material ->> 'document_id', '')::uuid
     )$old$, $new$linked_production.id = source.reference_id$new$),
    (30, 'public.factory_list_product_movements_v1(date,date,text,uuid,text,text)', $old$coalesce(job_order.job_order_no, movement.reference_no) as source_reference,$old$, $new$case when movement.reference_type = 'production' then coalesce(nullif(btrim(production.batch_no), ''), 'Batch number missing')
           else movement.reference_no end as source_reference,$new$),
    (31, 'public.factory_list_product_movements_v1(date,date,text,uuid,text,text)', $old$    left join lateral (
      select production_row.id, production_row.batch_no, production_row.job_order_id
      from public.factory_productions production_row
      where production_row.id = movement.reference_id
        or (movement.reference_type = 'production' and production_row.production_no = movement.reference_no)
      order by (production_row.id = movement.reference_id) desc limit 1
    ) production on true
    left join public.factory_job_orders job_order on job_order.id = production.job_order_id
$old$, $new$    left join public.factory_productions production
      on movement.reference_type = 'production' and production.id = movement.reference_id
$new$),
    (32, 'public.factory_list_product_movements_v1(date,date,text,uuid,text,text)', $old$enriched.dispatch_item_id, enriched.reference_no,$old$, $new$enriched.dispatch_item_id, enriched.source_reference,$new$),
    (33, 'public.factory_list_product_movements_v1(date,date,text,uuid,text,text)', $old$enriched.resolved_batch_summary, enriched.reference_no, enriched.reference_type,$old$, $new$enriched.resolved_batch_summary, enriched.source_reference, enriched.reference_type,$new$),
    (34, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$production.production_no,$old$, $new$nullif(btrim(production.batch_no), '') as production_batch_no,$new$),
    (35, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$base.production_id, base.source_reference_id, base.source_reference_no,
    base.remarks, base.production_no,$old$, $new$base.production_id, base.source_reference_id,
    case when base.source_type = 'production' then base.production_batch_no else base.source_reference_no end,
    base.remarks, base.production_batch_no,$new$),
    (36, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$base.source_reference_no, base.production_no, base.current_location_name$old$, $new$case when base.source_type = 'production' then base.production_batch_no else base.source_reference_no end, base.current_location_name$new$),
    (37, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$base.product_code, base.sku_name, base.family_name, base.batch_no,$old$, $new$base.product_code, base.sku_name, base.family_name,
    case when base.source_type = 'production' then base.production_batch_no else base.batch_no end,$new$),
    (38, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$or base.batch_no ilike '%' || btrim(p_batch_no) || '%'$old$, $new$or (case when base.source_type = 'production' then base.production_batch_no else base.batch_no end) ilike '%' || btrim(p_batch_no) || '%'$new$),
    (39, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$concat_ws(' ', base.batch_no, base.product_code$old$, $new$concat_ws(' ', case when base.source_type = 'production' then base.production_batch_no else base.batch_no end, base.product_code$new$),
    (40, 'feedx_integrations.traceability_core(date,date,uuid,text,text,text,uuid,text,text,text)', $old$nullif(btrim(production.batch_no), '') as production_batch_no,$old$, $new$case when balance.source_reference_id = production.id
        and (nullif(btrim(balance.batch_no), '') is null or balance.batch_no = production.batch_no)
        then nullif(btrim(production.batch_no), '') end as production_batch_no,$new$),
    (100, 'public.factory_list_product_movements_before_dispatch_reversal(date,date,text,uuid,text,text)',
      $old$coalesce(movement.production_batch_no, movement.job_order_no)$old$,
      $new$coalesce(movement.production_batch_no, 'Batch number missing')$new$)
      ) as edits(position, target, before_clause, after_clause)
    ) ordered
    group by target
  loop
    definition := pg_get_functiondef(edits.target::regprocedure);
    for clause in select value from jsonb_array_elements(edits.clauses)
    loop
      if strpos(definition, clause.value->>0) = 0 then
        raise exception 'Unexpected Factory definition for %: %', edits.target, left(clause.value->>0, 100);
      end if;
      definition := replace(definition, clause.value->>0, clause.value->>1);
    end loop;
    execute definition;
  end loop;
end;
$migration$;

-- These legacy entry points have no client grants. Keep their signatures for
-- historical dependency inspection while removing the obsolete writer bodies.
CREATE OR REPLACE FUNCTION public.factory_complete_production(p_job_order_id uuid, p_production_no text, p_product_name text, p_batch_no text, p_production_date date, p_operator_id uuid, p_operator_name text, p_start_time time without time zone, p_end_time time without time zone, p_actual_produced_qty numeric, p_good_output_qty numeric, p_wastage_qty numeric, p_uom text, p_qc_status text, p_notes text, p_created_by uuid, p_usage_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
begin
  raise exception using errcode = '0A000', message = 'Use the current Factory Production completion workflow.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.factory_complete_production(p_job_order_id uuid, p_finished_good_id uuid, p_production_no text, p_product_name text, p_batch_no text, p_production_date date, p_operator_id uuid, p_operator_name text, p_start_time time without time zone, p_end_time time without time zone, p_actual_produced_qty numeric, p_good_output_qty numeric, p_wastage_qty numeric, p_uom text, p_qc_status text, p_production_sop_id uuid, p_sop_version text, p_notes text, p_created_by uuid, p_usage_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
begin
  raise exception using errcode = '0A000', message = 'Use the current Factory Production completion workflow.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.factory_complete_production(p_job_order_id uuid, p_finished_good_id uuid, p_production_no text, p_product_name text, p_batch_no text, p_production_date date, p_operator_id uuid, p_operator_name text, p_start_time time without time zone, p_end_time time without time zone, p_actual_produced_qty numeric, p_good_output_qty numeric, p_wastage_qty numeric, p_uom text, p_qc_status text, p_production_sop_id uuid, p_sop_version text, p_notes text, p_created_by uuid, p_usage_items jsonb, p_actual_pack_qty numeric DEFAULT NULL::numeric, p_actual_output_qty numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
begin
  raise exception using errcode = '0A000', message = 'Use the current Factory Production completion workflow.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.factory_complete_production_with_batch(p_job_order_id uuid, p_finished_good_id uuid, p_production_no text, p_product_name text, p_batch_no text, p_production_date date, p_operator_id uuid, p_operator_name text, p_start_time time without time zone, p_end_time time without time zone, p_actual_produced_qty numeric, p_good_output_qty numeric, p_wastage_qty numeric, p_uom text, p_qc_status text, p_production_sop_id uuid, p_sop_version text, p_notes text, p_created_by uuid, p_usage_items jsonb, p_actual_pack_qty numeric DEFAULT NULL::numeric, p_actual_output_qty numeric DEFAULT NULL::numeric, p_end_date date DEFAULT NULL::date, p_expiry_date date DEFAULT NULL::date, p_storage_location_id uuid DEFAULT NULL::uuid, p_expiry_override_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception using errcode = '0A000', message = 'Use the current Factory Production completion workflow.';
end;
$function$;

update feedx_integrations.navigation_resources
set allowed_fields = allowed_fields - 'production_no',
    relationship_modules = relationship_modules - 'production_no'
where allowed_fields ? 'production_no' and module_id like 'factory_%';

update feedx_integrations.navigation_resources
set allowed_fields = (allowed_fields - 'production_id' - 'production_batch_no') || '["production_id","production_batch_no"]'::jsonb,
    relationship_modules = relationship_modules || '{"production_id":"factory_production"}'::jsonb
where resource_key in ('factory.product_movements', 'factory.raw_movements');
