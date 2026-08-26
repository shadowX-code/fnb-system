-- STAGING ONLY: validates request-level idempotency through the actual Crew and
-- Admin RPCs. It targets Friends Corner's dedicated QA identities and never
-- changes a production database. Append-only ledger entries intentionally remain
-- as QA audit evidence; their net balance effect is zero.
begin;

do $$
declare
  outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  sender constant uuid := '066594d7-800c-4b61-8de9-9de4efd57fe3';
  receiver constant uuid := '841521c8-31d3-4fb0-914b-256188712002';
  denied_employee constant uuid := '841521c8-31d3-4fb0-914b-256188712001';
  qa_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  qa_role constant uuid := 'fe3bd933-c86e-4c92-be6a-bc56cfc48ef3';
  sender_token constant text := 'cash-collection-contract-sender-20260826';
  receiver_token constant text := 'cash-collection-contract-receiver-20260826';
  denied_token constant text := 'cash-collection-contract-denied-20260826';
  crew_request constant uuid := '11111111-1111-4111-8111-111111111111';
  crew_second_request constant uuid := '11111111-1111-4111-8111-111111111112';
  admin_request constant uuid := '22222222-2222-4222-8222-222222222222';
  crew_result jsonb;
  crew_retry jsonb;
  admin_result jsonb;
  admin_retry jsonb;
  projection jsonb;
  crew_collection_uuid uuid;
  original_sender_role uuid;
  balance numeric;
  denied boolean := false;
  conflict boolean := false;
begin
  if public.crew_cash_balance(outlet) <> 900 then
    raise exception 'Expected Friends Corner QA baseline 900; found %', public.crew_cash_balance(outlet);
  end if;

  select role_id into original_sender_role from public.employees where id=sender for update;
  if original_sender_role is not null then
    raise exception 'QA sender role is no longer the isolated fixture expected by this verifier.';
  end if;
  update public.employees set role_id=qa_role where id=sender;

  insert into public.crew_sessions(employee_id,token_hash,expires_at)
  values
    (sender,encode(extensions.digest(sender_token,'sha256'),'hex'),now()+interval '15 minutes'),
    (receiver,encode(extensions.digest(receiver_token,'sha256'),'hex'),now()+interval '15 minutes'),
    (denied_employee,encode(extensions.digest(denied_token,'sha256'),'hex'),now()+interval '15 minutes')
  on conflict(token_hash) do update set employee_id=excluded.employee_id,expires_at=excluded.expires_at,revoked_at=null;

  -- Controlled funding makes the requested Crew assertion exact: 1000 -> 900.
  insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,activity,occurred_at,recorded_by_user_id)
  values(outlet,'checkout_adjustment',100,'Cash Checkout · QA idempotency contract funding',now(),qa_admin);
  if public.crew_cash_balance(outlet) <> 1000 then raise exception 'QA funding did not produce balance 1000'; end if;

  crew_result:=public.crew_cash_record_collection(sender_token,jsonb_build_object(
    'request_id',crew_request,'receiver_type','internal','receiver_employee_id',receiver,
    'amount',100,'purpose','QA idempotency contract Crew collection','note','Staging contract test'
  ));
  crew_collection_uuid:=(crew_result->>'id')::uuid;
  if public.crew_cash_balance(outlet) <> 900 then raise exception 'Crew submission did not immediately debit 100'; end if;
  if (select count(*) from public.crew_cash_collections c where c.outlet_id=outlet and c.request_id=crew_request) <> 1
    or (select count(*) from public.crew_cash_ledger_entries l where l.collection_id=crew_collection_uuid) <> 1 then
    raise exception 'Crew submission did not write exactly one collection and ledger entry';
  end if;

  crew_retry:=public.crew_cash_record_collection(sender_token,jsonb_build_object(
    'request_id',crew_request,'receiver_type','internal','receiver_employee_id',receiver,
    'amount',100,'purpose','QA idempotency contract Crew collection','note','Staging contract test'
  ));
  if crew_retry->>'id' <> crew_result->>'id' or public.crew_cash_balance(outlet) <> 900
    or (select count(*) from public.crew_cash_ledger_entries l where l.collection_id=crew_collection_uuid) <> 1 then
    raise exception 'Crew same-request retry was not idempotent';
  end if;

  begin
    perform public.crew_cash_record_collection(sender_token,jsonb_build_object(
      'request_id',crew_request,'receiver_type','internal','receiver_employee_id',receiver,
      'amount',99,'purpose','QA idempotency contract Crew collection','note','Staging contract test'
    ));
  exception when others then
    conflict:=position('conflicts with a different payload' in sqlerrm) > 0;
  end;
  if not conflict then raise exception 'Crew changed-payload retry did not reject as a conflict'; end if;

  perform public.crew_cash_confirm_collection(receiver_token,crew_collection_uuid,100);
  if public.crew_cash_balance(outlet) <> 900
    or (select count(*) from public.crew_cash_ledger_entries l where l.collection_id=crew_collection_uuid) <> 1
    or (select c.status from public.crew_cash_collections c where c.id=crew_collection_uuid) <> 'completed' then
    raise exception 'Crew confirmation changed balance or failed to confirm';
  end if;

  -- A new request identity is a new valid transaction. Its matching QA funding
  -- keeps the fixture's final canonical balance unchanged.
  insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,activity,occurred_at,recorded_by_user_id)
  values(outlet,'checkout_adjustment',1,'Cash Checkout · QA new-request funding',now(),qa_admin);
  perform public.crew_cash_record_collection(sender_token,jsonb_build_object(
    'request_id',crew_second_request,'receiver_type','external','receiver_name','QA External Receiver',
    'amount',1,'purpose','QA new request contract','note','Staging contract test'
  ));
  if public.crew_cash_balance(outlet) <> 900 then raise exception 'New Crew request did not create exactly one valid debit'; end if;

  begin
    perform public.crew_cash_record_collection(denied_token,jsonb_build_object(
      'request_id','33333333-3333-4333-8333-333333333333','receiver_type','external','receiver_name','Denied QA',
      'amount',1,'purpose','QA permission isolation','note','Staging contract test'
    ));
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Unprivileged QA Crew was allowed to collect cash'; end if;

  projection:=public.crew_cash_mobile(sender_token,current_date);
  if (projection->'deposit'->>'current_balance')::numeric <> 900
    or (projection->'deposit'->>'available_balance')::numeric <> 900 then
    raise exception 'Crew read model did not expose one canonical/compatibility balance';
  end if;

  if (select count(*) from public.crew_cash_ledger_entries l where l.collection_id='ca5c0002-0000-4000-8000-000000000002') <> 1 then
    raise exception 'Legacy pending collection transition was not appended exactly once';
  end if;

  perform set_config('request.jwt.claim.sub',qa_admin::text,true);
  insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,activity,occurred_at,recorded_by_user_id)
  values(outlet,'checkout_adjustment',100,'Cash Checkout · QA Admin idempotency contract funding',now(),qa_admin);
  admin_result:=public.crew_cash_admin_record_collection(outlet,jsonb_build_object(
    'request_id',admin_request,'receiver_type','external','receiver_name','QA Admin Receiver',
    'amount',100,'purpose','QA idempotency contract Admin collection','note','Staging contract test'
  ));
  admin_retry:=public.crew_cash_admin_record_collection(outlet,jsonb_build_object(
    'request_id',admin_request,'receiver_type','external','receiver_name','QA Admin Receiver',
    'amount',100,'purpose','QA idempotency contract Admin collection','note','Staging contract test'
  ));
  if admin_retry->>'id' <> admin_result->>'id' or public.crew_cash_balance(outlet) <> 900
    or (select count(*) from public.crew_cash_ledger_entries l where l.collection_id=(admin_result->>'id')::uuid) <> 1 then
    raise exception 'Admin path was not immediately debited and idempotent';
  end if;

  update public.employees set role_id=original_sender_role where id=sender;
  delete from public.crew_sessions where token_hash in (
    encode(extensions.digest(sender_token,'sha256'),'hex'),
    encode(extensions.digest(receiver_token,'sha256'),'hex'),
    encode(extensions.digest(denied_token,'sha256'),'hex')
  );

  balance:=public.crew_cash_balance(outlet);
  if balance <> 900 then raise exception 'Fixture did not return to canonical balance 900; found %',balance; end if;
end;
$$;

commit;

select jsonb_build_object(
  'status','PASS',
  'outlet','Friends Corner',
  'final_canonical_balance',public.crew_cash_balance('e804c48d-6343-4bf8-99d7-9893c473948f')
) as crew_cash_collection_semantics_staging;
