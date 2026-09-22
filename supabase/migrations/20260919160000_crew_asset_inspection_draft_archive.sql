-- Crew may cancel only its own resumable inspection draft. The completed
-- inspection/evidence lifecycle remains immutable and is never affected.
create or replace function public.crew_asset_archive_inspection_draft(
  p_token text,
  p_request_id uuid,
  p_inspection_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_inspection public.asset_inspections%rowtype;
  v_result jsonb;
begin
  if not coalesce((v_context->>'can_perform_asset_inspections')::boolean, false) then
    raise exception using errcode = '42501', message = 'Perform Asset Inspections Special Access is required.';
  end if;
  if p_request_id is null or p_inspection_id is null then
    raise exception using errcode = '22023', message = 'Inspection cancellation is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result
  from public.asset_lifecycle_requests
  where request_id = p_request_id and operation = 'inspection_archive';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id = p_request_id) then
    raise exception using errcode = '22023', message = 'Request ID was already used for another Asset action.';
  end if;

  select * into v_inspection
  from public.asset_inspections
  where id = p_inspection_id
  for update;
  if not found
    or v_inspection.outlet_id <> v_outlet_id
    or v_inspection.checked_by_employee_id <> v_employee_id then
    raise exception using errcode = '42501', message = 'Inspection draft is unavailable.';
  end if;
  if v_inspection.status not in ('draft', 'in_progress') then
    raise exception using errcode = '55000', message = 'Only resumable inspection drafts can be cancelled.';
  end if;

  update public.asset_inspections
  set status = 'archived', last_edited_at = now(), updated_at = now()
  where id = v_inspection.id
  returning * into v_inspection;

  v_result := jsonb_build_object(
    'inspection_id', v_inspection.id,
    'outlet_id', v_inspection.outlet_id,
    'status', v_inspection.status,
    'request_id', p_request_id,
    'actor_employee_id', v_employee_id
  );
  insert into public.asset_lifecycle_requests(request_id, operation, actor_employee_id, outlet_id, result)
  values(p_request_id, 'inspection_archive', v_employee_id, v_outlet_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.crew_asset_archive_inspection_draft(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crew_asset_archive_inspection_draft(text, uuid, uuid) to anon, authenticated;
