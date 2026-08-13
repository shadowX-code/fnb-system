select jsonb_build_object(
 'qa_crew',count(distinct e.id),
 'annual_balances',count(*) filter(where ce.leave_type='annual'),
 'medical_balances',count(*) filter(where ce.leave_type='medical'),
 'unpaid_unlimited',count(*) filter(where ce.leave_type='unpaid' and not p.balance_enforced),
 'qa_adjustments',(select count(*) from public.crew_leave_adjustments where reason like '[QA Balance v1]%'),
 'pending_scenario',(select count(*) from public.crew_leave_requests where reason='[QA Balance v1] Pending reservation' and status='pending'),
 'approved_scenario',(select count(*) from public.crew_leave_requests where reason='[QA Balance v1] Approved medical usage' and status='approved')
) crew_leave_balance_qa_validation
from public.employees e join public.crew_leave_entitlements ce on ce.employee_id=e.id join public.crew_leave_policies p on p.outlet_id=ce.outlet_id and p.leave_type=ce.leave_type
where e.employee_code in ('QA-CREW-CO-01','QA-CREW-IF-01','QA-CREW-IP-01','QA-CREW-NA-01','QA-CREW-NS-01') and ce.period_start='2026-01-01';
