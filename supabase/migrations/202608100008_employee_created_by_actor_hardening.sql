-- Employee creator attribution is an immutable auth.users identity. Never trust
-- a client-provided employee ID, display name, email, or created_by payload.
create or replace function public.employee_set_created_by_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is null then
      raise exception using
        errcode = '42501',
        message = 'Authenticated actor is required to create an employee.';
    end if;
    new.created_by := v_actor;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_set_created_by_from_auth on public.employees;
create trigger employees_set_created_by_from_auth
before insert or update on public.employees
for each row
execute function public.employee_set_created_by_from_auth();
