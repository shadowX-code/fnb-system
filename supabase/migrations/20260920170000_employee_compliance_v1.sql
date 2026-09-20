-- People-owned Employee Compliance V1.
-- Requirements are configured records; submissions and reviews are immutable evidence.

insert into public.permissions(code, module, description) values
  ('employee_compliance.view', 'People', 'View employee compliance records and private evidence'),
  ('employee_compliance.review', 'People', 'Verify or reject employee compliance submissions')
on conflict (code) do update set module=excluded.module, description=excluded.description;

insert into public.role_permissions(role_id, permission_id)
select distinct rp.role_id, permission.id
from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
join public.permissions permission on permission.code='employee_compliance.view'
where existing.code in ('employees.view','employees.edit','employees.manage')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select distinct rp.role_id, permission.id
from public.role_permissions rp
join public.permissions existing on existing.id=rp.permission_id
join public.permissions permission on permission.code='employee_compliance.review'
where existing.code in ('employees.edit','employees.manage')
on conflict do nothing;

create table public.employee_compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  requires_expiry boolean not null default false,
  expiring_soon_days integer not null default 30 check (expiring_soon_days between 1 and 365),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp()
);

create table public.employee_compliance_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_hash text not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  requirement_id uuid not null references public.employee_compliance_requirements(id) on delete restrict,
  submission_outlet_id uuid references public.outlets(id) on delete restrict,
  expiry_date date,
  supersedes_submission_id uuid references public.employee_compliance_submissions(id) on delete restrict,
  evidence_bucket text not null,
  evidence_path text not null unique,
  evidence_mime_type text not null,
  evidence_size_bytes bigint not null check (evidence_size_bytes > 0),
  submitted_at timestamptz not null default clock_timestamp(),
  constraint employee_compliance_expiry_shape check (expiry_date is null or expiry_date >= date '2000-01-01')
);

create table public.employee_compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.employee_compliance_submissions(id) on delete restrict,
  decision text not null check (decision in ('verified','rejected')),
  rejection_reason text,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  constraint employee_compliance_rejection_reason check (
    (decision='rejected' and nullif(btrim(rejection_reason),'') is not null)
    or (decision='verified' and rejection_reason is null)
  )
);

create index employee_compliance_submissions_employee_requirement_idx
  on public.employee_compliance_submissions(employee_id, requirement_id, submitted_at desc);
create index employee_compliance_reviews_submission_idx on public.employee_compliance_reviews(submission_id);

insert into public.employee_compliance_requirements(code,name,requires_expiry,expiring_soon_days,sort_order) values
  ('food_handler_certificate','Food Handler Certificate',false,30,10),
  ('typhoid_injection','Typhoid Injection',true,30,20)
on conflict (code) do update set
  name=excluded.name, requires_expiry=excluded.requires_expiry,
  expiring_soon_days=excluded.expiring_soon_days, sort_order=excluded.sort_order, is_active=true;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('employee-compliance-evidence','employee-compliance-evidence',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.employee_compliance_requirements enable row level security;
alter table public.employee_compliance_submissions enable row level security;
alter table public.employee_compliance_reviews enable row level security;
revoke all on public.employee_compliance_requirements, public.employee_compliance_submissions, public.employee_compliance_reviews from public, anon, authenticated;

create or replace function public.employee_compliance_current(
  p_employee_id uuid,
  p_requirement_id uuid,
  p_business_date date default ((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date)
) returns jsonb language sql stable security definer set search_path=public as $$
with requirement as (
  select * from public.employee_compliance_requirements where id=p_requirement_id
), verified as (
  select s.*, rv.reviewed_at, rv.reviewed_by
  from public.employee_compliance_submissions s
  join public.employee_compliance_reviews rv on rv.submission_id=s.id and rv.decision='verified'
  where s.employee_id=p_employee_id and s.requirement_id=p_requirement_id
  order by rv.reviewed_at desc, s.submitted_at desc limit 1
), pending as (
  select s.* from public.employee_compliance_submissions s
  left join public.employee_compliance_reviews rv on rv.submission_id=s.id
  where s.employee_id=p_employee_id and s.requirement_id=p_requirement_id and rv.id is null
  order by s.submitted_at desc limit 1
), rejected as (
  select s.*, rv.rejection_reason, rv.reviewed_at, rv.reviewed_by
  from public.employee_compliance_submissions s
  join public.employee_compliance_reviews rv on rv.submission_id=s.id and rv.decision='rejected'
  where s.employee_id=p_employee_id and s.requirement_id=p_requirement_id
  order by rv.reviewed_at desc, s.submitted_at desc limit 1
), state as (
  select r.*,
    v.id verified_id, v.expiry_date verified_expiry, v.submitted_at verified_submitted_at, v.reviewed_at verified_reviewed_at,
    p.id pending_id, p.expiry_date pending_expiry, p.submitted_at pending_submitted_at,
    x.id rejected_id, x.expiry_date rejected_expiry, x.submitted_at rejected_submitted_at,
    x.rejection_reason, x.reviewed_at rejected_reviewed_at
  from requirement r left join verified v on true left join pending p on true left join rejected x on true
), derived as (
  select *, case
    when verified_id is null then 'missing'
    when requires_expiry and verified_expiry < p_business_date then 'expired'
    when requires_expiry and verified_expiry <= p_business_date + expiring_soon_days then 'expiring_soon'
    else 'verified'
  end effective_status
  from state
)
select coalesce(jsonb_build_object(
  'requirement_id',id,'requirement_code',code,'requirement_name',name,'requires_expiry',requires_expiry,
  'status',case
    when pending_id is not null and (verified_submitted_at is null or pending_submitted_at > verified_submitted_at) then 'pending_verification'
    when rejected_id is not null and (verified_submitted_at is null or rejected_submitted_at > verified_submitted_at) then 'rejected'
    else effective_status end,
  'effective_status',effective_status,
  'effective_submission_id',verified_id,'effective_expiry_date',verified_expiry,'verified_at',verified_reviewed_at,
  'pending_submission_id',pending_id,'pending_expiry_date',pending_expiry,'pending_submitted_at',pending_submitted_at,
  'rejected_submission_id',rejected_id,'rejected_expiry_date',rejected_expiry,
  'rejection_reason',rejection_reason,'rejected_at',rejected_reviewed_at,
  'replacement_pending',pending_id is not null and verified_id is not null and pending_submitted_at > verified_submitted_at
),'{}'::jsonb) from derived;
$$;

revoke all on function public.employee_compliance_current(uuid,uuid,date) from public, anon, authenticated;

create or replace function public.crew_employee_compliance()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  raise exception using errcode='42501',message='Crew session is required.';
end; $$;

create or replace function public.crew_employee_compliance(p_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid; v_rows jsonb;
begin
  v_employee:=public.crew_session_employee(p_token);
  select coalesce(jsonb_agg(public.employee_compliance_current(v_employee,r.id) order by r.sort_order),'[]'::jsonb)
    into v_rows from public.employee_compliance_requirements r where r.is_active;
  return jsonb_build_object('requirements',v_rows);
end; $$;

create or replace function public.crew_employee_compliance_submit_context(p_token text,p_requirement_code text,p_expiry_date date,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare v_employee uuid; v_outlet uuid; v_requirement public.employee_compliance_requirements%rowtype; v_prior uuid; v_path text;
begin
  v_employee:=public.crew_session_employee(p_token);
  v_outlet:=public.crew_resolve_employee_outlet(v_employee);
  select * into v_requirement from public.employee_compliance_requirements where code=p_requirement_code and is_active;
  if v_requirement.id is null then raise exception using errcode='22023',message='Compliance requirement is unavailable.'; end if;
  if v_requirement.requires_expiry and p_expiry_date is null then raise exception using errcode='22023',message='Expiry date is required.'; end if;
  if not v_requirement.requires_expiry and p_expiry_date is not null then raise exception using errcode='22023',message='Expiry date is not accepted for this requirement.'; end if;
  select (public.employee_compliance_current(v_employee,v_requirement.id)->>'effective_submission_id')::uuid into v_prior;
  v_path:=format('%s/%s/%s.webp',v_employee,v_requirement.code,p_request_id);
  return jsonb_build_object('employee_id',v_employee,'outlet_id',v_outlet,'requirement_id',v_requirement.id,'bucket','employee-compliance-evidence','object_path',v_path,'supersedes_submission_id',v_prior);
end; $$;

create or replace function public.crew_employee_compliance_submit_finalize(
  p_token text,p_requirement_code text,p_expiry_date date,p_request_id uuid,
  p_evidence_path text,p_evidence_mime_type text,p_evidence_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public,storage,extensions as $$
declare v_context jsonb; v_existing public.employee_compliance_submissions%rowtype; v_hash text; v_row public.employee_compliance_submissions%rowtype;
begin
  v_context:=public.crew_employee_compliance_submit_context(p_token,p_requirement_code,p_expiry_date,p_request_id);
  if p_evidence_path<>v_context->>'object_path' or p_evidence_mime_type not in ('image/jpeg','image/png','image/webp') or p_evidence_size_bytes<=0 or p_evidence_size_bytes>10485760 then
    raise exception using errcode='22023',message='Compliance evidence is invalid.';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='employee-compliance-evidence' and name=p_evidence_path) then
    raise exception using errcode='22023',message='Compliance evidence upload is incomplete.';
  end if;
  v_hash:=encode(extensions.digest(concat_ws('|',v_context->>'employee_id',v_context->>'requirement_id',coalesce(p_expiry_date::text,''),p_evidence_path),'sha256'),'hex');
  select * into v_existing from public.employee_compliance_submissions where request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.request_hash<>v_hash then raise exception using errcode='23505',message='Submission request was already used.'; end if;
    return jsonb_build_object('submission_id',v_existing.id,'status','pending_verification');
  end if;
  insert into public.employee_compliance_submissions(request_id,request_hash,employee_id,requirement_id,submission_outlet_id,expiry_date,supersedes_submission_id,evidence_bucket,evidence_path,evidence_mime_type,evidence_size_bytes)
  values(p_request_id,v_hash,(v_context->>'employee_id')::uuid,(v_context->>'requirement_id')::uuid,(v_context->>'outlet_id')::uuid,p_expiry_date,(v_context->>'supersedes_submission_id')::uuid,'employee-compliance-evidence',p_evidence_path,p_evidence_mime_type,p_evidence_size_bytes)
  returning * into v_row;
  return jsonb_build_object('submission_id',v_row.id,'status','pending_verification');
end; $$;

create or replace function public.crew_employee_compliance_evidence_context(p_token text,p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee uuid; v_row public.employee_compliance_submissions%rowtype;
begin
  v_employee:=public.crew_session_employee(p_token);
  select * into v_row from public.employee_compliance_submissions where id=p_submission_id and employee_id=v_employee;
  if v_row.id is null then raise exception using errcode='42501',message='Evidence is unavailable.'; end if;
  return jsonb_build_object('bucket',v_row.evidence_bucket,'object_path',v_row.evidence_path);
end; $$;

create or replace function public.employee_compliance_admin_evidence_context(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_row public.employee_compliance_submissions%rowtype; v_outlet uuid;
begin
  if not public.current_user_has_permission('employee_compliance.view') then raise exception using errcode='42501',message='Compliance evidence is unavailable.'; end if;
  select * into v_row from public.employee_compliance_submissions where id=p_submission_id;
  if v_row.id is null then raise exception using errcode='22023',message='Evidence was not found.'; end if;
  v_outlet:=public.crew_resolve_employee_outlet(v_row.employee_id);
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501',message='Compliance evidence is outside your outlet scope.'; end if;
  return jsonb_build_object('bucket',v_row.evidence_bucket,'object_path',v_row.evidence_path);
end; $$;

create or replace function public.employee_compliance_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_outlet uuid; v_current jsonb; v_history jsonb;
begin
  if not public.current_user_has_permission('employee_compliance.view') then raise exception using errcode='42501',message='Missing permission to view compliance.'; end if;
  v_outlet:=public.crew_resolve_employee_outlet(p_employee_id);
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
  select coalesce(jsonb_agg(public.employee_compliance_current(p_employee_id,r.id) order by r.sort_order),'[]'::jsonb) into v_current from public.employee_compliance_requirements r where r.is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'submission_id',s.id,'requirement_id',r.id,'requirement_code',r.code,'requirement_name',r.name,'expiry_date',s.expiry_date,
    'submitted_at',s.submitted_at,'submission_outlet_id',s.submission_outlet_id,'supersedes_submission_id',s.supersedes_submission_id,
    'decision',rv.decision,'rejection_reason',rv.rejection_reason,'reviewed_at',rv.reviewed_at,'reviewed_by',rv.reviewed_by,
    'reviewer_name',reviewer.full_name
  ) order by s.submitted_at desc),'[]'::jsonb) into v_history
  from public.employee_compliance_submissions s join public.employee_compliance_requirements r on r.id=s.requirement_id
  left join public.employee_compliance_reviews rv on rv.submission_id=s.id left join public.employees reviewer on reviewer.auth_user_id=rv.reviewed_by
  where s.employee_id=p_employee_id;
  return jsonb_build_object('current',v_current,'history',v_history);
end; $$;

create or replace function public.employee_compliance_admin_page(p_outlet_id uuid,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_query text:=btrim(coalesce(p_filters->>'query','')); v_requirement text:=coalesce(p_filters->>'requirement','all'); v_status text:=coalesce(p_filters->>'status','all');
  v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end; v_total integer; v_rows jsonb; v_summary jsonb;
begin
  if not public.current_user_has_permission('employee_compliance.view') then raise exception using errcode='42501',message='Missing permission to view compliance.'; end if;
  if p_outlet_id is not null and not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Outlet is outside your scope.'; end if;
  with base as (
    select e.id employee_id,e.full_name,e.employee_code,e.position,public.crew_resolve_employee_outlet(e.id) outlet_id,o.name outlet_name,r.id requirement_id,r.code requirement_code,r.name requirement_name,r.requires_expiry,public.employee_compliance_current(e.id,r.id) state
    from public.employees e cross join public.employee_compliance_requirements r
    left join public.outlets o on o.id=public.crew_resolve_employee_outlet(e.id)
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active' and r.is_active
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id)
      and public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%')
      and (v_requirement='all' or r.code=v_requirement)
  ), filtered as (select * from base where v_status='all' or state->>'status'=v_status)
  select count(*) into v_total from filtered;
  with base as (
    select e.id employee_id,e.full_name,e.employee_code,e.position,public.crew_resolve_employee_outlet(e.id) outlet_id,o.name outlet_name,r.id requirement_id,r.code requirement_code,r.name requirement_name,r.requires_expiry,public.employee_compliance_current(e.id,r.id) state
    from public.employees e cross join public.employee_compliance_requirements r left join public.outlets o on o.id=public.crew_resolve_employee_outlet(e.id)
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active' and r.is_active
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id) and public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%') and (v_requirement='all' or r.code=v_requirement)
  ), filtered as (select * from base where v_status='all' or state->>'status'=v_status), page_rows as (
    select * from filtered order by full_name,requirement_name offset (v_page-1)*v_size limit v_size
  ) select coalesce(jsonb_agg(to_jsonb(page_rows) order by full_name,requirement_name),'[]'::jsonb) into v_rows from page_rows;
  with base as (
    select public.employee_compliance_current(e.id,r.id) state
    from public.employees e cross join public.employee_compliance_requirements r
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active' and r.is_active
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id) and public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%') and (v_requirement='all' or r.code=v_requirement)
  ) select jsonb_build_object(
    'compliant',count(*) filter(where state->>'effective_status' in ('verified','expiring_soon')),
    'needs_verification',count(*) filter(where state->>'status'='pending_verification'),
    'expiring_soon',count(*) filter(where state->>'effective_status'='expiring_soon'),
    'missing_or_expired',count(*) filter(where state->>'effective_status' in ('missing','expired'))
  ) into v_summary from base;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,'summary',v_summary);
end; $$;

create or replace function public.employee_compliance_review(p_submission_id uuid,p_decision text,p_rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_submission public.employee_compliance_submissions%rowtype; v_outlet uuid; v_review public.employee_compliance_reviews%rowtype;
begin
  if not public.current_user_has_permission('employee_compliance.review') then raise exception using errcode='42501',message='Missing permission to review compliance.'; end if;
  if p_decision not in ('verified','rejected') then raise exception using errcode='22023',message='Choose Verify or Reject.'; end if;
  if p_decision='rejected' and nullif(btrim(p_rejection_reason),'') is null then raise exception using errcode='22023',message='Rejection reason is required.'; end if;
  select * into v_submission from public.employee_compliance_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception using errcode='22023',message='Submission was not found.'; end if;
  v_outlet:=public.crew_resolve_employee_outlet(v_submission.employee_id);
  if v_outlet is not null and not public.current_user_can_access_outlet(v_outlet) then raise exception using errcode='42501',message='Submission is outside your outlet scope.'; end if;
  if exists(select 1 from public.employee_compliance_reviews where submission_id=p_submission_id) then raise exception using errcode='23505',message='Submission was already reviewed.'; end if;
  insert into public.employee_compliance_reviews(submission_id,decision,rejection_reason,reviewed_by)
  values(p_submission_id,p_decision,case when p_decision='rejected' then btrim(p_rejection_reason) end,auth.uid()) returning * into v_review;
  return jsonb_build_object('review_id',v_review.id,'submission_id',p_submission_id,'decision',p_decision,'reviewed_at',v_review.reviewed_at);
end; $$;

revoke all on function public.crew_employee_compliance() from public,anon,authenticated;
revoke all on function public.crew_employee_compliance(text) from public,anon,authenticated;
revoke all on function public.crew_employee_compliance_submit_context(text,text,date,uuid) from public,anon,authenticated;
revoke all on function public.crew_employee_compliance_submit_finalize(text,text,date,uuid,text,text,bigint) from public,anon,authenticated;
revoke all on function public.crew_employee_compliance_evidence_context(text,uuid) from public,anon,authenticated;
revoke all on function public.employee_compliance_admin_evidence_context(uuid) from public,anon,authenticated;
revoke all on function public.employee_compliance_admin_detail(uuid) from public,anon,authenticated;
revoke all on function public.employee_compliance_admin_page(uuid,jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.employee_compliance_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crew_employee_compliance(text), public.crew_employee_compliance_submit_context(text,text,date,uuid), public.crew_employee_compliance_submit_finalize(text,text,date,uuid,text,text,bigint), public.crew_employee_compliance_evidence_context(text,uuid) to anon,authenticated;
grant execute on function public.employee_compliance_admin_evidence_context(uuid), public.employee_compliance_admin_detail(uuid), public.employee_compliance_admin_page(uuid,jsonb,integer,integer), public.employee_compliance_review(uuid,text,text) to authenticated;
