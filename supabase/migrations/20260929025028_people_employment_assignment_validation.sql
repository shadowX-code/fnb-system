-- Forward-only hardening of the Staging-applied People timeline. Keep one
-- verified current baseline per employee and validate new master references.
create unique index employee_employment_one_baseline_idx
  on public.employee_employment_assignment_revisions(employee_id)
  where source_kind in ('cutover_current','new_employee');

create function public.employee_employment_assignment_validate_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_prior public.employee_employment_assignment_revisions%rowtype;
begin
  if new.source_kind<>'admin_change' then return new; end if;
  v_prior:=public.employee_employment_assignment_at(new.employee_id,new.effective_from);
  if new.position is distinct from v_prior.position
    and not exists (select 1 from public.job_positions jp
      where jp.name=new.position and jp.status='active') then
    raise exception using errcode='22023',message='Choose an active Job Position.';
  end if;
  if new.workplace is distinct from v_prior.workplace
    and lower(new.workplace) not in ('factory','management')
    and not exists (select 1 from public.outlets o where o.is_active
      and lower(new.workplace) in (lower(o.name),lower(coalesce(o.code,'')))) then
    raise exception using errcode='22023',message='Choose an active Workplace.';
  end if;
  return new;
end $$;
create trigger employee_employment_assignment_validate_insert
  before insert on public.employee_employment_assignment_revisions
  for each row execute function public.employee_employment_assignment_validate_insert();
revoke all on function public.employee_employment_assignment_validate_insert()
  from public,anon,authenticated;
