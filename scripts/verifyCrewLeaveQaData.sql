select jsonb_build_object(
 'scenarios',count(*),
 'pending',count(*) filter(where status='pending'),
 'approved',count(*) filter(where status='approved'),
 'rejected',count(*) filter(where status='rejected'),
 'medical_approved',count(*) filter(where status='approved' and leave_type='medical'),
 'conflict_projection',count(*) filter(where reason='[QA Leave v1] Approved over scheduled shift' and exists(select 1 from public.crew_leave_roster_projections p join public.crew_approved_leaves a on a.id=p.approved_leave_id where a.request_id=crew_leave_requests.id and p.superseded_roster_entry->>'entry_type'='working'))
) crew_leave_qa_data
from public.crew_leave_requests where reason like '[QA Leave v1]%';
