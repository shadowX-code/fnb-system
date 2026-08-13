-- crew_session_employee refreshes session activity, so this Crew authority
-- must remain VOLATILE (the PostgreSQL default), not STABLE/read-only.
create or replace function public.crew_leave_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; rows jsonb;
begin
 employee:=public.crew_session_employee(p_token);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',case when r.status='rejected' then r.rejection_reason else null end,'can_cancel',r.status='pending') order by r.start_date desc,r.submitted_at desc),'[]'::jsonb) into rows from public.crew_leave_requests r where r.employee_id=employee;
 return jsonb_build_object('requests',rows,'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'leave_type',a.leave_type,'start_date',a.start_date,'end_date',a.end_date,'duration_type',a.duration_type,'half_day_period',a.half_day_period) order by a.start_date) from public.crew_approved_leaves a where a.employee_id=employee and a.end_date>=timezone('Asia/Kuala_Lumpur',now())::date),'[]'::jsonb));
end $$;
revoke all on function public.crew_leave_mobile(text) from public,anon,authenticated;
grant execute on function public.crew_leave_mobile(text) to anon,authenticated;
