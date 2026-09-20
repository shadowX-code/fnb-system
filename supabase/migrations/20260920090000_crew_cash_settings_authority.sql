-- Align Cash Checkout settings with canonical Job Position IDs and make the
-- receiver-confirmation setting apply consistently to Admin handovers.

alter table public.crew_cash_settings
  add column if not exists required_position_ids uuid[] not null default '{}'::uuid[];

update public.crew_cash_settings s
set required_position_ids = coalesce((
  select array_agg(jp.id order by jp.name)
  from public.job_positions jp
  where exists (
    select 1
    from unnest(s.required_positions) configured(name)
    where lower(configured.name) = lower(jp.name)
  )
), '{}'::uuid[])
where cardinality(s.required_position_ids) = 0
  and cardinality(s.required_positions) > 0;

create or replace function public.crew_cash_float_at(p_outlet_id uuid,p_date date)
returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(
  (select a.new_amount from public.crew_cash_float_adjustments a where a.outlet_id=p_outlet_id and a.effective_date<=p_date order by a.effective_date desc,a.adjusted_at desc limit 1),
  (select a.previous_amount from public.crew_cash_float_adjustments a where a.outlet_id=p_outlet_id order by a.effective_date,a.adjusted_at limit 1),
  (select s.floating_cash from public.crew_cash_settings s where s.outlet_id=p_outlet_id),0
 )::numeric(14,2);
$$;
revoke all on function public.crew_cash_float_at(uuid,date) from public,anon,authenticated;

create or replace function public.crew_cash_settings_context(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  settings_row public.crew_cash_settings%rowtype;
  selected_ids uuid[];
begin
  if not (
    (public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view'))
    and public.current_user_can_access_outlet(p_outlet_id)
  ) then
    raise exception using errcode='42501', message='Cash Checkout access is unavailable for this outlet.';
  end if;

  select * into settings_row
  from public.crew_cash_settings
  where outlet_id = p_outlet_id;

  selected_ids := coalesce(settings_row.required_position_ids, '{}'::uuid[]);

  return jsonb_build_object(
    'settings', coalesce(to_jsonb(settings_row), '{}'::jsonb) || jsonb_build_object(
      'effective_floating_cash', public.crew_cash_float_at(p_outlet_id, timezone('Asia/Kuala_Lumpur', now())::date),
      'required_position_ids', selected_ids
    ),
    'checkout_positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', jp.id, 'name', jp.name, 'status', jp.status) order by jp.name)
      from public.job_positions jp
      where jp.status = 'active' or jp.id = any(selected_ids)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.crew_cash_settings_context(uuid) from public, anon, authenticated;
grant execute on function public.crew_cash_settings_context(uuid) to authenticated;

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
      floating_cash=next_float,
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

create or replace function public.crew_cash_admin_record_collection(p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype; require_confirm boolean;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(p_outlet_id,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(p_outlet_id) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',p_outlet_id,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(p_outlet_id::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 select coalesce((select s.require_receiver_confirmation from public.crew_cash_settings s where s.outlet_id=p_outlet_id),true) into require_confirm;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_user_id,confirmed_at)
 values(p_outlet_id,request,fingerprint,'internal',receiver,null,amount,case when not require_confirm then amount end,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),case when require_confirm then 'pending_receipt' else 'completed' end,auth.uid(),case when not require_confirm then now() end) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id)
 values(p_outlet_id,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,auth.uid());
 return to_jsonb(row);
end; $$;
revoke all on function public.crew_cash_admin_record_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_record_collection(uuid,jsonb) to authenticated;
