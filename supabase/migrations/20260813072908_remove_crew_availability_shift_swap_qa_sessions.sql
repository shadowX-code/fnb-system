-- Remove only the four deterministic sessions created by the withdrawn
-- Availability + Shift Swap Staging QA seed. Employee access, passcodes and
-- every unrelated Crew session remain untouched.
delete from public.crew_sessions s
using public.employees e
where e.id = s.employee_id
  and e.employee_code in (
    'QA-CREW-CO-01',
    'QA-CREW-IP-01',
    'QA-CREW-NS-01',
    'QA-CREW-NA-01'
  )
  and s.token_hash = encode(
    extensions.digest('availability-demo-' || e.employee_code, 'sha256'),
    'hex'
  );
