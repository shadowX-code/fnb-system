-- Forward-only correction for PL/pgSQL variable/column ambiguity in submit.
create or replace function public.crew_leave_submit(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_outlet uuid; v_leave_type text; v_start_date date; v_end_date date; v_duration text; v_half_period text; v_reason text; v_days numeric; v_row public.crew_leave_requests%rowtype;
begin
 v_employee:=public.crew_session_employee(p_token);
 if jsonb_typeof(p_payload)<>'object' or p_payload ?| array['employee_id','status','reviewed_by','approved','requested_days'] then raise exception using errcode='22023',message='Leave request payload is invalid.'; end if;
 v_leave_type:=p_payload->>'leave_type'; v_duration:=coalesce(p_payload->>'duration_type','full_day'); v_half_period:=nullif(p_payload->>'half_day_period',''); v_reason:=btrim(coalesce(p_payload->>'reason',''));
 begin v_start_date:=(p_payload->>'start_date')::date; v_end_date:=(p_payload->>'end_date')::date; exception when others then raise exception using errcode='22023',message='Valid leave dates are required.'; end;
 if v_leave_type not in ('annual','medical','unpaid','other') or v_duration not in ('full_day','half_day') or v_end_date<v_start_date or (v_duration='half_day' and (v_start_date<>v_end_date or v_half_period not in ('am','pm'))) or (v_duration='full_day' and v_half_period is not null) then raise exception using errcode='22023',message='Leave type, dates, or duration are invalid.'; end if;
 if v_start_date<timezone('Asia/Kuala_Lumpur',now())::date then raise exception using errcode='22023',message='Leave requests cannot start in the past.'; end if;
 if length(v_reason)<2 or length(v_reason)>1000 then raise exception using errcode='22023',message='A brief reason is required.'; end if;
 v_outlet:=public.crew_resolve_employee_outlet(v_employee); if v_outlet is null then raise exception using errcode='22023',message='Your employment outlet is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||v_employee::text));
 if exists(select 1 from public.crew_leave_requests r where r.employee_id=v_employee and r.status in ('pending','approved') and daterange(r.start_date,r.end_date,'[]') && daterange(v_start_date,v_end_date,'[]')) then raise exception using errcode='23P01',message='This request overlaps an existing pending or approved leave.'; end if;
 v_days:=public.crew_leave_requested_days(v_start_date,v_end_date,v_duration);
 insert into public.crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,half_day_period,requested_days,reason,document_status,submitted_by)
 values(v_employee,v_outlet,v_leave_type,v_start_date,v_end_date,v_duration,v_half_period,v_days,v_reason,case when v_leave_type='medical' then 'not_uploaded' else 'not_required' end,v_employee) returning * into v_row;
 insert into public.crew_leave_audit(request_id,action,actor_type,actor_employee_id) values(v_row.id,'submitted','crew',v_employee);
 return jsonb_build_object('id',v_row.id,'status',v_row.status,'leave_type',v_row.leave_type,'start_date',v_row.start_date,'end_date',v_row.end_date,'duration_type',v_row.duration_type,'half_day_period',v_row.half_day_period,'requested_days',v_row.requested_days,'submitted_at',v_row.submitted_at,'document_status',v_row.document_status);
end $$;
revoke all on function public.crew_leave_submit(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_leave_submit(text,jsonb) to anon,authenticated;
