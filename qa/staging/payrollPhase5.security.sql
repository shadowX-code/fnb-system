-- Disposable access already approved. Test-created sessions/commands roll back.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare token text; own_period uuid:='18f50e85-7fa3-42aa-8a9e-a23e28f402b3'; unrelated uuid; projected jsonb; entry public.payroll_settlement_entries%rowtype; before_count integer; rejected boolean;
begin
 -- Supply the disposable credential privately in the transaction; never commit it.
 token:=public.crew_authenticate('01199005501',current_setting('feedx.qa_crew_passcode',true))->>'token';
 projected:=public.crew_payroll_payslips(token)->'payslips';
 if jsonb_array_length(projected)<>1 or projected->0->>'net_pay'<>'2901.55' then raise exception 'Crew must see only own current result: %',projected; end if;
 projected:=public.crew_payroll_payslip_prepare(token,own_period);
 if projected->>'job_id'<>'0328eacd-4325-4d0d-ab7a-64f459857fef' then raise exception 'Crew exposed superseded/other artifact'; end if;
 select id into unrelated from public.payroll_periods where id<>own_period limit 1;
 rejected:=false;
 begin perform public.crew_payroll_payslip_prepare(token,unrelated); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Cross-employee period allowed'; end if;
 rejected:=false;
 begin perform public.crew_payroll_payslips('invalid'); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Invalid token allowed'; end if;
 select * into entry from public.payroll_settlement_entries where employee_id='2f8d04ad-e62b-4dc6-b7bd-6e46463387ce' order by created_at limit 1;
 select count(*) into before_count from public.payroll_settlement_entries where employee_id=entry.employee_id;
 perform public.payroll_payment_record(entry.request_id,entry.run_id,entry.employee_id,entry.kind,trim_scale(entry.amount),entry.payment_date,entry.reference,entry.remark,entry.reverses_id);
 if before_count<>(select count(*) from public.payroll_settlement_entries where employee_id=entry.employee_id) then raise exception 'Retry duplicated payment'; end if;
 rejected:=false;
 begin perform public.payroll_payment_record(entry.request_id,entry.run_id,entry.employee_id,entry.kind,entry.amount+1,entry.payment_date,entry.reference,entry.remark,entry.reverses_id); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Changed retry payload allowed'; end if;
 rejected:=false;
 begin perform public.payroll_payment_record(gen_random_uuid(),entry.run_id,entry.employee_id,'payment',1,current_date,'QA',null,null); exception when object_not_in_prerequisite_state then rejected:=true; end;
 if not rejected then raise exception 'Superseded settlement allowed'; end if;
 perform public.manage_crew_access(entry.employee_id,'disable');
 rejected:=false;
 begin perform public.crew_payroll_payslips(token); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Revoked Crew allowed'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 rejected:=false;
 begin perform public.payroll_payment_read(entry.run_id,entry.employee_id); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Unsigned Admin allowed'; end if;
 if has_table_privilege('authenticated','public.payroll_payslip_jobs','SELECT') or has_table_privilege('anon','public.payroll_settlement_entries','SELECT') then raise exception 'Direct sensitive table access'; end if;
end $$;
select 'Own/current payslip, cross-period denial, invalid/revoked session, Admin denial, immutable retry/current settlement PASS' result;
rollback;
