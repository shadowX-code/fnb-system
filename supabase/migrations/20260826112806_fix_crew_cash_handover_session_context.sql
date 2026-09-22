-- Use the existing token-bound Crew context authority; the prior receiver
-- migration accidentally referenced a non-existent helper.
create or replace function public.crew_cash_record_collection(p_token text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 ctx:=public.crew_operations_employee_context(p_token);
 employee:=(ctx->>'employee_id')::uuid;
 outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection') then raise exception using errcode='42501',message='You do not have permission to hand over Cash Deposit funds.'; end if;
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(outlet,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(outlet) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',outlet,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(outlet::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=outlet and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,amount,difference,purpose,note,status,handed_over_by_employee_id)
 values(outlet,request,fingerprint,'internal',receiver,amount,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),'pending_receipt',employee) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id)
 values(outlet,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,employee);
 return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_record_collection(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_record_collection(text,jsonb) to anon,authenticated;
