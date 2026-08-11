-- Login email remains a compatibility identity during this transition, so each
-- non-empty normalized employee email must identify exactly one employee row.
do $$
begin
  if exists (
    select 1
    from public.employees
    where nullif(btrim(email), '') is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Cannot add employee normalized-email identity uniqueness: duplicate employee emails require remediation.',
      hint = 'Merge or correct duplicate employees before applying employee_auth_identity_hardening_phase_1.';
  end if;
end;
$$;

create unique index if not exists employees_normalized_email_identity_unique
  on public.employees (lower(btrim(email)))
  where nullif(btrim(email), '') is not null;
