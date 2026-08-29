-- FeedX Reporting poster fixtures. STAGING ONLY; never a migration or source
-- of truth. These rows exercise the existing reporting RPCs through ordinary
-- financial and completed Product Analytics evidence.
begin;

do $$
declare
  v_outlet constant uuid := 'b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19c01';
  v_revenue_channel constant uuid := 'b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19c02';
  v_adjustment_channel constant uuid := 'b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19c03';
  v_marker constant text := 'FeedX Reporting Poster QA Fixture — Staging only';
  v_existing public.outlets%rowtype;
begin
  select * into v_existing from public.outlets where id = v_outlet;
  if found and (v_existing.name <> 'QA Demo — Reporting Posters' or v_existing.code <> 'QA-RPT-POSTER-2026') then
    raise exception 'Refusing to replace a non-QA outlet at the Reporting fixture ID.';
  end if;

  insert into public.outlets(id, name, code, location, address, status, is_active)
  values (v_outlet, 'QA Demo — Reporting Posters', 'QA-RPT-POSTER-2026', 'Staging QA / Demo only', v_marker, 'active', true)
  on conflict (id) do update set
    name = excluded.name, code = excluded.code, location = excluded.location,
    address = excluded.address, status = excluded.status, is_active = excluded.is_active,
    updated_at = now();

  -- Selected-scope Admin roles that can open Reports must receive the QA outlet
  -- in Staging so the authenticated UI exercises its ordinary outlet guard.
  -- Roles with all-outlet scope need no fixture-specific assignment.
  insert into public.role_outlets(role_id, outlet_id)
  select distinct r.id, v_outlet
  from public.roles r
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p on p.id = rp.permission_id
  where p.code = 'reports.view'
    and coalesce(lower(r.outlet_access_type), 'selected') in ('selected', 'selected_outlets')
  on conflict do nothing;

  insert into public.sales_channels(id, name, type, sort_order, status, is_active)
  values
    (v_revenue_channel, 'QA Fixture — Poster Revenue', 'channel', 9901, 'active', true),
    (v_adjustment_channel, 'QA Fixture — Poster Adjustment', 'adjustment', 9902, 'active', true)
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, sort_order = excluded.sort_order,
    status = excluded.status, is_active = excluded.is_active, updated_at = now();

  -- Rebuilding deletes only evidence owned by the explicit QA fixture outlet.
  delete from public.product_sales_reports where outlet_id = v_outlet;
  delete from public.sales_records where outlet_id = v_outlet;
  delete from public.purchase_records where outlet_id = v_outlet;
  delete from public.operating_expenses where outlet_id = v_outlet;

  -- Complete profitable January: revenue 120,000; COGS 35,000; OpEx 25,000;
  -- server-derived Net Profit 60,000. Product items include long labels and
  -- more than ten positive products to exercise both ranking lists.
  insert into public.sales_records(outlet_id, year, month, channel_id, channel_name, amount, remark) values
    (v_outlet, 2026, 1, v_revenue_channel, 'QA Fixture — Poster Revenue', 122000, v_marker),
    (v_outlet, 2026, 1, v_adjustment_channel, 'QA Fixture — Poster Adjustment', 2000, v_marker),
    (v_outlet, 2026, 2, v_revenue_channel, 'QA Fixture — Poster Revenue', 30000, v_marker),
    (v_outlet, 2026, 3, v_revenue_channel, 'QA Fixture — Poster Revenue', 60000, v_marker),
    (v_outlet, 2026, 5, v_revenue_channel, 'QA Fixture — Poster Revenue', 50000, v_marker),
    (v_outlet, 2026, 6, v_revenue_channel, 'QA Fixture — Poster Revenue', 45000, v_marker),
    (v_outlet, 2026, 7, v_revenue_channel, 'QA Fixture — Poster Revenue', 20000, v_marker)
  on conflict do nothing;

  insert into public.purchase_records(outlet_id, year, month, amount, remark) values
    (v_outlet, 2026, 1, 35000, v_marker),
    (v_outlet, 2026, 2, 25000, v_marker),
    (v_outlet, 2026, 3, 25000, v_marker),
    (v_outlet, 2026, 4, 12000, v_marker),
    (v_outlet, 2026, 6, 12000, v_marker),
    (v_outlet, 2026, 7, 10000, v_marker);

  insert into public.operating_expenses(outlet_id, year, month, amount, remark) values
    (v_outlet, 2026, 1, 25000, v_marker),
    (v_outlet, 2026, 2, 15000, v_marker),
    (v_outlet, 2026, 3, 0, v_marker),
    (v_outlet, 2026, 4, 4000, v_marker),
    (v_outlet, 2026, 5, 5000, v_marker),
    (v_outlet, 2026, 7, 3000, v_marker);

  -- May has revenue and explicit OpEx but intentionally no purchase record.
  -- April has COGS/OpEx but no revenue; June has revenue/COGS but no OpEx.
  -- July has complete financial evidence but intentionally no Product report.

  insert into public.product_sales_reports(
    id, outlet_id, report_month, report_year, file_name, status,
    total_net_sales, total_quantity, total_discount, raw_metadata
  ) values (
    'b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 1, 2026,
    'qa-reporting-poster-january.csv', 'completed', 78000, 1560, 0,
    jsonb_build_object('qa_fixture', true, 'marker', v_marker)
  );

  insert into public.product_sales_items(
    report_id, outlet_id, category_name, product_name, variant_name,
    quantity, gross_sales, discount, sst, service_charge, nett_sales
  ) values
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Chef''s Seasonal Tasting Collection with an Intentionally Long Category Name', 'Signature Truffle Butter Grilled Chicken with Caramelised Onion and House-Made Brioche', 'Large', 100, 15000, 0, 0, 0, 15000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Specialty Beverages', 'Cold Brew Coffee', 'Large', 180, 12000, 0, 0, 0, 12000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Mains', 'Smoky Beef Burger', 'Single', 150, 10000, 0, 0, 0, 10000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Mains', 'Nasi Lemak Royale', '', 140, 8500, 0, 0, 0, 8500),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Desserts', 'Burnt Cheesecake', '', 120, 7000, 0, 0, 0, 7000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Mains', 'Chicken Rice Bowl', '', 115, 5500, 0, 0, 0, 5500),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Sides', 'Truffle Fries', '', 100, 4000, 0, 0, 0, 4000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Specialty Beverages', 'Sparkling Lychee Tea', '', 95, 3500, 0, 0, 0, 3500),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Sides', 'Garlic Bread', '', 80, 2500, 0, 0, 0, 2500),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Desserts', 'Chocolate Brownie', '', 70, 2000, 0, 0, 0, 2000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Sides', 'Coleslaw', '', 55, 1500, 0, 0, 0, 1500),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Desserts', 'Vanilla Ice Cream', '', 50, 1000, 0, 0, 0, 1000),
    ('b34f5a81-2a0b-4ce4-a7f3-3fb4c8a19d01', v_outlet, 'Test Exclusions', 'Zero Sales Reference Item', '', 1, 0, 0, 0, 0, 0);
end $$;

commit;
