with qa as (
  select
    (select count(*) from public.crew_availability_windows w join public.employees e on e.id=w.employee_id where e.employee_code like 'QA-CREW-%') availability_windows,
    (select count(*) from public.crew_availability_exceptions x join public.employees e on e.id=x.employee_id where e.employee_code like 'QA-CREW-%') availability_exceptions,
    (select count(*) from public.crew_shift_requests where reason like '[QA Shift Swap]%') shift_requests,
    (select count(*) from public.crew_shift_requests where reason='[QA Shift Swap] Approved' and status='approved' and approved_publication_id is not null) approved,
    (select count(*) from public.crew_shift_requests where reason='[QA Shift Swap] Rejected' and status='rejected') rejected,
    (select count(*) from public.crew_shift_requests where reason='[QA Shift Swap] Specific Pending Manager' and status='pending_manager') pending_manager,
    (select count(*) from public.crew_shift_requests where reason='[QA Shift Swap] Open Cover' and status='pending_crew') open_cover,
    (select count(*) from public.duty_rosters r join public.employees e on e.id=r.employee_id where e.employee_code='QA-CREW-NS-01' and r.roster_date='2026-08-21' and r.availability_conflict) roster_warnings
)
select jsonb_build_object('target','fnb-system-staging','qa',to_jsonb(qa),'passed',(availability_windows>=28 and availability_exceptions>=1 and shift_requests>=4 and approved=1 and rejected=1 and pending_manager=1 and open_cover=1 and roster_warnings>=1)) result from qa;
