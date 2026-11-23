create or replace function inventory_authority.save_stock_check(
  p_request_id uuid, p_check jsonb, p_items jsonb, p_scope_outlet uuid,
  p_actor_user uuid, p_actor_employee uuid, p_actor_kind text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_id uuid := nullif(p_check->>'id','')::uuid;
  v_result jsonb;
  v_closing jsonb;
begin
  if exists (select 1 from public.inventory_stock_checks where id = v_id and correction_of_id is not null) then
    v_result := inventory_authority.save_audit_correction(v_id, p_request_id, p_check, p_items,
      p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
  else
    v_result := feedx_integrations.ra_save_stock_check(null::uuid, p_request_id, p_check, p_items,
      p_scope_outlet, p_actor_user, p_actor_employee, p_actor_kind);
  end if;

  -- A rejection rolls back submission, cost pinning and the request log together.
  if v_result->'check'->>'status' = 'submitted' and v_result->'check'->>'audit_type' = 'Month-End Closing' then
    -- The Crew gateway already validated the session, outlet, and audit grant.
    -- Crew freezes evidence only. The distinct Admin command owns publication.
    if p_actor_kind = 'crew' and p_actor_user is null and p_actor_employee is not null then
      if p_check->'publish_closing' = 'true'::jsonb then
        raise exception using errcode = '42501', message = 'Only an authorized Admin can publish Closing Stock.';
      end if;
      return v_result;
    end if;
    if p_actor_kind <> 'admin' or p_actor_user is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'Save the closing draft for an authorized Admin to submit.';
    end if;
    if p_check->'publish_closing' is distinct from 'true'::jsonb then
      raise exception 'Reload FeedX to submit and publish this closing together.';
    end if;
    v_closing := inventory_authority.publish_closing_stock(
      (v_result->'check'->>'id')::uuid, p_request_id, nullif(p_check->>'actual_count_date','')::date, true);
    return v_result || jsonb_build_object('closing', v_closing);
  end if;
  return v_result;
end;
$$;
