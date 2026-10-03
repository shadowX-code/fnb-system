-- Receiver eligibility uses canonical workplace/Role outlet authorization.
-- Admin selection grants receiving only; initiation remains separate Special Access.

create or replace function public.crew_cash_receiver_candidate_is_eligible(p_outlet_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id
  where e.id=p_employee_id and e.is_active
   and coalesce(e.employment_status,'active') not in ('resigned','terminated')
   and ca.access_state='active'
   and p_outlet_id=any(public.crew_authorized_outlet_ids(e.id))
   and ((lower(btrim(coalesce(e.workplace,'')))='management' and ca.primary_outlet_id is null)
    or (lower(btrim(coalesce(e.workplace,'')))<>'management'
     and ca.primary_outlet_id=p_outlet_id and public.crew_resolve_employee_outlet(e.id)=p_outlet_id))
 );
$$;
revoke all on function public.crew_cash_receiver_candidate_is_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_cash_receiver_is_eligible(p_outlet_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.crew_cash_receiver_candidate_is_eligible(p_outlet_id,p_employee_id)
  and exists(select 1 from public.crew_cash_handover_receivers r
   where r.outlet_id=p_outlet_id and r.employee_id=p_employee_id);
$$;
revoke all on function public.crew_cash_receiver_is_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_cash_save_handover_receivers(p_outlet_id uuid,p_employee_ids uuid[],p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_version integer; prior uuid[]; next_ids uuid[]:=coalesce(p_employee_ids,'{}'::uuid[]); candidate uuid;
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
  insert into public.crew_cash_handover_receiver_configs(outlet_id) values(p_outlet_id) on conflict(outlet_id) do nothing;
  select version into current_version from public.crew_cash_handover_receiver_configs where outlet_id=p_outlet_id for update;
  if p_expected_version is null or p_expected_version<>current_version then raise exception using errcode='40001',message='Receiver configuration changed. Reload before saving.'; end if;
  foreach candidate in array next_ids loop
    if not public.crew_cash_receiver_candidate_is_eligible(p_outlet_id,candidate) then raise exception using errcode='22023',message='Receiver must be active outlet Crew or Management authorized for this outlet.'; end if;
  end loop;
  select coalesce(array_agg(employee_id order by employee_id),'{}'::uuid[]) into prior from public.crew_cash_handover_receivers where outlet_id=p_outlet_id;
  delete from public.crew_cash_handover_receivers where outlet_id=p_outlet_id and not (employee_id=any(next_ids));
  insert into public.crew_cash_handover_receivers(outlet_id,employee_id,configured_by) select p_outlet_id,id,auth.uid() from unnest(next_ids) id on conflict(outlet_id,employee_id) do nothing;
  update public.crew_cash_handover_receiver_configs set version=version+1,updated_by=auth.uid(),updated_at=now() where outlet_id=p_outlet_id returning version into current_version;
  insert into public.crew_cash_handover_receiver_config_audit(outlet_id,version,previous_receiver_ids,receiver_ids,changed_by) values(p_outlet_id,current_version,prior,next_ids,auth.uid());
  return jsonb_build_object('version',current_version,'receiver_ids',next_ids);
end;
$$;
revoke all on function public.crew_cash_save_handover_receivers(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.crew_cash_save_handover_receivers(uuid,uuid[],integer) to authenticated;

create or replace function public.crew_cash_save_handover_receivers(p_outlet_id uuid,p_employee_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate uuid;
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
  foreach candidate in array coalesce(p_employee_ids,'{}'::uuid[]) loop
    if not public.crew_cash_receiver_candidate_is_eligible(p_outlet_id,candidate) then
      raise exception using errcode='22023',message='Receiver must be active outlet Crew or Management authorized for this outlet.';
    end if;
  end loop;
  delete from public.crew_cash_handover_receivers where outlet_id=p_outlet_id and employee_id<>all(coalesce(p_employee_ids,'{}'::uuid[]));
  insert into public.crew_cash_handover_receivers(outlet_id,employee_id,configured_by)
  select p_outlet_id,employee_id,auth.uid() from unnest(coalesce(p_employee_ids,'{}'::uuid[])) employee_id
  on conflict(outlet_id,employee_id) do nothing;
  return jsonb_build_object('receiver_ids',coalesce(p_employee_ids,'{}'::uuid[]));
end;
$$;
revoke all on function public.crew_cash_save_handover_receivers(uuid,uuid[]) from public,anon,authenticated;

create or replace function public.crew_cash_admin_context(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_settings jsonb; v_employees jsonb; v_receivers jsonb; v_positions jsonb; v_history jsonb;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.'; end if;
 select to_jsonb(s) || jsonb_build_object('effective_floating_cash',public.crew_cash_float_at(p_outlet_id,timezone('Asia/Kuala_Lumpur',now())::date)) into v_settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position,'workplace',e.workplace) order by e.full_name),'[]'::jsonb) into v_employees from public.employees e where public.crew_cash_receiver_candidate_is_eligible(p_outlet_id,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position,'workplace',e.workplace) order by e.full_name),'[]'::jsonb) into v_receivers from public.crew_cash_handover_receivers r join public.employees e on e.id=r.employee_id where r.outlet_id=p_outlet_id and public.crew_cash_receiver_is_eligible(p_outlet_id,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',p.status) order by p.name),'[]'::jsonb) into v_positions from public.job_positions p where p.status='active' or p.id=any(coalesce((select required_position_ids from public.crew_cash_settings where outlet_id=p_outlet_id),'{}'::uuid[]));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'previous_amount',a.previous_amount,'new_amount',a.new_amount,'effective_date',a.effective_date,'reason',a.reason,'adjusted_at',a.adjusted_at,'adjusted_by',coalesce(u.email,'Admin')) order by a.effective_date desc,a.adjusted_at desc),'[]'::jsonb) into v_history from public.crew_cash_float_adjustments a left join auth.users u on u.id=a.adjusted_by where a.outlet_id=p_outlet_id;
 return jsonb_build_object('settings',v_settings,'employees',v_employees,'eligible_receivers',v_receivers,'checkout_positions',v_positions,'float_history',v_history,'receiver_configuration',coalesce((select jsonb_build_object('version',c.version,'updated_at',c.updated_at) from public.crew_cash_handover_receiver_configs c where c.outlet_id=p_outlet_id),'{}'::jsonb));
end; $$;
revoke all on function public.crew_cash_admin_context(uuid) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_context(uuid) to authenticated;

create or replace function public.crew_outlet_scope(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_employee_id uuid:=public.crew_session_employee(p_token);
  v_employee public.employees%rowtype; v_ids uuid[]; v_outlets jsonb;
  v_default uuid; v_management boolean;
begin
  select * into v_employee from public.employees where id=v_employee_id;
  v_management:=lower(btrim(coalesce(v_employee.workplace,'')))='management';
  v_ids:=public.crew_authorized_outlet_ids(v_employee_id);
  if cardinality(v_ids)=0 then
    raise exception using errcode='42501',message='Crew Access is no longer active. Please sign in again.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,
      'special_access',public.crew_special_access_for_outlet(v_employee_id,o.id),
      'is_cash_handover_receiver',public.crew_cash_receiver_is_eligible(o.id,v_employee_id)
        or exists(select 1 from public.crew_cash_collections c where c.outlet_id=o.id
          and c.receiver_employee_id=v_employee_id and c.status='pending_receipt'))
      order by o.name,o.id),'[]'::jsonb),
    (array_agg(o.id order by o.name,o.id))[1]
  into v_outlets,v_default from public.outlets o where o.id=any(v_ids);
  return jsonb_build_object('employee_id',v_employee_id,'management',v_management,
    'outlets',v_outlets,'default_outlet_id',v_default);
end; $$;
revoke all on function public.crew_outlet_scope(text) from public,anon,authenticated;
grant execute on function public.crew_outlet_scope(text) to anon,authenticated;

-- Receiver-only Management reads its assigned receipts without entering the
-- initiation scope or gaining Cash Checkout/deposit-ledger authority.
create or replace function public.crew_management_cash_mobile(p_token text,p_outlet_id uuid,p_business_date date)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_employee uuid:=public.crew_session_employee(p_token); v_payload jsonb; v_pending jsonb; v_receiver boolean; v_outlet_name text;
begin
 if not exists(select 1 from public.employees e where e.id=v_employee and lower(btrim(coalesce(e.workplace,'')))='management') then
  raise exception using errcode='42501',message='Management Cash access is unavailable.';
 end if;
 perform public.crew_selected_outlet(p_token,p_outlet_id);
 if public.crew_can_initiate_cash_handover(v_employee,p_outlet_id) then
  perform public.crew_management_cash_scope(p_token,p_outlet_id);
  v_payload:=public.crew_cash_mobile(p_token,p_business_date);
  return (v_payload - 'checkout' - 'cash_context' - 'settings')
   || jsonb_build_object('can_perform',false,'checkout',null,'read_only_checkout',true);
 end if;
 v_receiver:=public.crew_cash_receiver_is_eligible(p_outlet_id,v_employee)
  or exists(select 1 from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.receiver_employee_id=v_employee and c.status='pending_receipt');
 if not v_receiver then raise exception using errcode='42501',message='Cash Handover access is unavailable.'; end if;
 select o.name into v_outlet_name from public.outlets o where o.id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'note',c.note,
  'sender',coalesce(sender.full_name,admin_sender.full_name,'Admin'),'outlet_name',v_outlet_name,
  'occurred_at',c.submitted_at) order by c.submitted_at desc),'[]'::jsonb) into v_pending
 from public.crew_cash_collections c
 left join public.employees sender on sender.id=c.handed_over_by_employee_id
 left join public.employees admin_sender on admin_sender.auth_user_id=c.handed_over_by_user_id
 where c.outlet_id=p_outlet_id and c.receiver_employee_id=v_employee and c.status='pending_receipt';
 return jsonb_build_object('outlet',jsonb_build_object('id',p_outlet_id,'name',v_outlet_name),
  'business_date',p_business_date,'can_perform',false,'can_record_collection',false,'can_initiate_handover',false,
  'checkout',null,'read_only_checkout',true,'deposit',null,'receivers','[]'::jsonb,
  'is_cash_handover_receiver',true,'pending_receipts',v_pending);
end; $$;
revoke all on function public.crew_management_cash_mobile(text,uuid,date) from public,anon,authenticated;
grant execute on function public.crew_management_cash_mobile(text,uuid,date) to anon,authenticated;

create or replace function public.crew_cash_confirm_collection(p_token text,p_collection_id uuid,p_received_amount numeric)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid; row public.crew_cash_collections%rowtype;
begin
  employee:=public.crew_session_employee(p_token);
  select * into row from public.crew_cash_collections where id=p_collection_id for update;
  if row.id is null or row.receiver_employee_id<>employee then
    raise exception using errcode='42501',message='This Cash Handover is not assigned to you.';
  end if;
  if exists(select 1 from public.employees e where e.id=employee
    and lower(btrim(coalesce(e.workplace,'')))='management') then
    perform public.crew_selected_outlet(p_token,row.outlet_id);
  end if;
  if row.status in ('completed','review_required') then return to_jsonb(row); end if;
  if row.status<>'pending_receipt' then
    raise exception using errcode='22023',message='This Cash Handover is no longer awaiting confirmation.';
  end if;
  if p_received_amount is distinct from row.amount then
    raise exception using errcode='22023',message='Cash Handover confirmation must acknowledge the handed-over amount.';
  end if;
  update public.crew_cash_collections
  set received_amount=row.amount,difference=0,received_by_employee_id=employee,confirmed_at=now(),status='completed'
  where id=row.id returning * into row;
  return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_confirm_collection(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.crew_cash_confirm_collection(text,uuid,numeric) to anon,authenticated;
