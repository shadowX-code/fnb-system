-- Rollback-only canonical Staging contract; fixture IDs are generated, never production IDs.
begin;
select set_config('request.jwt.claim.sub', 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_location uuid; v_first jsonb; v_saved jsonb; v_future jsonb; v_result jsonb;
  v_occurrence uuid; v_evidence jsonb; v_pending jsonb; v_before jsonb; v_after jsonb;
  v_message text; v_bad_date text;
begin
  assert public.current_user_has_permission('factory_mesti_cleaning.manage'), 'Staging test actor must have canonical management authority';
  select id into strict v_location from public.factory_storage_locations where status = 'active' order by id limit 1;
  select coalesce(jsonb_object_agg(id::text, to_jsonb(o)), '{}'::jsonb) into v_before from public.factory_mesti_cleaning_occurrences o;

  v_first := public.factory_save_mesti_cleaning_requirement(jsonb_build_object('task_name', 'QA rollback exact date', 'location_ids', jsonb_build_array(v_location), 'recurrence_type', 'daily', 'status', 'active', 'effective_from', v_today + 10));
  v_saved := public.factory_save_mesti_cleaning_requirement(v_first || jsonb_build_object('effective_from', v_today - 5));
  assert v_saved->>'id' = v_first->>'id' and (v_saved->>'version_no')::int = 1, 'Unissued future correction stays on the same version';
  assert (v_saved->>'effective_from')::date = v_today - 5, 'Selected backdate must not become today';
  v_result := public.factory_save_mesti_cleaning_requirement(v_saved);
  assert not (v_result->>'version_created')::boolean and v_result->>'id' = v_saved->>'id', 'Unchanged Save is a no-op';

  perform public.factory_mesti_materialize_cleaning_occurrences(v_today - 5, v_today - 5);
  select id into strict v_occurrence from public.factory_mesti_cleaning_occurrences where requirement_id = (v_saved->>'id')::uuid and location_id = v_location;
  perform public.factory_mesti_complete_cleaning_occurrence(v_occurrence, 'Rollback-only completion');
  perform public.factory_mesti_verify_cleaning_occurrence(v_occurrence, 'verified', 'Rollback-only verification');
  select to_jsonb(o) into v_evidence from public.factory_mesti_cleaning_occurrences o where id = v_occurrence;
  begin
    perform public.factory_save_mesti_cleaning_requirement(v_saved || jsonb_build_object('effective_from', v_today - 6));
    raise exception 'Unsafe backdate unexpectedly accepted';
  exception when sqlstate '22023' then
    get stacked diagnostics v_message = message_text;
    assert v_message like 'Effective From must be on or after %', 'Validation must explain the date boundary';
  end;

  v_saved := public.factory_save_mesti_cleaning_requirement(v_saved || jsonb_build_object('task_name', 'QA rollback successor', 'effective_from', v_today - 3));
  assert (v_saved->>'version_no')::int = 2 and (v_saved->>'effective_from')::date = v_today - 3, 'Safe backdated successor preserves the exact selected date';
  assert (select to_jsonb(o) = v_evidence from public.factory_mesti_cleaning_occurrences o where id = v_occurrence), 'Verified evidence and snapshot must remain byte-equivalent';

  v_future := public.factory_save_mesti_cleaning_requirement(v_saved || jsonb_build_object('task_name', 'QA rollback future', 'effective_from', v_today + 20));
  v_result := public.factory_save_mesti_cleaning_requirement(v_future || jsonb_build_object('effective_from', v_today + 30));
  assert v_result->>'id' = v_future->>'id', 'Unissued future version may move later';
  v_result := public.factory_save_mesti_cleaning_requirement(v_result || jsonb_build_object('effective_from', v_today - 1));
  assert v_result->>'id' = v_future->>'id' and (v_result->>'version_no')::int = 3, 'Safe correction of a future successor must not increment its version';
  assert (select effective_until = v_today - 1 from public.factory_mesti_cleaning_requirements where id = (v_saved->>'id')::uuid), 'Adjacent version boundaries must reconcile without overlap';
  begin
    perform public.factory_save_mesti_cleaning_requirement(v_first);
    raise exception 'Stale version unexpectedly accepted';
  exception when sqlstate '40001' then null;
  end;

  v_future := public.factory_save_mesti_cleaning_requirement(jsonb_build_object('task_name', 'QA rollback issued future', 'location_ids', jsonb_build_array(v_location), 'recurrence_type', 'daily', 'status', 'active', 'effective_from', v_today + 40));
  perform public.factory_mesti_materialize_cleaning_occurrences(v_today + 40, v_today + 40);
  select to_jsonb(o) into strict v_pending from public.factory_mesti_cleaning_occurrences o where requirement_id = (v_future->>'id')::uuid and location_id = v_location;
  begin
    perform public.factory_save_mesti_cleaning_requirement(v_future || jsonb_build_object('effective_from', v_today + 39));
    raise exception 'Issued future occurrence unexpectedly rewritten';
  exception when sqlstate '22023' then null;
  end;
  assert (select to_jsonb(o) = v_pending from public.factory_mesti_cleaning_occurrences o where id = (v_pending->>'id')::uuid), 'Issued pending occurrence identity and snapshot remain unchanged';
  foreach v_bad_date in array array['', '2026-02-31', 'not-a-date'] loop
    begin
      perform public.factory_save_mesti_cleaning_requirement(v_future || jsonb_build_object('effective_from', v_bad_date));
      raise exception 'Invalid date unexpectedly accepted';
    exception when sqlstate '22023' then null;
    end;
  end loop;
  select coalesce(jsonb_object_agg(id::text, to_jsonb(o)), '{}'::jsonb) into v_after from public.factory_mesti_cleaning_occurrences o where v_before ? id::text;
  assert v_before = v_after, 'Existing occurrence identities, snapshots, statuses and audit timestamps must remain unchanged';
end $$;
select 'exact_date_future_correction_version_boundaries_evidence_noop_stale_input = PASS (rollback only)' as result;
rollback;
