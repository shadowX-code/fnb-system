-- FeedX Crew Availability + Shift Swap v1.
-- Availability is planning evidence. Published roster revisions remain the
-- sole official schedule and swap approval creates a new immutable revision.

insert into public.permissions(code,module,description) values
('crew_availability.view','Crew Availability','View Crew availability planning evidence'),
('crew_availability.manage','Crew Availability','Manage Crew availability'),
('crew_shift_requests.view','Crew Shift Requests','View shift requests'),
('crew_shift_requests.review','Crew Shift Requests','Review and approve shift requests')
on conflict(code) do update set module=excluded.module,description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where lower(r.name) in ('owner','admin') and p.code in ('crew_availability.view','crew_availability.manage','crew_shift_requests.view','crew_shift_requests.review')
on conflict do nothing;

create table public.crew_availability_windows(
 id uuid primary key default extensions.gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade,
 day_of_week smallint not null check(day_of_week between 1 and 7), availability_type text not null check(availability_type in('available','unavailable','preferred')),
 start_time time, end_time time, sort_order integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((availability_type='unavailable' and start_time is null and end_time is null) or (availability_type<>'unavailable' and (start_time is null and end_time is null or start_time<end_time)))
);
create unique index crew_availability_window_unique on public.crew_availability_windows(employee_id,day_of_week,sort_order);
create table public.crew_availability_exceptions(
 id uuid primary key default extensions.gen_random_uuid(), employee_id uuid not null references public.employees(id) on delete cascade,
 exception_date date not null, availability_type text not null check(availability_type in('available','unavailable','preferred')),
 windows jsonb not null default '[]'::jsonb, reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(employee_id,exception_date)
);
create table public.crew_shift_requests(
 id uuid primary key default extensions.gen_random_uuid(), requester_employee_id uuid not null references public.employees(id) on delete restrict,
 original_entry_id uuid not null references public.duty_roster_published_entries(id) on delete restrict,
 original_publication_id uuid not null references public.duty_roster_publications(id) on delete restrict,
 outlet_id uuid not null references public.outlets(id) on delete restrict, roster_date date not null, start_time time not null, end_time time not null,
 position_snapshot text, coverage_mode text not null check(coverage_mode in('specific','open')),
 requested_replacement_id uuid references public.employees(id) on delete restrict, accepted_replacement_id uuid references public.employees(id) on delete restrict,
 reason_code text not null check(reason_code in('personal','transport','medical','other')), reason text,
 status text not null check(status in('pending_crew','pending_manager','approved','rejected','cancelled','expired')),
 availability_conflict boolean not null default false, availability_override_reason text, rejection_reason text,
 submitted_at timestamptz not null default now(), responded_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
 approved_publication_id uuid references public.duty_roster_publications(id) on delete set null, cancelled_at timestamptz, expires_at timestamptz not null
);
create unique index crew_shift_request_open_entry on public.crew_shift_requests(original_entry_id) where status in('pending_crew','pending_manager','approved');
create index crew_shift_request_outlet_date on public.crew_shift_requests(outlet_id,roster_date,status);
create table public.crew_shift_request_audit(
 id bigint generated always as identity primary key, request_id uuid not null references public.crew_shift_requests(id) on delete restrict,
 action text not null, actor_type text not null check(actor_type in('crew','admin','system')), actor_employee_id uuid references public.employees(id) on delete set null,
 actor_user_id uuid references auth.users(id) on delete set null, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.duty_roster_publications add column if not exists source text not null default 'manager_publish';
alter table public.duty_roster_publications add column if not exists shift_request_id uuid references public.crew_shift_requests(id) on delete set null;
alter table public.duty_rosters add column if not exists availability_conflict boolean not null default false;
alter table public.duty_rosters add column if not exists availability_override_reason text;
alter table public.duty_roster_published_entries add column if not exists shift_request_id uuid references public.crew_shift_requests(id) on delete set null;
alter table public.duty_roster_published_entries add column if not exists availability_conflict boolean not null default false;
alter table public.duty_roster_published_entries add column if not exists availability_override_reason text;

alter table public.crew_availability_windows enable row level security;
alter table public.crew_availability_exceptions enable row level security;
alter table public.crew_shift_requests enable row level security;
alter table public.crew_shift_request_audit enable row level security;
revoke all on public.crew_availability_windows,public.crew_availability_exceptions,public.crew_shift_requests,public.crew_shift_request_audit from public,anon,authenticated;

create or replace function public.crew_employee_availability(p_employee_id uuid,p_date date,p_start time,p_end time)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.crew_availability_exceptions%rowtype; matched boolean; preferred boolean; summary text;
begin
 select * into e from public.crew_availability_exceptions where employee_id=p_employee_id and exception_date=p_date;
 if found then
  if e.availability_type='unavailable' then return jsonb_build_object('compatible',false,'type','unavailable','source','exception','summary',coalesce(e.reason,'Unavailable')); end if;
  select jsonb_array_length(e.windows)=0 or exists(select 1 from jsonb_array_elements(e.windows) w where (w->>'start_time')::time<=p_start and (w->>'end_time')::time>=p_end) into matched;
  return jsonb_build_object('compatible',matched,'type',e.availability_type,'source','exception','summary',coalesce(e.reason,case when matched then 'Available' else 'Outside temporary availability' end));
 end if;
 if not exists(select 1 from public.crew_availability_windows where employee_id=p_employee_id and day_of_week=extract(isodow from p_date)) then return jsonb_build_object('compatible',true,'type','not_set','source','weekly','summary','Availability not set'); end if;
 if exists(select 1 from public.crew_availability_windows where employee_id=p_employee_id and day_of_week=extract(isodow from p_date) and availability_type='unavailable') then return jsonb_build_object('compatible',false,'type','unavailable','source','weekly','summary','Unavailable'); end if;
 select exists(select 1 from public.crew_availability_windows w where w.employee_id=p_employee_id and w.day_of_week=extract(isodow from p_date) and (w.start_time is null or (w.start_time<=p_start and w.end_time>=p_end))),
        exists(select 1 from public.crew_availability_windows w where w.employee_id=p_employee_id and w.day_of_week=extract(isodow from p_date) and w.availability_type='preferred' and (w.start_time is null or (w.start_time<=p_start and w.end_time>=p_end))) into matched,preferred;
 select string_agg(case when start_time is null then 'All day' else to_char(start_time,'HH24:MI')||'–'||to_char(end_time,'HH24:MI') end,', ' order by sort_order) into summary from public.crew_availability_windows where employee_id=p_employee_id and day_of_week=extract(isodow from p_date);
 return jsonb_build_object('compatible',matched,'type',case when preferred then 'preferred' else 'available' end,'source','weekly','summary',coalesce(summary,'Availability not set'));
end $$;
revoke all on function public.crew_employee_availability(uuid,date,time,time) from public,anon,authenticated;

create or replace function public.crew_roster_availability_check(p_outlet_id uuid,p_employee_id uuid,p_date date,p_start time,p_end time)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare availability jsonb; approved_leave boolean; pending_leave boolean; employee_outlet uuid;
begin
 if auth.uid() is null or not (public.current_user_has_permission('crew_roster.view') or public.current_user_has_permission('crew_roster.manage')) or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Roster availability is unavailable for this outlet.'; end if;
 employee_outlet:=public.crew_resolve_employee_outlet(p_employee_id);
 if employee_outlet is distinct from p_outlet_id then raise exception using errcode='42501',message='Employee is outside this outlet scope.'; end if;
 availability:=public.crew_employee_availability(p_employee_id,p_date,p_start,p_end);
 select exists(select 1 from public.crew_approved_leaves l where l.employee_id=p_employee_id and p_date between l.start_date and l.end_date),
        exists(select 1 from public.crew_leave_requests l where l.employee_id=p_employee_id and l.status='pending' and p_date between l.start_date and l.end_date)
 into approved_leave,pending_leave;
 return jsonb_build_object('availability',availability,'approved_leave',approved_leave,'pending_leave',pending_leave,'hard_block',approved_leave);
end $$;
revoke all on function public.crew_roster_availability_check(uuid,uuid,date,time,time) from public,anon,authenticated;
grant execute on function public.crew_roster_availability_check(uuid,uuid,date,time,time) to authenticated;

create or replace function public.crew_roster_capture_availability_conflict()
returns trigger language plpgsql security definer set search_path=public as $$
declare availability jsonb;
begin
 if new.start_time is null or new.end_time is null then new.availability_conflict:=false; return new; end if;
 availability:=public.crew_employee_availability(new.employee_id,new.roster_date,new.start_time,new.end_time);
 new.availability_conflict:=not coalesce((availability->>'compatible')::boolean,true);
 if not new.availability_conflict then new.availability_override_reason:=null; end if;
 return new;
end $$;
revoke all on function public.crew_roster_capture_availability_conflict() from public,anon,authenticated;
create trigger crew_roster_capture_availability_conflict before insert or update of employee_id,roster_date,start_time,end_time on public.duty_rosters for each row execute function public.crew_roster_capture_availability_conflict();
create trigger crew_published_roster_capture_availability_conflict before insert on public.duty_roster_published_entries for each row execute function public.crew_roster_capture_availability_conflict();

create or replace function public.crew_shift_candidate_eligible(p_employee_id uuid,p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare pe public.duty_roster_published_entries%rowtype; leave_conflict boolean; roster_conflict boolean; same_position boolean; availability jsonb;
begin
 select * into pe from public.duty_roster_published_entries where id=p_entry_id;
 if pe.id is null then return jsonb_build_object('eligible',false,'reason','Shift unavailable'); end if;
 same_position:=exists(select 1 from public.employees e where e.id=p_employee_id and e.is_active and coalesce(e.employment_status,'active')='active' and lower(coalesce(e.position,''))=lower(coalesce(pe.position_snapshot,'')) and public.crew_resolve_employee_outlet(e.id)=pe.outlet_id);
 select exists(select 1 from public.crew_approved_leaves a where a.employee_id=p_employee_id and pe.roster_date between a.start_date and a.end_date) into leave_conflict;
 select exists(select 1 from public.duty_roster_published_entries x join public.duty_roster_publications p on p.id=x.publication_id where x.employee_id=p_employee_id and x.roster_date=pe.roster_date and p.revision=(select max(p2.revision) from public.duty_roster_publications p2 where p2.outlet_id=p.outlet_id and p2.week_start_date=p.week_start_date)) into roster_conflict;
 availability:=public.crew_employee_availability(p_employee_id,pe.roster_date,pe.start_time,pe.end_time);
 return jsonb_build_object('eligible',same_position and not leave_conflict and not roster_conflict and coalesce((availability->>'compatible')::boolean,true),'same_position',same_position,'leave_conflict',leave_conflict,'roster_conflict',roster_conflict,'availability',availability);
end $$;
revoke all on function public.crew_shift_candidate_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_availability_save(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; item jsonb; win jsonb; idx int; d int; typ text; s time; e time;
begin
 employee:=public.crew_session_employee(p_token);
 if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'weekly')<>'array' or jsonb_typeof(p_payload->'exceptions')<>'array' then raise exception using errcode='22023',message='Availability payload is invalid.'; end if;
 delete from public.crew_availability_windows where employee_id=employee; delete from public.crew_availability_exceptions where employee_id=employee;
 for item in select value from jsonb_array_elements(p_payload->'weekly') loop
  d:=(item->>'day_of_week')::int; typ:=item->>'type'; if d not between 1 and 7 or typ not in('available','unavailable','preferred') then raise exception using errcode='22023',message='Weekly availability is invalid.'; end if;
  if typ='unavailable' then insert into public.crew_availability_windows(employee_id,day_of_week,availability_type,start_time,end_time,sort_order) values(employee,d,typ,null,null,1);
  else idx:=0; if jsonb_array_length(coalesce(item->'windows','[]'::jsonb))=0 then insert into public.crew_availability_windows(employee_id,day_of_week,availability_type,start_time,end_time,sort_order) values(employee,d,typ,null,null,1); else
   for win in select value from jsonb_array_elements(item->'windows') loop idx:=idx+1; s:=(win->>'start_time')::time; e:=(win->>'end_time')::time; if s>=e then raise exception using errcode='22023',message='Availability time window is invalid.'; end if; insert into public.crew_availability_windows(employee_id,day_of_week,availability_type,start_time,end_time,sort_order) values(employee,d,typ,s,e,idx); end loop; end if; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_payload->'exceptions') loop
  typ:=item->>'type'; if typ not in('available','unavailable','preferred') or nullif(item->>'date','') is null then raise exception using errcode='22023',message='Temporary availability exception is invalid.'; end if;
  insert into public.crew_availability_exceptions(employee_id,exception_date,availability_type,windows,reason) values(employee,(item->>'date')::date,typ,coalesce(item->'windows','[]'::jsonb),nullif(left(btrim(coalesce(item->>'reason','')),280),''));
 end loop;
 return public.crew_availability_mobile(p_token);
end $$;

create or replace function public.crew_availability_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; weekly jsonb; exceptions jsonb;
begin
 employee:=public.crew_session_employee(p_token);
 select coalesce(jsonb_agg(x order by (x->>'day_of_week')::int),'[]'::jsonb) into weekly from (select jsonb_build_object('day_of_week',day_of_week,'type',max(availability_type),'windows',jsonb_agg(jsonb_build_object('id',id,'start_time',start_time,'end_time',end_time,'sort_order',sort_order) order by sort_order) filter(where start_time is not null)) x from public.crew_availability_windows where employee_id=employee group by day_of_week) q;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',exception_date,'type',availability_type,'windows',windows,'reason',reason) order by exception_date),'[]'::jsonb) into exceptions from public.crew_availability_exceptions where employee_id=employee and exception_date>=timezone('Asia/Kuala_Lumpur',now())::date;
 return jsonb_build_object('weekly',weekly,'exceptions',exceptions);
end $$;

create or replace function public.crew_shift_candidates(p_token text,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; pe public.duty_roster_published_entries%rowtype; candidates jsonb;
begin
 employee:=public.crew_session_employee(p_token); select * into pe from public.duty_roster_published_entries where id=p_entry_id;
 if pe.id is null or pe.employee_id<>employee or pe.entry_type<>'working' or pe.roster_date<=timezone('Asia/Kuala_Lumpur',now())::date then raise exception using errcode='42501',message='This shift cannot be swapped.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position,'eligibility',public.crew_shift_candidate_eligible(e.id,pe.id)) order by coalesce(e.nickname,e.full_name)),'[]'::jsonb) into candidates from public.employees e where e.id<>employee and e.is_active and coalesce(e.employment_status,'active')='active' and public.crew_resolve_employee_outlet(e.id)=pe.outlet_id and lower(coalesce(e.position,''))=lower(coalesce(pe.position_snapshot,''));
 return jsonb_build_object('shift',jsonb_build_object('id',pe.id,'date',pe.roster_date,'start_time',pe.start_time,'end_time',pe.end_time,'outlet_id',pe.outlet_id,'position',pe.position_snapshot),'candidates',candidates);
end $$;

create or replace function public.crew_shift_request_submit(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; pe public.duty_roster_published_entries%rowtype; mode text; replacement uuid; eligibility jsonb; row public.crew_shift_requests%rowtype;
begin
 employee:=public.crew_session_employee(p_token); if jsonb_typeof(p_payload)<>'object' or p_payload ?| array['requester_employee_id','status','approved','reviewed_by'] then raise exception using errcode='22023',message='Shift request payload is invalid.'; end if;
 select e.* into pe from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.id=(p_payload->>'entry_id')::uuid and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
 if pe.id is null or pe.employee_id<>employee or pe.entry_type<>'working' or pe.roster_date<=timezone('Asia/Kuala_Lumpur',now())::date then raise exception using errcode='42501',message='Only your future published working shift can be swapped.'; end if;
 mode:=p_payload->>'coverage_mode'; replacement:=nullif(p_payload->>'replacement_employee_id','')::uuid; if mode not in('specific','open') or (mode='specific' and replacement is null) then raise exception using errcode='22023',message='Choose a valid coverage mode.'; end if;
 if mode='specific' then eligibility:=public.crew_shift_candidate_eligible(replacement,pe.id); if not coalesce((eligibility->>'eligible')::boolean,false) then raise exception using errcode='22023',message='The selected Crew member is not eligible for this shift.'; end if; end if;
 insert into public.crew_shift_requests(requester_employee_id,original_entry_id,original_publication_id,outlet_id,roster_date,start_time,end_time,position_snapshot,coverage_mode,requested_replacement_id,reason_code,reason,status,expires_at)
 values(employee,pe.id,pe.publication_id,pe.outlet_id,pe.roster_date,pe.start_time,pe.end_time,pe.position_snapshot,mode,replacement,p_payload->>'reason_code',nullif(left(btrim(coalesce(p_payload->>'reason','')),500),''),case when mode='specific' then 'pending_crew' else 'pending_crew' end,least(pe.roster_date::timestamptz,now()+interval '14 days')) returning * into row;
 insert into public.crew_shift_request_audit(request_id,action,actor_type,actor_employee_id) values(row.id,'submitted','crew',employee); return jsonb_build_object('id',row.id,'status',row.status);
end $$;

create or replace function public.crew_shift_request_respond(p_token text,p_request_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; row public.crew_shift_requests%rowtype; eligibility jsonb;
begin
 employee:=public.crew_session_employee(p_token); select * into row from public.crew_shift_requests where id=p_request_id for update;
 if row.id is not null and row.status in('pending_crew','pending_manager') and row.expires_at<=now() then update public.crew_shift_requests set status='expired' where id=row.id returning * into row; end if;
 if row.id is null or row.status<>'pending_crew' or (row.coverage_mode='specific' and row.requested_replacement_id<>employee) or (row.coverage_mode='open' and row.requester_employee_id=employee) then raise exception using errcode='42501',message='This shift request is unavailable.'; end if;
 if p_decision not in('accept','decline') then raise exception using errcode='22023',message='Response is invalid.'; end if;
 if p_decision='accept' then eligibility:=public.crew_shift_candidate_eligible(employee,row.original_entry_id); if coalesce((eligibility->>'leave_conflict')::boolean,false) or coalesce((eligibility->>'roster_conflict')::boolean,false) or not coalesce((eligibility->>'same_position')::boolean,false) then raise exception using errcode='22023',message='You are no longer eligible for this shift.'; end if; update public.crew_shift_requests set accepted_replacement_id=employee,status='pending_manager',availability_conflict=not coalesce((eligibility#>>'{availability,compatible}')::boolean,true),responded_at=now() where id=row.id returning * into row; else if row.coverage_mode='specific' then update public.crew_shift_requests set status='rejected',rejection_reason='The selected Crew member declined.',responded_at=now() where id=row.id returning * into row; else raise exception using errcode='22023',message='Open cover opportunities can only be accepted.'; end if; end if;
 insert into public.crew_shift_request_audit(request_id,action,actor_type,actor_employee_id) values(row.id,p_decision,'crew',employee); return jsonb_build_object('id',row.id,'status',row.status);
end $$;

create or replace function public.crew_shift_request_cancel(p_token text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; row public.crew_shift_requests%rowtype;
begin employee:=public.crew_session_employee(p_token); update public.crew_shift_requests set status='cancelled',cancelled_at=now() where id=p_request_id and requester_employee_id=employee and status in('pending_crew','pending_manager') returning * into row; if row.id is null then raise exception using errcode='42501',message='Only your pending shift request can be cancelled.'; end if; insert into public.crew_shift_request_audit(request_id,action,actor_type,actor_employee_id) values(row.id,'cancelled','crew',employee); return jsonb_build_object('id',row.id,'status',row.status); end $$;

create or replace function public.crew_shift_requests_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; own_rows jsonb; incoming jsonb; open_rows jsonb;
begin employee:=public.crew_session_employee(p_token);
 update public.crew_shift_requests set status='expired' where status in('pending_crew','pending_manager') and expires_at<=now();
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.roster_date,'start_time',r.start_time,'end_time',r.end_time,'outlet_id',r.outlet_id,'position',r.position_snapshot,'coverage_mode',r.coverage_mode,'replacement',case when r.accepted_replacement_id is not null then (select jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name)) from public.employees e where e.id=r.accepted_replacement_id) else null end,'reason_code',r.reason_code,'status',r.status,'submitted_at',r.submitted_at,'rejection_reason',r.rejection_reason,'can_cancel',r.status in('pending_crew','pending_manager')) order by r.submitted_at desc),'[]'::jsonb) into own_rows from public.crew_shift_requests r where r.requester_employee_id=employee or r.accepted_replacement_id=employee;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'requester',(select coalesce(e.nickname,e.full_name) from public.employees e where e.id=r.requester_employee_id),'date',r.roster_date,'start_time',r.start_time,'end_time',r.end_time,'position',r.position_snapshot,'reason_code',r.reason_code,'status',r.status) order by r.submitted_at),'[]'::jsonb) into incoming from public.crew_shift_requests r where r.status='pending_crew' and r.requested_replacement_id=employee;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'requester',(select coalesce(e.nickname,e.full_name) from public.employees e where e.id=r.requester_employee_id),'date',r.roster_date,'start_time',r.start_time,'end_time',r.end_time,'position',r.position_snapshot,'eligibility',public.crew_shift_candidate_eligible(employee,r.original_entry_id)) order by r.roster_date),'[]'::jsonb) into open_rows from public.crew_shift_requests r where r.status='pending_crew' and r.coverage_mode='open' and r.requester_employee_id<>employee and public.crew_resolve_employee_outlet(employee)=r.outlet_id;
 return jsonb_build_object('requests',own_rows,'incoming',incoming,'available_shifts',open_rows); end $$;

create or replace function public.crew_shift_requests_admin(p_outlet_id uuid,p_from date default null,p_to date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rows jsonb; begin if auth.uid() is null or not public.current_user_has_permission('crew_shift_requests.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Shift requests are unavailable for this outlet.'; end if;
 update public.crew_shift_requests set status='expired' where outlet_id=p_outlet_id and status in('pending_crew','pending_manager') and expires_at<=now();
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'requester',jsonb_build_object('id',e.id,'name',coalesce(e.nickname,e.full_name),'position',e.position),'replacement',case when re.id is null then null else jsonb_build_object('id',re.id,'name',coalesce(re.nickname,re.full_name),'position',re.position) end,'date',r.roster_date,'start_time',r.start_time,'end_time',r.end_time,'position',r.position_snapshot,'coverage_mode',r.coverage_mode,'reason_code',r.reason_code,'reason',r.reason,'status',r.status,'availability_conflict',r.availability_conflict,'eligibility',case when r.accepted_replacement_id is null then null else public.crew_shift_candidate_eligible(r.accepted_replacement_id,r.original_entry_id) end,'submitted_at',r.submitted_at,'rejection_reason',r.rejection_reason) order by case when r.status='pending_manager' then 1 else 2 end,r.submitted_at desc),'[]'::jsonb) into rows from public.crew_shift_requests r join public.employees e on e.id=r.requester_employee_id left join public.employees re on re.id=r.accepted_replacement_id where r.outlet_id=p_outlet_id and (p_from is null or r.roster_date>=p_from) and (p_to is null or r.roster_date<=p_to);
 return jsonb_build_object('requests',rows); end $$;

create or replace function public.crew_shift_request_review(p_request_id uuid,p_decision text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crew_shift_requests%rowtype; eligibility jsonb; old_pub public.duty_roster_publications%rowtype; new_pub uuid; rev int; now_at timestamptz:=now();
begin if auth.uid() is null or not public.current_user_has_permission('crew_shift_requests.review') then raise exception using errcode='42501',message='Shift request review permission is required.'; end if; select * into row from public.crew_shift_requests where id=p_request_id for update; if row.id is null or not public.current_user_can_access_outlet(row.outlet_id) then raise exception using errcode='42501',message='Shift request is outside your outlet scope.'; end if; if row.status<>'pending_manager' then raise exception using errcode='22023',message='Only a manager-pending request can be reviewed.'; end if;
 if p_decision='reject' then if length(btrim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='A rejection reason is required.'; end if; update public.crew_shift_requests set status='rejected',rejection_reason=left(btrim(p_reason),500),reviewed_by=auth.uid(),reviewed_at=now_at where id=row.id returning * into row;
 elsif p_decision='approve' then eligibility:=public.crew_shift_candidate_eligible(row.accepted_replacement_id,row.original_entry_id); if coalesce((eligibility->>'leave_conflict')::boolean,false) or coalesce((eligibility->>'roster_conflict')::boolean,false) or not coalesce((eligibility->>'same_position')::boolean,false) then raise exception using errcode='22023',message='Replacement eligibility changed; approval is blocked.'; end if; if not coalesce((eligibility#>>'{availability,compatible}')::boolean,true) and length(btrim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='An availability override reason is required.'; end if;
  select p.* into old_pub from public.duty_roster_publications p where p.id=(select e.publication_id from public.duty_roster_published_entries e where e.id=row.original_entry_id) and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date) for update; if old_pub.id is null then raise exception using errcode='22023',message='The original shift is no longer in the latest published roster.'; end if;
  select coalesce(max(revision),0)+1 into rev from public.duty_roster_publications where outlet_id=old_pub.outlet_id and week_start_date=old_pub.week_start_date; insert into public.duty_roster_publications(outlet_id,week_start_date,week_end_date,revision,source_period_id,published_by,published_at,source,shift_request_id) values(old_pub.outlet_id,old_pub.week_start_date,old_pub.week_end_date,rev,old_pub.source_period_id,auth.uid(),now_at,'shift_swap',row.id) returning id into new_pub;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,break_minutes,entry_type,template_code,template_name,position_snapshot,group_snapshot,outlet_name_snapshot,shift_snapshot,published_at,source,approved_leave_id,shift_request_id)
  select new_pub,e.outlet_id,case when e.id=row.original_entry_id then row.accepted_replacement_id else e.employee_id end,e.roster_date,e.start_time,e.end_time,e.break_minutes,e.entry_type,e.template_code,e.template_name,e.position_snapshot,e.group_snapshot,e.outlet_name_snapshot,e.shift_snapshot,now_at,coalesce(e.source,'manual_roster'),e.approved_leave_id,case when e.id=row.original_entry_id then row.id else e.shift_request_id end from public.duty_roster_published_entries e where e.publication_id=old_pub.id;
  update public.crew_shift_requests set status='approved',availability_override_reason=nullif(left(btrim(coalesce(p_reason,'')),500),''),reviewed_by=auth.uid(),reviewed_at=now_at,approved_publication_id=new_pub where id=row.id returning * into row;
 else raise exception using errcode='22023',message='Review decision is invalid.'; end if;
 insert into public.crew_shift_request_audit(request_id,action,actor_type,actor_user_id,detail) values(row.id,p_decision,'admin',auth.uid(),jsonb_build_object('publication_id',new_pub,'reason',p_reason)); return jsonb_build_object('id',row.id,'status',row.status,'publication_id',new_pub); end $$;

do $$ declare fn text; begin foreach fn in array array['crew_availability_save(text,jsonb)','crew_availability_mobile(text)','crew_shift_candidates(text,uuid)','crew_shift_request_submit(text,jsonb)','crew_shift_request_respond(text,uuid,text)','crew_shift_request_cancel(text,uuid)','crew_shift_requests_mobile(text)','crew_shift_requests_admin(uuid,date,date)','crew_shift_request_review(uuid,text,text)'] loop execute 'revoke all on function public.'||fn||' from public,anon,authenticated'; end loop; end $$;
grant execute on function public.crew_availability_save(text,jsonb),public.crew_availability_mobile(text),public.crew_shift_candidates(text,uuid),public.crew_shift_request_submit(text,jsonb),public.crew_shift_request_respond(text,uuid,text),public.crew_shift_request_cancel(text,uuid),public.crew_shift_requests_mobile(text) to anon,authenticated;
grant execute on function public.crew_shift_requests_admin(uuid,date,date),public.crew_shift_request_review(uuid,text,text) to authenticated;
