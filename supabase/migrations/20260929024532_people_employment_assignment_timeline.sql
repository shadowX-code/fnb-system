-- People owns the complete employment assignment. A current Employee row is a
-- projection, never evidence that the same assignment existed before cutover.
create table public.employee_employment_assignment_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  effective_from date not null,
  employment_type text not null check (employment_type in ('probation','full_time','part_time','intern','contract')),
  employment_status text not null check (employment_status in ('active','resigned','terminated')),
  position text,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  workplace text,
  employment_end_date date,
  source_kind text not null check (source_kind in ('cutover_current','new_employee','admin_change')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  evidence_reference text,
  corrects_revision_id uuid references public.employee_employment_assignment_revisions(id) on delete restrict,
  supersedes_revision_id uuid unique references public.employee_employment_assignment_revisions(id) on delete restrict,
  recorded_by_employee_id uuid references public.employees(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  check (source_kind <> 'admin_change'
    or (nullif(btrim(position),'') is not null and nullif(btrim(workplace),'') is not null)),
  check (employment_status <> 'active' or employment_end_date is null),
  check (source_kind <> 'cutover_current' or corrects_revision_id is null)
);
create index employee_employment_assignment_lookup_idx
  on public.employee_employment_assignment_revisions(employee_id,effective_from desc,recorded_at desc);
create index employee_employment_assignment_correction_idx
  on public.employee_employment_assignment_revisions(corrects_revision_id)
  where corrects_revision_id is not null;
alter table public.employee_employment_assignment_revisions enable row level security;
revoke all on public.employee_employment_assignment_revisions from public,anon,authenticated;

-- The current record is the only verified cutover source. No Joined Date,
-- document, payroll, roster or other historical inference is performed.
insert into public.employee_employment_assignment_revisions
  (employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,
   workplace,employment_end_date,source_kind,reason)
select e.id,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date,
  coalesce(e.employment_type,'probation'),coalesce(e.employment_status,'active'),
  e.position,e.legal_entity_id,e.workplace,
  case when e.employment_status in ('resigned','terminated') then e.resigned_date else null end,
  'cutover_current','Current Employee assignment at cutover; earlier history is unverified.'
from public.employees e;

-- A revision is never edited or deleted. A correction appends a new revision
-- and links to the evidence it corrects; same-date corrections supersede the
-- preceding same-date revision without modifying it.
create function public.employee_employment_assignment_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='55000',message='Employment assignment revisions are immutable.';
end $$;
create trigger employee_employment_assignment_immutable
  before update or delete on public.employee_employment_assignment_revisions
  for each row execute function public.employee_employment_assignment_immutable();

-- Existing table writers may still update unrelated Employee fields. The
-- employment assignment and its end date can only change via the trusted
-- People command/activation boundary in this transaction.
create function public.employee_employment_projection_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if (new.employment_type,new.employment_status,new.position,new.legal_entity_id,
      new.workplace,new.resigned_date)
     is distinct from
     (old.employment_type,old.employment_status,old.position,old.legal_entity_id,
      old.workplace,old.resigned_date)
     and current_setting('feedx.people_employment_projection',true) is distinct from 'yes' then
    raise exception using errcode='55000',message='Use Change Employment with an effective date and reason.';
  end if;
  return new;
end $$;
create trigger employee_employment_projection_guard
  before update on public.employees for each row execute function public.employee_employment_projection_guard();

-- New employees receive a current-only baseline, not a fabricated assignment
-- dating back to Joined Date.
create function public.employee_employment_new_employee_baseline()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_actor uuid;
begin
  select e.id into v_actor from public.employees e where e.auth_user_id=auth.uid() limit 1;
  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,
     legal_entity_id,workplace,employment_end_date,source_kind,reason,recorded_by_employee_id)
  values (new.id,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date,
    coalesce(new.employment_type,'probation'),coalesce(new.employment_status,'active'),
    new.position,new.legal_entity_id,new.workplace,
    case when new.employment_status in ('resigned','terminated') then new.resigned_date else null end,
    'new_employee','Initial current Employee assignment; earlier history is unverified.',v_actor);
  return new;
end $$;
create trigger employee_employment_new_employee_baseline
  after insert on public.employees for each row execute function public.employee_employment_new_employee_baseline();

create policy employee_employment_assignment_admin_read
  on public.employee_employment_assignment_revisions for select to authenticated
  using (public.current_user_has_permission('employees.view')
    and exists (select 1 from public.employees e where e.id=employee_id));
grant select on public.employee_employment_assignment_revisions to authenticated;

-- Internal effective-date resolver: superseded evidence remains readable in
-- history but cannot be selected as the active assignment for a date.
create function public.employee_employment_assignment_at(p_employee_id uuid,p_on date)
returns public.employee_employment_assignment_revisions
language sql stable security definer set search_path=public as $$
  select r from public.employee_employment_assignment_revisions r
  where r.employee_id=p_employee_id and r.effective_from<=p_on
    and not exists (select 1 from public.employee_employment_assignment_revisions newer
      where newer.supersedes_revision_id=r.id)
  order by r.effective_from desc,r.recorded_at desc,r.id desc limit 1;
$$;
revoke all on function public.employee_employment_assignment_at(uuid,date) from public,anon,authenticated;

-- Client read returns an explicit unresolved state before the first verified
-- baseline, plus all immutable revision evidence for the secondary timeline.
create function public.employee_employment_assignment_read(p_employee_id uuid,p_on date default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_row public.employee_employment_assignment_revisions%rowtype; v_start date; v_revisions jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('employees.view')
    or not exists (select 1 from public.employees e where e.id=p_employee_id
      and (public.current_user_has_all_outlet_access()
        or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
          and lower(coalesce(o.name,''))=lower(coalesce(e.workplace,''))
          or public.current_user_can_access_outlet(o.id)
          and lower(coalesce(o.code,''))=lower(coalesce(e.workplace,''))))) then
    raise exception using errcode='42501',message='Employee assignment is outside your scope.';
  end if;
  select min(effective_from) into v_start from public.employee_employment_assignment_revisions
    where employee_id=p_employee_id and source_kind in ('cutover_current','new_employee');
  v_row:=public.employee_employment_assignment_at(p_employee_id,coalesce(p_on,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.effective_from desc,r.recorded_at desc),'[]'::jsonb)
    into v_revisions from public.employee_employment_assignment_revisions r where r.employee_id=p_employee_id;
  return jsonb_build_object('state',case when v_row.id is null then 'unresolved' else 'resolved' end,
    'as_of',coalesce(p_on,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date),
    'verified_from',v_start,'assignment',case when v_row.id is null then null else to_jsonb(v_row) end,
    'revisions',v_revisions);
end $$;
revoke all on function public.employee_employment_assignment_read(uuid,date) from public,anon,authenticated;
grant execute on function public.employee_employment_assignment_read(uuid,date) to authenticated;

-- Keep the current Employee projection in lockstep with the current effective
-- assignment. Workplace updates intentionally fire the existing Crew Access
-- synchronization/session revocation trigger; future revisions do not.
create function public.employee_employment_apply_projection(p_employee_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_revision public.employee_employment_assignment_revisions%rowtype;
  v_department text;
begin
  select * into v_employee from public.employees where id=p_employee_id for update;
  if v_employee.id is null then return false; end if;
  v_revision:=public.employee_employment_assignment_at(p_employee_id,timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date);
  if v_revision.id is null then return false; end if;
  if (v_employee.employment_type,v_employee.employment_status,v_employee.position,
      v_employee.legal_entity_id,v_employee.workplace,v_employee.resigned_date)
     is not distinct from
     (v_revision.employment_type,v_revision.employment_status,v_revision.position,
      v_revision.legal_entity_id,v_revision.workplace,v_revision.employment_end_date) then
    return false;
  end if;
  select jp.department into v_department from public.job_positions jp where jp.name=v_revision.position limit 1;
  perform set_config('feedx.people_employment_projection','yes',true);
  update public.employees set employment_type=v_revision.employment_type,
    employment_status=v_revision.employment_status,position=v_revision.position,
    department=case when position is distinct from v_revision.position then v_department else department end,
    legal_entity_id=v_revision.legal_entity_id,workplace=v_revision.workplace,
    resigned_date=v_revision.employment_end_date,updated_at=clock_timestamp()
  where id=p_employee_id;
  perform set_config('feedx.people_employment_projection','',true);
  insert into public.audit_logs(action,module,description,metadata)
  values ('employee_employment_assignment_effective','people','Employment assignment became current.',
    jsonb_build_object('employee_id',p_employee_id,'revision_id',v_revision.id,
      'effective_from',v_revision.effective_from,'previous_workplace',v_employee.workplace,
      'current_workplace',v_revision.workplace));
  return true;
end $$;
revoke all on function public.employee_employment_apply_projection(uuid) from public,anon,authenticated;

create function public.employee_employment_assignment_save(
  p_employee_id uuid,p_effective_from date,p_assignment jsonb,p_reason text,
  p_expected_revision_id uuid,p_evidence_reference text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_prior public.employee_employment_assignment_revisions%rowtype;
  v_same_date public.employee_employment_assignment_revisions%rowtype; v_new public.employee_employment_assignment_revisions%rowtype;
  v_actor uuid; v_type text; v_status text; v_position text; v_workplace text;
  v_entity uuid; v_end date; v_cutover date; v_scope_outlet uuid;
begin
  if auth.uid() is null or not public.current_user_has_permission('employees.edit') then
    raise exception using errcode='42501',message='Employment assignment permission denied.';
  end if;
  if p_effective_from is null or p_assignment is null or jsonb_typeof(p_assignment)<>'object'
    or not p_assignment ?& array['employment_type','employment_status','position','legal_entity_id','workplace']
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))<3
    or length(btrim(p_reason))>500 then
    raise exception using errcode='22023',message='Complete assignment, effective date and reason are required.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if v_employee.id is null then raise exception using errcode='P0002',message='Employee is unavailable.'; end if;
  if not (public.current_user_has_all_outlet_access()
    or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
      and lower(v_employee.workplace) in (lower(o.name),lower(coalesce(o.code,''))))) then
    raise exception using errcode='42501',message='Current Employee workplace is outside your scope.';
  end if;
  v_type:=nullif(btrim(p_assignment->>'employment_type'),'');
  v_status:=nullif(btrim(p_assignment->>'employment_status'),'');
  v_position:=nullif(btrim(p_assignment->>'position'),'');
  v_workplace:=nullif(btrim(p_assignment->>'workplace'),'');
  v_entity:=nullif(p_assignment->>'legal_entity_id','')::uuid;
  if v_type not in ('probation','full_time','part_time','intern','contract')
    or v_status not in ('active','resigned','terminated')
    or v_position is null or v_workplace is null then
    raise exception using errcode='22023',message='Employment assignment is invalid.';
  end if;
  if not (public.current_user_has_all_outlet_access()
    or exists (select 1 from public.outlets o where public.current_user_can_access_outlet(o.id)
      and lower(v_workplace) in (lower(o.name),lower(coalesce(o.code,''))))) then
    raise exception using errcode='42501',message='New workplace is outside your scope.';
  end if;
  if v_entity is not null and not exists
    (select 1 from public.legal_entities le where le.id=v_entity and le.is_active) then
    raise exception using errcode='22023',message='Choose an active legal employer.';
  end if;
  select min(effective_from) into v_cutover from public.employee_employment_assignment_revisions
    where employee_id=p_employee_id and source_kind in ('cutover_current','new_employee');
  if v_cutover is null or p_effective_from<v_cutover then
    raise exception using errcode='22023',message='Employment before the verified baseline is unresolved.';
  end if;
  v_prior:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);
  if v_prior.id is distinct from p_expected_revision_id then
    raise exception using errcode='40001',message='Employment assignment changed. Review the latest timeline.';
  end if;
  if v_status='active' then v_end:=null;
  elsif v_prior.employment_status=v_status then v_end:=v_prior.employment_end_date;
  else v_end:=p_effective_from; end if;
  if (v_type,v_status,v_position,v_entity,v_workplace,v_end) is not distinct from
     (v_prior.employment_type,v_prior.employment_status,v_prior.position,
      v_prior.legal_entity_id,v_prior.workplace,v_prior.employment_end_date) then
    raise exception using errcode='22023',message='No Employment assignment change was made.';
  end if;
  select * into v_same_date from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id and r.effective_from=p_effective_from
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id)
    order by r.recorded_at desc limit 1;
  select e.id into v_actor from public.employees e where e.auth_user_id=auth.uid() limit 1;
  if v_actor is null then
    raise exception using errcode='42501',message='Employment change requires an Employee-linked Admin.';
  end if;
  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,
     workplace,employment_end_date,source_kind,reason,evidence_reference,
     corrects_revision_id,supersedes_revision_id,recorded_by_employee_id)
  values (p_employee_id,p_effective_from,v_type,v_status,v_position,v_entity,
    v_workplace,v_end,'admin_change',btrim(p_reason),nullif(btrim(p_evidence_reference),''),
    case when p_effective_from<timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      or v_same_date.id is not null then v_prior.id else null end,
    v_same_date.id,v_actor)
  returning * into v_new;
  if p_effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then
    perform public.employee_employment_apply_projection(p_employee_id);
  end if;
  return jsonb_build_object('revision',to_jsonb(v_new),
    'projection_state',case when p_effective_from>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      then 'scheduled' else 'current' end);
end $$;
revoke all on function public.employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)
  to authenticated;

-- The existing server scheduler activates future-dated changes on their
-- Malaysia effective day. The function is not callable by API roles.
create function public.employee_employment_activate_due()
returns integer language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_count integer:=0;
begin
  for v_id in
    select distinct r.employee_id from public.employee_employment_assignment_revisions r
    where r.effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      and r.source_kind='admin_change'
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id)
  loop
    if public.employee_employment_apply_projection(v_id) then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end $$;
revoke all on function public.employee_employment_activate_due() from public,anon,authenticated;

do $$
declare v_job bigint;
begin
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'People Employment Timeline requires the existing pg_cron scheduler.';
  end if;
  for v_job in execute 'select jobid from cron.job where jobname=$1'
    using 'feedx_people_employment_activate_due' loop
    execute 'select cron.unschedule($1)' using v_job;
  end loop;
  execute 'select cron.schedule($1,$2,$3)'
    using 'feedx_people_employment_activate_due','* * * * *',
      'select public.employee_employment_activate_due()';
end $$;
