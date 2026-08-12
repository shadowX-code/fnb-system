select c.period_start,c.configured_pool,c.unlocked_pool,c.actual_payout,c.unused_amount,c.status,c.calculation_version,
       count(e.id) entries,count(*) filter(where e.status in ('qualified','finalized','paid')) eligible
from public.crew_reward_cycles c left join public.crew_reward_entries e on e.cycle_id=c.id
where c.outlet_id='e804c48d-6343-4bf8-99d7-9893c473948f' and c.period_start=date_trunc('month',current_date)::date
group by c.id;
select emp.employee_code,emp.full_name,emp.employment_type,e.performance_score,e.eligible_hours,e.contribution_share,e.performance_factor,e.final_payout,e.status,e.eligibility_reason
from public.crew_reward_entries e join public.employees emp on emp.id=e.employee_id join public.crew_reward_cycles c on c.id=e.cycle_id
where c.outlet_id='e804c48d-6343-4bf8-99d7-9893c473948f' and c.period_start=date_trunc('month',current_date)::date order by e.final_payout desc,emp.employee_code;
