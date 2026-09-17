-- Verify the narrowly authorized legacy reconciliation repair without replaying
-- it on Staging. Production must have either none or all three canonical IDs.
do $verification$
declare
  v_present_count integer;
  v_valid_count integer;
begin
  select count(*) into v_present_count
  from public.factory_raw_material_batch_balances
  where id = any(array[
    '1095488e-eac5-4592-bb88-ca5819a46451'::uuid,
    'cf832e87-2ec9-495e-ade9-fe81a7213e62'::uuid,
    '23111ec4-2de8-49b6-adb4-0c69e9667a18'::uuid
  ]);

  if v_present_count not in (0, 3) then
    raise exception 'Whitelisted legacy Raw Material Stock Check repair IDs must be absent or present as the complete three-record set.';
  end if;

  if v_present_count = 3 then
    select count(*) into v_valid_count
    from public.factory_raw_material_batch_balances batch
    where batch.id = any(array[
      '1095488e-eac5-4592-bb88-ca5819a46451'::uuid,
      'cf832e87-2ec9-495e-ade9-fe81a7213e62'::uuid,
      '23111ec4-2de8-49b6-adb4-0c69e9667a18'::uuid
    ])
      and batch.source_type = 'stock_check_adjustment'
      and batch.status = 'active'
      and batch.internal_batch_no is null;

    if v_valid_count <> 3 then
      raise exception 'Whitelisted legacy Raw Material Stock Check reconciliation batches did not reach the expected active state.';
    end if;
  end if;
end;
$verification$;
