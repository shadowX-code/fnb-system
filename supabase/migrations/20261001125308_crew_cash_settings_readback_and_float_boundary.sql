-- General settings edits preserve the stored float field when no float change is requested.
-- The immutable float-adjustment ledger remains the effective amount authority.
create or replace function public.crew_cash_save_settings(p_outlet_id uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  current_row public.crew_cash_settings%rowtype;
  next_float numeric;
  current_effective_float numeric;
  effective date;
  reason text;
  positions_supplied boolean;
  next_position_ids uuid[];
  next_position_names text[];
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_checkout.manage');
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='Cash settings payload is invalid.';
  end if;
  if p_payload ? 'required_position_ids' and jsonb_typeof(p_payload->'required_position_ids')<>'array' then
    raise exception using errcode='22023',message='Checkout position IDs must be an array.';
  end if;
  if p_payload ? 'required_positions' and jsonb_typeof(p_payload->'required_positions')<>'array' then
    raise exception using errcode='22023',message='Checkout positions must be an array.';
  end if;

  select * into current_row
  from public.crew_cash_settings
  where outlet_id=p_outlet_id
  for update;

  current_effective_float:=public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date);
  next_float:=coalesce((p_payload->>'floating_cash')::numeric,current_effective_float,0);
  effective:=coalesce((p_payload->>'effective_date')::date,timezone('Asia/Kuala_Lumpur',now())::date);
  reason:=nullif(btrim(p_payload->>'reason'),'');
  positions_supplied:=p_payload ? 'required_position_ids' or p_payload ? 'required_positions';

  if next_float<0 or coalesce((p_payload->>'variance_tolerance')::numeric,current_row.variance_tolerance,0)<0 then
    raise exception using errcode='22023',message='Cash settings amounts cannot be negative.';
  end if;
  if next_float is distinct from current_effective_float and reason is null then
    raise exception using errcode='22023',message='A reason is required when Floating Cash changes.';
  end if;

  if p_payload ? 'required_position_ids' then
    select coalesce(array_agg(value::uuid order by ordinal), '{}'::uuid[])
    into next_position_ids
    from jsonb_array_elements_text(p_payload->'required_position_ids') with ordinality item(value,ordinal);
  elsif p_payload ? 'required_positions' then
    select coalesce(array_agg(jp.id order by item.ordinal), '{}'::uuid[])
    into next_position_ids
    from jsonb_array_elements_text(p_payload->'required_positions') with ordinality item(value,ordinal)
    join public.job_positions jp on lower(jp.name)=lower(item.value);
    if cardinality(next_position_ids) <> jsonb_array_length(p_payload->'required_positions') then
      raise exception using errcode='22023',message='Every Checkout Position must match a canonical Job Position.';
    end if;
  else
    next_position_ids:=coalesce(current_row.required_position_ids,'{}'::uuid[]);
  end if;

  if positions_supplied and exists (
    select 1 from unnest(next_position_ids) configured(id)
    where not exists (select 1 from public.job_positions jp where jp.id=configured.id)
  ) then
    raise exception using errcode='22023',message='Every Checkout Position must match a canonical Job Position.';
  end if;

  if positions_supplied then
    select coalesce(array_agg(jp.name order by configured.ordinal), '{}'::text[])
    into next_position_names
    from unnest(next_position_ids) with ordinality configured(id,ordinal)
    join public.job_positions jp on jp.id=configured.id;
  else
    next_position_names:=coalesce(current_row.required_positions,'{}'::text[]);
  end if;

  if current_row.id is null then
    insert into public.crew_cash_settings(
      outlet_id,floating_cash,variance_tolerance,required_positions,required_position_ids,
      closing_deadline,require_receiver_confirmation,require_manager_review_over_tolerance,created_by,updated_by
    ) values(
      p_outlet_id,next_float,coalesce((p_payload->>'variance_tolerance')::numeric,0),next_position_names,next_position_ids,
      nullif(p_payload->>'closing_deadline','')::time,coalesce((p_payload->>'require_receiver_confirmation')::boolean,true),
      coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,true),auth.uid(),auth.uid()
    ) returning * into current_row;
  else
    update public.crew_cash_settings set
      floating_cash=case when p_payload ? 'floating_cash' then next_float else floating_cash end,
      variance_tolerance=coalesce((p_payload->>'variance_tolerance')::numeric,variance_tolerance),
      required_positions=case when positions_supplied then next_position_names else required_positions end,
      required_position_ids=case when positions_supplied then next_position_ids else required_position_ids end,
      closing_deadline=case when p_payload ? 'closing_deadline' then nullif(p_payload->>'closing_deadline','')::time else closing_deadline end,
      require_receiver_confirmation=coalesce((p_payload->>'require_receiver_confirmation')::boolean,require_receiver_confirmation),
      require_manager_review_over_tolerance=coalesce((p_payload->>'require_manager_review_over_tolerance')::boolean,require_manager_review_over_tolerance),
      updated_at=now(),updated_by=auth.uid()
    where id=current_row.id
    returning * into current_row;
  end if;

  if next_float is distinct from current_effective_float then
    insert into public.crew_cash_float_adjustments(outlet_id,previous_amount,new_amount,effective_date,reason,adjusted_by)
    values(p_outlet_id,current_effective_float,next_float,effective,reason,auth.uid());
  end if;

  return to_jsonb(current_row) || jsonb_build_object('effective_floating_cash',public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date));
end;
$$;

revoke all on function public.crew_cash_save_settings(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_save_settings(uuid,jsonb) to authenticated;

-- Admin context reports the current dated float rather than treating a future
-- adjustment stored on the settings row as already effective.
create or replace function public.crew_cash_admin_context(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_settings jsonb; v_employees jsonb; v_receivers jsonb; v_positions jsonb; v_history jsonb;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.'; end if;
 select to_jsonb(s) || jsonb_build_object('effective_floating_cash',public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date)) into v_settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into v_employees from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=p_outlet_id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into v_receivers from public.crew_cash_handover_receivers r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and public.crew_cash_receiver_is_eligible(p_outlet_id,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.status) order by p.name),'[]'::jsonb) into v_positions from public.job_positions p where p.status='active' or p.id=any(coalesce((select required_position_ids from public.crew_cash_settings where outlet_id=p_outlet_id),'{}'::uuid[]));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'previous_amount',a.previous_amount,'new_amount',a.new_amount,'effective_date',a.effective_date,'reason',a.reason,'adjusted_at',a.adjusted_at,'adjusted_by',coalesce(u.email,'Admin')) order by a.effective_date desc,a.adjusted_at desc),'[]'::jsonb) into v_history from public.crew_cash_float_adjustments a left join auth.users u on u.id=a.adjusted_by where a.outlet_id=p_outlet_id;
 return jsonb_build_object('settings',v_settings,'employees',v_employees,'eligible_receivers',v_receivers,'checkout_positions',v_positions,'float_history',v_history,'receiver_configuration',coalesce((select jsonb_build_object('version',c.version,'updated_at',c.updated_at) from public.crew_cash_handover_receiver_configs c where c.outlet_id=p_outlet_id),'{}'::jsonb));
end; $$;
revoke all on function public.crew_cash_admin_context(uuid) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_context(uuid) to authenticated;
