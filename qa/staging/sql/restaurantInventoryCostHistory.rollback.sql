-- Run against the verified FeedX Staging database after the cost history migration.
begin;

do $$
declare
  v_actor uuid;
  v_item uuid := gen_random_uuid();
  v_baseline uuid;
begin
  if exists (
    select 1 from public.inventory_items item
    where item.cost_updated_at is not null and item.cost >= 0 and item.cost < 'Infinity'::numeric
      and not exists (
        select 1 from inventory_authority.item_cost_revisions revision where revision.id = item.cost_revision_id
          and revision.item_id = item.id and revision.unit_cost = item.cost
      )
  ) or exists (
    select 1 from inventory_authority.item_cost_revisions
    where effective_date is null and (revision_number <> 1 or reason <> 'Existing configured cost'
      or previous_revision_id is not null)
  ) then
    raise exception 'Confirmed costs do not match the revision projection, or a baseline invented lineage';
  end if;

  for v_actor in select e.auth_user_id from public.employees e join public.roles r on r.id = e.role_id
    where lower(r.name) in ('owner','admin') and e.auth_user_id is not null
  loop
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    exit when public.current_user_has_permission('inventory_master.edit') and public.current_user_has_all_outlet_access();
    v_actor := null;
  end loop;
  if v_actor is null then raise exception 'An existing Staging Master Inventory editor is required'; end if;

  select id into v_baseline from inventory_authority.item_cost_revisions where effective_date is null limit 1;
  if v_baseline is null then raise exception 'No migrated Staging baseline to verify'; end if;
  perform set_config('cost_qa.actor', v_actor::text, true);
  perform set_config('cost_qa.item', v_item::text, true);
  perform set_config('cost_qa.baseline', v_baseline::text, true);
  perform set_config('cost_qa.baseline_item', (select item_id::text from inventory_authority.item_cost_revisions where id = v_baseline), true);
end;
$$;

set local role authenticated;
do $$
declare
  v_item uuid := current_setting('cost_qa.item')::uuid;
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_correction uuid := gen_random_uuid();
  v_current_correction uuid := gen_random_uuid();
  v_day date := (statement_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_history jsonb;
begin
  insert into public.inventory_items(id, item_name, unit) values (v_item, 'QA Cost Item', 'kg');
  v_history := public.inventory_master_cost_history(v_item);
  if v_history->>'current_cost' is not null or v_history->'revisions' <> '[]'::jsonb then
    raise exception 'Unconfigured default confused with valid zero';
  end if;

  v_history := public.inventory_master_cost_history(current_setting('cost_qa.baseline_item')::uuid);
  if not exists (
    select 1 from jsonb_array_elements(v_history->'revisions') row
    where row->>'id' = current_setting('cost_qa.baseline') and row->>'effective_date' is null
      and row->>'recorded_at' is not null
  ) then raise exception 'Configured baseline absent from authorized history'; end if;

  begin
    update public.inventory_items set cost = 1, cost_updated_at = now() where id = v_item;
    raise exception 'Direct overwrite succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.inventory_items(item_name, unit, cost, cost_updated_at) values ('QA bypass', 'kg', 1, now());
    raise exception 'Direct configured insert succeeded';
  exception when insufficient_privilege then null; end;

  begin
    perform public.inventory_master_revise_cost(v_item, .00001, 'kg', v_day, 'Invalid precision', gen_random_uuid(), null);
    raise exception 'Invalid currency precision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_revise_cost(v_item, 1, 'bag', v_day, 'Wrong UOM', gen_random_uuid(), null);
    raise exception 'Mismatched UOM accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_revise_cost(v_item, 1, 'kg', v_day + 1, 'Future date', gen_random_uuid(), null);
    raise exception 'Future effective date accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_revise_cost(v_item, 1, 'kg', v_day, ' ', gen_random_uuid(), null);
    raise exception 'Blank reason accepted';
  exception when invalid_parameter_value then null; end;

  v_history := public.inventory_master_revise_cost(v_item, 0, 'kg', v_day - 1, 'Configured zero', v_first, null);
  if (v_history->>'current_cost')::numeric is distinct from 0
    or v_history->>'previous_cost' is not null
    or jsonb_array_length(v_history->'revisions') <> 1 then raise exception 'Configured zero lost'; end if;
  if v_history is distinct from public.inventory_master_revise_cost(v_item, 0, 'kg', v_day - 1, 'Configured zero', v_first, null)
    then raise exception 'Request retry appended a duplicate'; end if;
  begin
    perform public.inventory_master_revise_cost(v_item, 3, 'kg', v_day, 'Different intent', v_first, null);
    raise exception 'A request ID was reused for a different intent';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.inventory_master_revise_cost(v_item, 3, 'kg', v_day, 'Stale intent', gen_random_uuid(), null);
    raise exception 'Stale editor overwrote the current revision';
  exception when serialization_failure then null; end;
  begin
    perform public.inventory_master_revise_cost(v_item, 3, 'kg', v_day - 1, 'Same date', gen_random_uuid(), v_first);
    raise exception 'Duplicate effective date accepted without a correction';
  exception when invalid_parameter_value then null; end;
  begin
    update public.inventory_items set unit = 'bag' where id = v_item;
    raise exception 'A configured cost was silently relabeled in a different UOM';
  exception when check_violation then null; end;

  v_history := public.inventory_master_revise_cost(v_item, 2.1234, 'kg', v_day, 'New price', v_second, v_first);
  if (v_history->>'current_cost')::numeric is distinct from 2.1234
    or (public.inventory_master_cost_changes()->>v_second::text)::numeric is distinct from 0
    or (select cost from public.inventory_items where id = v_item) is distinct from 2.1234 then
    raise exception 'Display summary or existing consumer projection lost its canonical cost';
  end if;

  v_history := public.inventory_master_revise_cost(v_item, 1, 'kg', v_day - 1, 'Correct past evidence', v_correction, v_second, v_first);
  if (v_history->>'current_cost')::numeric is distinct from 2.1234
    or v_history->'revisions'->0->>'supersedes_revision_id' <> v_first::text
    or v_history->'revisions'->0->>'previous_revision_id' <> v_second::text then
    raise exception 'Historical correction lost evidence or changed the current cost';
  end if;

  v_history := public.inventory_master_revise_cost(v_item, 0, 'kg', v_day, 'Correct latest evidence',
    v_current_correction, v_correction, v_second);
  if (v_history->>'current_cost')::numeric is distinct from 0
    or (v_history->>'previous_cost')::numeric is distinct from 2.1234
    or jsonb_array_length(v_history->'revisions') <> 4 then raise exception 'Current cost correction lost evidence'; end if;
  begin
    perform public.inventory_master_revise_cost(v_item, 3, 'kg', v_day, 'Bad supersession', gen_random_uuid(),
      v_current_correction, v_second);
    raise exception 'A superseded revision was corrected twice';
  exception when invalid_parameter_value then null; end;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.inventory_master_cost_history(v_item);
    raise exception 'History exposed without Master permission and item scope';
  exception when insufficient_privilege then null; end;
  if public.inventory_master_cost_changes() <> '{}'::jsonb then raise exception 'Comparison costs exposed without permission'; end if;
  begin
    perform public.inventory_master_revise_cost(v_item, 9, 'kg', v_day, 'Unauthorized', gen_random_uuid(),
      v_current_correction, v_current_correction);
    raise exception 'Cost update bypassed permission enforcement';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
begin
  if exists (
    select 1 from inventory_authority.item_cost_revisions where item_id = current_setting('cost_qa.item')::uuid
      and actor_user_id is distinct from current_setting('cost_qa.actor')::uuid
  ) then raise exception 'Revision records lost the server-authenticated actor'; end if;

  begin
    update inventory_authority.item_cost_revisions set unit_cost = 99 where item_id = current_setting('cost_qa.item')::uuid;
    raise exception 'Stored cost evidence was overwritten';
  exception when insufficient_privilege then null; end;
  begin
    delete from inventory_authority.item_cost_revisions where item_id = current_setting('cost_qa.item')::uuid;
    raise exception 'Stored cost evidence was removed';
  exception when insufficient_privilege then null; end;
end;
$$;

rollback;
select 'PASS: scoped revision history, baselines, zero, validations, retries, corrections, projection and immutability' as result;
