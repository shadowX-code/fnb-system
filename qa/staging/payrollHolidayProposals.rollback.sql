-- Staging only: all synthetic source, review and publication evidence rolls back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare c uuid; chk uuid; rev integer; published uuid; pdf text:=encode(convert_to('%PDF-1.7 QA ONLY extractor authority fixture','UTF8'),'base64');
 hash text; v jsonb; decisions jsonb; denied boolean; events integer; before_hash text;
 rows jsonb:='[{"date":"2096-01-01","name":"QA ONLY clean","scope":"national","kind":"gazetted","source_locator":"page 1 row 1"},{"date":"2096-02-01","name":"QA ONLY classification","scope":"national","kind":"gazetted","classification_review":true,"suggested_kind":"required","source_locator":"page 1 row 2"},{"date":"2096-03-01","name":"QA ONLY provisional","scope":"national","kind":"gazetted","uncertainty":"Date subject to official confirmation","source_locator":"page 1 row 3"}]';
begin
 before_hash:=(select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s);
 if has_function_privilege('authenticated','payroll_holiday_candidate_propose(uuid,uuid,text,jsonb,jsonb)','EXECUTE') or has_function_privilege('anon','payroll_holiday_candidate_proposal_failure(uuid,uuid,text)','EXECUTE') then raise exception 'trusted extractor exposed'; end if;
 chk:=(public.payroll_holiday_update_check_begin(2096,'MY-08',gen_random_uuid())->>'id')::uuid;
 c:=(public.payroll_holiday_discovered_source_capture(2096,'https://www.kabinet.gov.my/storage/2096/QA.pdf','QA ONLY extraction rollback','qa.pdf',pdf,gen_random_uuid())->>'id')::uuid;
 select source_sha256 into hash from payroll_holiday_import_candidates where id=c;
 denied:=false;begin perform public.payroll_holiday_candidate_propose(c,chk,'wrong',rows,'{"parser":"bkpp_proposal_v1","document_role":"annual"}');exception when others then denied:=true;end;
 if not denied then raise exception 'wrong source hash accepted';end if;
 perform public.payroll_holiday_candidate_propose(c,chk,hash,rows,'{"parser":"bkpp_proposal_v1","document_role":"annual"}');
 select ic.revision,ic.decisions into rev,decisions from payroll_holiday_import_candidates ic where id=c;
 if decisions->'1'->>'action' is distinct from 'accept' or decisions ? '2' or decisions ? '3' then raise exception 'exception-only source review failed';end if;
 denied:=false;begin perform public.payroll_holiday_candidate_review(c,rev,decisions,true);exception when others then denied:=true;end;
 if not denied then raise exception 'uncertain evidence approved';end if;
 events:=(select count(*) from payroll_holiday_import_events where candidate_id=c);
 perform public.payroll_holiday_candidate_propose(c,chk,hash,rows,'{"parser":"bkpp_proposal_v1","document_role":"annual"}');
 if events<>(select count(*) from payroll_holiday_import_events where candidate_id=c) then raise exception 'proposal retry duplicated audit';end if;
 rows:=jsonb_set(rows,'{2,uncertainty}','""');
 perform public.payroll_holiday_candidate_parse(c,rows);
 select ic.revision,ic.decisions into rev,decisions from payroll_holiday_import_candidates ic where id=c;
 if decisions->'1'->>'action' is distinct from 'accept' or decisions ? '3' then raise exception 'clean decision preservation / correction review failed';end if;
 if not exists(select 1 from payroll_holiday_import_events where candidate_id=c and event_type='parsed' and jsonb_array_length(details->'previous_rows')=3) then raise exception 'prior extraction audit lost';end if;
 decisions:=decisions||'{"2":{"action":"accept","kind":"required"},"3":{"action":"accept","remark":"QA ONLY official date verified"}}';
 perform public.payroll_holiday_candidate_review(c,rev,decisions,true);
 select revision into rev from payroll_holiday_import_candidates where id=c;
 published:=public.payroll_holiday_candidate_publish(c,rev);
 if not exists(select 1 from payroll_holiday_calendar_versions where id=published and status='published') then raise exception 'explicit publication failed';end if;
 denied:=false;begin perform public.payroll_holiday_candidate_parse(c,rows||'[{"date":"2096-04-01","name":"QA ONLY late edit","scope":"national","source_locator":"p2"}]');exception when others then denied:=true;end;
 if not denied then raise exception 'published source changed';end if;
 -- A same-name changed date is a correction, not an unrelated new holiday.
 c:=public.payroll_holiday_candidate_capture(2096,'qa:synthetic','QA ONLY changed date','qa.pdf',pdf,gen_random_uuid(),true);
 perform public.payroll_holiday_candidate_parse(c,'[{"date":"2096-01-02","name":"QA ONLY clean","scope":"national","source_locator":"p1"}]');
 if (select ic.rows->0->>'state' from payroll_holiday_import_candidates ic where id=c) is distinct from 'changed' then raise exception 'date conflict was not identified';end if;
 if before_hash is distinct from (select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by run_id,employee_id),'')) from payroll_run_statutory_snapshots s) then raise exception 'finalized evidence changed';end if;
end $$;
rollback;
