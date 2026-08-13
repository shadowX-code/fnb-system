-- Crew Leave Request v1: employee-owned requests, controlled manager review,
-- durable approved leave records, and immutable roster projection revisions.

insert into public.permissions(code,module,description) values
 ('crew_leave.view','Crew Leave','View outlet-scoped Crew leave requests and approved leave.'),
 ('crew_leave.review','Crew Leave','Approve or reject outlet-scoped Crew leave requests.'),
 ('crew_leave.manage','Crew Leave','Manage Crew leave administration and projections.')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in ('crew_leave.view','crew_leave.review','crew_leave.manage')
on conflict do nothing;

create table public.crew_leave_requests(
 id uuid primary key default extensions.gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 employment_outlet_id uuid not null references public.outlets(id) on delete restrict,
 leave_type text not null check(leave_type in ('annual','medical','unpaid','other')),
 start_date date not null,
 end_date date not null,
 duration_type text not null default 'full_day' check(duration_type in ('full_day','half_day')),
 half_day_period text check(half_day_period in ('am','pm')),
 requested_days numeric(6,2) not null check(requested_days>0),
 reason text not null check(length(btrim(reason)) between 2 and 1000),
 document_status text not null default 'not_uploaded' check(document_status in ('not_required','not_uploaded')),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 submitted_by uuid not null references public.employees(id) on delete restrict,
 submitted_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 rejection_reason text,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(end_date>=start_date),
 check((duration_type='full_day' and half_day_period is null) or (duration_type='half_day' and start_date=end_date and half_day_period is not null)),
 check((status='rejected' and rejection_reason is not null and reviewed_at is not null) or status<>'rejected'),
 check((status='approved' and reviewed_at is not null) or status<>'approved'),
 check((status='cancelled' and cancelled_at is not null) or status<>'cancelled')
);
create index crew_leave_requests_employee_dates_idx on public.crew_leave_requests(employee_id,start_date,end_date,status);
create index crew_leave_requests_outlet_status_idx on public.crew_leave_requests(employment_outlet_id,status,submitted_at desc);

create table public.crew_approved_leaves(
 id uuid primary key default extensions.gen_random_uuid(),
 request_id uuid not null unique references public.crew_leave_requests(id) on delete restrict,
 employee_id uuid not null references public.employees(id) on delete restrict,
 employment_outlet_id uuid not null references public.outlets(id) on delete restrict,
 leave_type text not null check(leave_type in ('annual','medical','unpaid','other')),
 start_date date not null,
 end_date date not null,
 duration_type text not null check(duration_type in ('full_day','half_day')),
 half_day_period text check(half_day_period in ('am','pm')),
 approved_by uuid not null references auth.users(id) on delete restrict,
 approved_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 check(end_date>=start_date)
);
create index crew_approved_leaves_employee_dates_idx on public.crew_approved_leaves(employee_id,start_date,end_date);

create table public.crew_leave_roster_projections(
 id uuid primary key default extensions.gen_random_uuid(),
 approved_leave_id uuid not null references public.crew_approved_leaves(id) on delete restrict,
 employee_id uuid not null references public.employees(id) on delete restrict,
 roster_date date not null,
 outlet_id uuid not null references public.outlets(id) on delete restrict,
 leave_type text not null,
 source text not null default 'approved_leave' check(source='approved_leave'),
 superseded_roster_entry jsonb,
 source_publication_id uuid references public.duty_roster_publications(id) on delete set null,
 projected_by uuid not null references auth.users(id) on delete restrict,
 projected_at timestamptz not null default now(),
 unique(employee_id,roster_date)
);
create index crew_leave_roster_projection_outlet_date_idx on public.crew_leave_roster_projections(outlet_id,roster_date);

create table public.crew_leave_audit(
 id uuid primary key default extensions.gen_random_uuid(),
 request_id uuid not null references public.crew_leave_requests(id) on delete restrict,
 action text not null check(action in ('submitted','cancelled','approved','rejected','projected')),
 actor_type text not null check(actor_type in ('crew','admin','system')),
 actor_employee_id uuid references public.employees(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

alter table public.crew_leave_requests enable row level security;
alter table public.crew_approved_leaves enable row level security;
alter table public.crew_leave_roster_projections enable row level security;
alter table public.crew_leave_audit enable row level security;
revoke all on public.crew_leave_requests,public.crew_approved_leaves,public.crew_leave_roster_projections,public.crew_leave_audit from public,anon,authenticated;

alter table public.duty_rosters add column if not exists source text not null default 'manual_roster';
alter table public.duty_rosters add column if not exists approved_leave_id uuid references public.crew_approved_leaves(id) on delete restrict;
alter table public.duty_roster_published_entries add column if not exists source text not null default 'manual_roster';
alter table public.duty_roster_published_entries add column if not exists approved_leave_id uuid references public.crew_approved_leaves(id) on delete restrict;

insert into public.shift_templates(outlet_id,name,code,start_time,end_time,break_minutes,shift_type,color,is_active)
select o.id,v.name,v.code,null,null,0,v.shift_type,'purple',true from public.outlets o cross join (values
 ('Annual Leave','AL','annual_leave'),('Medical Leave','MC','medical_leave'),('Unpaid Leave','UL','unpaid_leave'),('Other Leave','OL','other_leave')
) v(name,code,shift_type) on conflict do nothing;

create or replace function public.crew_leave_label(p_type text) returns text language sql immutable set search_path=public as $$
 select case p_type when 'annual' then 'Annual Leave' when 'medical' then 'Medical Leave' when 'unpaid' then 'Unpaid Leave' else 'Other Leave' end
$$;
revoke all on function public.crew_leave_label(text) from public,anon,authenticated;

create or replace function public.crew_leave_requested_days(p_start date,p_end date,p_duration text)
returns numeric language sql immutable set search_path=public as $$ select case when p_duration='half_day' then 0.5 else (p_end-p_start+1)::numeric end $$;
revoke all on function public.crew_leave_requested_days(date,date,text) from public,anon,authenticated;

create or replace function public.crew_leave_submit(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; outlet uuid; leave_type text; start_date date; end_date date; duration text; half_period text; reason text; days numeric; row public.crew_leave_requests%rowtype;
begin
 employee:=public.crew_session_employee(p_token);
 if jsonb_typeof(p_payload)<>'object' or p_payload ?| array['employee_id','status','reviewed_by','approved','requested_days'] then raise exception using errcode='22023',message='Leave request payload is invalid.'; end if;
 leave_type:=p_payload->>'leave_type'; duration:=coalesce(p_payload->>'duration_type','full_day'); half_period:=nullif(p_payload->>'half_day_period',''); reason:=btrim(coalesce(p_payload->>'reason',''));
 begin start_date:=(p_payload->>'start_date')::date; end_date:=(p_payload->>'end_date')::date; exception when others then raise exception using errcode='22023',message='Valid leave dates are required.'; end;
 if leave_type not in ('annual','medical','unpaid','other') or duration not in ('full_day','half_day') or end_date<start_date or (duration='half_day' and (start_date<>end_date or half_period not in ('am','pm'))) or (duration='full_day' and half_period is not null) then raise exception using errcode='22023',message='Leave type, dates, or duration are invalid.'; end if;
 if start_date<timezone('Asia/Kuala_Lumpur',now())::date then raise exception using errcode='22023',message='Leave requests cannot start in the past.'; end if;
 if length(reason)<2 or length(reason)>1000 then raise exception using errcode='22023',message='A brief reason is required.'; end if;
 outlet:=public.crew_resolve_employee_outlet(employee); if outlet is null then raise exception using errcode='22023',message='Your employment outlet is unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtext('crew_leave:'||employee::text));
 if exists(select 1 from public.crew_leave_requests r where r.employee_id=employee and r.status in ('pending','approved') and daterange(r.start_date,r.end_date,'[]') && daterange(start_date,end_date,'[]')) then raise exception using errcode='23P01',message='This request overlaps an existing pending or approved leave.'; end if;
 days:=public.crew_leave_requested_days(start_date,end_date,duration);
 insert into public.crew_leave_requests(employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,half_day_period,requested_days,reason,document_status,submitted_by)
 values(employee,outlet,leave_type,start_date,end_date,duration,half_period,days,reason,case when leave_type='medical' then 'not_uploaded' else 'not_required' end,employee) returning * into row;
 insert into public.crew_leave_audit(request_id,action,actor_type,actor_employee_id) values(row.id,'submitted','crew',employee);
 return jsonb_build_object('id',row.id,'status',row.status,'leave_type',row.leave_type,'start_date',row.start_date,'end_date',row.end_date,'duration_type',row.duration_type,'half_day_period',row.half_day_period,'requested_days',row.requested_days,'submitted_at',row.submitted_at,'document_status',row.document_status);
end $$;
revoke all on function public.crew_leave_submit(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_leave_submit(text,jsonb) to anon,authenticated;

create or replace function public.crew_leave_mobile(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare employee uuid; rows jsonb;
begin
 employee:=public.crew_session_employee(p_token);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',case when r.status='rejected' then r.rejection_reason else null end,'can_cancel',r.status='pending') order by r.start_date desc,r.submitted_at desc),'[]'::jsonb) into rows from public.crew_leave_requests r where r.employee_id=employee;
 return jsonb_build_object('requests',rows,'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'leave_type',a.leave_type,'start_date',a.start_date,'end_date',a.end_date,'duration_type',a.duration_type,'half_day_period',a.half_day_period) order by a.start_date) from public.crew_approved_leaves a where a.employee_id=employee and a.end_date>=timezone('Asia/Kuala_Lumpur',now())::date),'[]'::jsonb));
end $$;
revoke all on function public.crew_leave_mobile(text) from public,anon,authenticated;
grant execute on function public.crew_leave_mobile(text) to anon,authenticated;

create or replace function public.crew_leave_cancel(p_token text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; row public.crew_leave_requests%rowtype;
begin
 employee:=public.crew_session_employee(p_token); select * into row from public.crew_leave_requests where id=p_request_id for update;
 if row.id is null or row.employee_id<>employee then raise exception using errcode='42501',message='Leave request is unavailable.'; end if;
 if row.status<>'pending' then raise exception using errcode='22023',message='Only a pending leave request can be cancelled.'; end if;
 update public.crew_leave_requests set status='cancelled',cancelled_at=now(),updated_at=now() where id=row.id returning * into row;
 insert into public.crew_leave_audit(request_id,action,actor_type,actor_employee_id) values(row.id,'cancelled','crew',employee);
 return jsonb_build_object('id',row.id,'status',row.status,'cancelled_at',row.cancelled_at);
end $$;
revoke all on function public.crew_leave_cancel(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_leave_cancel(text,uuid) to anon,authenticated;

create or replace function public.crew_leave_admin_data(p_outlet_id uuid,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows jsonb;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Leave requests are unavailable for this outlet.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee',jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position),'outlet',jsonb_build_object('id',o.id,'name',o.name),'leave_type',r.leave_type,'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,'reviewed_at',r.reviewed_at,'rejection_reason',r.rejection_reason,'roster_context',coalesce((select jsonb_agg(jsonb_build_object('date',d.d,'schedule',public.crew_roster_employee_day(r.employee_id,d.d)) order by d.d) from generate_series(r.start_date,r.end_date,interval '1 day') d(d)),'[]'::jsonb)) order by case r.status when 'pending' then 1 else 2 end,r.submitted_at desc),'[]'::jsonb) into rows
 from public.crew_leave_requests r join public.employees e on e.id=r.employee_id join public.outlets o on o.id=r.employment_outlet_id
 where r.employment_outlet_id=p_outlet_id and (p_from is null or r.end_date>=p_from) and (p_to is null or r.start_date<=p_to);
 return jsonb_build_object('requests',rows);
end $$;
revoke all on function public.crew_leave_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_leave_admin_data(uuid,date,date) to authenticated;

create or replace function public.crew_leave_review(p_request_id uuid,p_decision text,p_rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crew_leave_requests%rowtype; approved public.crew_approved_leaves%rowtype; d date; projection_outlet uuid; current_schedule jsonb; template_id uuid;
begin
 if auth.uid() is null or not public.current_user_has_permission('crew_leave.review') then raise exception using errcode='42501',message='Leave review permission is required.'; end if;
 select * into row from public.crew_leave_requests where id=p_request_id for update;
 if row.id is null or not public.current_user_can_access_outlet(row.employment_outlet_id) then raise exception using errcode='42501',message='Leave request is outside your outlet scope.'; end if;
 if row.status<>'pending' then raise exception using errcode='22023',message='Only a pending leave request can be reviewed.'; end if;
 if p_decision not in ('approve','reject') then raise exception using errcode='22023',message='Review decision is invalid.'; end if;
 if p_decision='reject' then
   if length(btrim(coalesce(p_rejection_reason,'')))<2 then raise exception using errcode='22023',message='A rejection reason is required.'; end if;
   update public.crew_leave_requests set status='rejected',rejection_reason=left(btrim(p_rejection_reason),1000),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=row.id returning * into row;
   insert into public.crew_leave_audit(request_id,action,actor_type,actor_user_id,detail) values(row.id,'rejected','admin',auth.uid(),jsonb_build_object('reason',row.rejection_reason));
 else
   if exists(select 1 from public.crew_approved_leaves a where a.employee_id=row.employee_id and daterange(a.start_date,a.end_date,'[]') && daterange(row.start_date,row.end_date,'[]')) then raise exception using errcode='23P01',message='This leave overlaps another approved leave.'; end if;
   update public.crew_leave_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=row.id returning * into row;
   insert into public.crew_approved_leaves(request_id,employee_id,employment_outlet_id,leave_type,start_date,end_date,duration_type,half_day_period,approved_by) values(row.id,row.employee_id,row.employment_outlet_id,row.leave_type,row.start_date,row.end_date,row.duration_type,row.half_day_period,auth.uid()) returning * into approved;
   for d in select generate_series(row.start_date,row.end_date,interval '1 day')::date loop
     current_schedule:=public.crew_roster_employee_day(row.employee_id,d); projection_outlet:=coalesce(nullif(current_schedule->>'outlet_id','')::uuid,row.employment_outlet_id);
     insert into public.crew_leave_roster_projections(approved_leave_id,employee_id,roster_date,outlet_id,leave_type,superseded_roster_entry,source_publication_id,projected_by)
     values(approved.id,row.employee_id,d,projection_outlet,row.leave_type,nullif(current_schedule,'null'::jsonb),nullif(current_schedule->>'publication_id','')::uuid,auth.uid());
     select id into template_id from public.shift_templates where outlet_id=projection_outlet and code=case row.leave_type when 'annual' then 'AL' when 'medical' then 'MC' when 'unpaid' then 'UL' else 'OL' end limit 1;
     insert into public.duty_rosters(outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,break_minutes,status,remark,created_by,updated_by,source,approved_leave_id)
     values(projection_outlet,row.employee_id,d,template_id,null,null,0,'draft',public.crew_leave_label(row.leave_type),auth.uid(),auth.uid(),'approved_leave',approved.id)
     on conflict(outlet_id,employee_id,roster_date) do update set shift_template_id=excluded.shift_template_id,start_time=null,end_time=null,break_minutes=0,status='draft',remark=excluded.remark,updated_by=auth.uid(),updated_at=now(),source='approved_leave',approved_leave_id=approved.id;
   end loop;
   insert into public.crew_leave_audit(request_id,action,actor_type,actor_user_id,detail) values(row.id,'approved','admin',auth.uid(),jsonb_build_object('approved_leave_id',approved.id));
 end if;
 return jsonb_build_object('id',row.id,'status',row.status,'reviewed_at',row.reviewed_at,'rejection_reason',row.rejection_reason,'approved_leave_id',approved.id);
end $$;
revoke all on function public.crew_leave_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_leave_review(uuid,text,text) to authenticated;

create or replace function public.crew_leave_block_roster_override() returns trigger language plpgsql security definer set search_path=public as $$
declare shift_type text;
begin
 select t.shift_type into shift_type from public.shift_templates t where t.id=new.shift_template_id;
 if coalesce(new.source,'manual_roster')<>'approved_leave' and coalesce(shift_type,case when new.start_time is not null then 'working' end)='working' and exists(select 1 from public.crew_approved_leaves a where a.employee_id=new.employee_id and new.roster_date between a.start_date and a.end_date) then raise exception using errcode='23P01',message='This employee has approved leave on the selected date.'; end if;
 return new;
end $$;
revoke all on function public.crew_leave_block_roster_override() from public,anon,authenticated;
create trigger crew_leave_block_roster_override before insert or update on public.duty_rosters for each row execute function public.crew_leave_block_roster_override();

create or replace function public.crew_roster_employee_day(p_employee_id uuid,p_business_date date)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce((select jsonb_build_object('entry_id',lp.id,'publication_id',lp.source_publication_id,'date',lp.roster_date,'outlet_id',lp.outlet_id,'outlet_name',o.name,'start_time',null,'end_time',null,'break_minutes',0,'entry_type',a.leave_type||'_leave','template_code',case a.leave_type when 'annual' then 'AL' when 'medical' then 'MC' when 'unpaid' then 'UL' else 'OL' end,'template_name',public.crew_leave_label(a.leave_type),'position',e.position,'group',null,'published_at',a.approved_at,'source','approved_leave','approved_leave_id',a.id) from public.crew_leave_roster_projections lp join public.crew_approved_leaves a on a.id=lp.approved_leave_id join public.outlets o on o.id=lp.outlet_id join public.employees e on e.id=lp.employee_id where lp.employee_id=p_employee_id and lp.roster_date=p_business_date),
 (select jsonb_build_object('entry_id',pe.id,'publication_id',pe.publication_id,'date',pe.roster_date,'outlet_id',pe.outlet_id,'outlet_name',pe.outlet_name_snapshot,'start_time',pe.start_time,'end_time',pe.end_time,'break_minutes',pe.break_minutes,'entry_type',pe.entry_type,'template_code',pe.template_code,'template_name',pe.template_name,'position',pe.position_snapshot,'group',pe.group_snapshot,'published_at',pe.published_at,'source',coalesce(pe.source,'manual_roster')) from public.duty_roster_published_entries pe join public.duty_roster_publications p on p.id=pe.publication_id where pe.employee_id=p_employee_id and pe.roster_date=p_business_date and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date) order by pe.published_at desc limit 1),'null'::jsonb)
$$;
revoke all on function public.crew_roster_employee_day(uuid,date) from public,anon,authenticated;

create or replace function public.crew_my_roster(p_token text,p_from date default timezone('Asia/Kuala_Lumpur',now())::date,p_to date default (timezone('Asia/Kuala_Lumpur',now())::date+13))
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; d date; entries jsonb:='[]'::jsonb; item jsonb;
begin
 employee:=public.crew_session_employee(p_token); if p_to<p_from or p_to-p_from>62 then raise exception using errcode='22023',message='Schedule range must be between 1 and 63 days.'; end if;
 for d in select generate_series(p_from,p_to,interval '1 day')::date loop item:=public.crew_roster_employee_day(employee,d); if item is not null and item<>'null'::jsonb then entries:=entries||jsonb_build_array(jsonb_build_object('id',item->>'entry_id','date',item->>'date','outlet',jsonb_build_object('id',item->>'outlet_id','name',item->>'outlet_name'),'start_time',item->>'start_time','end_time',item->>'end_time','break_minutes',coalesce((item->>'break_minutes')::int,0),'entry_type',item->>'entry_type','template',jsonb_build_object('code',item->>'template_code','name',item->>'template_name'),'position',item->>'position','group',item->>'group','status','published','published_at',item->>'published_at','source',item->>'source')); end if; end loop;
 return jsonb_build_object('from',p_from,'to',p_to,'today',public.crew_roster_employee_day(employee,timezone('Asia/Kuala_Lumpur',now())::date),'entries',entries);
end $$;
revoke all on function public.crew_my_roster(text,date,date) from public,anon,authenticated;
grant execute on function public.crew_my_roster(text,date,date) to anon,authenticated;

create or replace function public.crew_performance_roster_attendance_evidence(p_employee_id uuid,p_period date)
returns jsonb language sql stable security definer set search_path=public as $$
 with days as(select generate_series(date_trunc('month',p_period)::date,(date_trunc('month',p_period)+interval '1 month'-interval '1 day')::date,interval '1 day')::date d), roster as(select d.d,public.crew_roster_employee_day(p_employee_id,d.d) schedule from days d), attendance as(select timezone('Asia/Kuala_Lumpur',a.clock_in_at)::date d,count(*) records,count(*) filter(where a.status='completed') completed from public.crew_attendance_records a where a.employee_id=p_employee_id and a.clock_in_at>=date_trunc('month',p_period) and a.clock_in_at<date_trunc('month',p_period)+interval '1 month' group by 1)
 select jsonb_build_object('scheduled_working_days',count(*) filter(where schedule->>'entry_type'='working'),'approved_leave_days',count(*) filter(where schedule->>'source'='approved_leave'),'non_working_roster_days',count(*) filter(where schedule is not null and schedule->>'entry_type'<>'working'),'completed_scheduled_days',count(*) filter(where schedule->>'entry_type'='working' and coalesce(attendance.completed,0)>0),'missing_after_day_end',count(*) filter(where schedule->>'entry_type'='working' and schedule->>'source'<>'approved_leave' and roster.d<timezone('Asia/Kuala_Lumpur',now())::date and coalesce(attendance.records,0)=0),'calculation_version','roster-attendance-evidence-v2') from roster left join attendance using(d)
$$;
revoke all on function public.crew_performance_roster_attendance_evidence(uuid,date) from public,anon,authenticated;
