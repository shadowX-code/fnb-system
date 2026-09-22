-- Forward-only runtime correction: generate_series returns timestamptz, while
-- crew_roster_employee_day is intentionally date-scoped.
create or replace function public.crew_leave_admin_data(p_outlet_id uuid,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Leave requests are unavailable for this outlet.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee',jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position),'outlet',jsonb_build_object('id',o.id,'name',o.name),'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',r.rejection_reason,'roster_context',coalesce((select jsonb_agg(jsonb_build_object('date',d.d::date,'schedule',public.crew_roster_employee_day(r.employee_id,d.d::date)) order by d.d) from generate_series(r.start_date,r.end_date,interval '1 day') d(d)),'[]'::jsonb)) order by case r.status when 'pending' then 1 else 2 end,r.submitted_at desc),'[]'::jsonb) into rows
 from public.crew_leave_requests r join public.employees e on e.id=r.employee_id join public.outlets o on o.id=r.employment_outlet_id
 where r.employment_outlet_id=p_outlet_id and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to);
 return jsonb_build_object('requests',rows);
end $$;
revoke all on function public.crew_leave_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_leave_admin_data(uuid,date,date) to authenticated;
