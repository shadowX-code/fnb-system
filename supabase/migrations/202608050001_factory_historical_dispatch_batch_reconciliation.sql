-- Reconcile two confirmed historical Dispatch lines before introducing the
-- Finished Goods batch ledger in 202608050002. This migration changes only the
-- canonical legacy batch reference on the existing Dispatch Item rows.

do $$
declare
  v_mapping record;
  v_item public.factory_finished_good_dispatch_items%rowtype;
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_production public.factory_productions%rowtype;
  v_production_date date;
  v_aggregate_balance numeric;
  v_known_batch_balance numeric;
begin
  -- Validate and lock both mappings before either Dispatch Item is updated.
  for v_mapping in
    select *
    from (values
      (
        'D260619-01'::text,
        '053a46a1-6887-4b74-91e1-443d690ad347'::uuid,
        '8688884f-cad6-4409-8795-d63b72feeed5'::uuid,
        1::numeric,
        'e2e386e5-d2b2-46ff-96d4-dddd73d27294'::uuid,
        'PB-20260616-7TDD'::text,
        59::numeric
      ),
      (
        'D260625-01'::text,
        '257867ef-57b4-45f5-84fc-6054d8e30d2f'::uuid,
        '6a593fc1-bcdb-4ee1-81e3-94d688d8dc84'::uuid,
        1::numeric,
        'da83bc29-a70a-4cdc-880b-ae39a55b8f09'::uuid,
        'PB-20260622-R33N'::text,
        9::numeric
      )
    ) as mapping(
      dispatch_no,
      dispatch_item_id,
      finished_good_id,
      quantity,
      production_id,
      batch_no,
      expected_balance
    )
  loop
    select *
    into v_item
    from public.factory_finished_good_dispatch_items item
    where item.id = v_mapping.dispatch_item_id
    for update;

    if not found then
      raise exception 'Historical Dispatch Item % was not found for Dispatch %.',
        v_mapping.dispatch_item_id, v_mapping.dispatch_no;
    end if;

    if v_item.finished_good_id is distinct from v_mapping.finished_good_id then
      raise exception 'Historical Dispatch Item % Packaging SKU does not match the confirmed mapping.',
        v_mapping.dispatch_item_id;
    end if;

    if v_item.quantity is distinct from v_mapping.quantity then
      raise exception 'Historical Dispatch Item % quantity must equal % pack.',
        v_mapping.dispatch_item_id, v_mapping.quantity;
    end if;

    if nullif(btrim(v_item.batch_no), '') is not null
      and nullif(btrim(v_item.batch_no), '') <> v_mapping.batch_no then
      raise exception 'Historical Dispatch Item % already has a different Batch reference: %.',
        v_mapping.dispatch_item_id, v_item.batch_no;
    end if;

    select *
    into v_dispatch
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = v_item.dispatch_id
    for update;

    if not found then
      raise exception 'Dispatch header was not found for historical Dispatch Item %.',
        v_mapping.dispatch_item_id;
    end if;

    if v_dispatch.dispatch_no is distinct from v_mapping.dispatch_no then
      raise exception 'Historical Dispatch Item % belongs to Dispatch %, not %.',
        v_mapping.dispatch_item_id, v_dispatch.dispatch_no, v_mapping.dispatch_no;
    end if;

    if lower(coalesce(v_dispatch.status, '')) <> 'completed' then
      raise exception 'Historical Dispatch % must be Completed before batch reconciliation.',
        v_mapping.dispatch_no;
    end if;

    if v_dispatch.dispatch_date is null then
      raise exception 'Historical Dispatch % is missing its Dispatch Date.',
        v_mapping.dispatch_no;
    end if;

    select *
    into v_production
    from public.factory_productions production
    where production.id = v_mapping.production_id
    for update;

    if not found then
      raise exception 'Confirmed source Production % was not found for Dispatch %.',
        v_mapping.production_id, v_mapping.dispatch_no;
    end if;

    if lower(coalesce(v_production.status, '')) <> 'completed' then
      raise exception 'Confirmed source Production % must be Completed.',
        v_mapping.production_id;
    end if;

    if v_production.finished_good_id is distinct from v_mapping.finished_good_id then
      raise exception 'Confirmed source Production % Packaging SKU does not match Dispatch Item %.',
        v_mapping.production_id, v_mapping.dispatch_item_id;
    end if;

    if nullif(btrim(v_production.batch_no), '') is distinct from v_mapping.batch_no then
      raise exception 'Confirmed source Production % Batch No. does not match %.',
        v_mapping.production_id, v_mapping.batch_no;
    end if;

    v_production_date := v_production.production_date;

    if v_production_date is null then
      raise exception 'Confirmed source Production % has no Production Date.',
        v_mapping.production_id;
    end if;

    if v_production_date > v_dispatch.dispatch_date then
      raise exception 'Confirmed source Production % has a Production Date after Dispatch %.',
        v_mapping.production_id, v_mapping.dispatch_no;
    end if;

    if v_production.storage_location_id is null then
      raise notice 'Production % / Batch % has no Storage Location and must remain unavailable for new Dispatch allocation until corrected.',
        v_mapping.production_id, v_mapping.batch_no;
    end if;
  end loop;

  -- Idempotent write: correctly reconciled rows remain unchanged on rerun.
  for v_mapping in
    select *
    from (values
      ('053a46a1-6887-4b74-91e1-443d690ad347'::uuid, 'PB-20260616-7TDD'::text),
      ('257867ef-57b4-45f5-84fc-6054d8e30d2f'::uuid, 'PB-20260622-R33N'::text)
    ) as mapping(dispatch_item_id, batch_no)
  loop
    update public.factory_finished_good_dispatch_items item
    set batch_no = v_mapping.batch_no
    where item.id = v_mapping.dispatch_item_id
      and nullif(btrim(item.batch_no), '') is null;

    select *
    into v_item
    from public.factory_finished_good_dispatch_items item
    where item.id = v_mapping.dispatch_item_id;

    if not found then
      raise exception 'Historical Dispatch Item % was not found after batch reconciliation.',
        v_mapping.dispatch_item_id;
    end if;

    if nullif(btrim(v_item.batch_no), '') is distinct from v_mapping.batch_no then
      raise exception 'Historical Dispatch Item % Batch reference was not reconciled to %.',
        v_mapping.dispatch_item_id, v_mapping.batch_no;
    end if;
  end loop;

  -- Reproduce the 202608050002 known Production-batch calculation. Historical
  -- Dispatch usage is deducted only when its SKU and Batch reference identify
  -- exactly one completed Production.
  for v_mapping in
    select *
    from (values
      ('8688884f-cad6-4409-8795-d63b72feeed5'::uuid, 59::numeric, 'SK03-500g'::text),
      ('6a593fc1-bcdb-4ee1-81e3-94d688d8dc84'::uuid, 9::numeric, 'S01'::text)
    ) as mapping(finished_good_id, expected_balance, sku_code)
  loop
    select finished_good.current_balance
    into v_aggregate_balance
    from public.factory_finished_goods finished_good
    where finished_good.id = v_mapping.finished_good_id;

    if not found then
      raise exception 'Packaging SKU % was not found during reconciliation verification.',
        v_mapping.finished_good_id;
    end if;

    select coalesce(sum(
      production.actual_pack_qty - coalesce((
        select sum(item.quantity)
        from public.factory_finished_good_dispatch_items item
        join public.factory_finished_good_dispatches dispatch
          on dispatch.id = item.dispatch_id
        where lower(coalesce(dispatch.status, '')) = 'completed'
          and item.finished_good_id = production.finished_good_id
          and nullif(btrim(item.batch_no), '') = nullif(btrim(production.batch_no), '')
          and (
            select count(*)
            from public.factory_productions matching_production
            where matching_production.finished_good_id = item.finished_good_id
              and lower(coalesce(matching_production.status, '')) = 'completed'
              and nullif(btrim(matching_production.batch_no), '') = nullif(btrim(item.batch_no), '')
          ) = 1
      ), 0)
    ), 0)
    into v_known_batch_balance
    from public.factory_productions production
    where production.finished_good_id = v_mapping.finished_good_id
      and lower(coalesce(production.status, '')) = 'completed'
      and production.actual_pack_qty > 0
      and production.actual_pack_qty = trunc(production.actual_pack_qty)
      and nullif(btrim(production.batch_no), '') is not null;

    if v_aggregate_balance is distinct from v_mapping.expected_balance then
      raise exception 'Packaging SKU % aggregate balance is %, expected %.',
        v_mapping.sku_code, v_aggregate_balance, v_mapping.expected_balance;
    end if;

    if v_known_batch_balance is distinct from v_mapping.expected_balance then
      raise exception 'Packaging SKU % known batch balance is %, expected %.',
        v_mapping.sku_code, v_known_batch_balance, v_mapping.expected_balance;
    end if;

    if v_aggregate_balance - v_known_batch_balance <> 0 then
      raise exception 'Packaging SKU % reconciliation variance remains %.',
        v_mapping.sku_code, v_aggregate_balance - v_known_batch_balance;
    end if;
  end loop;

  -- Migration-authored audit rows use a system identity because no authenticated
  -- application user exists while a database migration is running.
  for v_mapping in
    select *
    from (values
      (
        'D260619-01'::text,
        '053a46a1-6887-4b74-91e1-443d690ad347'::uuid,
        '8688884f-cad6-4409-8795-d63b72feeed5'::uuid,
        'e2e386e5-d2b2-46ff-96d4-dddd73d27294'::uuid,
        'PB-20260616-7TDD'::text
      ),
      (
        'D260625-01'::text,
        '257867ef-57b4-45f5-84fc-6054d8e30d2f'::uuid,
        '6a593fc1-bcdb-4ee1-81e3-94d688d8dc84'::uuid,
        'da83bc29-a70a-4cdc-880b-ae39a55b8f09'::uuid,
        'PB-20260622-R33N'::text
      )
    ) as mapping(dispatch_no, dispatch_item_id, finished_good_id, production_id, batch_no)
  loop
    insert into public.audit_logs (
      action,
      module,
      user_id,
      user_name,
      description,
      metadata,
      created_at
    )
    select
      'factory_historical_dispatch_batch_reconciled',
      'factory',
      null,
      'System Migration',
      'Historical batch source reconciliation before batch inventory migration.',
      jsonb_build_object(
        'target', v_mapping.dispatch_no,
        'dispatch_no', v_mapping.dispatch_no,
        'dispatch_item_id', v_mapping.dispatch_item_id,
        'finished_good_id', v_mapping.finished_good_id,
        'production_id', v_mapping.production_id,
        'assigned_batch_no', v_mapping.batch_no,
        'reason', 'Historical batch source reconciliation before batch inventory migration.'
      ),
      now()
    where not exists (
      select 1
      from public.audit_logs audit
      where audit.action = 'factory_historical_dispatch_batch_reconciled'
        and audit.module = 'factory'
        and audit.metadata ->> 'dispatch_item_id' = v_mapping.dispatch_item_id::text
        and nullif(btrim(audit.metadata ->> 'assigned_batch_no'), '') = v_mapping.batch_no
    );
  end loop;
end;
$$;
