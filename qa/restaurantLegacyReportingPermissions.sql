-- Local isolated rehearsal only; transaction-local test predicates are rolled
-- back. Never apply this test file to a hosted environment.
begin;
create or replace function public.current_user_has_permission(permission_code text)
returns boolean language sql stable as $$
  select permission_code = current_setting('legacy_test.permission', true)
$$;
create or replace function public.current_user_can_access_outlet(target_outlet_id uuid)
returns boolean language sql stable as $$
  select target_outlet_id::text = current_setting('legacy_test.outlet', true)
$$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('legacy_test.outlet', (select id::text from public.outlets order by id limit 1), true);
select set_config('legacy_test.permission', 'outlet_pnl.view', true);
do $$
declare result jsonb;
begin
  result := public.reporting_yearly_scope_financials(null, 2099);
  if jsonb_array_length(result->'months') <> 12 then raise exception 'Yearly contract changed'; end if;
  if result->'months'->0->'financials'->'net_profit'->>'presence' <> 'missing'
     or result->'months'->0->'financials'->'net_profit'->>'amount' is not null then
    raise exception 'Missing financial evidence became zero';
  end if;
  if (select count(*) from public.reporting_scope_outlets(null)) <> 1 then raise exception 'Outlet scope widened'; end if;
  begin
    perform public.reporting_monthly_scope_product_sales(null, 2099, 1);
    raise exception 'Product Analytics permission widened';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reporting_monthly_outlet_financials('22222222-2222-4222-8222-222222222222', 2099, 1);
    raise exception 'Outlet scope bypassed';
  exception when insufficient_privilege then null; end;
  perform set_config('legacy_test.permission', 'reports.view', true);
  perform public.reporting_monthly_scope_product_sales(null, 2099, 1);
  perform set_config('legacy_test.permission', 'none', true);
  begin
    perform public.reporting_yearly_scope_financials(null, 2099);
    raise exception 'Permission bypassed';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: financial permissions, Reports-only products, scope, missing inputs';
end $$;
rollback;
