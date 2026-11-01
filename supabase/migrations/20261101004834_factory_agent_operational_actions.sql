-- Explicit machine actions, canonical business cores, unchanged View grants.
set check_function_bodies=off;
-- No grants are inferred from View. Machine capabilities remain outside the Human Role Matrix.
create table feedx_integrations.factory_actions (
 key text primary key, module_id text not null references feedx_integrations.navigation_modules(id),
 label text not null, action text not null, human_permission text not null references public.permissions(code),
 target_table regclass not null, requires_confirmation boolean not null, target_required boolean not null,
 input_fields text[] not null, description text not null
);
revoke all on feedx_integrations.factory_actions from public, anon, authenticated;

-- Explicit principal: NULL means the existing authenticated human contract. No fake Employee/Auth user.
create function feedx_integrations.factory_actor_can(p_machine_identity_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine_identity_id is null then public.current_user_has_permission(p_permission) else
 exists(select 1 from feedx_integrations.machine_identities m
 join public.roles r on r.id=m.role_id and r.is_active and r.name not in ('Owner','Admin')
 join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id
 join feedx_integrations.factory_actions a on p.code='factory_agent_action_'||a.key
 where m.id=p_machine_identity_id and m.enabled and a.human_permission=p_permission) end;
$$;
revoke all on function feedx_integrations.factory_actor_can(uuid,text) from public,anon,authenticated;

-- Calibrations require exactly one real principal. Existing human rows are unchanged.
alter table public.factory_mesti_calibration_records add column recorded_by_agent uuid references feedx_integrations.machine_identities(id);
alter table public.factory_mesti_calibration_records alter column recorded_by drop not null;
alter table public.factory_mesti_calibration_records add constraint calibration_recording_principal check ((recorded_by is not null)::int+(recorded_by_agent is not null)::int=1);

create table feedx_integrations.factory_action_requests (
 identity_id uuid not null references feedx_integrations.machine_identities(id), request_id uuid not null,
 action text not null references feedx_integrations.factory_actions(key), target_id uuid,
 expected_version text, input jsonb not null, payload_hash text not null,
 status text not null check(status in ('awaiting_confirmation','confirmed','completed')),
 requested_at timestamptz not null default clock_timestamp(), confirmed_by uuid references public.employees(id),
 confirmed_at timestamptz, evidence_reference text, completed_at timestamptz, receipt jsonb,
 primary key(identity_id,request_id),
 check((status='completed')=(receipt is not null))
);
revoke all on feedx_integrations.factory_action_requests from public,anon,authenticated;
alter table feedx_integrations.factory_action_requests enable row level security;

-- Exact source version, including child evidence. Stable ordering is part of the comparison contract.
create function feedx_integrations.factory_action_state(p_action text,p_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a feedx_integrations.factory_actions%rowtype; value jsonb; child jsonb:='{}'; t text; fk text;
begin
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if p_id is null then return null; end if;
 if p_lock then execute format('select to_jsonb(t) from %s t where id=$1 for update',a.target_table) into value using p_id;
 else execute format('select to_jsonb(t) from %s t where id=$1',a.target_table) into value using p_id; end if;
 if value is null then raise exception using errcode='P0002',message='Factory action target was not found.'; end if;
 for t,fk in select * from (values
 ('factory_job_orders','factory_production_step_executions','job_order_id'),
 ('factory_job_orders','factory_production_qc_results','job_order_id'),
 ('factory_raw_material_receiving_batches','factory_raw_material_receivings','batch_id'),
 ('factory_product_stock_checks','factory_product_stock_check_items','stock_check_id'),
 ('factory_raw_material_stock_checks','factory_raw_material_stock_check_items','stock_check_id')
 ) x(parent,child_table,foreign_key) where parent=a.target_table::text
 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]''::jsonb) from public.%I t where %I=$1',t,fk) into child using p_id;
  value:=value||jsonb_build_object(t,child);
 end loop;
 return value;
end $$;
revoke all on function feedx_integrations.factory_action_state(text,uuid,boolean) from public,anon,authenticated;

create function feedx_integrations.factory_action_version(p_value jsonb) returns text language sql immutable set search_path=public,pg_temp as $$
 select case when p_value is null then null else encode(extensions.digest(p_value::text,'sha256'),'hex') end;
$$;
revoke all on function feedx_integrations.factory_action_version(jsonb) from public,anon,authenticated;

create function feedx_integrations.factory_action_authorize(p_token text,p_action text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid; module text;
begin
 select module_id into strict module from feedx_integrations.factory_actions where key=p_action;
 m:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if feedx_integrations.authorize(p_token,'factory_agent_action_'||p_action) is distinct from m
 or feedx_integrations.authorize(p_token,'factory_agent_nav_'||module||'.view') is distinct from m then
 raise exception using errcode='42501',message='Factory action and business-module View access are required.'; end if;
 return m;
end $$;
revoke all on function feedx_integrations.factory_action_authorize(text,text) from public,anon,authenticated;

create function public.factory_agent_action_context(p_token text,p_action text,p_target_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid; a feedx_integrations.factory_actions%rowtype; value jsonb;
begin
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if a.target_required and p_target_id is null then raise exception using errcode='22023',message='Target is required.'; end if;
 value:=feedx_integrations.factory_action_state(p_action,p_target_id);
 -- Context is concurrency metadata, never a second unrestricted business read.
 return jsonb_build_object('action',p_action,'target_id',p_target_id,'expected_version',feedx_integrations.factory_action_version(value),
 'status',value->>'status','requires_human_confirmation',a.requires_confirmation,'input_fields',a.input_fields,
 'instruction',case when a.requires_confirmation then 'Submit the exact intent. An authorized human must confirm existing physical evidence before execution.' else 'Explicit action grant permits autonomous execution.' end);
end $$;
revoke all on function public.factory_agent_action_context(text,text,uuid) from public;
grant execute on function public.factory_agent_action_context(text,text,uuid) to anon,authenticated;
insert into feedx_integrations.factory_actions values('job_order.create','factory_job_order_records','Job Orders','create','factory_job_orders.create','public.factory_job_orders'::regclass,false,false,ARRAY['finished_good_id','target_quantity','uom','planned_date','due_date','priority','assigned_team','remarks','target_pack_qty','target_production_qty']::text[],'Create Job Orders.');
insert into feedx_integrations.factory_actions values('job_order.update','factory_job_order_records','Job Orders','update','factory_job_orders.edit','public.factory_job_orders'::regclass,false,true,ARRAY['finished_good_id','target_quantity','uom','planned_date','due_date','priority','assigned_team','remarks','target_pack_qty','target_production_qty']::text[],'Update Job Orders.');
insert into feedx_integrations.factory_actions values('job_order.submit','factory_job_order_records','Job Orders','submit','factory_job_orders.edit','public.factory_job_orders'::regclass,false,true,ARRAY[]::text[],'Release planned Job Order into production queue.');
insert into feedx_integrations.factory_actions values('job_order.cancel','factory_job_order_records','Job Orders','cancel','factory_job_orders.cancel','public.factory_job_orders'::regclass,false,true,ARRAY[]::text[],'Cancel Job Orders.');
insert into feedx_integrations.factory_actions values('production.update','factory_production','Production','update','factory_production.complete','public.factory_job_orders'::regclass,true,true,ARRAY['step_rows','qc_rows']::text[],'Update Production.');
insert into feedx_integrations.factory_actions values('production.complete','factory_production','Production','complete','factory_production.complete','public.factory_job_orders'::regclass,true,true,ARRAY['payload']::text[],'Complete Production.');
insert into feedx_integrations.factory_actions values('production.verify','factory_production','Production','verify','factory_production.verify','public.factory_productions'::regclass,true,true,ARRAY[]::text[],'Verify Production.');
insert into feedx_integrations.factory_actions values('receiving.create','factory_raw_receiving','Raw Material Receiving','create','factory_raw_receiving.create','public.factory_raw_material_receiving_batches'::regclass,false,false,ARRAY['supplier_id','reference_no','received_date','remarks','items']::text[],'Create Raw Material Receiving.');
insert into feedx_integrations.factory_actions values('receiving.update','factory_raw_receiving','Raw Material Receiving','update','factory_raw_receiving.edit','public.factory_raw_material_receiving_batches'::regclass,false,true,ARRAY['supplier_id','reference_no','received_date','remarks','items']::text[],'Update Raw Material Receiving.');
insert into feedx_integrations.factory_actions values('receiving.complete','factory_raw_receiving','Raw Material Receiving','complete','factory_raw_receiving.edit','public.factory_raw_material_receiving_batches'::regclass,true,true,ARRAY['supplier_id','reference_no','received_date','remarks','items']::text[],'Complete Raw Material Receiving.');
insert into feedx_integrations.factory_actions values('receiving.verify','factory_raw_receiving','Raw Material Receiving','verify','factory_raw_receiving.verify','public.factory_raw_material_receiving_batches'::regclass,true,true,ARRAY[]::text[],'Verify Raw Material Receiving.');
insert into feedx_integrations.factory_actions values('receiving.cancel','factory_raw_receiving','Raw Material Receiving','cancel','factory_raw_receiving.delete','public.factory_raw_material_receiving_batches'::regclass,false,true,ARRAY[]::text[],'Cancel Raw Material Receiving.');
insert into feedx_integrations.factory_actions values('product_stock_check.create','factory_product_stock_check','Product Stock Check','create','factory_product_stock_check.create','public.factory_product_stock_checks'::regclass,false,false,ARRAY['check_date','notes','rows']::text[],'Create Product Stock Check.');
insert into feedx_integrations.factory_actions values('product_stock_check.update','factory_product_stock_check','Product Stock Check','update','factory_product_stock_check.edit','public.factory_product_stock_checks'::regclass,false,true,ARRAY['check_date','notes','rows']::text[],'Update Product Stock Check.');
insert into feedx_integrations.factory_actions values('product_stock_check.submit','factory_product_stock_check','Product Stock Check','submit','factory_product_stock_check.submit','public.factory_product_stock_checks'::regclass,true,true,ARRAY['check_date','notes','rows']::text[],'Submit Product Stock Check.');
insert into feedx_integrations.factory_actions values('product_stock_check.approve','factory_product_stock_check','Product Stock Check','approve','factory_product_stock_check.approve','public.factory_product_stock_checks'::regclass,true,true,ARRAY[]::text[],'Approve Product Stock Check.');
insert into feedx_integrations.factory_actions values('raw_stock_check.create','factory_raw_stock_check','Raw Material Stock Check','create','factory_raw_stock_check.create','public.factory_raw_material_stock_checks'::regclass,false,false,ARRAY['category_id','check_date','notes','rows']::text[],'Create Raw Material Stock Check.');
insert into feedx_integrations.factory_actions values('raw_stock_check.update','factory_raw_stock_check','Raw Material Stock Check','update','factory_raw_stock_check.edit','public.factory_raw_material_stock_checks'::regclass,false,true,ARRAY['category_id','check_date','notes','rows']::text[],'Update Raw Material Stock Check.');
insert into feedx_integrations.factory_actions values('raw_stock_check.submit','factory_raw_stock_check','Raw Material Stock Check','submit','factory_raw_stock_check.submit','public.factory_raw_material_stock_checks'::regclass,true,true,ARRAY['category_id','check_date','notes','rows']::text[],'Submit Raw Material Stock Check.');
insert into feedx_integrations.factory_actions values('raw_stock_check.approve','factory_raw_stock_check','Raw Material Stock Check','approve','factory_raw_stock_check.approve','public.factory_raw_material_stock_checks'::regclass,true,true,ARRAY[]::text[],'Approve Raw Material Stock Check.');
insert into feedx_integrations.factory_actions values('area_cleaning.complete','factory_mesti_cleaning','Area Cleaning','complete','factory_mesti_cleaning.complete','public.factory_mesti_cleaning_occurrences'::regclass,true,true,ARRAY['result','note']::text[],'Complete Area Cleaning.');
insert into feedx_integrations.factory_actions values('area_cleaning.verify','factory_mesti_cleaning','Area Cleaning','verify','factory_mesti_cleaning.review','public.factory_mesti_cleaning_occurrences'::regclass,true,true,ARRAY['result','note']::text[],'Verify Area Cleaning.');
insert into feedx_integrations.factory_actions values('equipment_cleaning.complete','factory_mesti_equipment_cleaning','Equipment Cleaning','complete','factory_mesti_equipment_cleaning.complete','public.factory_mesti_equipment_cleaning_occurrences'::regclass,true,true,ARRAY['result','note']::text[],'Complete Equipment Cleaning.');
insert into feedx_integrations.factory_actions values('equipment_cleaning.verify','factory_mesti_equipment_cleaning','Equipment Cleaning','verify','factory_mesti_equipment_cleaning.review','public.factory_mesti_equipment_cleaning_occurrences'::regclass,true,true,ARRAY['result','note']::text[],'Verify Equipment Cleaning.');
insert into feedx_integrations.factory_actions values('calibration.create','factory_mesti_calibration','Calibration','create','factory_mesti_calibration.complete','public.factory_mesti_calibration_requirements'::regclass,true,true,ARRAY['record']::text[],'Create Calibration.');
insert into feedx_integrations.factory_actions values('calibration.verify','factory_mesti_calibration','Calibration','verify','factory_mesti_calibration.review','public.factory_mesti_calibration_records'::regclass,true,true,ARRAY[]::text[],'Verify Calibration.');
alter table feedx_integrations.capabilities drop constraint capabilities_action_type_check; alter table feedx_integrations.capabilities add constraint capabilities_action_type_check check(action_type in ('view','list','read','search','filter','draft','execute','create','update','submit','complete','verify','approve','cancel'));

insert into public.permissions(code,module,description,requires_restaurant_outlet_scope) select 'factory_agent_action_'||key,'factory_agent_action_'||split_part(key,'.',1),description,false from feedx_integrations.factory_actions;
insert into feedx_integrations.capabilities(tool_id,adapter_key,label,description,workspace,domain,domain_label,action_type,permission_code,requires_human_approval,implemented,sort_order,mcp_tool,navigation_module_id) select a.key,'factory_mesti',a.label,a.description,'Factory',n.section,n.section,a.action,'factory_agent_action_'||a.key,a.requires_confirmation,true,500+row_number() over(order by a.key),'execute_factory_action',a.module_id from feedx_integrations.factory_actions a join feedx_integrations.navigation_modules n on n.id=a.module_id;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_approve_product_stock_check(p_machine_identity_id uuid, p_stock_check_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_item record; v_adjustment record; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype; v_total numeric; v_batch_total numeric;
  v_approval_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_adjustment_prefix text := 'ADJ-FGSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD');
  v_adjustment_sequence integer;
  v_adjustment_batch_no text;
begin
  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Product Stock Check.';
  end if;
  select * into v_check from public.factory_product_stock_checks where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status <> 'submitted' then raise exception 'Only submitted stock checks can be approved.'; end if;

  -- Every new reconciliation batch approved on this Factory business date shares
  -- one serialized sequence, including multiple SKU adjustments in this check.
  perform pg_advisory_xact_lock(hashtextextended('factory_product_stock_check_adjustment:' || v_adjustment_prefix, 0));

  for v_item in
    select item.*, sku.product_name, sku.storage_location_id as current_default_storage_location_id
    from public.factory_product_stock_check_items item
    join public.factory_finished_goods sku on sku.id = item.finished_good_id
    where item.stock_check_id = p_stock_check_id order by item.finished_good_id, item.id for update of item
  loop
    if lower(coalesce(v_item.count_status, 'counted')) = 'skip' or v_item.variance_status = 'Skipped' then continue; end if;
    if v_item.variance_qty <> 0 and coalesce(btrim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    select coalesce(sum(balance.current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances balance where balance.finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - v_item.system_qty) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before approval.', v_item.product_name;
    end if;
    if v_item.variance_qty < 0 then
      select coalesce(sum(adjustment.quantity), 0) into v_total from public.factory_product_stock_check_batch_adjustments adjustment where adjustment.stock_check_item_id = v_item.id;
      if v_total <> abs(v_item.variance_qty) then raise exception 'Negative Product Stock Check variance must be fully allocated across batches.'; end if;
      for v_adjustment in select * from public.factory_product_stock_check_batch_adjustments where stock_check_item_id = v_item.id order by batch_balance_id, id loop
        select * into v_batch from public.factory_finished_good_batch_balances where id = v_adjustment.batch_balance_id for update;
        select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id or v_batch.current_balance < v_adjustment.quantity
          or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Batch stock has changed. Review the suggested resolution again.';
        end if;
        update public.factory_finished_good_batch_balances set current_balance = current_balance - v_adjustment.quantity, updated_at = now() where id = v_batch.id;
      end loop;
    elsif v_item.variance_qty > 0 then
      if not v_item.positive_adjustment_confirmed then raise exception 'Reconciliation Batch intent is required for a positive Product Stock Check variance.'; end if;
      if v_item.positive_adjustment_batch_balance_id is not null then
        select * into v_batch from public.factory_finished_good_batch_balances where id = v_item.positive_adjustment_batch_balance_id for update;
        select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
          or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Selected reconciliation batch is no longer available.';
        end if;
        update public.factory_finished_good_batch_balances set current_balance = current_balance + v_item.variance_qty, updated_at = now() where id = v_batch.id;
      else
        select * into v_location from public.factory_storage_locations where id = v_item.adjustment_storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active' or v_location.is_storage_location is not true then
          raise exception 'Reconciliation Batch requires an active storage location.';
        end if;

        select coalesce(max((substring(balance.batch_no from ('^' || v_adjustment_prefix || '-([0-9]+)$')))::integer), 0) + 1
        into v_adjustment_sequence
        from public.factory_finished_good_batch_balances balance
        where balance.source_type = 'adjustment'
          and balance.batch_no ~ ('^' || v_adjustment_prefix || '-[0-9]+$');
        v_adjustment_batch_no := v_adjustment_prefix || '-' || public.factory_format_business_sequence(v_adjustment_sequence);

        insert into public.factory_finished_good_batch_balances (
          finished_good_id, source_type, source_reference_id, source_reference_no, batch_no, manufacturing_date,
          storage_location_id, storage_location, storage_location_type, opening_qty, current_balance, remarks
        ) values (
          v_item.finished_good_id, 'adjustment', p_stock_check_id, v_check.check_no, v_adjustment_batch_no,
          v_check.check_date, v_location.id, v_location.location_name, v_location.location_type,
          v_item.variance_qty, v_item.variance_qty, v_item.variance_reason
        );
      end if;
    end if;
    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_finished_good_balance(v_item.finished_good_id, v_item.variance_qty);
      insert into public.factory_product_stock_movements (
        finished_good_id, product_name, movement_type, quantity, uom, reference_type, reference_id, reference_no,
        movement_date, notes, created_by
      ) values (
        v_item.finished_good_id, v_item.product_name, 'Stock Check Adjustment', v_item.variance_qty, v_item.uom,
        'product_stock_check', p_stock_check_id, v_check.check_no, coalesce(v_check.check_date, current_date),
        case when v_item.positive_adjustment_batch_balance_id is null then 'Approved finished goods Stock Check reconciliation batch.' else 'Approved finished goods Stock Check adjustment to an existing batch.' end,
        feedx_integrations.fa_current_active_employee_id(p_machine_identity_id)
      );
    end if;
  end loop;
  update public.factory_product_stock_checks set status = 'approved', approved_by = feedx_integrations.fa_current_active_employee_id(p_machine_identity_id),
    approved_at = now(), submitted_at = coalesce(submitted_at, now()), updated_at = now() where id = p_stock_check_id;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_approve_product_stock_check(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_approve_product_stock_check(p_stock_check_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_approve_product_stock_check(null::uuid ,p_stock_check_id,p_approved_by);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_approve_raw_material_stock_check(p_machine_identity_id uuid, p_stock_check_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_check public.factory_raw_material_stock_checks%rowtype;
  v_item public.factory_raw_material_stock_check_items%rowtype;
  v_material public.factory_raw_materials%rowtype;
  v_batch public.factory_raw_material_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_remaining numeric;
  v_take numeric;
  v_known_available numeric;
  v_adjustment_batch_id uuid;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Raw Material Stock Checks.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;
  if p_machine_identity_id is null and v_actor.id is null then
    raise exception using errcode = '42501', message = 'An active employee profile is required.';
  end if;

  select stock_check.* into v_check
  from public.factory_raw_material_stock_checks stock_check
  where stock_check.id = p_stock_check_id
  for update;
  if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
  if lower(coalesce(v_check.status, '')) <> 'submitted' then
    raise exception 'Only submitted Raw Material Stock Checks can be approved.';
  end if;
  if not exists (
    select 1 from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
  ) then
    raise exception 'Raw Material Stock Check requires at least one counted item.';
  end if;

  perform material.id
  from public.factory_raw_materials material
  where material.id in (
    select distinct item.raw_material_id
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
      and lower(coalesce(item.count_status, 'counted')) <> 'skipped'
  )
  order by material.id
  for update;

  perform balance.id
  from public.factory_raw_material_batch_balances balance
  where balance.raw_material_id in (
    select distinct item.raw_material_id
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
      and coalesce(item.variance_qty, 0) < 0
  )
  order by balance.id
  for update;

  for v_item in
    select item.*
    from public.factory_raw_material_stock_check_items item
    where item.stock_check_id = v_check.id
    order by item.raw_material_id, item.id
  loop
    if lower(coalesce(v_item.count_status, 'counted')) = 'pending' then
      raise exception 'All Raw Material Stock Check items must be counted or skipped before approval.';
    end if;
    if lower(coalesce(v_item.count_status, 'counted')) = 'skipped'
       or lower(coalesce(v_item.variance_status, '')) = 'skipped' then
      continue;
    end if;
    if lower(coalesce(v_item.variance_status, '')) in ('warning', 'critical')
       and nullif(btrim(v_item.variance_reason), '') is null then
      raise exception 'Variance reason is required for Warning and Critical Raw Material Stock Check items.';
    end if;

    select material.* into v_material
    from public.factory_raw_materials material
    where material.id = v_item.raw_material_id
    for update;
    if v_material.id is null or lower(coalesce(v_material.status, '')) <> 'active' then
      raise exception 'Every counted Raw Material Stock Check row requires an active Raw Material.';
    end if;
    if nullif(lower(btrim(v_item.uom)), '') is null
       or nullif(lower(btrim(v_material.uom)), '') is null
       or lower(btrim(v_item.uom)) <> lower(btrim(v_material.uom)) then
      raise exception 'Raw Material Stock Check UOM must match the Raw Material UOM.';
    end if;

    if coalesce(v_item.variance_qty, 0) < 0 then
      v_remaining := abs(v_item.variance_qty);
      select coalesce(sum(balance.current_balance), 0) into v_known_available
      from public.factory_raw_material_batch_balances balance
      join public.factory_storage_locations location
        on location.id = balance.storage_location_id
       and lower(coalesce(location.status, '')) = 'active'
      where balance.raw_material_id = v_material.id
        and balance.source_type = 'receiving'
        and balance.status = 'active'
        and balance.current_balance > 0
        and nullif(lower(btrim(balance.uom)), '') = lower(btrim(v_item.uom));
      v_known_available := least(v_known_available, greatest(coalesce(v_material.current_balance, 0), 0));
      if v_known_available < v_remaining then
        raise exception 'Insufficient reconciled Raw Material batch stock for Stock Check adjustment. Required %, available %.', v_remaining, v_known_available;
      end if;

      for v_batch in
        select balance.*
        from public.factory_raw_material_batch_balances balance
        join public.factory_storage_locations location
          on location.id = balance.storage_location_id
         and lower(coalesce(location.status, '')) = 'active'
        where balance.raw_material_id = v_material.id
          and balance.source_type = 'receiving'
          and balance.status = 'active'
          and balance.current_balance > 0
          and nullif(lower(btrim(balance.uom)), '') = lower(btrim(v_item.uom))
        order by balance.expiry_date asc nulls last, balance.received_date asc nulls last,
          balance.manufacturing_date asc nulls last, balance.internal_batch_no asc, balance.id asc
        for update of balance
      loop
        exit when v_remaining <= 0;
        v_take := least(v_batch.current_balance, v_remaining);
        update public.factory_raw_material_batch_balances
        set current_balance = current_balance - v_take, updated_at = now()
        where id = v_batch.id and current_balance >= v_take;
        if not found then raise exception 'Raw Material batch stock changed while approving the Stock Check.'; end if;

        insert into public.factory_raw_material_stock_check_batch_allocations (
          stock_check_item_id, raw_material_batch_balance_id, allocated_qty
        ) values (v_item.id, v_batch.id, v_take);

        update public.factory_raw_materials
        set current_balance = current_balance - v_take, updated_at = now()
        where id = v_material.id and current_balance >= v_take;
        if not found then raise exception 'Raw Material aggregate stock changed while approving the Stock Check.'; end if;
        v_material.current_balance := v_material.current_balance - v_take;

        insert into public.factory_raw_material_movements (
          raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
          reference_no, movement_date, notes, created_by,
          raw_material_batch_balance_id
        ) values (
          v_material.id, 'Stock Check Adjustment', -v_take, v_item.uom,
          'raw_material_stock_check', v_check.id, v_check.check_no,
          coalesce(v_check.check_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
          coalesce(nullif(btrim(v_item.variance_reason), ''), 'Approved Raw Material Stock Check reduction.'),
          v_actor.id, v_batch.id
        );
        v_remaining := v_remaining - v_take;
      end loop;
      if v_remaining > 0.000001 then
        raise exception 'Raw Material Stock Check batch allocation could not be reconciled completely.';
      end if;
    elsif coalesce(v_item.variance_qty, 0) > 0 then
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = v_material.storage_location_id
        and lower(coalesce(location.status, '')) = 'active'
        and location.is_storage_location is true;
      if v_location.id is null then
        raise exception 'Select an active storage-enabled Raw Material Storage Location before approving a positive Stock Check adjustment.';
      end if;

      perform pg_advisory_xact_lock(hashtextextended(
        'factory_raw_stock_check_adjustment:' || 'ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD'), 0
      ));
      insert into public.factory_raw_material_batch_balances (
        raw_material_stock_check_item_id, raw_material_id, source_type,
        internal_batch_no, storage_location_id, uom, opening_qty, current_balance,
        status, diagnostic
      ) values (
        v_item.id, v_material.id, 'stock_check_adjustment',
        'ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-' || public.factory_format_business_sequence((
          select coalesce(max((substring(balance.internal_batch_no from ('^ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-([0-9]+)$')))::integer), 0) + 1
          from public.factory_raw_material_batch_balances balance
          where balance.source_type = 'stock_check_adjustment'
            and balance.internal_batch_no ~ ('^ADJ-RMSC' || to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD') || '-[0-9]+$')
        )),
        v_location.id, v_item.uom, v_item.variance_qty, v_item.variance_qty,
        'active',
        'Approved Raw Material Stock Check reconciliation batch; source is Stock Check, not Receiving.'
      ) returning id into v_adjustment_batch_id;

      update public.factory_raw_materials
      set current_balance = current_balance + v_item.variance_qty, updated_at = now()
      where id = v_material.id;

      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by,
        raw_material_batch_balance_id
      ) values (
        v_material.id, 'Stock Check Adjustment', v_item.variance_qty, v_item.uom,
        'raw_material_stock_check', v_check.id, v_check.check_no,
        coalesce(v_check.check_date, (now() at time zone 'Asia/Kuala_Lumpur')::date),
        coalesce(nullif(btrim(v_item.variance_reason), ''), 'Approved Raw Material Stock Check increase; batch reconciliation required.'),
        v_actor.id, v_adjustment_batch_id
      );
    end if;
  end loop;

  update public.factory_raw_material_stock_checks
  set status = 'approved', approved_by = v_actor.id, approved_at = now(), updated_at = now()
  where id = v_check.id and lower(status) = 'submitted';
  if not found then raise exception 'Raw Material Stock Check is no longer submitted.'; end if;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_approve_raw_material_stock_check(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_approve_raw_material_stock_check(p_stock_check_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_approve_raw_material_stock_check(null::uuid ,p_stock_check_id,p_approved_by);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_cancel_job_order(p_machine_identity_id uuid, p_job_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.factory_job_orders%rowtype;
begin
  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_job_orders.cancel') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission to cancel Job Orders.';
  end if;

  select job.* into v_job
  from public.factory_job_orders job
  where job.id = p_job_order_id
  for update;

  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) = 'cancelled' then
    raise exception 'Job Order is already cancelled.';
  end if;
  if lower(coalesce(v_job.status, '')) not in ('planned', 'released') then
    raise exception 'Only Scheduled or Released Job Orders can be cancelled.';
  end if;

  if v_job.started_at is not null
     or v_job.production_date is not null
     or v_job.start_time is not null
     or v_job.qc_snapshot_created_at is not null
     or exists (
       select 1 from public.factory_productions production
       where production.job_order_id = v_job.id
     )
     or exists (
       select 1 from public.factory_production_step_executions execution
       where execution.job_order_id = v_job.id
     )
     or exists (
       select 1 from public.factory_production_qc_results result
       where result.job_order_id = v_job.id
     ) then
    raise exception 'Job Order cannot be cancelled after Production has started.';
  end if;

  update public.factory_job_orders job
  set status = 'cancelled',
      updated_at = now()
  where job.id = p_job_order_id;

  insert into public.audit_logs (
    action, module, user_id, user_name, description, metadata, created_at
  ) values (
    'factory_job_order_cancelled',
    'factory',
    auth.uid(),
    'Authenticated User',
    'Factory Job Order cancelled before Production start.',
    jsonb_build_object(
      'target', v_job.job_order_no,
      'job_order_id', v_job.id,
      'before', jsonb_build_object('status', v_job.status),
      'after', jsonb_build_object('status', 'cancelled')
    ),
    now()
  );
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_cancel_job_order(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_cancel_job_order(p_job_order_id uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_cancel_job_order(null::uuid ,p_job_order_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_current_active_employee_id(p_machine_identity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid;
begin
  if p_machine_identity_id is not null then return null; end if;
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select employee.id
  into v_employee_id
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;

  if p_machine_identity_id is null and v_employee_id is null then
    raise exception using errcode = '42501', message = 'An active employee profile is required.';
  end if;
  return v_employee_id;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_current_active_employee_id(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_current_active_employee_id()
 RETURNS uuid
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_current_active_employee_id(null::uuid);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_current_active_employee_name(p_machine_identity_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text;
begin
  if p_machine_identity_id is not null then return (select name from feedx_integrations.machine_identities where id=p_machine_identity_id); end if;
  perform feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  select coalesce(
    nullif(btrim(employee.nickname), ''),
    nullif(btrim(employee.full_name), ''),
    nullif(btrim(employee.email), ''),
    'Employee'
  )
  into v_name
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;
  return v_name;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_current_active_employee_name(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_current_active_employee_name()
 RETURNS text
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_current_active_employee_name(null::uuid);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_complete_cleaning_occurrence(p_machine_identity_id uuid, p_occurrence_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee public.employees%rowtype := feedx_integrations.fa_mesti_current_employee(p_machine_identity_id);
  v_occurrence public.factory_mesti_cleaning_occurrences%rowtype;
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_cleaning.complete') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_cleaning.manage')) then
    raise exception using errcode='42501', message='Missing permission to complete Cleaning occurrences.';
  end if;
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id=p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode='P0002', message='Cleaning occurrence was not found.'; end if;
  if v_occurrence.status not in ('pending','missed','unsatisfactory') then
    raise exception using errcode='55000', message='Cleaning occurrence cannot be completed from its current state.';
  end if;
  update public.factory_mesti_cleaning_occurrences
  set status='completed', completed_by=v_employee.id, completed_at=now(), completion_result='completed',
      completion_note=nullif(btrim(coalesce(p_note,'')),''), updated_at=now()
  where id=p_occurrence_id
  returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_complete_cleaning_occurrence(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_complete_cleaning_occurrence(p_occurrence_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_complete_cleaning_occurrence(null::uuid ,p_occurrence_id,p_note);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(p_machine_identity_id uuid, p_occurrence_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_employee public.employees%rowtype := feedx_integrations.fa_mesti_current_employee(p_machine_identity_id); v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype;
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_equipment_cleaning.complete') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to complete Equipment Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.'; end if;
  if v_occurrence.status not in ('pending', 'missed', 'unsatisfactory') then raise exception using errcode = '55000', message = 'Equipment Cleaning occurrence cannot be completed from its current state.'; end if;
  update public.factory_mesti_equipment_cleaning_occurrences set status = 'completed', completed_by = v_employee.id, completed_at = now(), completion_result = 'completed', completion_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_complete_equipment_cleaning_occurrence(p_occurrence_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(null::uuid ,p_occurrence_id,p_note);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_current_employee(p_machine_identity_id uuid)
 RETURNS employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee public.employees%rowtype;
begin
  if p_machine_identity_id is not null then return null; end if;
  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid()
  limit 1;
  if p_machine_identity_id is null and v_employee.id is null then
    raise exception using errcode='42501', message='Current employee profile is required.';
  end if;
  return v_employee;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_current_employee(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_current_employee()
 RETURNS employees
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_current_employee(null::uuid);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_record_calibration(p_machine_identity_id uuid, p_requirement_id uuid, p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a uuid := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  req public.factory_mesti_calibration_requirements%rowtype;
  equip public.factory_equipment%rowtype;
  rec public.factory_mesti_calibration_records%rowtype;
  due date := (p_record->>'scheduled_due_date')::date;
  calibrated date := (p_record->>'calibrated_date')::date;
  expected_due date;
  result_value text := lower(btrim(p_record->>'result'));
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_calibration.complete') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_calibration.manage')) then
    raise exception using errcode='42501', message='Missing calibration record permission.';
  end if;
  select * into req from public.factory_mesti_calibration_requirements where id=p_requirement_id and status='active' and effective_until is null;
  if req.id is null then raise exception using errcode='22023', message='Active calibration requirement was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(req.logical_requirement_id::text, 0));
  select * into req from public.factory_mesti_calibration_requirements where logical_requirement_id=req.logical_requirement_id and effective_until is null and status='active' for update;
  if req.id is null then raise exception using errcode='22023', message='Active calibration requirement was not found.'; end if;
  if due is null or calibrated is null or result_value not in ('pass','fail') then raise exception using errcode='22023', message='Scheduled Due, Calibrated Date and a Pass or Fail result are required.'; end if;
  select coalesce(public.factory_mesti_calibration_due_date(r.calibrated_date,req.interval_months),req.effective_from)
  into expected_due
  from public.factory_mesti_calibration_records r
  where r.logical_requirement_id=req.logical_requirement_id and r.status='verified' and r.result='pass'
  order by r.verified_at desc,r.created_at desc
  limit 1;
  if due is distinct from coalesce(expected_due,req.effective_from) then raise exception using errcode='22023', message='Scheduled Due no longer matches the canonical calibration schedule.'; end if;
  select * into equip from public.factory_equipment where id=req.equipment_id;
  if equip.id is null then raise exception using errcode='22023', message='Equipment was not found.'; end if;
  insert into public.factory_mesti_calibration_records(logical_requirement_id,requirement_id,equipment_id,scheduled_due_date,calibrated_date,result,equipment_snapshot,provider_name,reference_no,notes,recorded_by,recorded_by_agent)
  values(req.logical_requirement_id,req.id,equip.id,due,calibrated,result_value,public.factory_mesti_calibration_snapshot(equip),nullif(btrim(p_record->>'provider_name'),''),nullif(btrim(p_record->>'reference_no'),''),nullif(btrim(p_record->>'notes'),''),a,p_machine_identity_id) returning * into rec;
  return to_jsonb(rec);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_record_calibration(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_record_calibration(p_requirement_id uuid, p_record jsonb)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_record_calibration(null::uuid ,p_requirement_id,p_record);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_verify_calibration(p_machine_identity_id uuid, p_record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id); v_record public.factory_mesti_calibration_records%rowtype; v_verified_at timestamptz := clock_timestamp();
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_calibration.review') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_calibration.manage')) then raise exception using errcode = '42501', message = 'Missing calibration verification permission.'; end if;
  select * into v_record from public.factory_mesti_calibration_records where id = p_record_id for update;
  if v_record.id is null or v_record.status <> 'awaiting_verification' then raise exception 'Calibration record is not awaiting verification.'; end if;
  update public.factory_mesti_calibration_records set status = 'verified', verified_by = v_actor, verified_at = v_verified_at, updated_at = v_verified_at where id = v_record.id returning * into v_record;
  return to_jsonb(v_record);
end $function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_verify_calibration(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_verify_calibration(p_record_id uuid)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_verify_calibration(null::uuid ,p_record_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_verify_cleaning_occurrence(p_machine_identity_id uuid, p_occurrence_id uuid, p_result text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_employee public.employees%rowtype := feedx_integrations.fa_mesti_current_employee(p_machine_identity_id); v_occurrence public.factory_mesti_cleaning_occurrences%rowtype; v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_cleaning.review') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to verify Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Cleaning occurrence was not found.'; end if;
  if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed Cleaning occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;
  update public.factory_mesti_cleaning_occurrences set status = v_result, verified_by = v_employee.id, verified_at = now(), verification_result = v_result, verification_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end $function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_verify_cleaning_occurrence(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_verify_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_verify_cleaning_occurrence(null::uuid ,p_occurrence_id,p_result,p_note);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(p_machine_identity_id uuid, p_occurrence_id uuid, p_result text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_employee public.employees%rowtype := feedx_integrations.fa_mesti_current_employee(p_machine_identity_id); v_occurrence public.factory_mesti_equipment_cleaning_occurrences%rowtype; v_result text := lower(coalesce(p_result, 'verified'));
begin
  if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_equipment_cleaning.review') or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_mesti_equipment_cleaning.manage')) then raise exception using errcode = '42501', message = 'Missing permission to verify Equipment Cleaning occurrences.'; end if;
  select * into v_occurrence from public.factory_mesti_equipment_cleaning_occurrences where id = p_occurrence_id for update;
  if v_occurrence.id is null then raise exception using errcode = 'P0002', message = 'Equipment Cleaning occurrence was not found.'; end if;
  if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed Equipment Cleaning occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;
  update public.factory_mesti_equipment_cleaning_occurrences set status = v_result, verified_by = v_employee.id, verified_at = now(), verification_result = v_result, verification_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = v_occurrence.id returning * into v_occurrence;
  return to_jsonb(v_occurrence);
end $function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_mesti_verify_equipment_cleaning_occurrence(p_occurrence_id uuid, p_result text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(null::uuid ,p_occurrence_id,p_result,p_note);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_release_job_order(p_machine_identity_id uuid, p_job_order_id uuid, p_released_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform feedx_integrations.fa_release_job_order(p_machine_identity_id, p_job_order_id);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_release_job_order(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_release_job_order(p_job_order_id uuid, p_released_by uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_release_job_order(null::uuid ,p_job_order_id,p_released_by);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_release_job_order(p_machine_identity_id uuid, p_job_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.factory_job_orders%rowtype;
  v_actor public.employees%rowtype;
  v_actor_name text;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to release Job Orders.';
  end if;

  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_job_orders.edit') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission to release Job Orders.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if p_machine_identity_id is null and not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to release Job Orders.';
  end if;

  select job.* into v_job
  from public.factory_job_orders job
  where job.id = p_job_order_id
  for update;

  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) = 'released' then return; end if;
  if lower(coalesce(v_job.status, '')) not in ('draft', 'planned') then
    raise exception 'Only Draft or Scheduled Job Orders can be released.';
  end if;

  v_actor_name := coalesce(v_actor.nickname, v_actor.full_name, 'Authenticated User');

  update public.factory_job_orders job
  set status = 'released',
      released_at = now(),
      released_by = v_actor.id,
      updated_at = now()
  where job.id = p_job_order_id;

  insert into public.audit_logs (
    action, module, user_id, user_name, description, metadata, created_at
  ) values (
    'factory_job_order_released',
    'factory',
    auth.uid(),
    coalesce(v_actor_name, 'Authenticated User'),
    'Factory Job Order released for production.',
    jsonb_build_object(
      'target', v_job.job_order_no,
      'job_order_id', v_job.id,
      'release_mode', 'manual',
      'before', jsonb_build_object('status', v_job.status),
      'after', jsonb_build_object('status', 'released')
    ),
    now()
  );
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_release_job_order(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_release_job_order(p_job_order_id uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_release_job_order(null::uuid ,p_job_order_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_job_order_structure(p_machine_identity_id uuid, p_job_order_id uuid DEFAULT NULL::uuid, p_finished_good_id uuid DEFAULT NULL::uuid, p_target_quantity numeric DEFAULT NULL::numeric, p_uom text DEFAULT NULL::text, p_planned_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_priority text DEFAULT NULL::text, p_assigned_team text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_target_pack_qty numeric DEFAULT NULL::numeric, p_target_production_qty numeric DEFAULT NULL::numeric)
 RETURNS TABLE(job_order_id uuid, job_order_no text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_job_orders%rowtype;
  v_saved public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_recipe_uom text;
  v_requested_production_qty numeric;
  v_expected_pack_qty numeric;
  v_expected_production_qty numeric;
  v_expected_production_uom text;
  v_is_complete boolean := false;
  v_priority text;
  v_yymmdd text := to_char(current_date, 'YYMMDD');
  v_next integer;
  v_job_order_no text;
  v_actor_name text;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to save Job Orders.';
  end if;

  select employee.*
  into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if p_machine_identity_id is null and not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to save Job Orders.';
  end if;

  if p_job_order_id is null then
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_job_orders.create') then
      raise exception using
        errcode = '42501',
        message = 'Missing permission to create Job Orders.';
    end if;
  else
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_job_orders.edit') then
      raise exception using
        errcode = '42501',
        message = 'Missing permission to edit Job Orders.';
    end if;

    select job.*
    into v_existing
    from public.factory_job_orders job
    where job.id = p_job_order_id
    for update;

    if not found then
      raise exception 'Job Order was not found.';
    end if;

    if lower(coalesce(v_existing.status, '')) not in ('draft', 'planned') then
      raise exception 'Only Draft or Planned Job Orders can be edited.';
    end if;
  end if;

  if coalesce(p_target_production_qty, p_target_quantity, 0) < 0
     or coalesce(p_target_pack_qty, 0) < 0 then
    raise exception 'Job Order quantities cannot be negative.';
  end if;

  v_requested_production_qty := coalesce(p_target_production_qty, p_target_quantity, 0);
  v_priority := case lower(btrim(coalesce(p_priority, '')))
    when 'urgent' then 'Urgent'
    when 'high' then 'High'
    when 'low' then 'Low'
    else 'Normal'
  end;

  if p_finished_good_id is not null then
    select finished_good.*
    into v_finished_good
    from public.factory_finished_goods finished_good
    where finished_good.id = p_finished_good_id
    for share;

    if not found then
      raise exception 'Packaging SKU was not found.';
    end if;

    if lower(coalesce(v_finished_good.status, '')) <> 'active' then
      raise exception 'Packaging SKU must be active before saving a Job Order.';
    end if;

    if coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty, 0) <= 0
       or coalesce(
         nullif(btrim(v_finished_good.pack_size_uom), ''),
         nullif(btrim(v_finished_good.base_uom), '')
       ) is null then
      raise exception 'Packaging SKU needs Pack Size before saving a Job Order.';
    end if;
  end if;

  if p_finished_good_id is not null
     and v_requested_production_qty > 0
     and nullif(btrim(coalesce(p_uom, '')), '') is not null then
    select recipe.uom
    into v_recipe_uom
    from public.factory_product_recipes recipe
    where lower(coalesce(recipe.status, '')) = 'active'
      and recipe.product_family_id is not null
      and recipe.product_family_id = v_finished_good.product_family_id
    order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last, recipe.id desc
    limit 1;

    if v_recipe_uom is null then
      select recipe.uom
      into v_recipe_uom
      from public.factory_product_recipes recipe
      where lower(coalesce(recipe.status, '')) = 'active'
        and recipe.finished_good_id = v_finished_good.id
      order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last, recipe.id desc
      limit 1;
    end if;

    select plan.target_pack_qty, plan.target_production_qty, plan.production_uom
    into v_expected_pack_qty, v_expected_production_qty, v_expected_production_uom
    from public.factory_packaging_pack_estimate(
      v_requested_production_qty,
      p_uom,
      coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
      coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom),
      v_recipe_uom
    ) plan;

    if p_target_pack_qty is not null
       and abs(p_target_pack_qty - v_expected_pack_qty) > 0.000001 then
      raise exception 'Estimated Pack Qty does not match Target Production Qty and Packaging SKU Pack Size.';
    end if;

    if abs(v_requested_production_qty - v_expected_production_qty) > 0.000001 then
      raise exception 'Target Production Qty does not match normalized Production UOM.';
    end if;

    v_is_complete := coalesce(v_expected_pack_qty, 0) > 0
      and coalesce(v_expected_production_qty, 0) > 0
      and nullif(btrim(coalesce(v_expected_production_uom, '')), '') is not null
      and p_planned_date is not null;
  end if;

  if p_job_order_id is not null
     and lower(coalesce(v_existing.status, '')) = 'planned'
     and not v_is_complete then
    raise exception 'Planned Job Orders must remain operationally complete.';
  end if;

  v_actor_name := coalesce(v_actor.nickname, v_actor.full_name, 'Authenticated User');

  if p_job_order_id is null then
    perform pg_advisory_xact_lock(hashtextextended('factory_job_order:JO:' || v_yymmdd, 0));

    select coalesce(max((substring(job.job_order_no from ('^JO' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
    into v_next
    from public.factory_job_orders job
    where job.job_order_no ~ ('^JO' || v_yymmdd || '-[0-9]+$');

    v_job_order_no := 'JO' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

    insert into public.factory_job_orders (
      job_order_no,
      finished_good_id,
      product_name,
      target_pack_qty,
      target_production_qty,
      target_quantity,
      produced_quantity,
      uom,
      planned_date,
      due_date,
      priority,
      status,
      assigned_team,
      remarks,
      created_by,
      updated_at
    ) values (
      v_job_order_no,
      v_finished_good.id,
      coalesce(v_finished_good.product_name, ''),
      case when v_expected_pack_qty > 0 then v_expected_pack_qty else null end,
      case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end,
      coalesce(case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end, 0),
      0,
      coalesce(v_expected_production_uom, nullif(btrim(coalesce(p_uom, '')), '')),
      p_planned_date,
      p_due_date,
      v_priority,
      case when v_is_complete then 'planned' else 'draft' end,
      coalesce(p_assigned_team, ''),
      coalesce(p_remarks, ''),
      v_actor.id,
      now()
    )
    returning * into v_saved;

    insert into public.audit_logs (
      action, module, user_id, user_name, description, metadata, created_at
    ) values (
      'factory_job_order_created',
      'factory',
      auth.uid(),
      v_actor_name,
      case when lower(v_saved.status) = 'planned'
        then 'Factory Job Order scheduled.'
        else 'Factory Job Order draft created.'
      end,
      jsonb_build_object(
        'target', v_saved.job_order_no,
        'job_order_id', v_saved.id,
        'after', to_jsonb(v_saved)
      ),
      now()
    );
  else
    update public.factory_job_orders job
    set finished_good_id = p_finished_good_id,
        product_name = coalesce(v_finished_good.product_name, ''),
        target_pack_qty = case when v_expected_pack_qty > 0 then v_expected_pack_qty else null end,
        target_production_qty = case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end,
        target_quantity = coalesce(case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end, 0),
        uom = coalesce(v_expected_production_uom, nullif(btrim(coalesce(p_uom, '')), '')),
        planned_date = p_planned_date,
        due_date = p_due_date,
        priority = v_priority,
        status = case when v_is_complete then 'planned' else 'draft' end,
        assigned_team = coalesce(p_assigned_team, ''),
        remarks = coalesce(p_remarks, ''),
        updated_at = now()
    where job.id = p_job_order_id
    returning * into v_saved;

    insert into public.audit_logs (
      action, module, user_id, user_name, description, metadata, created_at
    ) values (
      'factory_job_order_updated',
      'factory',
      auth.uid(),
      v_actor_name,
      'Factory Job Order planning structure updated.',
      jsonb_build_object(
        'target', v_saved.job_order_no,
        'job_order_id', v_saved.id,
        'before', to_jsonb(v_existing),
        'after', to_jsonb(v_saved)
      ),
      now()
    );
  end if;

  return query
  select v_saved.id, v_saved.job_order_no, v_saved.status;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_job_order_structure(uuid,uuid,uuid,numeric,text,date,date,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_job_order_structure(p_job_order_id uuid DEFAULT NULL::uuid, p_finished_good_id uuid DEFAULT NULL::uuid, p_target_quantity numeric DEFAULT NULL::numeric, p_uom text DEFAULT NULL::text, p_planned_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_priority text DEFAULT NULL::text, p_assigned_team text DEFAULT NULL::text, p_remarks text DEFAULT NULL::text, p_target_pack_qty numeric DEFAULT NULL::numeric, p_target_production_qty numeric DEFAULT NULL::numeric)
 RETURNS TABLE(job_order_id uuid, job_order_no text, status text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_job_order_structure(null::uuid ,p_job_order_id,p_finished_good_id,p_target_quantity,p_uom,p_planned_date,p_due_date,p_priority,p_assigned_team,p_remarks,p_target_pack_qty,p_target_production_qty);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_product_stock_check_structure(p_machine_identity_id uuid, p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text, p_created_by uuid, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_saved_id uuid;
  v_base_rows jsonb;
  v_submitting boolean := lower(coalesce(p_target_status, 'draft')) = 'submitted';
  v_invalid boolean;
begin
  if v_submitting and not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Product Stock Check.';
  end if;

  select coalesce(jsonb_agg(jsonb_set(row, '{positive_adjustment_confirmed}', 'false'::jsonb)), '[]'::jsonb)
  into v_base_rows
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) row;

  select saved.id into v_saved_id
  from feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(p_machine_identity_id, p_stock_check_id, p_check_date, p_notes,
    case when v_submitting then 'draft' else lower(coalesce(p_target_status, 'draft')) end,
    p_created_by, v_base_rows
  ) saved;
  if v_saved_id is null then raise exception 'Product Stock Check save did not return a record.'; end if;

  if v_submitting then
    select exists (
      select 1
      from public.factory_product_stock_check_items item
      where item.stock_check_id = v_saved_id
        and lower(coalesce(item.count_status, '')) <> 'skip'
        and (
          lower(coalesce(item.count_status, '')) = 'pending'
          or (item.variance_qty <> 0 and coalesce(btrim(item.variance_reason), '') = '')
          or (
            item.variance_qty < 0
            and coalesce((
              select sum(adjustment.quantity)
              from public.factory_product_stock_check_batch_adjustments adjustment
              where adjustment.stock_check_item_id = item.id
            ), 0) <> abs(item.variance_qty)
          )
        )
    ) into v_invalid;
    if v_invalid then
      raise exception 'Complete each counted item and resolve every variance before submitting.';
    end if;

    select exists (
      select 1
      from public.factory_product_stock_check_items item
      join public.factory_finished_goods sku on sku.id = item.finished_good_id
      join lateral (
        select row from jsonb_array_elements(p_rows) row
        where nullif(row->>'finished_good_id', '')::uuid = item.finished_good_id
        limit 1
      ) requested on true
      left join public.factory_finished_good_batch_balances selected_batch
        on selected_batch.id = nullif(requested.row->>'positive_adjustment_batch_balance_id', '')::uuid
      left join public.factory_storage_locations selected_location
        on selected_location.id = selected_batch.storage_location_id
      left join public.factory_storage_locations default_location
        on default_location.id = sku.storage_location_id
      where item.stock_check_id = v_saved_id
        and item.variance_qty > 0
        and (
          not coalesce(nullif(requested.row->>'positive_adjustment_confirmed', '')::boolean, false)
          or (
            selected_batch.id is not null
            and (selected_batch.finished_good_id <> item.finished_good_id
              or lower(coalesce(selected_location.status, '')) <> 'active'
              or selected_location.is_storage_location is not true)
          )
          or (
            selected_batch.id is null
            and (default_location.id is null
              or lower(coalesce(default_location.status, '')) <> 'active'
              or default_location.is_storage_location is not true)
          )
        )
    ) into v_invalid;
    if v_invalid then
      raise exception 'Choose a valid existing batch or configure an active storage location for the Reconciliation Batch before submitting.';
    end if;
  end if;

  update public.factory_product_stock_check_items item
  set positive_adjustment_confirmed = coalesce(nullif(requested.row->>'positive_adjustment_confirmed', '')::boolean, false),
      positive_adjustment_batch_balance_id = nullif(requested.row->>'positive_adjustment_batch_balance_id', '')::uuid,
      adjustment_storage_location_id = case
        when item.variance_qty > 0 and nullif(requested.row->>'positive_adjustment_batch_balance_id', '') is null then sku.storage_location_id
        else null
      end,
      updated_at = now()
  from public.factory_finished_goods sku
  join lateral (
    select row from jsonb_array_elements(p_rows) row
    where nullif(row->>'finished_good_id', '')::uuid = sku.id
    limit 1
  ) requested on true
  where item.stock_check_id = v_saved_id and item.finished_good_id = sku.id;

  if v_submitting then
    update public.factory_product_stock_checks stock_check
    set status = 'submitted',
        submitted_by = coalesce(p_created_by, feedx_integrations.fa_current_active_employee_id(p_machine_identity_id)),
        submitted_at = now(),
        updated_at = now()
    where stock_check.id = v_saved_id;
  end if;

  return query select stock_check.id, stock_check.check_no
  from public.factory_product_stock_checks stock_check where stock_check.id = v_saved_id;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_product_stock_check_structure(uuid,uuid,date,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_product_stock_check_structure(p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text, p_created_by uuid, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_product_stock_check_structure(null::uuid ,p_stock_check_id,p_check_date,p_notes,p_target_status,p_created_by,p_rows);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_raw_material_stock_check_structure(p_machine_identity_id uuid, p_stock_check_id uuid, p_category_id uuid, p_check_date date, p_notes text, p_target_status text, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id uuid := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id); v_check public.factory_raw_material_stock_checks%rowtype;
  v_check_id uuid; v_check_no text; v_status text := lower(coalesce(nullif(btrim(p_target_status), ''), 'draft'));
  v_row jsonb; v_material public.factory_raw_materials%rowtype; v_material_id uuid; v_system_qty numeric; v_physical_qty numeric;
  v_variance_qty numeric; v_variance_percent numeric; v_variance_status text; v_count_status text; v_reason text;
begin
  if v_status not in ('draft', 'submitted') then raise exception 'Raw Material Stock Check status must be Draft or Submitted.'; end if;
  if p_category_id is null or not exists (select 1 from public.factory_raw_material_categories category where category.id = p_category_id) then raise exception 'Select a valid Raw Material category.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Raw Material Stock Check requires at least one item.'; end if;
  if v_status = 'submitted' and not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_stock_check.submit') then raise exception using errcode = '42501', message = 'Insufficient permission to submit Raw Material Stock Check.'; end if;
  if p_stock_check_id is null then
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_stock_check.create') then raise exception using errcode = '42501', message = 'Insufficient permission to create Raw Material Stock Check.'; end if;
    insert into public.factory_raw_material_stock_checks (check_date, category_id, status, notes, created_by, created_at, updated_at) values (coalesce(p_check_date, timezone('Asia/Kuala_Lumpur', now())::date), p_category_id, 'draft', coalesce(p_notes, ''), v_actor_id, now(), now()) returning factory_raw_material_stock_checks.id, factory_raw_material_stock_checks.check_no into v_check_id, v_check_no;
  else
    if not (feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_stock_check.edit') or (v_status = 'submitted' and feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_stock_check.submit'))) then raise exception using errcode = '42501', message = 'Insufficient permission to edit Raw Material Stock Check.'; end if;
    select stock_check.* into v_check from public.factory_raw_material_stock_checks stock_check where stock_check.id = p_stock_check_id for update;
    if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then raise exception 'Only Draft Raw Material Stock Checks can be edited or submitted.'; end if;
    v_check_id := v_check.id; v_check_no := v_check.check_no;
    update public.factory_raw_material_stock_checks stock_check set check_date = coalesce(p_check_date, stock_check.check_date), category_id = p_category_id, notes = coalesce(p_notes, ''), updated_at = now() where stock_check.id = v_check_id;
  end if;
  delete from public.factory_raw_material_stock_check_items item where item.stock_check_id = v_check_id;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_material_id := nullif(v_row ->> 'raw_material_id', '')::uuid;
    if exists (select 1 from public.factory_raw_material_stock_check_items item where item.stock_check_id = v_check_id and item.raw_material_id = v_material_id) then raise exception 'Raw Material appears more than once in this Stock Check.'; end if;
    select material.* into v_material from public.factory_raw_materials material where material.id = v_material_id and material.category_id = p_category_id and lower(coalesce(material.status, '')) = 'active' for update;
    if v_material.id is null then raise exception 'Every Stock Check row requires an active Raw Material in the selected category.'; end if;
    v_system_qty := coalesce(v_material.current_balance, 0);
    v_count_status := lower(coalesce(nullif(btrim(v_row ->> 'count_status'), ''), case when nullif(v_row ->> 'physical_qty', '') is null then 'pending' else 'counted' end));
    if v_count_status not in ('pending', 'counted', 'skip', 'skipped') then raise exception 'Raw Material Stock Check count status is invalid.'; end if;
    if v_count_status in ('skip', 'skipped') then v_count_status := 'skip'; v_physical_qty := v_system_qty;
    elsif nullif(v_row ->> 'physical_qty', '') is null then v_count_status := 'pending'; v_physical_qty := v_system_qty;
    else v_count_status := 'counted'; v_physical_qty := (v_row ->> 'physical_qty')::numeric; if v_physical_qty < 0 then raise exception 'Physical count cannot be negative.'; end if; end if;
    v_variance_qty := case when v_count_status = 'counted' then v_physical_qty - v_system_qty else 0 end;
    v_variance_percent := case when v_system_qty > 0 then (v_variance_qty / v_system_qty) * 100 else 0 end;
    v_variance_status := case when v_count_status = 'skip' then 'Skipped' when v_variance_qty = 0 then 'Normal' when v_system_qty <= 0 or abs(v_variance_percent) >= 5 then 'Critical' else 'Variance' end;
    v_reason := nullif(btrim(coalesce(v_row ->> 'variance_reason', '')), '');
    if v_status = 'submitted' and v_count_status = 'pending' then raise exception 'Submit requires every Raw Material Stock Check row to be counted or skipped.'; end if;
    if v_status = 'submitted' and v_count_status = 'counted' and v_variance_qty <> 0 and v_reason is null then raise exception 'Variance reason is required for Raw Material Stock Check adjustments.'; end if;
    insert into public.factory_raw_material_stock_check_items (stock_check_id, raw_material_id, system_qty, physical_qty, variance_qty, variance_percent, count_status, variance_status, variance_reason, uom, created_at, updated_at) values (v_check_id, v_material.id, v_system_qty, v_physical_qty, v_variance_qty, v_variance_percent, v_count_status, v_variance_status, coalesce(v_reason, ''), v_material.uom, now(), now());
  end loop;
  if v_status = 'submitted' then update public.factory_raw_material_stock_checks stock_check set status = 'submitted', submitted_by = v_actor_id, submitted_at = now(), updated_at = now() where stock_check.id = v_check_id and lower(stock_check.status) = 'draft'; if not found then raise exception 'Raw Material Stock Check is no longer Draft.'; end if; end if;
  return query select v_check_id, v_check_no;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_raw_material_stock_check_structure(uuid,uuid,uuid,date,text,text,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_raw_material_stock_check_structure(p_stock_check_id uuid, p_category_id uuid, p_check_date date, p_notes text, p_target_status text, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_raw_material_stock_check_structure(null::uuid ,p_stock_check_id,p_category_id,p_check_date,p_notes,p_target_status,p_rows);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_verify_production_record(p_machine_identity_id uuid, p_production_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor_id uuid := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  v_production public.factory_productions%rowtype;
begin
  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.verify') then
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
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_verify_production_record(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_verify_production_record(p_production_id uuid)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_verify_production_record(null::uuid ,p_production_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_verify_raw_material_receiving(p_machine_identity_id uuid, p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_batch public.factory_raw_material_receiving_batches%rowtype;
begin
  if (p_machine_identity_id is null and auth.uid() is null) or not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.verify') then
    raise exception using errcode = '42501', message = 'Missing permission to verify Raw Material Receiving.';
  end if;

  select employee.* into v_actor from public.employees employee
  where employee.auth_user_id = auth.uid() and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id limit 1;
  if p_machine_identity_id is null and not found then raise exception using errcode = '42501', message = 'An active employee profile is required to verify Raw Material Receiving.'; end if;

  select batch_row.* into v_batch from public.factory_raw_material_receiving_batches batch_row
  where batch_row.id = p_batch_id for update;
  if not found then raise exception 'Raw Material Receiving was not found.'; end if;
  if v_batch.verification_status = 'verified' then return public.factory_raw_receiving_payload(v_batch.id); end if;
  if v_batch.status <> 'completed' or v_batch.verification_status <> 'awaiting_verification' then
    raise exception 'Only completed Receiving awaiting verification can be verified.';
  end if;
  if v_batch.completed_by = v_actor.id then
    raise exception using errcode = '42501', message = 'Received By cannot verify the same Receiving.';
  end if;

  update public.factory_raw_material_receiving_batches
  set verification_status = 'verified', verified_by = v_actor.id, verified_at = now(), updated_at = now()
  where id = v_batch.id;
  return public.factory_raw_receiving_payload(v_batch.id);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_verify_raw_material_receiving(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_verify_raw_material_receiving(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_verify_raw_material_receiving(null::uuid ,p_batch_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_cancel_raw_material_receiving(p_machine_identity_id uuid, p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_batch public.factory_raw_material_receiving_batches%rowtype;
begin
  if (p_machine_identity_id is null and auth.uid() is null) or not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.delete') then
    raise exception using errcode = '42501', message = 'Missing permission to cancel Raw Material Receiving.';
  end if;
  select employee.* into v_actor from public.employees employee
  where employee.auth_user_id = auth.uid() and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id limit 1;
  if p_machine_identity_id is null and not found then raise exception using errcode = '42501', message = 'An active employee profile is required to cancel Raw Material Receiving.'; end if;

  select batch_row.* into v_batch from public.factory_raw_material_receiving_batches batch_row
  where batch_row.id = p_batch_id for update;
  if not found then raise exception 'Raw Material Receiving was not found.'; end if;
  if lower(coalesce(v_batch.status, '')) <> 'draft' then raise exception 'Only Draft Raw Material Receiving can be cancelled.'; end if;
  if exists (
    select 1 from public.factory_raw_material_movements movement
    join public.factory_raw_material_receivings item on item.id = movement.reference_id
    where item.batch_id = v_batch.id and movement.reference_type = 'raw_material_receiving'
  ) then raise exception 'Raw Material Receiving with stock history cannot be cancelled.'; end if;

  update public.factory_raw_material_receiving_batches
  set status = 'cancelled', cancelled_by = v_actor.id, cancelled_at = now(), updated_at = now()
  where id = v_batch.id;
  return public.factory_raw_receiving_payload(v_batch.id);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_cancel_raw_material_receiving(uuid,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_cancel_raw_material_receiving(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_cancel_raw_material_receiving(null::uuid ,p_batch_id);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_complete_production_with_raw_batch_allocations(p_machine_identity_id uuid, p_request_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_employee_id uuid;
  v_employee_name text;
  v_production_id uuid;
  v_authoritative_payload jsonb;
  v_recipe_id uuid := nullif(p_payload->>'recipe_id', '')::uuid;
begin
  v_employee_id := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  v_employee_name := feedx_integrations.fa_current_active_employee_name(p_machine_identity_id);
  v_authoritative_payload := (p_payload - 'operator_id' - 'operator_name' - 'recipe_id') || jsonb_build_object('operator_id', v_employee_id, 'operator_name', v_employee_name);
  perform public.factory_validate_production_usage_precision_internal(coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  if v_recipe_id is not null then
    perform public.factory_validate_production_recipe_usage_internal(v_recipe_id, nullif(v_authoritative_payload->>'actual_output_qty', '')::numeric, coalesce(v_authoritative_payload->'usage_items', '[]'::jsonb));
  end if;
  v_production_id := feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(p_machine_identity_id, p_request_id, v_authoritative_payload);
  perform public.factory_mesti_materialize_equipment_cleaning_after_production(v_production_id);
  return v_production_id;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_complete_production_with_raw_batch_allocations(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_complete_production_with_raw_batch_allocations(p_request_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_complete_production_with_raw_batch_allocations(null::uuid ,p_request_id,p_payload);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(p_machine_identity_id uuid, p_request_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_productions%rowtype;
  v_job public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_production_id uuid;
  v_usage_id uuid;
  v_usage jsonb;
  v_allocation jsonb;
  v_material public.factory_raw_materials%rowtype;
  v_batch public.factory_raw_material_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_canonical jsonb;
  v_items jsonb;
  v_allocations jsonb;
  v_fingerprint text;
  v_actual numeric;
  v_standard numeric;
  v_variance numeric;
  v_allocation_qty numeric;
  v_allocated numeric;
  v_available numeric;
  v_actual_pack_qty numeric;
  v_actual_output_qty numeric;
  v_expected_output_qty numeric;
  v_expected_output_uom text;
  v_production_no text;
  v_production_date date;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if p_request_id is null then raise exception 'Production completion request ID is required.'; end if;
  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.complete') then
    raise exception using errcode = '42501', message = 'Insufficient permission to complete Production.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid() and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;
  if p_machine_identity_id is null and v_actor.id is null then raise exception using errcode = '42501', message = 'An active employee profile is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('factory-production-complete:' || p_request_id::text, 0));

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'raw_material_id', (item->>'raw_material_id')::uuid,
      'standard_usage', coalesce(nullif(item->>'standard_usage', '')::numeric, 0),
      'actual_usage', coalesce(nullif(item->>'actual_usage', '')::numeric, 0),
      'uom', nullif(lower(btrim(item->>'uom')), ''),
      'variance_reason', nullif(btrim(item->>'variance_reason'), ''),
      'wastage_quantity', coalesce(nullif(item->>'wastage_quantity', '')::numeric, 0),
      'notes', nullif(btrim(item->>'notes'), ''),
      'allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'batch_balance_id', (allocation->>'batch_balance_id')::uuid,
          'allocated_qty', (allocation->>'allocated_qty')::numeric
        ) order by (allocation->>'batch_balance_id')::uuid, (allocation->>'allocated_qty')::numeric)
        from jsonb_array_elements(coalesce(item->'allocations', '[]'::jsonb)) allocation
      ), '[]'::jsonb)
    ) order by (item->>'raw_material_id')::uuid,
      coalesce(nullif(item->>'actual_usage', '')::numeric, 0),
      coalesce(nullif(item->>'standard_usage', '')::numeric, 0),
      coalesce(nullif(lower(btrim(item->>'uom')), ''), ''),
      coalesce(nullif(btrim(item->>'variance_reason'), ''), ''),
      coalesce(nullif(item->>'wastage_quantity', '')::numeric, 0),
      coalesce(nullif(btrim(item->>'notes'), ''), ''),
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'batch_balance_id', (allocation->>'batch_balance_id')::uuid,
          'allocated_qty', (allocation->>'allocated_qty')::numeric
        ) order by (allocation->>'batch_balance_id')::uuid, (allocation->>'allocated_qty')::numeric)::text
        from jsonb_array_elements(coalesce(item->'allocations', '[]'::jsonb)) allocation
      ), '[]')
  ), '[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(p_payload->'usage_items', '[]'::jsonb)) item;

  v_canonical := jsonb_build_object(
    'job_order_id', (p_payload->>'job_order_id')::uuid,
    'finished_good_id', (p_payload->>'finished_good_id')::uuid,
    'batch_no', nullif(btrim(p_payload->>'batch_no'), ''),
    'end_date', (p_payload->>'end_date')::date,
    'end_time', (p_payload->>'end_time')::time,
    'expiry_date', nullif(p_payload->>'expiry_date', '')::date,
    'storage_location_id', nullif(p_payload->>'storage_location_id', '')::uuid,
    'operator_id', nullif(p_payload->>'operator_id', '')::uuid,
    'operator_name', nullif(btrim(p_payload->>'operator_name'), ''),
    'expiry_override_reason', nullif(btrim(p_payload->>'expiry_override_reason'), ''),
    'actual_pack_qty', (p_payload->>'actual_pack_qty')::numeric,
    'actual_output_qty', (p_payload->>'actual_output_qty')::numeric,
    'uom', nullif(lower(btrim(p_payload->>'uom')), ''),
    'notes', nullif(btrim(p_payload->>'notes'), ''),
    'usage_items', v_items
  );
  v_fingerprint := encode(extensions.digest(v_canonical::text, 'sha256'::text), 'hex');

  select production.* into v_existing
  from public.factory_productions production
  where production.completion_request_id = p_request_id
  for update;
  if v_existing.id is not null then
    if v_existing.completion_payload_fingerprint is distinct from v_fingerprint then
      raise exception 'This Production request was already completed with different details.';
    end if;
    return v_existing.id;
  end if;

  select job.* into v_job from public.factory_job_orders job
  where job.id = (p_payload->>'job_order_id')::uuid for update;
  if v_job.id is null then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job.status, '')) <> 'in_progress' then raise exception 'Only In Progress Job Orders can be completed.'; end if;
  if exists (select 1 from public.factory_productions production where production.job_order_id = v_job.id and lower(coalesce(production.status, '')) = 'completed') then
    raise exception 'This Job Order already has a completed Production record.';
  end if;

  select finished_good.* into v_finished_good from public.factory_finished_goods finished_good
  where finished_good.id = (p_payload->>'finished_good_id')::uuid for update;
  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active'
     or v_finished_good.id is distinct from v_job.finished_good_id then
    raise exception 'Production Packaging SKU must be active and match the Job Order.';
  end if;

  v_actual_pack_qty := (p_payload->>'actual_pack_qty')::numeric;
  if v_actual_pack_qty <= 0 or v_actual_pack_qty <> trunc(v_actual_pack_qty) then raise exception 'Actual Pack Qty must be a whole number greater than 0.'; end if;
  select plan.target_production_qty, plan.production_uom into v_expected_output_qty, v_expected_output_uom
  from public.factory_packaging_production_plan(
    v_actual_pack_qty, coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
    coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom), p_payload->>'uom'
  ) plan;
  v_actual_output_qty := (p_payload->>'actual_output_qty')::numeric;
  if abs(v_actual_output_qty - v_expected_output_qty) > 0.000001 then raise exception 'Actual Output Qty does not match Packaging SKU Pack Size.'; end if;
  if coalesce(jsonb_array_length(p_payload->'usage_items'), 0) = 0 then raise exception 'At least one material usage row is required.'; end if;

  -- Acquire shared inventory locks in one deterministic order to avoid cross-Production deadlocks.
  perform material.id
  from public.factory_raw_materials material
  where material.id in (
    select distinct (usage_row->>'raw_material_id')::uuid
    from jsonb_array_elements(p_payload->'usage_items') usage_row
  )
  order by material.id
  for update;
  perform balance.id
  from public.factory_raw_material_batch_balances balance
  where balance.id in (
    select distinct (allocation->>'batch_balance_id')::uuid
    from jsonb_array_elements(p_payload->'usage_items') usage_row
    cross join lateral jsonb_array_elements(coalesce(usage_row->'allocations', '[]'::jsonb)) allocation
  )
  order by balance.id
  for update;

  v_production_date := v_job.production_date;
  if v_production_date is null or v_job.start_time is null then raise exception 'Job Order Production Date and Start Time are required.'; end if;
  if (p_payload->>'end_date')::date < v_production_date
     or ((p_payload->>'end_date')::date = v_production_date and (p_payload->>'end_time')::time < v_job.start_time) then
    raise exception 'Production End Date and Time cannot be earlier than Start Date and Time.';
  end if;

  perform set_config('feedx.production_end_date', p_payload->>'end_date', true);
  perform set_config('feedx.production_expiry_date', coalesce(p_payload->>'expiry_date', ''), true);
  perform set_config('feedx.production_storage_location_id', coalesce(p_payload->>'storage_location_id', ''), true);
  perform set_config('feedx.production_expiry_override_reason', coalesce(p_payload->>'expiry_override_reason', ''), true);
  v_production_no := coalesce(nullif(btrim(p_payload->>'production_no'), ''), 'PRD-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'));

  insert into public.factory_productions (
    job_order_id, finished_good_id, production_no, product_name, batch_no,
    actual_pack_qty, actual_output_qty, produced_quantity, actual_produced_qty, good_output_qty,
    wastage_qty, uom, production_date, operator_id, operator_name, start_time, end_time,
    qc_status, production_sop_id, sop_version, status, notes, created_by, completed_at, updated_at,
    completion_request_id, completion_payload_fingerprint
  ) values (
    v_job.id, v_finished_good.id, v_production_no, v_finished_good.product_name,
    nullif(btrim(p_payload->>'batch_no'), ''), v_actual_pack_qty, v_expected_output_qty,
    v_expected_output_qty, v_expected_output_qty, v_expected_output_qty, 0, v_expected_output_uom,
    v_production_date, coalesce(nullif(p_payload->>'operator_id', '')::uuid, v_job.production_operator_id, v_actor.id),
    coalesce(nullif(btrim(p_payload->>'operator_name'), ''), v_job.production_operator_name),
    v_job.start_time, (p_payload->>'end_time')::time, 'Pending', null, '', 'completed',
    nullif(btrim(p_payload->>'notes'), ''), v_actor.id, now(), now(), p_request_id, v_fingerprint
  ) returning id into v_production_id;

  for v_usage in select value from jsonb_array_elements(p_payload->'usage_items') loop
    select material.* into v_material from public.factory_raw_materials material
    where material.id = (v_usage->>'raw_material_id')::uuid for update;
    if v_material.id is null or lower(coalesce(v_material.status, '')) <> 'active' then raise exception 'Every Production usage row requires an active Raw Material.'; end if;
    v_standard := coalesce(nullif(v_usage->>'standard_usage', '')::numeric, 0);
    v_actual := coalesce(nullif(v_usage->>'actual_usage', '')::numeric, 0);
    if v_actual < 0 then raise exception 'Actual usage cannot be negative.'; end if;
    v_variance := v_actual - v_standard;
    if abs(v_variance) > 0.000001 and nullif(btrim(v_usage->>'variance_reason'), '') is null then raise exception 'Variance reason is required when actual usage differs from standard usage.'; end if;
    select coalesce(sum((entry->>'allocated_qty')::numeric), 0) into v_allocated
    from jsonb_array_elements(coalesce(v_usage->'allocations', '[]'::jsonb)) entry;
    if abs(v_allocated - v_actual) > 0.000001 then raise exception 'Raw Material batch allocation must equal Actual Used.'; end if;
    select least(
      greatest(coalesce(v_material.current_balance, 0), 0),
      coalesce(sum(balance.current_balance), 0)
    ) into v_available
    from public.factory_raw_material_batch_balances balance
    join public.factory_storage_locations location
      on location.id = balance.storage_location_id and lower(coalesce(location.status, '')) = 'active'
    where balance.raw_material_id = v_material.id
      and balance.source_type in ('receiving', 'stock_check_adjustment')
      and balance.status = 'active'
      and balance.current_balance > 0
      and nullif(lower(btrim(balance.uom)), '') = nullif(lower(btrim(coalesce(v_usage->>'uom', v_material.uom))), '')
      and (balance.expiry_date is null or balance.expiry_date >= v_production_date);
    if v_available < v_actual then
      raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, v_available;
    end if;

    insert into public.factory_production_material_usage (
      production_id, raw_material_id, quantity_used, standard_usage, actual_usage,
      variance_qty, variance_percent, variance_reason, uom, wastage_quantity, notes, updated_at
    ) values (
      v_production_id, v_material.id, v_actual, v_standard, v_actual, v_variance,
      case when v_standard = 0 then case when v_actual = 0 then 0 else 100 end else (v_variance / v_standard) * 100 end,
      nullif(btrim(v_usage->>'variance_reason'), ''), coalesce(nullif(v_usage->>'uom', ''), v_material.uom),
      coalesce(nullif(v_usage->>'wastage_quantity', '')::numeric, 0), nullif(btrim(v_usage->>'notes'), ''), now()
    ) returning id into v_usage_id;

    for v_allocation in select value from jsonb_array_elements(coalesce(v_usage->'allocations', '[]'::jsonb)) loop
      v_allocation_qty := (v_allocation->>'allocated_qty')::numeric;
      select balance.* into v_batch from public.factory_raw_material_batch_balances balance
      where balance.id = (v_allocation->>'batch_balance_id')::uuid for update;
      select location.* into v_location from public.factory_storage_locations location where location.id = v_batch.storage_location_id;
      with eligible as (
        select candidate.id, candidate.current_balance,
          coalesce(sum(candidate.current_balance) over (
            partition by candidate.raw_material_id
            order by candidate.expiry_date asc nulls last, candidate.received_date asc nulls last,
              candidate.manufacturing_date asc nulls last, candidate.internal_batch_no asc, candidate.id asc
            rows between unbounded preceding and 1 preceding
          ), 0) as earlier_balance
        from public.factory_raw_material_batch_balances candidate
        join public.factory_storage_locations candidate_location
          on candidate_location.id = candidate.storage_location_id
         and lower(coalesce(candidate_location.status, '')) = 'active'
        where candidate.raw_material_id = v_material.id
          and candidate.source_type in ('receiving', 'stock_check_adjustment')
          and candidate.status = 'active'
          and candidate.current_balance > 0
          and nullif(lower(btrim(candidate.uom)), '') = nullif(lower(btrim(coalesce(v_usage->>'uom', v_material.uom))), '')
          and (candidate.expiry_date is null or candidate.expiry_date >= v_production_date)
      )
      select greatest(least(eligible.current_balance,
        greatest(coalesce(v_material.current_balance, 0), 0) - eligible.earlier_balance), 0)
      into v_available
      from eligible where eligible.id = v_batch.id;
      if v_allocation_qty <= 0 or v_batch.id is null or v_batch.raw_material_id is distinct from v_material.id
         or v_batch.source_type not in ('receiving', 'stock_check_adjustment') or v_batch.status <> 'active'
         or coalesce(v_available, 0) < v_allocation_qty
         or lower(btrim(v_batch.uom)) <> lower(btrim(coalesce(v_usage->>'uom', v_material.uom)))
         or v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
         or (v_batch.expiry_date is not null and v_batch.expiry_date < v_production_date) then
        select least(greatest(coalesce(v_material.current_balance, 0), 0), coalesce(sum(balance.current_balance), 0)) into v_available
        from public.factory_raw_material_batch_balances balance
        join public.factory_storage_locations location on location.id = balance.storage_location_id and lower(coalesce(location.status, '')) = 'active'
        where balance.raw_material_id = v_material.id and balance.source_type in ('receiving', 'stock_check_adjustment')
          and balance.status = 'active' and balance.current_balance > 0
          and lower(btrim(balance.uom)) = lower(btrim(coalesce(v_usage->>'uom', v_material.uom)))
          and (balance.expiry_date is null or balance.expiry_date >= v_production_date);
        raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, v_available;
      end if;

      insert into public.factory_production_material_usage_batch_allocations (
        production_material_usage_id, raw_material_batch_balance_id, allocated_qty
      ) values (v_usage_id, v_batch.id, v_allocation_qty);
      update public.factory_raw_material_batch_balances
      set current_balance = current_balance - v_allocation_qty, updated_at = now()
      where id = v_batch.id;
      update public.factory_raw_materials
      set current_balance = current_balance - v_allocation_qty, updated_at = now()
      where id = v_material.id and current_balance >= v_allocation_qty;
      if not found then
        raise exception 'Insufficient Raw Material batch stock for %. Required %, available %.', v_material.name, v_actual, greatest(coalesce(v_material.current_balance, 0), 0);
      end if;
      v_material.current_balance := v_material.current_balance - v_allocation_qty;
      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by,
        production_material_usage_id, raw_material_batch_balance_id
      ) values (
        v_material.id, 'Production Usage', -v_allocation_qty, coalesce(nullif(v_usage->>'uom', ''), v_material.uom),
        'production', v_production_id, v_production_no, v_production_date,
        'Raw material deducted from exact Production batch allocation.', v_actor.id,
        v_usage_id, v_batch.id
      );
    end loop;
  end loop;

  perform public.factory_adjust_finished_good_balance(v_finished_good.id, v_actual_pack_qty);
  insert into public.factory_product_stock_movements (
    finished_good_id, product_name, movement_type, quantity, uom, reference_type,
    reference_id, reference_no, movement_date, notes, created_by
  ) values (
    v_finished_good.id, v_finished_good.product_name, 'Production Stock In', v_actual_pack_qty,
    coalesce(v_finished_good.uom, 'packs'), 'production', v_production_id, v_production_no,
    v_production_date, 'Finished goods Packaging SKU stocked in from completed Production.', v_actor.id
  );
  update public.factory_job_orders
  set status = 'completed', produced_quantity = v_expected_output_qty,
      product_name = v_finished_good.product_name, uom = v_expected_output_uom,
      completed_at = now(), completed_by = v_actor.id, updated_at = now()
  where id = v_job.id and lower(status) = 'in_progress';
  if not found then raise exception 'Unable to complete Job Order because it is no longer In Progress.'; end if;
  return v_production_id;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_complete_production_with_raw_batch_allocations_impl_050(p_request_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(null::uuid ,p_request_id,p_payload);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(p_machine_identity_id uuid, p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text, p_created_by uuid, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_check_id uuid;
  v_check_no text;
  v_date date := coalesce(p_check_date, current_date);
  v_status text := lower(coalesce(p_target_status, 'draft'));
  v_prefix text := 'FGSC' || to_char(coalesce(p_check_date, current_date), 'YYMMDD');
  v_next integer;
  v_row jsonb;
  v_allocation jsonb;
  v_finished_good public.factory_finished_goods%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_item_id uuid;
  v_finished_good_id uuid;
  v_physical_qty numeric;
  v_system_qty numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_status text;
  v_count_status text;
  v_is_skipped boolean;
  v_positive_adjustment_confirmed boolean;
  v_reason text;
  v_adjustment_location_id uuid;
  v_batch_total numeric;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_batch_id uuid;
  v_allocation_qty numeric;
  v_allocation_total numeric;
begin
  if v_status not in ('draft', 'submitted') then
    raise exception 'Product Stock Check status must be Draft or Submitted.';
  end if;
  if v_status = 'submitted'
    and not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Product Stock Check.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Product Stock Check requires at least one item.';
  end if;

  if p_stock_check_id is null then
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.create') then
      raise exception using errcode = '42501', message = 'Insufficient permission to create Product Stock Check.';
    end if;
    perform pg_advisory_xact_lock(hashtext('factory_product_stock_check_' || v_prefix));
    select coalesce(max(nullif(regexp_replace(stock_check.check_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
    into v_next from public.factory_product_stock_checks stock_check
    where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');
    v_check_no := v_prefix || '-' || lpad(v_next::text, 2, '0');
    insert into public.factory_product_stock_checks (
      check_no, check_date, status, notes, created_by, submitted_by, submitted_at, created_at, updated_at
    ) values (
      v_check_no, v_date, 'draft', coalesce(p_notes, ''), feedx_integrations.fa_current_active_employee_id(p_machine_identity_id),
      case when v_status = 'submitted' then feedx_integrations.fa_current_active_employee_id(p_machine_identity_id) end,
      case when v_status = 'submitted' then now() end, now(), now()
    ) returning factory_product_stock_checks.id into v_check_id;
  else
    if not (
      feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.edit')
      or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_product_stock_check.submit')
    ) then raise exception using errcode = '42501', message = 'Insufficient permission to edit Product Stock Check.'; end if;
    select * into v_check from public.factory_product_stock_checks
    where factory_product_stock_checks.id = p_stock_check_id for update;
    if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then
      raise exception 'Only Draft Product Stock Checks can be edited or submitted.';
    end if;
    v_check_id := v_check.id;
    v_check_no := v_check.check_no;
    update public.factory_product_stock_checks
    set check_date = v_date, notes = coalesce(p_notes, ''), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;

  delete from public.factory_product_stock_check_items stock_item
  where stock_item.stock_check_id = v_check_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_finished_good_id := nullif(v_row->>'finished_good_id', '')::uuid;
    if exists (
      select 1 from public.factory_product_stock_check_items stock_item
      where stock_item.stock_check_id = v_check_id
        and stock_item.finished_good_id = v_finished_good_id
    ) then raise exception 'Packaging SKU appears more than once in Product Stock Check.'; end if;
    select * into v_finished_good from public.factory_finished_goods
    where factory_finished_goods.id = v_finished_good_id for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    v_system_qty := coalesce(v_finished_good.current_balance, 0);
    if v_system_qty <> trunc(v_system_qty) then
      raise exception 'Packaging SKU system balance must be a whole number before Stock Check.';
    end if;
    v_is_skipped := coalesce(nullif(v_row->>'is_skipped', '')::boolean, false)
      or lower(coalesce(v_row->>'count_status', '')) = 'skip';
    v_count_status := case
      when v_is_skipped then 'skip'
      when not (v_row ? 'physical_qty') or v_row->>'physical_qty' is null then 'pending'
      else 'counted'
    end;
    v_positive_adjustment_confirmed := coalesce(nullif(v_row->>'positive_adjustment_confirmed', '')::boolean, false);
    if v_status = 'submitted' and not v_is_skipped
      and (not (v_row ? 'physical_qty') or v_row->>'physical_qty' is null) then
      raise exception 'Physical Qty is required before submitting Product Stock Check.';
    end if;
    v_physical_qty := case when v_is_skipped
      then v_system_qty
      else coalesce(nullif(v_row->>'physical_qty', '')::numeric, v_system_qty)
    end;
    if v_physical_qty < 0 or v_physical_qty <> trunc(v_physical_qty) then
      raise exception 'Physical Qty must be a whole number.';
    end if;
    v_variance_qty := v_physical_qty - v_system_qty;
    if v_status = 'submitted' and not v_is_skipped and v_variance_qty <> 0 then
      select coalesce(sum(balance.current_balance), 0) into v_batch_total
      from public.factory_finished_good_batch_balances balance
      where balance.finished_good_id = v_finished_good.id;
      if abs(v_batch_total - v_system_qty) > 0.0001 then
        raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before submitting.',
          coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
      end if;
    end if;
    v_variance_percent := case when v_system_qty = 0
      then case when v_variance_qty = 0 then 0 else 100 end
      else (v_variance_qty / v_system_qty) * 100 end;
    v_variance_status := case
      when v_is_skipped then 'Skipped'
      when v_count_status = 'pending' then 'Pending'
      when v_variance_qty = 0 then 'Normal'
      when v_system_qty <= 0 or abs(v_variance_percent) >= 10 then 'Critical'
      else 'Variance' end;
    v_reason := btrim(coalesce(v_row->>'variance_reason', ''));
    if v_status = 'submitted' and v_variance_qty <> 0 and v_reason = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    v_adjustment_location_id := null;
    if v_variance_qty > 0 then
      if v_status = 'submitted' and not v_positive_adjustment_confirmed then
        raise exception 'Assign an Adjustment Batch before submitting a positive Product Stock Check variance.';
      end if;
      if v_positive_adjustment_confirmed then
        select location.* into v_location from public.factory_storage_locations location
        where location.id = v_finished_good.storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
          or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
          raise exception 'Positive Product Stock Check variance requires an active Finished Goods default storage location.';
        end if;
        v_adjustment_location_id := v_location.id;
      end if;
    end if;
    insert into public.factory_product_stock_check_items (
      stock_check_id, finished_good_id, system_qty, physical_qty, variance_qty,
      variance_percent, variance_status, count_status, variance_reason, uom,
      adjustment_storage_location_id, positive_adjustment_confirmed, created_at, updated_at
    ) values (
      v_check_id, v_finished_good.id, v_system_qty, v_physical_qty, v_variance_qty,
      v_variance_percent, v_variance_status, v_count_status, v_reason, 'Packs',
      v_adjustment_location_id, v_positive_adjustment_confirmed, now(), now()
    ) returning factory_product_stock_check_items.id into v_item_id;

    v_allocation_total := 0;
    for v_allocation in select * from jsonb_array_elements(coalesce(v_row->'allocations', '[]'::jsonb)) loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_qty := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_qty is null or v_allocation_qty <= 0
        or v_allocation_qty <> trunc(v_allocation_qty) then
        raise exception 'Batch reduction quantities must be whole numbers greater than 0.';
      end if;
      select balance.* into v_batch
      from public.factory_finished_good_batch_balances balance
      where balance.id = v_batch_id for update;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good.id then
        raise exception 'Stock Check batch does not belong to the selected Packaging SKU.';
      end if;
      if v_batch.current_balance < v_allocation_qty then
        raise exception 'Stock Check batch allocation exceeds its current balance.';
      end if;
      select location.* into v_location
      from public.factory_storage_locations location
      where location.id = v_batch.storage_location_id;
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
      end if;
      insert into public.factory_product_stock_check_batch_adjustments
        (stock_check_item_id, batch_balance_id, quantity)
      values (v_item_id, v_batch.id, v_allocation_qty);
      v_allocation_total := v_allocation_total + v_allocation_qty;
    end loop;
    if v_variance_qty < 0 and v_allocation_total > abs(v_variance_qty) then
      raise exception 'Batch reductions cannot exceed the negative Product Stock Check variance.';
    end if;
    if v_status = 'submitted' and v_variance_qty < 0
      and v_allocation_total <> abs(v_variance_qty) then
      raise exception 'Resolve the full pack difference before submitting.';
    end if;
    if v_variance_qty >= 0 and v_allocation_total <> 0 then
      raise exception 'Batch reductions are only allowed for negative Product Stock Check variance.';
    end if;
  end loop;

  if v_status = 'submitted' then
    update public.factory_product_stock_checks
    set status = 'submitted', submitted_by = feedx_integrations.fa_current_active_employee_id(p_machine_identity_id),
      submitted_at = now(), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;
  return query select v_check_id, v_check_no;
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(uuid,uuid,date,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_product_stock_check_structure_business_no_v1(p_stock_check_id uuid, p_check_date date, p_notes text, p_target_status text, p_created_by uuid, p_rows jsonb)
 RETURNS TABLE(id uuid, check_no text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_product_stock_check_structure_business_no_v1(null::uuid ,p_stock_check_id,p_check_date,p_notes,p_target_status,p_created_by,p_rows);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_production_qc_progress(p_machine_identity_id uuid, p_job_order_id uuid, p_steps jsonb, p_results jsonb, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_item jsonb;
  v_status text;
  v_result text;
  v_remarks text;
  v_qc_type text;
  v_required boolean;
  v_existing_step_status text;
  v_existing_result text;
  v_existing_remarks text;
  v_changed boolean := false;
  v_previous_status text;
  v_current_status text;
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_required_total integer;
  v_required_completed integer;
begin
  if not (
    feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.complete')
    or feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.edit')
  ) then
    raise exception 'Missing permission to update Production QC.';
  end if;

  select jo.* into v_job_order
  from public.factory_job_orders jo
  where jo.id = p_job_order_id
  for update;
  if not found then raise exception 'Job Order was not found.'; end if;
  if lower(coalesce(v_job_order.status, '')) <> 'in_progress' then
    raise exception 'Production QC can only be updated while the Job Order is In Progress.';
  end if;
  if v_job_order.qc_snapshot_created_at is null then
    raise exception 'This legacy production has no QC execution snapshot.';
  end if;

  v_previous_status := public.factory_get_production_qc_status(p_job_order_id, null);

  for v_item in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_status := lower(coalesce(v_item->>'status', 'pending'));
    if v_status not in ('pending', 'completed') then raise exception 'Invalid production step status.'; end if;

    select execution.status into v_existing_step_status
    from public.factory_production_step_executions execution
    where execution.id = nullif(v_item->>'id', '')::uuid
      and execution.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'Production step does not belong to this Job Order.'; end if;

    if v_existing_step_status is distinct from v_status then
      update public.factory_production_step_executions execution
      set status = v_status,
          completed_by = case when v_status = 'completed' then coalesce(feedx_integrations.fa_current_active_employee_id(p_machine_identity_id), execution.completed_by) else null end,
          completed_at = case when v_status = 'completed' then coalesce(execution.completed_at, now()) else null end,
          updated_at = now()
      where execution.id = nullif(v_item->>'id', '')::uuid
        and execution.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    select result.qc_type, result.is_required, result.checklist_result,
           nullif(btrim(coalesce(result.remarks, '')), '')
    into v_qc_type, v_required, v_existing_result, v_existing_remarks
    from public.factory_production_qc_results result
    where result.id = nullif(v_item->>'id', '')::uuid
      and result.job_order_id = p_job_order_id
    for update;
    if not found then raise exception 'QC result does not belong to this Job Order.'; end if;

    v_result := nullif(lower(btrim(coalesce(v_item->>'checklist_result', ''))), '');
    v_remarks := nullif(btrim(coalesce(v_item->>'remarks', '')), '');
    if v_qc_type = 'checklist' and v_result is not null and v_result not in ('pass', 'fail', 'na') then
      raise exception 'Checklist result must be Pass, Fail or N/A.';
    end if;
    if v_qc_type = 'remarks' then v_result := null; end if;
    if v_result = 'na' and v_remarks is null then
      raise exception 'Add a reason when selecting N/A.';
    end if;

    if v_existing_result is distinct from v_result or v_existing_remarks is distinct from v_remarks then
      update public.factory_production_qc_results result
      set checklist_result = v_result,
          remarks = v_remarks,
          checked_by = case when v_result is not null or v_remarks is not null then coalesce(feedx_integrations.fa_current_active_employee_id(p_machine_identity_id), result.checked_by) else null end,
          checked_by_name = case when v_result is not null or v_remarks is not null then coalesce(nullif(btrim(coalesce(feedx_integrations.fa_current_active_employee_name(p_machine_identity_id), '')), ''), result.checked_by_name) else null end,
          checked_at = case when v_result is not null or v_remarks is not null then now() else null end,
          updated_at = now()
      where result.id = nullif(v_item->>'id', '')::uuid
        and result.job_order_id = p_job_order_id;
      v_changed := true;
    end if;
  end loop;

  select count(*),
         count(*) filter (where (qc_type = 'checklist' and checklist_result is not null) or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)),
         count(*) filter (where qc_type = 'checklist' and checklist_result = 'fail'),
         count(*) filter (where is_required),
         count(*) filter (where is_required and (
           (qc_type = 'checklist' and checklist_result is not null and (checklist_result <> 'na' or nullif(btrim(coalesce(remarks, '')), '') is not null))
           or (qc_type = 'remarks' and nullif(btrim(coalesce(remarks, '')), '') is not null)
         ))
  into v_total, v_completed, v_failed, v_required_total, v_required_completed
  from public.factory_production_qc_results result
  where result.job_order_id = p_job_order_id;

  v_current_status := public.factory_get_production_qc_status(p_job_order_id, null);

  return jsonb_build_object(
    'changed', v_changed or v_previous_status is distinct from v_current_status,
    'previous_status', v_previous_status,
    'current_status', v_current_status,
    'total', v_total,
    'completed', v_completed,
    'failed', v_failed,
    'required_total', v_required_total,
    'required_completed', v_required_completed
  );
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_production_qc_progress(uuid,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_production_qc_progress(p_job_order_id uuid, p_steps jsonb, p_results jsonb, p_actor_id uuid DEFAULT NULL::uuid, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_production_qc_progress(null::uuid ,p_job_order_id,p_steps,p_results,p_actor_id,p_actor_name);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_raw_material_receiving(p_machine_identity_id uuid, p_batch_id uuid, p_request_id uuid, p_supplier_id uuid, p_reference_no text, p_received_date date, p_remarks text, p_items jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_raw_material_id uuid;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using errcode = '42501', message = 'Authentication is required to save Raw Material Receiving.';
  end if;

  if p_batch_id is null then
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.create') then
      raise exception using errcode = '42501', message = 'Missing permission to create Raw Material Receiving.';
    end if;
  elsif not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.edit') then
    raise exception using errcode = '42501', message = 'Missing permission to edit Raw Material Receiving.';
  end if;

  if p_supplier_id is not null
    and p_items is not null
    and jsonb_typeof(p_items) = 'array'
  then
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_raw_material_id := nullif(v_item->>'raw_material_id', '')::uuid;
      if v_raw_material_id is not null
        and not exists (
          select 1
          from public.factory_supplier_raw_material_links link
          join public.factory_raw_materials material on material.id = link.raw_material_id
          join public.factory_suppliers supplier on supplier.id = link.supplier_id
          where link.supplier_id = p_supplier_id
            and link.raw_material_id = v_raw_material_id
            and lower(coalesce(material.status, '')) = 'active'
            and lower(coalesce(supplier.status, '')) = 'active'
        )
      then
        raise exception using errcode = '22023', message = 'Raw Material is not linked to the selected Supplier.';
      end if;
    end loop;
  end if;

  return feedx_integrations.fa_save_raw_material_receiving_impl_supplier_material_link(p_machine_identity_id, p_batch_id,
    p_request_id,
    p_supplier_id,
    p_reference_no,
    p_received_date,
    p_remarks,
    p_items,
    p_complete
  );
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_raw_material_receiving(uuid,uuid,uuid,uuid,text,date,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_raw_material_receiving(p_batch_id uuid, p_request_id uuid, p_supplier_id uuid, p_reference_no text, p_received_date date, p_remarks text, p_items jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_raw_material_receiving(null::uuid ,p_batch_id,p_request_id,p_supplier_id,p_reference_no,p_received_date,p_remarks,p_items,p_complete);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_save_raw_material_receiving_impl_supplier_material_link(p_machine_identity_id uuid, p_batch_id uuid, p_request_id uuid, p_supplier_id uuid, p_reference_no text, p_received_date date, p_remarks text, p_items jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor public.employees%rowtype;
  v_supplier public.factory_suppliers%rowtype;
  v_batch public.factory_raw_material_receiving_batches%rowtype;
  v_request_batch public.factory_raw_material_receiving_batches%rowtype;
  v_existing_item public.factory_raw_material_receivings%rowtype;
  v_material public.factory_raw_materials%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_seen_ids uuid[] := '{}';
  v_index integer := 0;
  v_batch_prefix text;
  v_next_batch integer;
  v_receipt_no text;
  v_internal_batch_no text;
  v_supplier_lot_no text;
  v_received_qty numeric;
  v_storage_location_id uuid;
  v_expiry_date date;
  v_expiry_source text;
  v_expiry_confirmed boolean;
  v_item_remarks text;
  v_completion_fingerprint text;
begin
  if (p_machine_identity_id is null and auth.uid() is null) then
    raise exception using errcode = '42501', message = 'Authentication is required to save Raw Material Receiving.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;
  if p_machine_identity_id is null and not found then
    raise exception using errcode = '42501', message = 'An active employee profile is required to save Raw Material Receiving.';
  end if;

  if p_batch_id is null then
    if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.create') then
      raise exception using errcode = '42501', message = 'Missing permission to create Raw Material Receiving.';
    end if;
  elsif not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_raw_receiving.edit') then
    raise exception using errcode = '42501', message = 'Missing permission to edit Raw Material Receiving.';
  end if;

  if p_supplier_id is null then raise exception 'Supplier is required.'; end if;
  if p_received_date is null then raise exception 'Received Date is required.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one received item.';
  end if;
  if p_request_id is null then raise exception 'Receiving request ID is required.'; end if;

  v_completion_fingerprint := public.factory_raw_receiving_request_fingerprint(
    p_supplier_id, p_received_date, p_reference_no, p_remarks, p_items
  );
  perform pg_advisory_xact_lock(hashtext('factory_raw_receiving_request_' || p_request_id::text));

  select batch_row.* into v_request_batch
  from public.factory_raw_material_receiving_batches batch_row
  where batch_row.completion_request_id = p_request_id
  for update;

  if found then
    if p_batch_id is not null and v_request_batch.id <> p_batch_id then
      raise exception 'This Receiving request is already linked to another Receiving.';
    end if;
    if p_batch_id is null and v_request_batch.created_by is distinct from v_actor.id then
      raise exception using errcode = '42501', message = 'Receiving request is not available.';
    end if;
    if lower(coalesce(v_request_batch.status, '')) in ('active', 'completed') then
      if v_request_batch.completion_payload_fingerprint is distinct from v_completion_fingerprint then
        raise exception 'This Receiving request was already completed with different details.';
      end if;
      return public.factory_raw_receiving_payload(v_request_batch.id);
    end if;
    if lower(coalesce(v_request_batch.status, '')) = 'cancelled' then
      raise exception 'This Receiving request belongs to a Cancelled Receiving.';
    end if;
    if lower(coalesce(v_request_batch.status, '')) <> 'draft' then
      raise exception 'This Receiving request is linked to an incompatible Receiving.';
    end if;
    if not p_complete
      and p_batch_id is null
      and v_request_batch.completion_payload_fingerprint is not distinct from v_completion_fingerprint
    then
      return public.factory_raw_receiving_payload(v_request_batch.id);
    end if;
    p_batch_id := v_request_batch.id;
  end if;

  if p_batch_id is not null then
    select batch_row.* into v_batch
    from public.factory_raw_material_receiving_batches batch_row
    where batch_row.id = p_batch_id
    for update;
    if not found then raise exception 'Raw Material Receiving was not found.'; end if;
    if v_batch.completion_request_id is not null and v_batch.completion_request_id <> p_request_id then
      raise exception 'This Receiving is linked to another request.';
    end if;
  end if;

  if p_complete
    and lower(coalesce(v_batch.status, '')) in ('active', 'completed')
    and v_batch.completion_request_id = p_request_id
  then
    if v_batch.completion_payload_fingerprint is distinct from v_completion_fingerprint then
      raise exception 'This Receiving request was already completed with different details.';
    end if;
    return public.factory_raw_receiving_payload(v_batch.id);
  end if;

  if v_batch.id is not null and exists (
    select 1
    from public.factory_raw_material_movements movement
    join public.factory_raw_material_receivings item on item.id = movement.reference_id
    where item.batch_id = v_batch.id
      and movement.reference_type = 'raw_material_receiving'
  ) then
    raise exception 'Raw Material Receiving with stock history cannot be edited.';
  end if;

  if v_batch.id is not null and lower(coalesce(v_batch.status, '')) <> 'draft' then
    raise exception 'Only Draft Raw Material Receiving can be edited or completed.';
  end if;
  select supplier.* into v_supplier from public.factory_suppliers supplier where supplier.id = p_supplier_id;
  if not found then raise exception 'Factory Supplier not found.'; end if;
  if lower(coalesce(v_supplier.status, '')) <> 'active' then raise exception 'Archived Factory Suppliers cannot be selected.'; end if;

  if v_batch.id is null then
    v_batch_prefix := 'R' || to_char(p_received_date, 'YYMMDD');
    perform pg_advisory_xact_lock(hashtext('factory_raw_receiving:' || v_batch_prefix));
    select coalesce(max(nullif(substring(batch_no from '^R[0-9]{6}-([0-9]+)$'), '')::integer), 0) + 1
    into v_next_batch
    from public.factory_raw_material_receiving_batches
    where batch_no ~ ('^' || v_batch_prefix || '-[0-9]+$');

    insert into public.factory_raw_material_receiving_batches (
      batch_no, reference_no, supplier_id, supplier_name, received_date, remarks,
      status, completion_request_id, completion_payload_fingerprint, created_by, updated_at
    ) values (
      v_batch_prefix || '-' || lpad(v_next_batch::text, 2, '0'), nullif(btrim(p_reference_no), ''),
      v_supplier.id, v_supplier.supplier_name, p_received_date, nullif(btrim(p_remarks), ''),
      'draft', p_request_id, v_completion_fingerprint, v_actor.id, now()
    ) returning * into v_batch;
  else
    update public.factory_raw_material_receiving_batches
    set reference_no = nullif(btrim(p_reference_no), ''), supplier_id = v_supplier.id,
        supplier_name = v_supplier.supplier_name, received_date = p_received_date,
        remarks = nullif(btrim(p_remarks), ''), completion_request_id = coalesce(completion_request_id, p_request_id),
        completion_payload_fingerprint = v_completion_fingerprint, updated_at = now()
    where id = v_batch.id returning * into v_batch;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by nullif(value->>'raw_material_id', '')::uuid::text, value::text
  loop
    v_index := v_index + 1;
    v_item_id := nullif(v_item->>'id', '')::uuid;
    select item.* into v_existing_item
    from public.factory_raw_material_receivings item
    where item.id = v_item_id and item.batch_id = v_batch.id
    for update;

    select material.* into v_material
    from public.factory_raw_materials material
    where material.id = nullif(v_item->>'raw_material_id', '')::uuid;
    if not found then raise exception 'Raw Material is required for row %.', v_index; end if;
    if lower(coalesce(v_material.status, '')) <> 'active' then raise exception 'Archived Raw Materials cannot be received for row %.', v_index; end if;
    if nullif(btrim(v_material.uom), '') is null then raise exception 'UOM is required for row %.', v_index; end if;

    v_received_qty := coalesce(nullif(btrim(v_item->>'received_qty'), '')::numeric, 0);
    v_storage_location_id := nullif(v_item->>'storage_location_id', '')::uuid;
    v_expiry_date := nullif(v_item->>'expiry_date', '')::date;
    v_expiry_source := nullif(btrim(v_item->>'expiry_source'), '');
    v_expiry_confirmed := coalesce(nullif(btrim(v_item->>'expiry_confirmed'), '')::boolean, false);
    v_supplier_lot_no := nullif(btrim(v_item->>'supplier_lot_no'), '');
    v_item_remarks := nullif(btrim(v_item->>'remarks'), '');
    v_internal_batch_no := case when p_complete
      then public.factory_raw_receiving_next_internal_batch_no(v_material.id, p_received_date)
      else null
    end;

    if nullif(btrim(v_item->>'uom'), '') is distinct from v_material.uom then
      raise exception 'A valid UOM is required for row %.', v_index;
    end if;
    if v_expiry_source is not null and v_expiry_source not in ('supplier_label', 'calculated', 'not_applicable') then
      raise exception 'Expiry source is invalid for row %.', v_index;
    end if;

    if p_complete then
      if v_received_qty <= 0 then raise exception 'Qty must be greater than 0 for row %.', v_index; end if;
      if v_storage_location_id is null then raise exception 'Storage Location is required for row %.', v_index; end if;
      select location.* into v_location from public.factory_storage_locations location
      where location.id = v_storage_location_id and lower(coalesce(location.status, '')) = 'active';
      if not found then raise exception 'Active Storage Location not found for row %.', v_index; end if;
      if v_material.expiry_tracking_mode = 'not_applicable' then
        v_expiry_date := null;
        v_expiry_source := 'not_applicable';
        v_expiry_confirmed := true;
      elsif v_material.expiry_tracking_mode = 'required' and v_expiry_date is null then
        raise exception 'Expiry Date is required for row %.', v_index;
      elsif v_expiry_date is null then
        v_expiry_source := null;
        v_expiry_confirmed := false;
      end if;
      if v_expiry_date is not null and (
        not v_expiry_confirmed
        or v_expiry_source is null
        or v_expiry_source not in ('supplier_label', 'calculated')
      ) then
        raise exception 'Confirm the Expiry Date before completing Receiving.';
      end if;
    else
      if v_material.expiry_tracking_mode = 'not_applicable' then
        v_expiry_date := null;
        v_expiry_source := 'not_applicable';
        v_expiry_confirmed := true;
      elsif v_expiry_date is null then
        v_expiry_source := null;
        v_expiry_confirmed := false;
      end if;
      select location.* into v_location from public.factory_storage_locations location where location.id = v_storage_location_id;
    end if;

    v_receipt_no := coalesce(v_existing_item.receipt_no,
      v_batch.batch_no || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    if v_existing_item.id is null then
      insert into public.factory_raw_material_receivings (
        receipt_no, batch_id, raw_material_id, supplier_id, supplier_name, batch_no,
        supplier_lot_no, internal_batch_no, received_qty, uom, unit_cost, total_cost,
        invoice_no, received_date, manufacturing_date, expiry_date, expiry_source, expiry_confirmed, storage_location_id,
        storage_location, remarks, received_by, updated_at
      ) values (
        v_receipt_no, v_batch.id, v_material.id, v_supplier.id, v_supplier.supplier_name, v_internal_batch_no,
        v_supplier_lot_no, v_internal_batch_no, v_received_qty, v_material.uom, null,
        null, nullif(btrim(p_reference_no), ''), p_received_date,
        null, v_expiry_date, v_expiry_source, v_expiry_confirmed, v_storage_location_id, v_location.location_name,
        v_item_remarks, case when p_complete then v_actor.id else null end, now()
      ) returning id into v_item_id;
    else
      update public.factory_raw_material_receivings
      set receipt_no = v_receipt_no, raw_material_id = v_material.id, supplier_id = v_supplier.id,
          supplier_name = v_supplier.supplier_name, batch_no = v_internal_batch_no,
          supplier_lot_no = v_supplier_lot_no, internal_batch_no = v_internal_batch_no,
          received_qty = v_received_qty, uom = v_material.uom, unit_cost = null,
          total_cost = null, invoice_no = nullif(btrim(p_reference_no), ''),
          received_date = p_received_date, manufacturing_date = null,
          expiry_date = v_expiry_date, expiry_source = v_expiry_source,
          expiry_confirmed = v_expiry_confirmed, storage_location_id = v_storage_location_id,
          storage_location = v_location.location_name, remarks = v_item_remarks,
          received_by = case when p_complete then v_actor.id else null end, updated_at = now()
      where id = v_existing_item.id returning id into v_item_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
  end loop;

  delete from public.factory_raw_material_receivings item
  where item.batch_id = v_batch.id and not (item.id = any(v_seen_ids));

  if p_complete then
    if exists (
      select 1 from public.factory_raw_material_movements movement
      join public.factory_raw_material_receivings item on item.id = movement.reference_id
      where item.batch_id = v_batch.id and movement.reference_type = 'raw_material_receiving'
    ) then raise exception 'Raw Material Receiving has already affected stock.'; end if;

    for v_existing_item in select * from public.factory_raw_material_receivings where batch_id = v_batch.id order by created_at, id
    loop
      update public.factory_raw_materials
      set current_balance = coalesce(current_balance, 0) + v_existing_item.received_qty, updated_at = now()
      where id = v_existing_item.raw_material_id and lower(coalesce(status, '')) = 'active';
      if not found then raise exception 'Unable to update Raw Material balance.'; end if;

      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by
      ) values (
        v_existing_item.raw_material_id, 'Receiving', v_existing_item.received_qty,
        v_existing_item.uom, 'raw_material_receiving', v_existing_item.id,
        v_existing_item.receipt_no, p_received_date, 'Raw material receiving completed.', v_actor.id
      );
    end loop;

    update public.factory_raw_material_receiving_batches
    set status = 'completed', completion_payload_fingerprint = v_completion_fingerprint,
        completed_by = v_actor.id, completed_at = now(), updated_at = now()
    where id = v_batch.id;
  end if;

  return public.factory_raw_receiving_payload(v_batch.id);
end;
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_save_raw_material_receiving_impl_supplier_material_link(uuid,uuid,uuid,uuid,text,date,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_save_raw_material_receiving_impl_supplier_material_link(p_batch_id uuid, p_request_id uuid, p_supplier_id uuid, p_reference_no text, p_received_date date, p_remarks text, p_items jsonb, p_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_save_raw_material_receiving_impl_supplier_material_link(null::uuid ,p_batch_id,p_request_id,p_supplier_id,p_reference_no,p_received_date,p_remarks,p_items,p_complete);
$function$;
CREATE OR REPLACE FUNCTION feedx_integrations.fa_start_job_order(p_machine_identity_id uuid, p_job_order_id uuid, p_operator_id uuid, p_operator_name text, p_production_date date, p_start_time time without time zone, p_remarks text, p_started_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job_order public.factory_job_orders%rowtype;
  v_product_family_id uuid;
  v_sop public.factory_production_sops%rowtype;
  v_step public.factory_production_sop_steps%rowtype;
  v_step_execution_id uuid;
  v_actor_id uuid;
  v_actor_name text;
begin
  v_actor_id := feedx_integrations.fa_current_active_employee_id(p_machine_identity_id);
  v_actor_name := feedx_integrations.fa_current_active_employee_name(p_machine_identity_id);

  if not feedx_integrations.factory_actor_can(p_machine_identity_id, 'factory_production.complete') then
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
$function$;
REVOKE ALL ON FUNCTION feedx_integrations.fa_start_job_order(uuid,uuid,uuid,text,date,time without time zone,text,uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.factory_start_job_order(p_job_order_id uuid, p_operator_id uuid, p_operator_name text, p_production_date date, p_start_time time without time zone, p_remarks text, p_started_by uuid)
 RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select * from feedx_integrations.fa_start_job_order(null::uuid ,p_job_order_id,p_operator_id,p_operator_name,p_production_date,p_start_time,p_remarks,p_started_by);
$function$;
create function public.factory_agent_execute_action(p_token text,p_request_id uuid,p_action text,p_target_id uuid,p_expected_version text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid; a feedx_integrations.factory_actions%rowtype; req feedx_integrations.factory_action_requests%rowtype;
 before_value jsonb; after_value jsonb; result jsonb; v_id uuid; role_id_value uuid; fingerprint text; canonical_request uuid;
begin
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>65536 then
 raise exception using errcode='22023',message='Request ID and bounded action input are required.';end if;
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 select role_id into role_id_value from feedx_integrations.machine_identities where id=m;
 -- Coordinate with access changes; reauthorize after acquiring the same role lock.
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||role_id_value::text));
 perform 1 from feedx_integrations.machine_identities where id=m for update;
 if feedx_integrations.factory_action_authorize(p_token,p_action)<>m or
  (select role_id from feedx_integrations.machine_identities where id=m) is distinct from role_id_value then
 raise exception using errcode='40001',message='Agent access changed. Retry after reviewing access.';end if;
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if (a.target_required and p_target_id is null) or (not a.target_required and p_target_id is not null) then
 raise exception using errcode='22023',message='Target does not match this action.';end if;
 if exists(select 1 from jsonb_object_keys(p_input)k where not k=any(a.input_fields)) then
 raise exception using errcode='22023',message='Unsupported action input. Actor and lifecycle state are server-owned.';end if;
 fingerprint:=feedx_integrations.factory_action_version(jsonb_build_object('action',p_action,'target',p_target_id,'version',p_expected_version,'input',p_input));
 perform pg_advisory_xact_lock(hashtextextended('factory-agent-request:'||m::text||':'||p_request_id::text,0));
 select * into req from feedx_integrations.factory_action_requests where identity_id=m and request_id=p_request_id for update;
 if found then
  if req.payload_hash<>fingerprint then raise exception using errcode='22023',message='Request ID was used for a different intent. Use a new request ID.';end if;
  if req.status='completed' then return req.receipt||jsonb_build_object('replayed',true);end if;
 end if;
 before_value:=feedx_integrations.factory_action_state(p_action,p_target_id,true);
 if feedx_integrations.factory_action_version(before_value) is distinct from p_expected_version then
 raise exception using errcode='40001',message='Factory evidence changed. Read current action context and review a new intent.';end if;
 -- Same machine, regardless of credential, cannot review its own recorded work.
 if a.action in ('verify','approve') and exists(
  select 1 from feedx_integrations.factory_action_requests r where r.identity_id=m and r.status='completed'
   and r.action not like '%.verify' and r.action not like '%.approve'
   and (r.target_id=p_target_id or r.receipt->>'target_id'=p_target_id::text)
 ) then raise exception using errcode='42501',message='This Agent cannot verify or approve its own work. Use an independent reviewer.';end if;
 if req.request_id is null then
  insert into feedx_integrations.factory_action_requests(identity_id,request_id,action,target_id,expected_version,input,payload_hash,status)
  values(m,p_request_id,p_action,p_target_id,p_expected_version,p_input,fingerprint,case when a.requires_confirmation then 'awaiting_confirmation' else 'confirmed' end)
  returning * into req;
 end if;
 if a.requires_confirmation and req.status<>'confirmed' then
 return jsonb_build_object('status','awaiting_confirmation','request_id',p_request_id,'action',p_action,'target_id',p_target_id,
 'message','An authorized human must review this exact action and confirm existing physical evidence in AI Integrations. Nothing has been executed.');end if;
 if a.requires_confirmation and (req.confirmed_by is null or req.confirmed_at<clock_timestamp()-interval '30 minutes') then
 raise exception using errcode='55000',message='Human confirmation expired. Submit a new intent for review.';end if;
 -- Namespace inner canonical retry keys by stable Agent identity, never by credential.
 canonical_request:=md5(m::text||':'||p_request_id::text)::uuid;
 v_id:=p_target_id;
 case p_action
 when 'job_order.create','job_order.update' then
  select to_jsonb(v),v.job_order_id into result,v_id from feedx_integrations.fa_save_job_order_structure(m,p_target_id,
   (p_input->>'finished_good_id')::uuid,(p_input->>'target_quantity')::numeric,p_input->>'uom',(p_input->>'planned_date')::date,
   (p_input->>'due_date')::date,p_input->>'priority',p_input->>'assigned_team',p_input->>'remarks',
   (p_input->>'target_pack_qty')::numeric,(p_input->>'target_production_qty')::numeric)v;
 when 'job_order.submit' then perform feedx_integrations.fa_release_job_order(m,p_target_id);
 when 'job_order.cancel' then perform feedx_integrations.fa_cancel_job_order(m,p_target_id);
 when 'production.update' then
  perform feedx_integrations.fa_save_production_qc_progress(m,p_target_id,coalesce(p_input->'step_rows','[]'),coalesce(p_input->'qc_rows','[]'),null,null);
 when 'production.complete' then
  v_id:=feedx_integrations.fa_complete_production_with_raw_batch_allocations(m,canonical_request,
   coalesce(p_input->'payload','{}')||jsonb_build_object('job_order_id',p_target_id));
 when 'production.verify' then perform feedx_integrations.fa_verify_production_record(m,p_target_id);
 when 'receiving.create','receiving.update','receiving.complete' then
  if p_target_id is not null then
   select coalesce(completion_request_id,canonical_request) into canonical_request from public.factory_raw_material_receiving_batches where id=p_target_id;
  end if;
  result:=feedx_integrations.fa_save_raw_material_receiving(m,p_target_id,canonical_request,(p_input->>'supplier_id')::uuid,
   p_input->>'reference_no',(p_input->>'received_date')::date,p_input->>'remarks',p_input->'items',p_action='receiving.complete');
  v_id:=coalesce((result->>'batch_id')::uuid,(result->>'id')::uuid,p_target_id);
 when 'receiving.verify' then result:=feedx_integrations.fa_verify_raw_material_receiving(m,p_target_id);
 when 'receiving.cancel' then result:=feedx_integrations.fa_cancel_raw_material_receiving(m,p_target_id);
 when 'product_stock_check.create','product_stock_check.update','product_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_product_stock_check_structure(m,p_target_id,
   (p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,null,p_input->'rows')v;
 when 'product_stock_check.approve' then perform feedx_integrations.fa_approve_product_stock_check(m,p_target_id,null);
 when 'raw_stock_check.create','raw_stock_check.update','raw_stock_check.submit' then
  select to_jsonb(v),v.id into result,v_id from feedx_integrations.fa_save_raw_material_stock_check_structure(m,p_target_id,
   (p_input->>'category_id')::uuid,(p_input->>'check_date')::date,p_input->>'notes',case when a.action='submit' then 'submitted' else 'draft' end,p_input->'rows')v;
 when 'raw_stock_check.approve' then perform feedx_integrations.fa_approve_raw_material_stock_check(m,p_target_id,null);
 when 'area_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'area_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'equipment_cleaning.complete' then result:=feedx_integrations.fa_mesti_complete_equipment_cleaning_occurrence(m,p_target_id,p_input->>'note');
 when 'equipment_cleaning.verify' then result:=feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(m,p_target_id,p_input->>'result',p_input->>'note');
 when 'calibration.create' then result:=feedx_integrations.fa_mesti_record_calibration(m,p_target_id,p_input->'record');v_id:=(result->>'id')::uuid;
 when 'calibration.verify' then result:=feedx_integrations.fa_mesti_verify_calibration(m,p_target_id);
 else raise exception using errcode='22023',message='Unsupported Factory action.';
 end case;
 if v_id is null then raise exception using errcode='55000',message='Canonical action did not return a target identity.';end if;
 after_value:=feedx_integrations.factory_action_state(
  case when p_action='production.complete' then 'production.verify' when p_action='calibration.create' then 'calibration.verify' else p_action end,v_id);
 result:=jsonb_build_object('status','completed','request_id',p_request_id,'action',p_action,'target_id',v_id,
  'actor',jsonb_build_object('type','machine','identity_id',m),'confirmed_by',req.confirmed_by,'confirmed_at',req.confirmed_at,
  'before_version',p_expected_version,'after_version',feedx_integrations.factory_action_version(after_value),
  'completed_at',clock_timestamp(),'replayed',false);
 update feedx_integrations.factory_action_requests set status='completed',completed_at=clock_timestamp(),receipt=result
 where identity_id=m and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
 select 'factory_agent_action_completed','factory',null,name,'Factory action executed by External Agent.',
 result||jsonb_build_object('source_before',before_value,'source_after',after_value,'payload_hash',fingerprint)
 from feedx_integrations.machine_identities where id=m;
 return result;
end $$;
revoke all on function public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb) from public;
grant execute on function public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb) to anon,authenticated;

create function public.external_agents_factory_action_requests(p_identity_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('label',a.label,'requires_confirmation',a.requires_confirmation,
 'can_confirm',public.current_user_has_permission(a.human_permission)) order by r.requested_at desc),'[]')
 from (select request_id,identity_id,action,target_id,input,status,requested_at,confirmed_by,confirmed_at,evidence_reference,receipt
 from feedx_integrations.factory_action_requests where identity_id=p_identity_id order by requested_at desc limit 50)r
 join feedx_integrations.factory_actions a on a.key=r.action);
end $$;
revoke all on function public.external_agents_factory_action_requests(uuid) from public,anon;
grant execute on function public.external_agents_factory_action_requests(uuid) to authenticated;

create function public.external_agents_confirm_factory_action(p_identity_id uuid,p_request_id uuid,p_evidence_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req feedx_integrations.factory_action_requests%rowtype; a feedx_integrations.factory_actions%rowtype; employee_id_value uuid; source_value jsonb;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 employee_id_value:=public.factory_current_active_employee_id();
 select * into strict req from feedx_integrations.factory_action_requests where identity_id=p_identity_id and request_id=p_request_id for update;
 select * into strict a from feedx_integrations.factory_actions where key=req.action;
 if not a.requires_confirmation or not public.current_user_has_permission(a.human_permission) then raise exception using errcode='42501',message='The corresponding Factory business authority is required.';end if;
 if req.status<>'awaiting_confirmation' then raise exception using errcode='55000',message='This action is no longer awaiting confirmation.';end if;
 if nullif(btrim(p_evidence_reference),'') is null or length(p_evidence_reference)>1000 then raise exception using errcode='22023',message='Reference to observed physical or approved business evidence is required.';end if;
 source_value:=feedx_integrations.factory_action_state(req.action,req.target_id,true);
 if feedx_integrations.factory_action_version(source_value) is distinct from req.expected_version then raise exception using errcode='40001',message='Factory evidence changed. Ask the Agent to submit a new intent.';end if;
 if a.action in ('verify','approve') and employee_id_value::text in (source_value->>'created_by',source_value->>'completed_by',source_value->>'recorded_by',source_value->>'submitted_by',source_value->>'operator_id') then
 raise exception using errcode='42501',message='An independent reviewer must confirm this action.';end if;
 update feedx_integrations.factory_action_requests set status='confirmed',confirmed_by=employee_id_value,confirmed_at=clock_timestamp(),evidence_reference=btrim(p_evidence_reference)
 where identity_id=p_identity_id and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('factory_agent_action_confirmed','factory',auth.uid(),'Authorized Factory reviewer',
 'Exact Agent action confirmed against existing evidence; execution remains pending.',jsonb_build_object('identity_id',p_identity_id,'request_id',p_request_id,'action',req.action,'payload_hash',req.payload_hash,'evidence_reference',btrim(p_evidence_reference)));
 return jsonb_build_object('status','confirmed','request_id',p_request_id);
end $$;
revoke all on function public.external_agents_confirm_factory_action(uuid,uuid,text) from public,anon;
grant execute on function public.external_agents_confirm_factory_action(uuid,uuid,text) to authenticated;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_read_business_catalog(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select coalesce(jsonb_agg(v||jsonb_build_object('label',coalesce((select r.label from feedx_integrations.resources r where r.key=v->>'resource_key'),regexp_replace(v->>'label','^Preserved ','')),'workspace',coalesce(v->>'workspace','Factory'),'domain',case when v->>'section'='Factory' then case v->>'module_id' when 'factory_dashboard' then 'Factory Insights' when 'factory_product_feedback' then 'Product Feedback' when 'factory_petty_cash' then 'Petty Cash' else 'Production' end else coalesce(v->>'section',v->>'domain_label','MeSTI') end,'scope',coalesce((select jsonb_agg(jsonb_build_object('resource',r.slug,'label',r.label,'row_scope',b.row_scope,'fields',b.allowed_fields,'context_fields',b.context_fields,'scope_note','Basic related identifiers, names and current statuses only. Full related records, stock, costs and personal data are not included by reference.','relationships',b.relationship_modules,'required_modules',b.required_modules)) from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=v->>'module_id'),jsonb_build_array(coalesce((select jsonb_build_object('resource',r.slug,'label',r.label,'scope_note',r.description,'field_policy',r.field_policy) from feedx_integrations.resources r where r.key=v->>'resource_key'),jsonb_build_object('resource',v->>'resource_key','label',v->>'label','scope_note',v->>'description')))),'description',case when v->>'module_id' is null then v->>'description' else 'View the listed records with basic related identifiers, names and current statuses. Related full records, inventory and costs require their own access. Some reporting resources require the source capabilities listed in Review Changes.' end,'retained_only',v->>'module_id' is null) order by v->>'workspace',v->>'label'),'[]')
from (select value v from jsonb_array_elements(feedx_integrations.navigation_catalog(p_identity)) union all select value from jsonb_array_elements(feedx_integrations.preserved_access(p_identity)))s;
$function$
;
revoke all on function feedx_integrations.factory_read_business_catalog(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_read_discovery(p_identity uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with granted as (
 select c.*,r.slug from feedx_integrations.machine_identities m join feedx_integrations.capabilities c on c.adapter_key=m.adapter_key left join feedx_integrations.resources r on r.key=c.resource_key join public.permissions p on p.code=c.permission_code join public.role_permissions rp on rp.role_id=m.role_id and rp.permission_id=p.id where m.id=p_identity and c.implemented and c.mcp_tool='query_factory_resources' and not c.requires_human_approval
 ),allowed as (
 select distinct mcp_tool from granted where mcp_tool='query_factory_resources'
 ),operations as (
 select jsonb_build_object('resource',g.slug,'action',op) as value from granted g cross join lateral unnest(case when g.action_type='view' then array['list','read','search','filter'] else array[g.action_type] end)op where g.slug is not null
 union all select jsonb_build_object('resource',r.slug,'action',op,'business_module',g.navigation_module_id) from granted g join feedx_integrations.navigation_resources b on b.module_id=g.navigation_module_id join feedx_integrations.resources r on r.key=b.resource_key cross join unnest(array['list','read','search','filter'])op where not exists(select 1 from jsonb_array_elements_text(b.required_modules) dep where not exists(select 1 from granted source_grant where source_grant.navigation_module_id=dep))
 ),catalog as (
 select jsonb_build_object('resource',r.slug,'label',r.label,'filters',r.filter_fields,'date_semantics',r.date_semantics) as value from feedx_integrations.resources r where exists(select 1 from granted g where g.resource_key=r.key)
 union all select jsonb_build_object('resource',r.slug,'business_module',n.id,'business_label',n.label,'section',n.section,'coverage',n.coverage,'limitation',n.explanation,'row_scope',b.row_scope,'context_fields',b.context_fields,'context_policy','Minimal identifiers, names and current statuses. No related full records, balances, costs or personal data.','requires_modules',b.required_modules,'query_available',not exists(select 1 from jsonb_array_elements_text(b.required_modules) dep where not exists(select 1 from granted source_grant where source_grant.navigation_module_id=dep)),'missing_required_modules',(select coalesce(jsonb_agg(jsonb_build_object('id',dep,'label',required.label)),'[]') from jsonb_array_elements_text(b.required_modules)dep join feedx_integrations.navigation_modules required on required.id=dep where not exists(select 1 from granted source_grant where source_grant.navigation_module_id=dep)),'fields',(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements_text(b.allowed_fields)f where not b.relationship_modules ? f or exists(select 1 from granted target where target.navigation_module_id=b.relationship_modules->>f)),'filters',(select coalesce(jsonb_agg(f),'[]') from jsonb_array_elements_text(r.filter_fields)f where b.allowed_fields ? f and (not b.relationship_modules ? f or exists(select 1 from granted target where target.navigation_module_id=b.relationship_modules->>f))),'date_semantics',r.date_semantics) from granted g join feedx_integrations.navigation_modules n on n.id=g.navigation_module_id join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key
 )
 select jsonb_build_object('authorized',true,'tools',(select coalesce(jsonb_agg(mcp_tool),'[]') from allowed),'resource_catalog',(select coalesce(jsonb_agg(value),'[]') from catalog),'resource_actions',(select coalesce(jsonb_agg(value),'[]') from operations));
$function$
;
revoke all on function feedx_integrations.factory_read_discovery(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION feedx_integrations.factory_read_effective_paths(p_names text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with selected as(select c.* from feedx_integrations.capabilities c where c.tool_id=any(p_names) and c.implemented and not c.requires_human_approval), modules as(select c.navigation_module_id id from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id where n.coverage<>'unavailable' and c.action_type='view'),paths as (
 select jsonb_build_object('key',n.id||':'||r.slug,'grant_name',c.tool_id,'owner',n.label,'module_id',n.id,'resource',r.slug,'label',r.label,'actions',jsonb_build_array('list','read','search','filter'),'row_scope',b.row_scope,
 'fields',(select coalesce(jsonb_agg(f order by f),'[]') from jsonb_array_elements_text(b.allowed_fields)f where not b.relationship_modules ? f or exists(select 1 from modules m where m.id=b.relationship_modules->>f)),
 'audit_modules',case when r.slug='audit_trail' then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'label',nm.label) order by m.id),'[]') from modules m join feedx_integrations.navigation_modules nm on nm.id=m.id where feedx_integrations.audit_navigation_owner(case m.id when 'factory_raw_inventory' then 'factory_raw_material' when 'factory_batch_traceability' then 'factory_historical_dispatch_batch_reconciled' when 'factory_finished_goods_dispatch' then 'factory_finished_good_dispatch' else m.id end)=m.id) else '[]'::jsonb end) v
 from selected c join feedx_integrations.navigation_modules n on n.id=c.navigation_module_id join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key where r.implemented and exists(select 1 from modules m where m.id=n.id) and not exists(select 1 from jsonb_array_elements_text(b.required_modules)dep where not exists(select 1 from modules m where m.id=dep))
 union all
 select jsonb_build_object('key','saved:'||c.tool_id,'grant_name',c.tool_id,'owner',r.label,'module_id',null,'resource',r.slug,'label',r.label,'actions',case when c.action_type='view' then jsonb_build_array('list','read','search','filter') else jsonb_build_array(c.action_type) end,'row_scope','{}'::jsonb,'field_policy',r.field_policy,
 'relationship_fields',(select coalesce(jsonb_agg(f.key order by f.key),'[]') from jsonb_each_text(r.relationship_fields)f where feedx_integrations.review_has_resource(p_names,f.value,'list')),'audit_modules','[]'::jsonb) from selected c join feedx_integrations.resources r on r.key=c.resource_key where c.navigation_module_id is null and feedx_integrations.review_has_resource(p_names,r.slug,case when c.action_type='view' then 'list' else c.action_type end)
 ) select coalesce(jsonb_agg(v order by v->>'key'),'[]') from paths;
$function$
;
revoke all on function feedx_integrations.factory_read_effective_paths(text[]) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION feedx_integrations.navigation_catalog(p_identity uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('name',c.tool_id,'label',n.label,'description',n.explanation,'workspace',n.workspace,'section',n.section,'domain',n.section,'domain_label',n.section,'module_id',n.id,'route',n.route,'sidebar',n.sidebar,'coverage',n.coverage,'capability_coverage',n.coverage,'capability_limitation',n.capability_limitation,'data_limitations',n.explanation,'capability','view','read_only',true,'implemented',c.implemented and n.coverage<>'unavailable','requires_human_approval',c.requires_human_approval,'mcp_tool',c.mcp_tool,'permission',c.permission_code,
 'limited_access',feedx_integrations.navigation_has_preserved_access(p_identity,n.id),'granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id where m.id=p_identity and rp.permission_id=p.id),
 'can_assign',c.implemented and n.coverage<>'unavailable' and public.current_user_can_assign_permission(p.id),
 'required_modules',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label)) from feedx_integrations.navigation_modules d where exists(select 1 from feedx_integrations.navigation_resources b where b.module_id=n.id and b.required_modules ? d.id)),'[]'),
 'technical_resources',coalesce((select jsonb_agg(jsonb_build_object('resource',r.slug,'row_scope',b.row_scope)) from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=n.id),'[]')) order by n.sort_order),'[]')
 from feedx_integrations.navigation_modules n join feedx_integrations.capabilities c on c.navigation_module_id=n.id and c.action_type='view' join public.permissions p on p.code=c.permission_code;
$function$
;
CREATE OR REPLACE FUNCTION public.external_agents_set_capability(p_identity_id uuid, p_tool_id text, p_granted boolean, p_expected_granted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role uuid;v_locked_role uuid;v_cap feedx_integrations.capabilities%rowtype;v_permission uuid;v_before boolean;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings authority is required.';end if;
 select role_id into v_role from feedx_integrations.machine_identities where id=p_identity_id;
 perform pg_advisory_xact_lock(hashtext('role_configuration:'||v_role::text));
 select role_id into v_locked_role from feedx_integrations.machine_identities where id=p_identity_id for update;
 if v_role is distinct from v_locked_role then raise exception using errcode='40001',message='Agent role changed.';end if;
 perform 1 from public.roles where id=v_role for update;
 if not feedx_integrations.can_manage(p_identity_id) or not feedx_integrations.has_dedicated_role(p_identity_id) then raise exception using errcode='42501',message='Manage shared roles in Role Settings.';end if;
 select c.* into v_cap from feedx_integrations.capabilities c join feedx_integrations.machine_identities m on m.adapter_key=c.adapter_key
  join feedx_integrations.adapters a on a.key=c.adapter_key
  where m.id=p_identity_id and c.tool_id=p_tool_id and c.implemented and ((c.navigation_module_id is not null and (c.action_type='view' or exists(select 1 from feedx_integrations.factory_actions fa where fa.key=c.tool_id))) or p_granted=false) and (c.resource_key is null or exists(select 1 from feedx_integrations.resources r where r.key=c.resource_key and r.implemented)) and exists(select 1 from jsonb_array_elements(a.tools)t where t->>'name'=c.mcp_tool);
 if not found or p_granted is null or p_expected_granted is null then raise exception using errcode='22023',message='Capability unavailable.';end if;
 select id into v_permission from public.permissions where code=v_cap.permission_code;
 if not public.current_user_can_assign_permission(v_permission) then raise exception using errcode='42501',message='Capability is outside your authority.';end if;
 select exists(select 1 from public.role_permissions where role_id=v_role and permission_id=v_permission) into v_before;
 if v_before<>p_expected_granted then raise exception using errcode='40001',message='Access changed. Refresh before trying again.';end if;
 if v_before<>p_granted then
  if p_granted then insert into public.role_permissions(role_id,permission_id) values(v_role,v_permission) on conflict do nothing;
  else delete from public.role_permissions where role_id=v_role and permission_id=v_permission;end if;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
   values(case when p_granted then 'external_agent_capability_granted' else 'external_agent_capability_revoked' end,'access-control',auth.uid(),'Administrator',
    case when p_granted then 'Agent capability granted.' else 'Agent capability revoked.' end,
    jsonb_build_object('identity_id',p_identity_id,'role_id',v_role,'tool',v_cap.tool_id,'label',v_cap.label,'action_type',v_cap.action_type,'navigation_module_id',v_cap.navigation_module_id,'permission',v_cap.permission_code,'before',v_before,'after',p_granted));
 end if;
 return jsonb_build_object('granted',p_granted);
end $function$
;
CREATE OR REPLACE FUNCTION public.external_agents_register(p_request_id uuid, p_name text, p_provider text, p_adapter_key text, p_tool_ids text[], p_validity_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_identity uuid;v_role jsonb;v_codes text[];v_base text;v_result jsonb;
begin
 if auth.uid() is null or not public.current_user_has_role_management_permission('create') or not public.current_user_has_role_management_permission('edit') then raise exception using errcode='42501',message='Role Settings create and edit authority is required.';end if;
 if p_request_id is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_provider is null or length(trim(p_provider)) not between 1 and 80
  or coalesce(cardinality(p_tool_ids),0)=0 or cardinality(p_tool_ids)<>cardinality(array(select distinct unnest(p_tool_ids))) then raise exception using errcode='22023',message='Provide agent details and select implemented capabilities.';end if;
 perform pg_advisory_xact_lock(hashtext('external_agent_registration:'||p_request_id::text));
 if exists(select 1 from feedx_integrations.machine_identities where registration_request_id=p_request_id) then raise exception using errcode='55000',message='Agent already connected. Access keys cannot be retrieved again.';end if;
 select permission_code into v_base from feedx_integrations.adapters where key=p_adapter_key;
 if v_base is null or exists(select 1 from unnest(p_tool_ids) tool where not exists(select 1 from feedx_integrations.capabilities c join feedx_integrations.adapters a on a.key=c.adapter_key where c.tool_id=tool and c.adapter_key=p_adapter_key and c.implemented and c.navigation_module_id is not null and (c.action_type='view' or exists(select 1 from feedx_integrations.factory_actions fa where fa.key=c.tool_id)) and (c.resource_key is null or exists(select 1 from feedx_integrations.resources r where r.key=c.resource_key and r.implemented)) and exists(select 1 from jsonb_array_elements(a.tools)t where t->>'name'=c.mcp_tool))) then raise exception using errcode='22023',message='Capability unavailable.';end if;
 select array_agg(c.permission_code) into v_codes from feedx_integrations.capabilities c where c.tool_id=any(p_tool_ids);
 v_role:=public.save_role_configuration(p_request_id,jsonb_build_object('name','external_agent_'||replace(p_request_id::text,'-',''),'description','Dedicated external agent role.','is_active',true,'outlet_access_type','none'),array_append(v_codes,v_base),'{}'::uuid[]);
 insert into feedx_integrations.machine_identities(name,role_id,enabled,provider,adapter_key,registration_request_id)
  values(trim(p_name),(v_role->'role'->>'id')::uuid,true,trim(p_provider),p_adapter_key,p_request_id) returning id into v_identity;
 v_result:=public.external_agents_rotate_credential(v_identity,null,gen_random_uuid(),p_validity_days);
 return v_result||jsonb_build_object('identity_id',v_identity);
end $function$
;
create function feedx_integrations.factory_action_catalog(p_identity uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('name',c.tool_id,'label',a.label,'description',a.description,'workspace','Factory',
 'domain',n.section,'module_id',a.module_id,'capability',a.action,'permission',c.permission_code,'mcp_tool','execute_factory_action',
 'implemented',true,'retained_only',false,'read_only',false,'requires_human_approval',a.requires_confirmation,
 'execution_requirement',case when a.requires_confirmation then 'Authorized human confirmation of the exact intent and physical/business evidence is required.' else 'Autonomous with explicit action and module View grants.' end,
 'required_view_permission','factory_agent_nav_'||a.module_id||'.view',
 'granted',exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id where m.id=p_identity and rp.permission_id=p.id),
 'can_assign',public.current_user_can_assign_permission(p.id),
 'scope',jsonb_build_array(jsonb_build_object('label',a.label,'scope_note',a.description||' Module View access is required. Existing lifecycle and evidence validation remain enforced.')))
 order by c.sort_order),'[]')
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key
 join public.permissions p on p.code=c.permission_code join feedx_integrations.navigation_modules n on n.id=a.module_id;
$$;
revoke all on function feedx_integrations.factory_action_catalog(uuid) from public,anon,authenticated;

create or replace function feedx_integrations.business_capability_catalog(p_identity uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select feedx_integrations.factory_read_business_catalog(p_identity)||feedx_integrations.factory_action_catalog(p_identity);
$$;

create or replace function feedx_integrations.discovery(p_identity uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with actions as(select c from jsonb_array_elements(feedx_integrations.factory_action_catalog(p_identity))c
 where (c->>'granted')::boolean and exists(select 1 from feedx_integrations.machine_identities m join public.role_permissions rp on rp.role_id=m.role_id
 join public.permissions p on p.id=rp.permission_id where m.id=p_identity and p.code=c->>'required_view_permission')),
 base as(select feedx_integrations.factory_read_discovery(p_identity) v)
 select v||jsonb_build_object('tools',coalesce(v->'tools','[]')||case when exists(select 1 from actions) then '["factory_action_context","execute_factory_action"]'::jsonb else '[]' end,
 'factory_actions',coalesce((select jsonb_agg(c) from actions),'[]')) from base;
$$;

create or replace function feedx_integrations.review_effective_paths(p_names text[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select feedx_integrations.factory_read_effective_paths(p_names)||coalesce((select jsonb_agg(jsonb_build_object(
 'key','action:'||a.key,'grant_name',c.tool_id,'owner',a.label,'label',a.action,'module_id',a.module_id,'resource','action:'||a.key,
 'actions',jsonb_build_array(a.action),'row_scope','{}'::jsonb,'requires_human_confirmation',a.requires_confirmation,
 'required_view_permission','factory_agent_nav_'||a.module_id||'.view','audit_modules','[]'::jsonb))
 from feedx_integrations.factory_actions a join feedx_integrations.capabilities c on c.tool_id=a.key where c.tool_id=any(p_names)),'[]');
$$;

update feedx_integrations.adapters set tools=tools||'[{"name":"factory_action_context","description":"Current action version and evidence requirements"},{"name":"execute_factory_action","description":"Explicitly granted canonical Factory actions"}]'::jsonb where key='factory_mesti';
set check_function_bodies=on;
notify pgrst,'reload schema';
