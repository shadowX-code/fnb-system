-- Return committed inspection values so Crew never renders a stale quantity after a successful mutation.
create or replace function public.crew_asset_submit_inspection(p_token text,p_request_id uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_employee_name text := v_context->>'employee_name';
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_draft_id uuid := nullif(p_payload->>'draft_id','')::uuid;
  v_status text := lower(coalesce(nullif(p_payload->>'status',''),'completed'));
  v_rows jsonb := coalesce(p_payload->'rows','[]'::jsonb);
  v_inspection public.asset_inspections%rowtype;
  v_asset public.asset_items%rowtype;
  v_item public.asset_inspection_items%rowtype;
  v_row jsonb;
  v_evidence jsonb;
  v_expected numeric;
  v_counted numeric;
  v_condition text;
  v_result jsonb;
  v_asset_updates jsonb := '[]'::jsonb;
begin
  if not coalesce((v_context->>'can_perform_asset_inspections')::boolean,false) then
    raise exception using errcode='42501',message='Perform Asset Inspections Special Access is required.';
  end if;
  if p_request_id is null or jsonb_typeof(v_rows)<>'array' then raise exception using errcode='22023',message='Valid inspection request is required.'; end if;
  if v_status not in ('draft','in_progress','completed','partial') then raise exception using errcode='22023',message='Invalid inspection status.'; end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='inspection_submission';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  if v_status not in ('draft','in_progress') and (jsonb_array_length(v_rows)=0 or exists(
    select 1 from jsonb_array_elements(v_rows) r group by r->>'asset_id' having count(*)>1)) then
    raise exception using errcode='22023',message='A completed inspection needs unique asset rows.';
  end if;
  if v_draft_id is not null then
    select * into v_inspection from public.asset_inspections where id=v_draft_id for update;
    if not found or v_inspection.outlet_id<>v_outlet_id or v_inspection.checked_by_employee_id<>v_employee_id then raise exception using errcode='42501',message='Inspection draft is unavailable.'; end if;
    if v_inspection.status not in ('draft','in_progress','pending_review') then raise exception using errcode='55000',message='Completed inspections are immutable.'; end if;
    if v_status not in ('draft','in_progress') then delete from public.asset_inspection_items where inspection_id=v_inspection.id; end if;
    update public.asset_inspections set status=case when v_status in ('draft','in_progress') then v_status else status end,
      category_scope=coalesce(p_payload->'category_scope','{"type":"all","category_ids":[]}'::jsonb),
      current_step=coalesce(nullif(p_payload->>'current_step','')::int,1), completion_percentage=coalesce(nullif(p_payload->>'completion_percentage','')::numeric,0),
      draft_data=coalesce(p_payload->'draft_data','{}'::jsonb),notes=coalesce(p_payload->>'notes',''),last_edited_at=now(),updated_at=now()
      where id=v_draft_id returning * into v_inspection;
  else
    insert into public.asset_inspections(outlet_id,inspection_date,checked_by,checked_by_employee_id,category_scope,status,summary,current_step,completion_percentage,last_edited_at,draft_data,auto_saved,notes,remark,created_at,updated_at)
    values(v_outlet_id,current_date,v_employee_name,v_employee_id,coalesce(p_payload->'category_scope','{"type":"all","category_ids":[]}'::jsonb),
      case when v_status in ('draft','in_progress') then v_status else 'draft' end,coalesce(p_payload->'summary','{}'::jsonb),
      coalesce(nullif(p_payload->>'current_step','')::int,1),coalesce(nullif(p_payload->>'completion_percentage','')::numeric,0),now(),
      coalesce(p_payload->'draft_data','{}'::jsonb),false,coalesce(p_payload->>'notes',''),coalesce(p_payload->>'notes',''),now(),now()) returning * into v_inspection;
  end if;
  if v_status not in ('draft','in_progress') then
    for v_row in select value from jsonb_array_elements(v_rows) loop
      select * into v_asset from public.asset_items where id=nullif(v_row->>'asset_id','')::uuid for update;
      if not found or v_asset.outlet_id<>v_outlet_id or v_asset.status='archived' then raise exception using errcode='42501',message='Inspection asset is unavailable.'; end if;
      v_expected:=v_asset.current_quantity; v_counted:=coalesce(nullif(v_row->>'counted_quantity','')::numeric,0);
      v_condition:=lower(coalesce(nullif(v_row->>'condition_status',''),'healthy'));
      if v_counted<0 or v_condition not in ('healthy','needs_attention','low_quantity','damaged','missing') then raise exception using errcode='22023',message='Invalid inspection result.'; end if;
      if coalesce((v_row->>'evidence_required')::boolean,false) and jsonb_array_length(coalesce(v_row->'evidence','[]'::jsonb))=0 then raise exception using errcode='22023',message='Photo evidence is required for this condition.'; end if;
      insert into public.asset_inspection_items(inspection_id,asset_id,expected_quantity,counted_quantity,expected_qty,counted_qty,difference,condition,condition_status,condition_template_id,evidence_required,evidence_status,remark,created_at)
      values(v_inspection.id,v_asset.id,v_expected,v_counted,v_expected,v_counted,v_counted-v_expected,v_condition,v_condition,
        nullif(v_row->>'condition_template_id','')::uuid,coalesce((v_row->>'evidence_required')::boolean,false),
        case when jsonb_array_length(coalesce(v_row->'evidence','[]'::jsonb))>0 then 'complete' else 'not_required' end,coalesce(v_row->>'remark',''),now()) returning * into v_item;
      for v_evidence in select value from jsonb_array_elements(coalesce(v_row->'evidence','[]'::jsonb)) loop
        if nullif(v_evidence->>'image_url','') is null then raise exception using errcode='22023',message='Inspection evidence image is required.'; end if;
        insert into public.asset_inspection_evidence(inspection_item_id,image_url,caption,created_at)
        values(v_item.id,v_evidence->>'image_url',nullif(v_evidence->>'caption',''),now());
      end loop;
      update public.asset_items set current_quantity=v_counted,condition=v_condition,last_inspection_at=current_date,updated_at=now() where id=v_asset.id returning * into v_asset;
      v_asset_updates:=v_asset_updates || jsonb_build_array(jsonb_build_object('id',v_asset.id,'current_quantity',v_asset.current_quantity,'condition',v_asset.condition,'last_inspection_at',v_asset.last_inspection_at));
      if v_counted<>v_expected then insert into public.asset_movement_logs(asset_id,outlet_id,movement_type,quantity_change,quantity_before,quantity_after,reason,remark,movement_date,created_by_employee_id,created_at)
        values(v_asset.id,v_outlet_id,'correction',v_counted-v_expected,v_expected,v_counted,'inspection','Crew inspection correction',current_date,v_employee_id,now()); end if;
    end loop;
    update public.asset_inspections set status=v_status,summary=jsonb_build_object('total_assets',jsonb_array_length(v_rows),'checked_assets',jsonb_array_length(v_rows),'completion_percentage',100),completion_percentage=100,updated_at=now() where id=v_inspection.id returning * into v_inspection;
  end if;
  v_result:=jsonb_build_object('inspection_id',v_inspection.id,'outlet_id',v_outlet_id,'status',v_inspection.status,'request_id',p_request_id,'actor_employee_id',v_employee_id,'asset_updates',v_asset_updates);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result)
  values(p_request_id,'inspection_submission',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;
