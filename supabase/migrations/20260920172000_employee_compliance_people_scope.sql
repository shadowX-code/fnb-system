-- Align Employee Compliance Admin visibility with the canonical People employee scope.

create or replace function public.employee_compliance_admin_can_access_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.employees e
    where e.id=p_employee_id
      and (
        public.current_user_has_all_outlet_access()
        or public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
      )
  );
$$;

revoke all on function public.employee_compliance_admin_can_access_employee(uuid) from public,anon,authenticated;

create or replace function public.employee_compliance_admin_evidence_context(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_row public.employee_compliance_submissions%rowtype;
begin
  if not public.current_user_has_permission('employee_compliance.view') then raise exception using errcode='42501',message='Compliance evidence is unavailable.'; end if;
  select * into v_row from public.employee_compliance_submissions where id=p_submission_id;
  if v_row.id is null then raise exception using errcode='22023',message='Evidence was not found.'; end if;
  if not public.employee_compliance_admin_can_access_employee(v_row.employee_id) then raise exception using errcode='42501',message='Compliance evidence is outside your outlet scope.'; end if;
  return jsonb_build_object('bucket',v_row.evidence_bucket,'object_path',v_row.evidence_path);
end; $$;

create or replace function public.employee_compliance_admin_detail(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_current jsonb; v_history jsonb;
begin
  if not public.current_user_has_permission('employee_compliance.view') then raise exception using errcode='42501',message='Missing permission to view compliance.'; end if;
  if not public.employee_compliance_admin_can_access_employee(p_employee_id) then raise exception using errcode='42501',message='Employee is outside your outlet scope.'; end if;
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
      and public.employee_compliance_admin_can_access_employee(e.id)
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%')
      and (v_requirement='all' or r.code=v_requirement)
  ), filtered as (select * from base where v_status='all' or state->>'status'=v_status)
  select count(*) into v_total from filtered;
  with base as (
    select e.id employee_id,e.full_name,e.employee_code,e.position,public.crew_resolve_employee_outlet(e.id) outlet_id,o.name outlet_name,r.id requirement_id,r.code requirement_code,r.name requirement_name,r.requires_expiry,public.employee_compliance_current(e.id,r.id) state
    from public.employees e cross join public.employee_compliance_requirements r left join public.outlets o on o.id=public.crew_resolve_employee_outlet(e.id)
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active' and r.is_active
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id) and public.employee_compliance_admin_can_access_employee(e.id)
      and (v_query='' or concat_ws(' ',e.full_name,e.employee_code,e.position) ilike '%'||v_query||'%') and (v_requirement='all' or r.code=v_requirement)
  ), filtered as (select * from base where v_status='all' or state->>'status'=v_status), page_rows as (
    select * from filtered order by full_name,requirement_name offset (v_page-1)*v_size limit v_size
  ) select coalesce(jsonb_agg(to_jsonb(page_rows) order by full_name,requirement_name),'[]'::jsonb) into v_rows from page_rows;
  with base as (
    select public.employee_compliance_current(e.id,r.id) state
    from public.employees e cross join public.employee_compliance_requirements r
    where coalesce(e.is_active,true) and coalesce(e.employment_status,'active')='active' and r.is_active
      and (p_outlet_id is null or public.crew_resolve_employee_outlet(e.id)=p_outlet_id) and public.employee_compliance_admin_can_access_employee(e.id)
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
declare v_submission public.employee_compliance_submissions%rowtype; v_review public.employee_compliance_reviews%rowtype;
begin
  if not public.current_user_has_permission('employee_compliance.review') then raise exception using errcode='42501',message='Missing permission to review compliance.'; end if;
  if p_decision not in ('verified','rejected') then raise exception using errcode='22023',message='Choose Verify or Reject.'; end if;
  if p_decision='rejected' and nullif(btrim(p_rejection_reason),'') is null then raise exception using errcode='22023',message='Rejection reason is required.'; end if;
  select * into v_submission from public.employee_compliance_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception using errcode='22023',message='Submission was not found.'; end if;
  if not public.employee_compliance_admin_can_access_employee(v_submission.employee_id) then raise exception using errcode='42501',message='Submission is outside your outlet scope.'; end if;
  if exists(select 1 from public.employee_compliance_reviews where submission_id=p_submission_id) then raise exception using errcode='23505',message='Submission was already reviewed.'; end if;
  insert into public.employee_compliance_reviews(submission_id,decision,rejection_reason,reviewed_by)
  values(p_submission_id,p_decision,case when p_decision='rejected' then btrim(p_rejection_reason) end,auth.uid()) returning * into v_review;
  return jsonb_build_object('review_id',v_review.id,'submission_id',p_submission_id,'decision',p_decision,'reviewed_at',v_review.reviewed_at);
end; $$;
