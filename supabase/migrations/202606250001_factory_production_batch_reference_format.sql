-- Factory production batch reference format.
-- Generates new production batch numbers as PBYYMMDD-01 while preserving existing historical batch_no values.

create or replace function public.factory_set_production_batch_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_date date;
  v_yymmdd text;
  v_prefix text;
  v_next integer;
begin
  if nullif(trim(coalesce(new.batch_no, '')), '') is not null then
    return new;
  end if;

  v_batch_date := coalesce(new.production_date, current_date);
  v_yymmdd := to_char(v_batch_date, 'YYMMDD');
  v_prefix := 'PB' || v_yymmdd;

  perform pg_advisory_xact_lock(hashtextextended('factory_production_batch:' || v_prefix, 0));

  select coalesce(max((substring(prod.batch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_productions prod
  where prod.batch_no ~ ('^' || v_prefix || '-[0-9]+$');

  new.batch_no := v_prefix || '-' || lpad(v_next::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists factory_set_production_batch_no_before_insert on public.factory_productions;
create trigger factory_set_production_batch_no_before_insert
before insert on public.factory_productions
for each row
execute function public.factory_set_production_batch_no();
