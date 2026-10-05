-- Act 4 s2(24) includes holiday remuneration and extra work on holidays.
-- The existing ordinary SOCSO/EIS authority already includes company_ph_benefit.
-- LINDUNG independently assesses the same canonical earning under Act 4; no
-- component setup, PH formula, participation or historical Payroll data changes.
-- Official evidence: https://perkeso.gov.my/images/akta/ACT%204/Act%204%20-%20EMPLOYEES%E2%80%99%20SOCIAL%20SECURITY%20ACT%201969%20(As%20at%201%20September%202022).pdf

do $$
declare definition text; old_mapping text; new_mapping text;
begin
 definition:=pg_get_functiondef('public.payroll_lindung_wages(jsonb)'::regprocedure);
 old_mapping:=$anchor$('monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','unpaid_time')$anchor$;
 new_mapping:=$anchor$('monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','company_ph_benefit','unpaid_time')$anchor$;
 if position(old_mapping in definition)=0 then
  raise exception 'Canonical LINDUNG system earning mapping differs; inspect before applying';
 end if;
 execute replace(definition,old_mapping,new_mapping);
end $$;
-- Remain an internal statutory authority. Client intent cannot supply line codes.
revoke all on function public.payroll_lindung_wages(jsonb) from public,anon,authenticated;
