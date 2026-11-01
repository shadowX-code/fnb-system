-- The existing fixed dispatcher owns request identity, exact intent, locking and receipts.
-- Restaurant contributes only its canonical command mapping and scope/evidence preflight.
create function feedx_integrations.restaurant_target_scope(p_machine uuid,p_action text,p_target uuid,p_outlet uuid)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a feedx_integrations.factory_actions%rowtype; actual uuid;
begin
 if not feedx_integrations.restaurant_actor_outlet(p_machine,p_outlet) then raise exception using errcode='42501',message='Restaurant outlet access is required';end if;
 select * into strict a from feedx_integrations.factory_actions where key=p_action and key like 'restaurant_%';
 if p_target is not null then
  execute format('select outlet_id from %s where id=$1',a.target_table) into actual using p_target;
  if actual is distinct from p_outlet then raise exception using errcode='42501',message='The Restaurant target is outside the selected outlet';end if;
 end if;
end $$;
revoke all on function feedx_integrations.restaurant_target_scope(uuid,text,uuid,uuid) from public,anon,authenticated;

create function public.restaurant_agent_action_context(p_token text,p_action text,p_outlet_id uuid,p_target_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare m uuid;a feedx_integrations.factory_actions%rowtype; value jsonb;
begin
 m:=feedx_integrations.factory_action_authorize(p_token,p_action);
 perform feedx_integrations.restaurant_target_scope(m,p_action,p_target_id,p_outlet_id);
 select * into strict a from feedx_integrations.factory_actions where key=p_action;
 if a.target_required is distinct from (p_target_id is not null) then raise exception using errcode='22023',message='Select the required existing target or a create action';end if;
 value:=feedx_integrations.factory_action_state(p_action,p_target_id);
 return jsonb_build_object('action',p_action,'outlet_id',p_outlet_id,'target_id',p_target_id,'expected_version',feedx_integrations.factory_action_version(value),'status',value->>'status','input_fields',a.input_fields,'requires_human_confirmation',false,
 'execution',jsonb_build_object('execution_policy','autonomous','eligible_without_confirmation',true,'execution_reason','Exact Action and outlet scope authorize execution; canonical evidence, lifecycle and approval requirements still apply. Never fabricate inspection, maintenance or receiving evidence.'));
end $$;
revoke all on function public.restaurant_agent_action_context(text,text,uuid,uuid) from public;
grant execute on function public.restaurant_agent_action_context(text,text,uuid,uuid) to anon,authenticated;

create function feedx_integrations.restaurant_execute(p_machine uuid,p_request uuid,p_action text,p_target uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare outlet uuid:=(p_input->>'outlet_id')::uuid; record jsonb:=coalesce(p_input->'record','{}'); items jsonb:=coalesce(p_input->'items','[]'); result jsonb; id uuid:=p_target; old_value jsonb; v_asset public.asset_items%rowtype; row_value jsonb; template public.asset_condition_templates%rowtype; a text:=split_part(p_action,'.',2);
begin
 perform feedx_integrations.restaurant_target_scope(p_machine,p_action,p_target,outlet);
 if jsonb_typeof(record)<>'object' or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>500 then raise exception using errcode='22023',message='Record object and at most 500 item rows are required';end if;
 if record ?| array['created_by','updated_by','actor_id','actor_employee_id','actor_machine_id','checked_by','checked_by_employee_id','submitted_by','received_by','role_id','auth_user_id','machine_identity_id'] then raise exception using errcode='22023',message='Actor and scope attribution are server-owned';end if;
 if record ? 'outlet_id' and record->>'outlet_id' is distinct from outlet::text then raise exception using errcode='42501',message='Payload outlet conflicts with selected scope';end if;
 if p_target is not null then old_value:=feedx_integrations.factory_action_state(p_action,p_target,true);end if;
 record:=coalesce(old_value,'{}')||record||jsonb_build_object('id',p_target,'outlet_id',outlet);
 if split_part(p_action,'.',1) in ('restaurant_movement','restaurant_waste') and not exists(select 1 from public.inventory_item_outlets io where io.outlet_id=outlet and io.inventory_item_id=(record->>'inventory_item_id')::uuid) then raise exception using errcode='42501',message='Inventory item is not assigned to this outlet';end if;
 if split_part(p_action,'.',1)='restaurant_recipe' then
  for row_value in select value from jsonb_array_elements(items) loop
   if not exists(select 1 from public.inventory_item_outlets io where io.outlet_id=outlet and io.inventory_item_id=coalesce(row_value->>'inventory_item_id',row_value->>'item_id')::uuid) then raise exception using errcode='42501',message='Recipe ingredient is not assigned to this outlet';end if;
  end loop;
 end if;
 case split_part(p_action,'.',1)
 when 'restaurant_asset' then
  if a='create' then record:=record||'{"minimum_quantity":0,"condition":"healthy","status":"active","health_status":"healthy"}';end if;
  result:=feedx_integrations.ra_asset_import_row(p_machine,p_request,record,a);id:=(result->'asset'->>'id')::uuid;
 when 'restaurant_inspection' then
  record:=record||jsonb_build_object('draft_id',p_target,'status',case when a='complete' then 'completed' else 'draft' end);
  if a='complete' then
   if not record ? 'inspection_date' or jsonb_array_length(coalesce(record->'rows','[]'))=0 then raise exception using errcode='22023',message='An inspection date and explicit observed asset counts are required';end if;
   for row_value in select value from jsonb_array_elements(record->'rows') loop
    if not row_value ? 'counted_quantity' or not row_value ? 'condition_status' then raise exception using errcode='22023',message='Explicit observed count and condition are required; no inferred inspection';end if;
    select * into v_asset from public.asset_items asset where asset.id=(row_value->>'asset_id')::uuid and outlet_id=outlet for update;
    if not found then raise exception using errcode='42501',message='Inspection asset is outside outlet scope';end if;
    if nullif(row_value->>'condition_template_id','') is not null then
     select * into template from public.asset_condition_templates ct where ct.id=(row_value->>'condition_template_id')::uuid and ct.category_id=v_asset.category_id and ct.active;
     if not found then raise exception using errcode='22023',message='Inspection condition template is not valid for this asset';end if;
     if template.requires_photo and jsonb_array_length(coalesce(row_value->'evidence','[]'))=0 then raise exception using errcode='22023',message='Existing genuine inspection photo evidence is required';end if;
     if template.requires_remark and nullif(btrim(row_value->>'remark'),'') is null then raise exception using errcode='22023',message='The inspection condition requires an observation remark';end if;
    end if;
    if coalesce((row_value->>'evidence_required')::boolean,false) and jsonb_array_length(coalesce(row_value->'evidence','[]'))=0 then raise exception using errcode='22023',message='Required inspection evidence is missing';end if;
   end loop;
  end if;
  result:=feedx_integrations.ra_asset_submit_inspection(p_machine,p_request,record);id:=(result->>'inspection_id')::uuid;
 when 'restaurant_maintenance' then
  if a='complete' then
   if nullif(btrim(record->>'action_taken'),'') is null or nullif(record->>'completed_date','') is null then raise exception using errcode='22023',message='Actual maintenance action and completion date are required';end if;
   record:=record||'{"status":"completed"}';
  elsif record->>'status'='completed' then raise exception using errcode='22023',message='Use the explicit Complete Maintenance action';end if;
  result:=feedx_integrations.ra_asset_save_maintenance(p_machine,p_request,record);id:=(result->'record'->>'id')::uuid;
 when 'restaurant_stock_check' then
  if coalesce(record->>'stock_check_type','scheduled')<>'scheduled' then raise exception using errcode='22023',message='Audit stock checks require their independent audit authority; these actions support scheduled checks only';end if;
  record:=record||jsonb_build_object('status',case when a='submit' then 'submitted' else 'draft' end);
  result:=feedx_integrations.ra_save_stock_check(p_machine,p_request,record,items,outlet,null,null,'machine');id:=(result->'check'->>'id')::uuid;
 when 'restaurant_purchase_order' then
  if a in ('create','update') then
   record:=record||'{"status":"draft"}';result:=feedx_integrations.ra_save_purchase_order(p_machine,p_request,record,items,outlet,null,null,'machine');id:=(result->'order'->>'id')::uuid;
  elsif a='receive' then result:=feedx_integrations.ra_receive_purchase_order(p_machine,p_target,p_request,p_input->>'reason',items,outlet,null,null,'machine');
  else result:=feedx_integrations.ra_transition_purchase_order(p_machine,p_target,p_request,case when a='return_to_draft' then 'reopen_draft' else a end,p_input->>'reason',outlet,null,null,'machine');end if;
 when 'restaurant_movement' then
  if record ?| array['reference_id','reference_no','created_at'] then raise exception using errcode='22023',message='Movement references and recording timestamp are server-owned';end if;
  if record->>'movement_type' is not null and lower(record->>'movement_type')<>'adjustment' then raise exception using errcode='22023',message='Use the canonical Receiving or Waste action; manual movements are Adjustments only';end if;
  record:=record||'{"movement_type":"Adjustment","reference_type":"manual"}';result:=feedx_integrations.ra_inventory_save_manual_movement(p_machine,p_request,record);id:=(result->'movement'->>'id')::uuid;
 when 'restaurant_waste' then
  result:=feedx_integrations.ra_inventory_save_waste(p_machine,p_request,outlet,(record->>'inventory_item_id')::uuid,record->>'waste_type',(record->>'quantity')::numeric,record->>'unit',(record->>'waste_date')::date,record->>'notes',record->>'photo_url');id:=(result->>'waste_id')::uuid;
 when 'restaurant_recipe' then
  result:=feedx_integrations.ra_inventory_save_recipe(p_machine,p_request,record,items);id:=(result->'recipe'->>'id')::uuid;
 else raise exception using errcode='22023',message='Unsupported Restaurant command';
 end case;
 return id;
end $$;
revoke all on function feedx_integrations.restaurant_execute(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
