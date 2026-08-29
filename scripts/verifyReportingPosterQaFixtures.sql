-- Verifies Reporting Poster QA fixtures through the same authenticated RPCs
-- consumed by reportingService. No fixture-specific Reporting path exists.
begin;

do $$
declare
  v_outlet constant uuid := 'b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19c01';
  v_owner uuid;
  v_january jsonb;
  v_february jsonb;
  v_march jsonb;
  v_april jsonb;
  v_may jsonb;
  v_june jsonb;
  v_july_products jsonb;
  v_january_products jsonb;
begin
  if not exists(select 1 from public.outlets where id = v_outlet and name = 'QA Demo — Reporting Posters' and code = 'QA-RPT-POSTER-2026') then
    raise exception 'Reporting QA fixture outlet is unavailable or mislabeled.';
  end if;
  select e.auth_user_id into v_owner
  from public.employees e join public.roles r on r.id = e.role_id
  where lower(r.name) in ('owner', 'admin') and e.auth_user_id is not null and e.is_active
  order by case when lower(r.name) = 'owner' then 0 else 1 end
  limit 1;
  if v_owner is null then raise exception 'An active owner/admin fixture is required for Reporting RPC verification.'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_january := public.reporting_monthly_outlet_financials(v_outlet, 2026, 1);
  v_february := public.reporting_monthly_outlet_financials(v_outlet, 2026, 2);
  v_march := public.reporting_monthly_outlet_financials(v_outlet, 2026, 3);
  v_april := public.reporting_monthly_outlet_financials(v_outlet, 2026, 4);
  v_may := public.reporting_monthly_outlet_financials(v_outlet, 2026, 5);
  v_june := public.reporting_monthly_outlet_financials(v_outlet, 2026, 6);
  v_january_products := public.reporting_monthly_outlet_product_sales(v_outlet, 2026, 1);
  v_july_products := public.reporting_monthly_outlet_product_sales(v_outlet, 2026, 7);
  execute 'reset role';

  if v_january->>'financial_completeness' <> 'complete' or (v_january #>> '{financials,net_profit,amount}')::numeric <> 60000 then
    raise exception 'January profitable fixture failed: %', v_january;
  end if;
  if v_february->>'financial_completeness' <> 'complete' or (v_february #>> '{financials,net_profit,amount}')::numeric <> -10000 then
    raise exception 'February negative-profit fixture failed: %', v_february;
  end if;
  if v_march #>> '{financials,opex,presence}' <> 'present' or (v_march #>> '{financials,opex,amount}')::numeric <> 0 then
    raise exception 'March explicit RM0 fixture failed: %', v_march;
  end if;
  if v_april #>> '{financials,revenue,presence}' <> 'missing' then raise exception 'April missing-Revenue fixture failed.'; end if;
  if v_may #>> '{financials,purchase_based_cogs,presence}' <> 'missing' then raise exception 'May missing-COGS fixture failed.'; end if;
  if v_june #>> '{financials,opex,presence}' <> 'missing' then raise exception 'June missing-OpEx fixture failed.'; end if;
  if v_july_products->>'product_data_status' <> 'unavailable' then raise exception 'July product-unavailable fixture failed.'; end if;
  if jsonb_array_length(v_january_products->'top_products') <> 10 or jsonb_array_length(v_january_products->'lowest_products') <> 10 then
    raise exception 'January Product Analytics ranking fixture failed: %', v_january_products;
  end if;
  if v_january_products #>> '{top_products,0,product_name}' <> 'Signature Truffle Butter Grilled Chicken with Caramelised Onion and House-Made Brioche' then
    raise exception 'January top-product fixture failed: %', v_january_products;
  end if;
  if v_january_products #>> '{lowest_products,0,product_name}' <> 'Vanilla Ice Cream' then
    raise exception 'January lowest-product fixture failed: %', v_january_products;
  end if;
end $$;

commit;
