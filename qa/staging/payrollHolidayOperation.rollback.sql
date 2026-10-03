-- Staging only. Synthetic source/publication evidence is completely rolled back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare c uuid; rev integer; workplace uuid; rows jsonb:='[]'; decisions jsonb:='{}'; keys jsonb:='[]'; input jsonb; result jsonb; retry jsonb;
 i integer; denied boolean; before_hash text; before_rows jsonb; context jsonb;
begin
 before_hash:=(select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s);
 select v.outlet_id into workplace from payroll_outlet_state_versions v join outlets o on o.id=v.outlet_id where v.state_code='MY-08' and o.is_active and o.name like 'QA ONLY%' limit 1;
 if workplace is null then raise exception 'Verified QA ONLY Perak workplace required'; end if;
 context:=public.payroll_holiday_operation_read(workplace);
 if context->'geographies'->>0 is distinct from 'MY-08' or (context->>'unverified_count')::integer<>0 then raise exception 'Canonical geography projection failed'; end if;
 c:=public.payroll_holiday_candidate_capture(2097,'qa:synthetic','QA ONLY operational Perak calendar','qa.pdf',encode(convert_to('%PDF-1.7 QA ONLY','UTF8'),'base64'),gen_random_uuid(),true);
 for i in 1..11 loop
  rows:=rows||jsonb_build_array(jsonb_build_object('date',make_date(2097,1,i),'name','QA ONLY operational holiday '||i,'scope',case when i=5 then 'state' else 'national' end,'state_code',case when i=5 then 'MY-08' else null end,'kind','gazetted','source_locator','QA ONLY row '||i));
  decisions:=decisions||jsonb_build_object(i::text,jsonb_build_object('action','accept','kind',case when i<=5 then 'required' else 'gazetted' end));
  if i>5 then keys:=keys||jsonb_build_array(i::text); end if;
 end loop;
 rows:=rows||'[{"date":"2097-02-01","name":"QA ONLY unrelated KL uncertainty","scope":"state","state_code":"MY-14","kind":"gazetted","source_locator":"QA ONLY row 12","uncertainty":"Unconfirmed KL date"}]';
 perform public.payroll_holiday_candidate_parse(c,rows);
 select revision,ic.rows into rev,before_rows from payroll_holiday_import_candidates ic where id=c;
 input:=jsonb_build_object('year',2097,'outlet_id',workplace,'geography','MY-08','candidate_id',c,'candidate_revision',rev,'previous_calendar_id',null,'previous_policy_id',null,'selected_keys',keys,'decisions',decisions,'reviewed',true,'request_id',gen_random_uuid());
 -- Insufficient selection and a spoofed jurisdiction must fail with no partial write.
 denied:=false; begin perform public.payroll_holiday_operation_publish(jsonb_set(input,'{selected_keys}','["6"]')); exception when others then denied:=true; end;
 if not denied or exists(select 1 from payroll_holiday_calendar_versions where year=2097) then raise exception 'Selection gate/atomic rollback failed'; end if;
 denied:=false; begin perform public.payroll_holiday_operation_publish(jsonb_set(input,'{geography}','"MY-14"')); exception when others then denied:=true; end;
 if not denied then raise exception 'Jurisdiction spoof accepted'; end if;
 result:=public.payroll_holiday_operation_publish(input);
 retry:=public.payroll_holiday_operation_publish(input);
 if result<>retry then raise exception 'Publication retry is not stable'; end if;
 if (select ic.rows from payroll_holiday_import_candidates ic where id=c)<>before_rows then raise exception 'Source evidence was rewritten'; end if;
 if (select ic.decisions ? '12' from payroll_holiday_import_candidates ic where id=c) then raise exception 'Unrelated KL row was reviewed'; end if;
 if not exists(select 1 from payroll_holiday_calendar_versions where id=(result->>'calendar_id')::uuid and status='published' and jsonb_array_length(entries)=11) then raise exception 'Scoped canonical calendar failed'; end if;
 if not exists(select 1 from payroll_paid_holiday_policy_versions where id=(result->>'policy_id')::uuid and status='published' and cardinality(selected_holiday_ids)=11 and outlet_ids=array[workplace]) then raise exception 'Atomic policy publication failed'; end if;
 if not exists(select 1 from payroll_holiday_import_events where candidate_id=c and event_type='operation_published' and details->>'geography'='MY-08') then raise exception 'Scoped publication audit missing'; end if;
 if before_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s) then raise exception 'Finalized evidence changed'; end if;
 if has_function_privilege('anon','public.payroll_holiday_operation_publish(jsonb)','execute') then raise exception 'Anonymous publication grant'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false; begin perform public.payroll_holiday_operation_publish(input); exception when others then denied:=true; end;
 if not denied then raise exception 'Unauthenticated publication allowed'; end if;
end $$;
rollback;
