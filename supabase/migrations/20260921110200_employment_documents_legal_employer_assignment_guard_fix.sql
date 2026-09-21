-- The employee master save path is intentionally direct/RLS-controlled. Its
-- assignment trigger must inspect the private Legal Entity master without
-- granting callers direct table reads.
create or replace function public.employee_legal_entity_assignment_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (tg_op='INSERT' or new.legal_entity_id is distinct from old.legal_entity_id) and new.legal_entity_id is not null
    and not exists(select 1 from public.legal_entities where id=new.legal_entity_id and is_active) then
    raise exception using errcode='23514',message='Choose an active legal employer.';
  end if;
  return new;
end; $$;

revoke all on function public.employee_legal_entity_assignment_guard() from public,anon,authenticated;
