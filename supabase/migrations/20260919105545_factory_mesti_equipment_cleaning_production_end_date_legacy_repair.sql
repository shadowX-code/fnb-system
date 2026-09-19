-- Production-only legacy correction for the nine occurrences audited on 2026-09-19.
-- Staging has none of these immutable Production IDs, so it records this migration as a no-op.
do $$
declare
  v_present_count integer;
  v_matched_count integer;
  v_updated_count integer;
begin
  select count(*) into v_present_count
  from public.factory_mesti_equipment_cleaning_occurrences
  where id in (
    'c9e168d6-ab0f-481c-92d2-ca8ccd33db85'::uuid,
    'dbf9f9ac-86df-4bcd-bc24-6e99646fa8c9'::uuid,
    '879127bf-3e07-4e34-a42b-309b3db4edbc'::uuid,
    '9f6b9b1a-4c66-44e0-826e-c891c7bc36ef'::uuid,
    '71501d51-212f-4622-9511-b664a5f25c7e'::uuid,
    '5792fed5-0ee7-4abc-ae54-0f26b50acd65'::uuid,
    '61712b7d-041f-4129-9b79-dc3412848ae9'::uuid,
    '42dcd7d5-6fe4-4d37-a2ac-1ca0b1f12820'::uuid,
    '2268d0ac-22dd-4cef-b2fe-49a29e2e259f'::uuid
  );

  if v_present_count = 0 then
    return;
  end if;

  if v_present_count <> 9 then
    raise exception 'Expected all 9 audited Production equipment-cleaning occurrences, found %', v_present_count;
  end if;

  perform 1
  from public.factory_mesti_equipment_cleaning_occurrences
  where id in (
    'c9e168d6-ab0f-481c-92d2-ca8ccd33db85'::uuid,
    'dbf9f9ac-86df-4bcd-bc24-6e99646fa8c9'::uuid,
    '879127bf-3e07-4e34-a42b-309b3db4edbc'::uuid,
    '9f6b9b1a-4c66-44e0-826e-c891c7bc36ef'::uuid,
    '71501d51-212f-4622-9511-b664a5f25c7e'::uuid,
    '5792fed5-0ee7-4abc-ae54-0f26b50acd65'::uuid,
    '61712b7d-041f-4129-9b79-dc3412848ae9'::uuid,
    '42dcd7d5-6fe4-4d37-a2ac-1ca0b1f12820'::uuid,
    '2268d0ac-22dd-4cef-b2fe-49a29e2e259f'::uuid
  )
  for update;

  with targets(occurrence_id, production_id, equipment_id, expected_status, current_due_date, corrected_due_date, expects_completion_evidence) as (
    values
      ('c9e168d6-ab0f-481c-92d2-ca8ccd33db85'::uuid, '7166fdea-ed06-4dc0-8aa2-02f59cd5fd46'::uuid, 'c733f22c-5330-46a6-a009-a1083fd0c306'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('dbf9f9ac-86df-4bcd-bc24-6e99646fa8c9'::uuid, '7166fdea-ed06-4dc0-8aa2-02f59cd5fd46'::uuid, 'a582c0a9-a03b-4ee0-ad6b-7298cf09986b'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('879127bf-3e07-4e34-a42b-309b3db4edbc'::uuid, '7166fdea-ed06-4dc0-8aa2-02f59cd5fd46'::uuid, 'c34ed630-14c6-40ae-8154-391a3d8125af'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('9f6b9b1a-4c66-44e0-826e-c891c7bc36ef'::uuid, '7166fdea-ed06-4dc0-8aa2-02f59cd5fd46'::uuid, '545cbc57-ae38-4bfb-9534-990311cb1727'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('71501d51-212f-4622-9511-b664a5f25c7e'::uuid, '966989ba-c018-432f-a141-565fd6bedf17'::uuid, 'c733f22c-5330-46a6-a009-a1083fd0c306'::uuid, 'completed', date '2026-09-18', date '2026-09-16', true),
      ('5792fed5-0ee7-4abc-ae54-0f26b50acd65'::uuid, 'e5cf89b6-6580-4e65-b98e-871537aa7e21'::uuid, 'c733f22c-5330-46a6-a009-a1083fd0c306'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('61712b7d-041f-4129-9b79-dc3412848ae9'::uuid, 'e5cf89b6-6580-4e65-b98e-871537aa7e21'::uuid, 'c34ed630-14c6-40ae-8154-391a3d8125af'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('42dcd7d5-6fe4-4d37-a2ac-1ca0b1f12820'::uuid, 'e5cf89b6-6580-4e65-b98e-871537aa7e21'::uuid, '545cbc57-ae38-4bfb-9534-990311cb1727'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false),
      ('2268d0ac-22dd-4cef-b2fe-49a29e2e259f'::uuid, '6cc04943-1b7f-4a97-ba78-04f349fa2d63'::uuid, 'c733f22c-5330-46a6-a009-a1083fd0c306'::uuid, 'pending', date '2026-09-18', date '2026-09-17', false)
  )
  select count(*) into v_matched_count
  from targets
  join public.factory_mesti_equipment_cleaning_occurrences occurrence on occurrence.id = targets.occurrence_id
  join public.factory_productions production on production.id = occurrence.production_id
  where occurrence.source_type = 'after_production'
    and occurrence.production_id = targets.production_id
    and occurrence.equipment_id = targets.equipment_id
    and occurrence.status = targets.expected_status
    and occurrence.due_date = targets.current_due_date
    and production.end_date = targets.corrected_due_date
    and (not targets.expects_completion_evidence or occurrence.completed_at is not null)
    and (targets.expects_completion_evidence or occurrence.completed_at is null)
    and occurrence.verified_at is null;

  if v_matched_count <> 9 then
    raise exception 'Audited Production equipment-cleaning occurrence state changed; repair aborted (% of 9 targets match)', v_matched_count;
  end if;

  with targets(occurrence_id, corrected_due_date) as (
    values
      ('c9e168d6-ab0f-481c-92d2-ca8ccd33db85'::uuid, date '2026-09-17'),
      ('dbf9f9ac-86df-4bcd-bc24-6e99646fa8c9'::uuid, date '2026-09-17'),
      ('879127bf-3e07-4e34-a42b-309b3db4edbc'::uuid, date '2026-09-17'),
      ('9f6b9b1a-4c66-44e0-826e-c891c7bc36ef'::uuid, date '2026-09-17'),
      ('71501d51-212f-4622-9511-b664a5f25c7e'::uuid, date '2026-09-16'),
      ('5792fed5-0ee7-4abc-ae54-0f26b50acd65'::uuid, date '2026-09-17'),
      ('61712b7d-041f-4129-9b79-dc3412848ae9'::uuid, date '2026-09-17'),
      ('42dcd7d5-6fe4-4d37-a2ac-1ca0b1f12820'::uuid, date '2026-09-17'),
      ('2268d0ac-22dd-4cef-b2fe-49a29e2e259f'::uuid, date '2026-09-17')
  )
  update public.factory_mesti_equipment_cleaning_occurrences occurrence
  set due_date = targets.corrected_due_date
  from targets
  where occurrence.id = targets.occurrence_id
    and occurrence.due_date = date '2026-09-18';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 9 then
    raise exception 'Expected to repair 9 Production equipment-cleaning occurrences, updated %', v_updated_count;
  end if;
end;
$$;
