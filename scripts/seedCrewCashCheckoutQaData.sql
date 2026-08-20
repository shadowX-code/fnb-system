-- FeedX Crew Cash Checkout QA dataset. STAGING ONLY; never a migration.
-- Uses only an existing Friends Corner QA Crew identity and creates no real employee.
begin;

do $$
declare
  outlet uuid;
  employee uuid;
  receiver uuid;
  qa_admin uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  balanced uuid := 'ca5c0001-0000-4000-8000-000000000001';
  short_row uuid := 'ca5c0001-0000-4000-8000-000000000002';
  over_row uuid := 'ca5c0001-0000-4000-8000-000000000003';
  shortfall_row uuid := 'ca5c0001-0000-4000-8000-000000000004';
begin
  select id into outlet from public.outlets where name='Friends Corner' limit 1;
  if outlet is null then raise exception 'Friends Corner Staging outlet is unavailable.'; end if;
  select e.id into employee from public.employees e join public.crew_access ca on ca.employee_id=e.id
   where e.employee_code like 'QA-%' and e.is_active and ca.primary_outlet_id=outlet and ca.access_state='active'
   order by e.employee_code limit 1;
  if employee is null then raise exception 'A safe active Friends Corner QA Crew employee is required.'; end if;
  select e.id into receiver from public.employees e join public.crew_access ca on ca.employee_id=e.id
   where e.employee_code like 'QA-%' and e.id<>employee and e.is_active and ca.primary_outlet_id=outlet and ca.access_state='active'
   order by e.employee_code limit 1;
  if receiver is null then raise exception 'A second safe Friends Corner QA Crew employee is required for handover.'; end if;
  if not exists(select 1 from auth.users where id=qa_admin) then raise exception 'Crew Admin QA identity is unavailable.'; end if;

  insert into public.crew_cash_settings(outlet_id,floating_cash,variance_tolerance,required_positions,closing_deadline,require_receiver_confirmation,require_manager_review_over_tolerance,created_by,updated_by)
  values(outlet,300,5,array['Service Crew','Cashier','Supervisor','Outlet Manager'], '23:00',true,true,qa_admin,qa_admin)
  on conflict(outlet_id) do update set variance_tolerance=excluded.variance_tolerance,required_positions=excluded.required_positions,updated_by=qa_admin,updated_at=now();
  insert into public.crew_cash_float_adjustments(outlet_id,previous_amount,new_amount,effective_date,reason,adjusted_by)
  select outlet,0,300,date '2026-08-01','Initial Cash Checkout QA floating cash',qa_admin
  where not exists(select 1 from public.crew_cash_float_adjustments where outlet_id=outlet and reason='Initial Cash Checkout QA floating cash');

  insert into public.crew_cash_checkouts(id,outlet_id,business_date,checked_out_by_employee_id,floating_cash,previous_carry_forward,expected_opening_cash,actual_opening_cash,opening_variance,denomination_counts,counted_cash,pos_expected_cash,variance,reconciliation_status,carry_forward,amount_for_deposit,float_shortfall,variance_tolerance,review_required,review_status,status,reconciled_at,submitted_at,completed_at)
  values
   (balanced,outlet,'2026-08-01',employee,300,0,300,300,0,'{"100":7,"50":2,"20":5}'::jsonb,900,900,0,'balanced',0,600,0,5,false,'not_required','completed','2026-08-01 22:00+08','2026-08-01 22:02+08','2026-08-01 22:03+08'),
   (short_row,outlet,'2026-08-02',employee,300,0,300,300,0,'{"100":5,"50":2}'::jsonb,600,610,-10,'short',0,300,0,5,true,'approved','completed','2026-08-02 22:00+08','2026-08-02 22:02+08','2026-08-02 22:08+08'),
   (over_row,outlet,'2026-08-03',employee,300,0,300,300,0,'{"100":4,"50":2}'::jsonb,500,490,10,'over',0,200,0,5,true,'approved','completed','2026-08-03 22:00+08','2026-08-03 22:02+08','2026-08-03 22:09+08'),
   (shortfall_row,outlet,'2026-08-04',employee,300,0,300,300,0,'{"100":2,"50":1,"20":1,"10":1}'::jsonb,280,285,-5,'short',0,0,20,5,true,'pending','submitted','2026-08-04 22:00+08','2026-08-04 22:02+08',null)
  on conflict do nothing;

  perform public.crew_cash_append_checkout_ledger(balanced,qa_admin);
  perform public.crew_cash_append_checkout_ledger(short_row,qa_admin);
  perform public.crew_cash_append_checkout_ledger(over_row,qa_admin);

  insert into public.crew_cash_collections(id,outlet_id,receiver_type,external_receiver_name,amount,received_amount,difference,purpose,note,status,handed_over_by_user_id,confirmed_at)
  values('ca5c0002-0000-4000-8000-000000000001',outlet,'external','Dason',900,900,0,'Bank deposit collection','QA completed external collection','completed',qa_admin,'2026-08-03 10:00+08')
  on conflict(id) do nothing;
  insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id)
  values(outlet,'collection',-900,'ca5c0002-0000-4000-8000-000000000001','Cash Collection','Dason','2026-08-03 10:00+08',qa_admin)
  on conflict do nothing;

  insert into public.crew_cash_collections(id,outlet_id,receiver_type,receiver_employee_id,amount,purpose,note,status,handed_over_by_user_id,submitted_at)
  values('ca5c0002-0000-4000-8000-000000000002',outlet,'internal',receiver,100,'Bank run handover','QA pending internal receipt','pending_receipt',qa_admin,'2026-08-05 10:00+08')
  on conflict(id) do nothing;
end $$;

commit;
