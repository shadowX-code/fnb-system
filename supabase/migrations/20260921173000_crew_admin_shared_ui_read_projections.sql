-- Shared Admin presentation refinements retain the existing authorities while
-- adding the Crew Access employment-status scope and safe ledger actor labels.
create or replace function public.crew_access_admin_page(
  p_outlet_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_query text := btrim(coalesce(p_filters->>'query', ''));
  v_employment_status text := nullif(btrim(coalesce(p_filters->>'employment_status', '')), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_total integer;
  v_rows jsonb;
  v_summary jsonb;
begin
  if p_outlet_id is null or not (public.current_user_has_permission('crew_employees.view') or public.current_user_has_permission('crew_employees.manage')) then
    raise exception using errcode='42501', message='Missing permission to view Crew Access.';
  end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501', message='You cannot view Crew Access outside your outlet scope.';
  end if;

  with source as (
    select e.*, ca.employee_id as access_employee_id, ca.mobile_number as crew_mobile_number, ca.access_state as crew_access_state, ca.activated_at as crew_activated_at, ca.disabled_at as crew_disabled_at, ca.locked_until as crew_locked_until, ca.last_login_at as crew_last_login_at, ca.primary_outlet_id as crew_primary_outlet_id, ca.can_initiate_handover as crew_can_initiate_handover, ca.can_add_assets as crew_can_add_assets, ca.can_manage_asset_details as crew_can_manage_asset_details, ca.can_adjust_assets as crew_can_adjust_assets, ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%')
      and (v_employment_status is null or v_employment_status='all' or coalesce(employment_status, 'active')=v_employment_status)
  ) select count(*) into v_total from filtered;

  with source as (
    select e.*, ca.employee_id as access_employee_id, ca.mobile_number as crew_mobile_number, ca.access_state as crew_access_state, ca.activated_at as crew_activated_at, ca.disabled_at as crew_disabled_at, ca.locked_until as crew_locked_until, ca.last_login_at as crew_last_login_at, ca.primary_outlet_id as crew_primary_outlet_id, ca.can_initiate_handover as crew_can_initiate_handover, ca.can_add_assets as crew_can_add_assets, ca.can_manage_asset_details as crew_can_manage_asset_details, ca.can_adjust_assets as crew_can_adjust_assets, ca.can_perform_asset_inspections as crew_can_perform_asset_inspections
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ), filtered as (
    select * from source where (v_query='' or concat_ws(' ', full_name, employee_code, position, workplace) ilike '%' || v_query || '%')
      and (v_employment_status is null or v_employment_status='all' or coalesce(employment_status, 'active')=v_employment_status)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'full_name', full_name, 'employee_code', employee_code, 'position', position, 'workplace', workplace, 'contact', contact,
    'employment_type', employment_type, 'employment_status', employment_status, 'is_active', is_active,
    'crew_access', case when access_employee_id is null then null else jsonb_build_object(
      'employee_id', access_employee_id, 'mobile_number', crew_mobile_number, 'access_state', crew_access_state, 'activated_at', crew_activated_at,
      'disabled_at', crew_disabled_at, 'locked_until', crew_locked_until, 'last_login_at', crew_last_login_at, 'primary_outlet_id', crew_primary_outlet_id,
      'can_initiate_handover', crew_can_initiate_handover, 'can_add_assets', crew_can_add_assets, 'can_manage_asset_details', crew_can_manage_asset_details,
      'can_adjust_assets', crew_can_adjust_assets, 'can_perform_asset_inspections', crew_can_perform_asset_inspections
    ) end
  ) order by full_name, id), '[]'::jsonb) into v_rows
  from (select * from filtered order by full_name, id offset (v_page - 1) * v_size limit v_size) page_rows;

  with source as (
    select coalesce(ca.access_state, 'not_enabled') as crew_access_state
    from public.employees e left join public.crew_access ca on ca.employee_id=e.id
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
  ) select jsonb_build_object(
    'active', count(*) filter (where crew_access_state='active'),
    'locked', count(*) filter (where crew_access_state='locked'),
    'not_enabled', count(*) filter (where crew_access_state='not_enabled')
  ) into v_summary from source;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;
revoke all on function public.crew_access_admin_page(uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.crew_access_admin_page(uuid,jsonb,integer,integer) to authenticated;

create or replace function public.crew_cash_admin_page(p_outlet_id uuid,p_from date,p_to date,p_listing text default 'checkouts',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in(20,50,100) then p_page_size else 20 end; v_total integer; v_rows jsonb; v_summary jsonb; v_settings jsonb; v_collections jsonb;
begin
 if not ((public.current_user_has_permission('crew_cash_checkout.view') or public.current_user_has_permission('crew_cash_deposit.view')) and public.current_user_can_access_outlet(p_outlet_id)) then raise exception using errcode='42501',message='Cash Checkout access is unavailable for this outlet.'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception using errcode='22023',message='Cash Checkout date range must be 367 days or fewer.'; end if;
 if p_listing not in ('checkouts','ledger') then raise exception using errcode='22023',message='Unsupported Cash Checkout listing.'; end if;
 select coalesce(to_jsonb(s),'{}'::jsonb) into v_settings from public.crew_cash_settings s where s.outlet_id=p_outlet_id;
 select jsonb_build_object('current_balance',coalesce(sum(signed_amount),0),'available_balance',public.crew_cash_available_balance(p_outlet_id),'total_added',coalesce(sum(greatest(signed_amount,0)),0),'total_collected',coalesce(sum(greatest(-signed_amount,0)),0),'pending_handover',coalesce((select sum(amount) from public.crew_cash_collections where outlet_id=p_outlet_id and status='pending_receipt'),0)) into v_summary from public.crew_cash_ledger_entries where outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_collections from (select c.*,coalesce(r.full_name,c.external_receiver_name) receiver_name from public.crew_cash_collections c left join public.employees r on r.id=c.receiver_employee_id where c.outlet_id=p_outlet_id and c.status in ('pending_receipt','review_required'))x;
 if p_listing='checkouts' then
  select count(*) into v_total from public.crew_cash_checkouts where outlet_id=p_outlet_id and business_date between p_from and p_to;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.business_date desc,x.id desc),'[]'::jsonb) into v_rows from (select c.*,e.full_name checked_out_by from public.crew_cash_checkouts c join public.employees e on e.id=c.checked_out_by_employee_id where c.outlet_id=p_outlet_id and c.business_date between p_from and p_to order by c.business_date desc,c.id desc offset (v_page-1)*v_size limit v_size)x;
 else
  select count(*) into v_total from public.crew_cash_ledger_entries l where l.outlet_id=p_outlet_id and timezone('Asia/Kuala_Lumpur',l.occurred_at)::date between p_from and p_to;
  with ledger as (select l.id,l.occurred_at,l.entry_type,l.activity,greatest(l.signed_amount,0) amount_in,greatest(-l.signed_amount,0) amount_out,sum(l.signed_amount) over(order by l.occurred_at,l.id) balance,l.receiver_name,coalesce(crew_actor.full_name,admin_actor.full_name,'Admin') recorded_by from public.crew_cash_ledger_entries l left join public.employees crew_actor on crew_actor.id=l.recorded_by_employee_id left join public.employees admin_actor on admin_actor.auth_user_id=l.recorded_by_user_id where l.outlet_id=p_outlet_id) select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into v_rows from (select * from ledger where timezone('Asia/Kuala_Lumpur',occurred_at)::date between p_from and p_to order by occurred_at desc,id desc offset (v_page-1)*v_size limit v_size)x;
 end if;
 return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,'summary',v_summary,'settings',v_settings,'collections',v_collections);
end; $$;
revoke all on function public.crew_cash_admin_page(uuid,date,date,text,integer,integer) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_page(uuid,date,date,text,integer,integer) to authenticated;
