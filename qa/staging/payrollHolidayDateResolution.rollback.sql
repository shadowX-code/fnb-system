-- Canonical Staging only. Every fixture, confirmation and publication rolls back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare c uuid; workplace uuid; input jsonb; r jsonb; effective jsonb; raw jsonb; rows jsonb:='[]'; decisions jsonb:='{}'; keys jsonb:='[]'; result jsonb; rev integer; i integer; denied boolean; before_hash text;
begin
 before_hash:=(select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s);
 select v.outlet_id into workplace from payroll_outlet_state_versions v join outlets o on o.id=v.outlet_id where v.state_code='MY-08' and o.is_active and o.name like 'QA ONLY%' limit 1;
 if workplace is null then raise exception 'Verified QA workplace required'; end if;
 c:=payroll_holiday_candidate_capture(2096,'qa:synthetic','QA ONLY date resolution','qa.pdf',encode(convert_to('%PDF-1.7 QA ONLY resolution','UTF8'),'base64'),gen_random_uuid(),true);
 for i in 1..11 loop
  rows:=rows||jsonb_build_array(jsonb_build_object('date',make_date(2096,1,i),'name','QA ONLY date holiday '||case when i=7 then 6 else i end,'scope',case when i=5 then 'state' else 'national' end,'state_code',case when i=5 then 'MY-08' else null end,'kind','gazetted','source_locator','QA ONLY row '||i,'uncertainty',case when i=6 then 'Official source marks this date subject to change. Confirm the observed date against official evidence.' else '' end));
  decisions:=decisions||jsonb_build_object(i::text,jsonb_build_object('action','accept','kind',case when i<=5 then 'required' else 'gazetted' end));
  if i>5 then keys:=keys||jsonb_build_array(i::text); end if;
 end loop;
 perform payroll_holiday_candidate_parse(c,rows);
 select revision,ic.rows into rev,raw from payroll_holiday_import_candidates ic where id=c;
 input:=jsonb_build_object('year',2096,'outlet_id',workplace,'geography','MY-08','candidate_id',c,'candidate_revision',rev,'previous_calendar_id',null,'previous_policy_id',null,'selected_keys',keys,'decisions',decisions,'reviewed',true,'request_id',gen_random_uuid());
 denied:=false; begin perform payroll_holiday_operation_publish(input); exception when others then denied:=true; end;
 if not denied then raise exception 'Unconfirmed source published'; end if;
 r:=raw->5;
 input:=jsonb_build_object('candidate_id',c,'candidate_revision',rev,'source_sha256',(select source_sha256 from payroll_holiday_import_candidates where id=c),'row_key','6','row_identity',payroll_holiday_row_identity(r),'row_fingerprint',payroll_holiday_row_fingerprint(r),'confirmed_date','2096-02-02','official_reference','QA ONLY verified official confirmation page 2','outlet_id',workplace,'request_id',gen_random_uuid());
 result:=payroll_holiday_date_confirm(input);
 if payroll_holiday_date_confirm(input)<>result then raise exception 'Retry not stable'; end if;
 denied:=false; begin perform payroll_holiday_date_confirm(jsonb_set(input,'{official_reference}','"changed"')); exception when others then denied:=true; end;
 if not denied then raise exception 'Changed retry accepted'; end if;
 select value->'rows' into effective from jsonb_array_elements(payroll_holiday_candidate_read(2096,true)) where value->>'id'=c::text;
 if effective->5->>'state'<>'new' or effective->5->'row'->>'date'<>'2096-02-02' or not (effective->5 ? 'date_resolution') then raise exception 'Effective confirmation projection failed'; end if;
 if (select ic.rows from payroll_holiday_import_candidates ic where id=c)<>raw then raise exception 'Raw extraction rewritten'; end if;
 if not exists(select 1 from payroll_holiday_import_events where candidate_id=c and event_type='date_confirmed' and details->'source_row'->>'issue'=r->>'issue' and actor_employee_id is not null) then raise exception 'Resolution audit missing original evidence'; end if;
 if (payroll_holiday_effective_rows(c,'different_source_hash',2096,raw)->5 ? 'date_resolution') then raise exception 'Source hash inherited confirmation'; end if;
 -- Confirmed uncertainty does not clear a separately conflicting effective date.
 select revision into rev from payroll_holiday_import_candidates where id=c;
 perform payroll_holiday_date_confirm(input||jsonb_build_object('candidate_revision',rev,'confirmed_date','2096-01-07','request_id',gen_random_uuid()));
 select value->'rows' into effective from jsonb_array_elements(payroll_holiday_candidate_read(2096,true)) where value->>'id'=c::text;
 if effective->5->>'state'<>'blocked' or effective->5->>'issue'<>'Duplicate date/name/jurisdiction' or not (effective->5 ? 'date_resolution') then raise exception 'Independent date conflict bypassed'; end if;
 -- Independent classification review survives confirmation.
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update payroll_holiday_import_candidates set rows=jsonb_set(ic.rows,'{5,classification_review}','true'),decisions='{}' from payroll_holiday_import_candidates ic where ic.id=c and payroll_holiday_import_candidates.id=c;
 select revision,ic.rows into rev,raw from payroll_holiday_import_candidates ic where id=c;
 input:=input||jsonb_build_object('candidate_revision',rev,'row_identity',payroll_holiday_row_identity(raw->5),'row_fingerprint',payroll_holiday_row_fingerprint(raw->5),'request_id',gen_random_uuid());
 perform payroll_holiday_date_confirm(input);
 select revision into rev from payroll_holiday_import_candidates where id=c;
 denied:=false; begin perform payroll_holiday_candidate_review(c,rev,jsonb_build_object('6',jsonb_build_object('action','accept')),true); exception when others then denied:=true; end;
 if not denied then raise exception 'Date confirmation bypassed classification'; end if;
 -- Same source with revised row evidence requires another explicit confirmation.
 perform payroll_holiday_candidate_parse(c,jsonb_set(rows,'{5,source_locator}','"QA ONLY revised row 6"'));
 select ic.rows into raw from payroll_holiday_import_candidates ic where id=c;
 select value->'rows' into effective from jsonb_array_elements(payroll_holiday_candidate_read(2096,true)) where value->>'id'=c::text;
 if effective->5 ? 'date_resolution' or effective->5->>'state'<>'blocked' then raise exception 'Revised row inherited confirmation'; end if;
 select revision into rev from payroll_holiday_import_candidates where id=c;
 input:=input||jsonb_build_object('candidate_revision',rev,'row_identity',payroll_holiday_row_identity(raw->5),'row_fingerprint',payroll_holiday_row_fingerprint(raw->5),'request_id',gen_random_uuid());
 perform payroll_holiday_date_confirm(input);
 select revision into rev from payroll_holiday_import_candidates where id=c;
 result:=payroll_holiday_operation_publish(jsonb_build_object('year',2096,'outlet_id',workplace,'geography','MY-08','candidate_id',c,'candidate_revision',rev,'previous_calendar_id',null,'previous_policy_id',null,'selected_keys',keys,'decisions',decisions,'reviewed',true,'request_id',gen_random_uuid()));
 if not exists(select 1 from payroll_holiday_calendar_versions v cross join lateral jsonb_array_elements(v.entries)e where v.id=(result->>'calendar_id')::uuid and e->'holiday'->>'holiday_date'='2096-02-02') then raise exception 'Publication ignored confirmed date'; end if;
 if before_hash<>(select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s) then raise exception 'Finalized evidence changed'; end if;
 if has_function_privilege('anon','payroll_holiday_date_confirm(jsonb)','execute') or has_function_privilege('authenticated','payroll_holiday_effective_rows(uuid,text,integer,jsonb)','execute') then raise exception 'Authority grants exposed'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false; begin perform payroll_holiday_date_confirm(input); exception when others then denied:=true; end;
 if not denied then raise exception 'Unauthenticated confirmation accepted'; end if;
end $$;
rollback;
