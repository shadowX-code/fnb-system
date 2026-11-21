-- Verified FeedX Staging only. All rows are synthetic and all fixture changes roll back.
begin;
set local lock_timeout = '1500ms';
set local statement_timeout = '15s';

do $$
declare
  v_today date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_outlet uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_expired uuid := gen_random_uuid();
  v_current uuid := gen_random_uuid();
  v_future uuid := gen_random_uuid();
  v_undated uuid := gen_random_uuid();
  v_correction_item uuid := gen_random_uuid();
  v_expired_check uuid := gen_random_uuid();
  v_current_check uuid := gen_random_uuid();
  v_future_check uuid := gen_random_uuid();
  v_undated_check uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
  v_actor uuid;
  v_candidate uuid;
begin
  if inventory_authority.scheduled_stock_check_occurrence_expired('2026-10-31', '2026-10-31 15:59:59.999999+00')
    or not inventory_authority.scheduled_stock_check_occurrence_expired('2026-10-31', '2026-10-31 16:00:00+00')
    or inventory_authority.scheduled_stock_check_occurrence_expired('2026-11-01', '2026-10-31 16:00:00+00')
    or inventory_authority.scheduled_stock_check_occurrence_expired(null, now())
    or inventory_authority.scheduled_stock_check_occurrence_expired('-infinity', now())
    or has_function_privilege('authenticated', 'inventory_authority.scheduled_stock_check_occurrence_expired(date,timestamptz)', 'execute') then
    raise exception 'Scheduled expiry at the MYT boundary, conservative fallback or private access failed';
  end if;

  insert into public.outlets(id,name,code)
    values(v_outlet,'QA UOM Expiry','QAUE'||left(v_outlet::text,6));
  insert into public.inventory_stock_check_groups(id,outlet_id,name,shift,frequency_days)
    values(v_group,v_outlet,'QA UOM Expiry','Morning',array[to_char(v_today,'FMDay')]);
  insert into public.inventory_items(id,item_name,unit) values
    (v_expired,'QA Expired Scheduled','kg'),(v_current,'QA Current Scheduled','kg'),
    (v_future,'QA Future Scheduled','kg'),(v_undated,'QA Undated Scheduled','kg'),
    (v_correction_item,'QA Audit Correction','kg');
  insert into public.inventory_item_outlets(inventory_item_id,outlet_id,par_unit,par_level)
    select item_id,v_outlet,'kg',case when item_id=v_expired then 2.5 end
    from unnest(array[v_expired,v_current,v_future,v_undated,v_correction_item]) as fixture(item_id);

  insert into public.inventory_stock_checks(id,outlet_id,group_id,stock_check_type,shift,check_date,status)
    values(v_current_check,v_outlet,v_group,'scheduled','Morning',v_today,'draft');
  -- Seed legacy headers that cannot be constructed through the current write trigger.
  alter table public.inventory_stock_checks disable trigger inventory_scheduled_stock_check_date_guard;
  insert into public.inventory_stock_checks(id,outlet_id,group_id,stock_check_type,shift,check_date,status)
    values(v_expired_check,v_outlet,v_group,'scheduled','Morning',v_today-1,'draft'),
      (v_future_check,v_outlet,v_group,'scheduled','Morning',v_today+1,'draft'),
      (v_undated_check,v_outlet,v_group,'scheduled','Morning',null,'draft');
  alter table public.inventory_stock_checks enable trigger inventory_scheduled_stock_check_date_guard;

  insert into public.inventory_stock_checks(id,outlet_id,stock_check_type,audit_type,check_date,status)
    values(v_source,v_outlet,'audit','Spot Check',v_today-1,'draft');
  insert into public.inventory_stock_check_items(stock_check_id,item_id,actual_count_quantity,par_level_quantity,unit,notes)
    values(v_expired_check,v_expired,2.125,2.5,'kg','Retained historical count'),
      (v_current_check,v_current,1,2,'kg',null),(v_future_check,v_future,1,2,'kg',null),
      (v_undated_check,v_undated,1,2,'kg',null),(v_source,v_correction_item,2,3,'kg',null);
  update public.inventory_stock_checks set status='submitted',submitted_at=now() where id=v_source;

  for v_candidate in
    select employee.auth_user_id from public.employees employee join public.roles role on role.id=employee.role_id
    where lower(role.name) in ('owner','admin') and employee.auth_user_id is not null
    union select profile.id from public.user_profiles profile join public.roles role on role.id=profile.role_id where lower(role.name) in ('owner','admin')
  loop
    perform set_config('request.jwt.claim.sub',v_candidate::text,true);
    if public.current_user_has_permission('inventory_master.edit')
      and public.current_user_can_access_outlet(v_outlet)
      and inventory_authority.can_correct_audit() then v_actor := v_candidate; exit; end if;
  end loop;
  if v_actor is null then raise exception 'A scoped Staging Inventory administrator is required'; end if;

  begin
    update public.inventory_stock_checks set status='submitted' where id=v_expired_check;
    raise exception 'The scheduled write lifecycle allowed submission of a missed draft';
  exception when raise_exception then
    if sqlerrm <> 'A scheduled stock check is no longer due on this business date.' then raise; end if;
  end;
  update public.inventory_stock_checks set notes='Same business date remains resumable' where id=v_current_check;

  perform set_config('uom_expiry.expired',v_expired::text,true);
  perform set_config('uom_expiry.expired_check',v_expired_check::text,true);
  perform set_config('uom_expiry.current',v_current::text,true);
  perform set_config('uom_expiry.future',v_future::text,true);
  perform set_config('uom_expiry.undated',v_undated::text,true);
  perform set_config('uom_expiry.correction_item',v_correction_item::text,true);
  perform set_config('uom_expiry.source',v_source::text,true);
end;
$$;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('uom_expiry.expired')::uuid;
  v_check uuid := current_setting('uom_expiry.expired_check')::uuid;
  v_blocked uuid;
  v_before jsonb;
  v_after jsonb;
  v_history jsonb;
begin
  select jsonb_build_array(to_jsonb(c),to_jsonb(l)) into strict v_before
    from public.inventory_stock_checks c join public.inventory_stock_check_items l on l.stock_check_id=c.id where c.id=v_check;
  perform public.inventory_create_audit_correction(current_setting('uom_expiry.source')::uuid,gen_random_uuid());
  foreach v_blocked in array array[current_setting('uom_expiry.current')::uuid,current_setting('uom_expiry.future')::uuid,
    current_setting('uom_expiry.undated')::uuid,current_setting('uom_expiry.correction_item')::uuid]
  loop
    if coalesce(public.inventory_master_stock_uom_history(v_blocked)->>'blocked_reason','') not like 'Submit or discard the open Stock Check%' then
      raise exception 'The UOM read model did not report unresolved Stock Check work';
    end if;
    begin
      perform public.inventory_master_change_stock_uom(v_blocked,'g',gen_random_uuid(),null,'kg',null,.001);
      raise exception 'An unresolved Stock Check draft allowed cutover';
    exception when check_violation then
      if sqlerrm not like 'Submit or discard the open Stock Check%' then raise; end if;
    end;
  end loop;

  v_history := public.inventory_master_stock_uom_history(v_item);
  if v_history->>'blocked_reason' is not null or v_history->>'requires_conversion' is distinct from 'true' then
    raise exception 'Missed evidence either still blocks open work or lost its required conversion';
  end if;
  begin
    perform public.inventory_master_change_stock_uom(v_item,'g',gen_random_uuid(),null,'kg',null,null);
    raise exception 'Missed evidence allowed a factor-free cutover';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Enter how many current units%' then raise; end if;
  end;
  v_history := public.inventory_master_change_stock_uom(v_item,'g',gen_random_uuid(),null,'kg',null,.001);
  select jsonb_build_array(to_jsonb(c),to_jsonb(l)) into strict v_after
    from public.inventory_stock_checks c join public.inventory_stock_check_items l on l.stock_check_id=c.id where c.id=v_check;
  if v_history->>'unit' is distinct from 'g' or v_after is distinct from v_before
    or (select par_level from public.inventory_item_outlets where inventory_item_id=v_item) is distinct from 2500 then
    raise exception 'Successful exact UOM change altered missed evidence or failed to convert Par';
  end if;
end;
$$;

select 'PASS: MYT boundary, scheduled write parity, active and audit correction blockers, exact conversion and preserved missed evidence' as result;
rollback;
