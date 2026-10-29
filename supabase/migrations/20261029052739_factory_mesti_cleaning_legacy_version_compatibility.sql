-- Legacy logical requirements may version without inventing a historical method.
do $preflight$
begin
  if md5(pg_get_functiondef('public.factory_mesti_guard_cleaning_method()'::regprocedure)) <> 'e7198581998b194f19b0b48a54270e54' then
    raise exception 'Cleaning Method guard changed; audit before applying legacy compatibility.';
  end if;
end $preflight$;

create or replace function public.factory_mesti_guard_cleaning_method()
returns trigger language plpgsql set search_path = public, pg_temp as $guard$
declare v_used boolean; v_unspecified_lineage boolean;
begin
  if TG_OP = 'INSERT' and new.cleaning_method is null then
    execute format('select coalesce(bool_and(cleaning_method is null), false) from public.%I where logical_requirement_id = $1', TG_TABLE_NAME)
      into v_unspecified_lineage using new.logical_requirement_id;
    if not v_unspecified_lineage then
      raise exception using errcode='22023', message='Select one Cleaning Method.';
    end if;
    if new.cleaning_method_reference is not null then
      raise exception using errcode='22023', message='An unspecified Cleaning Method cannot have a procedure reference.';
    end if;
    return new;
  end if;
  if TG_OP = 'UPDATE' and new.cleaning_method is not distinct from old.cleaning_method then
    if new.cleaning_method_reference is distinct from old.cleaning_method_reference then
      raise exception using errcode='22023', message='Cleaning Method reference is immutable.';
    end if;
    return new;
  end if;
  if new.cleaning_method is null then raise exception using errcode='22023', message='A specified Cleaning Method cannot be cleared.'; end if;
  if TG_OP = 'UPDATE' then
    if TG_TABLE_NAME = 'factory_mesti_cleaning_requirements' then
      select exists(select 1 from public.factory_mesti_cleaning_occurrences where requirement_id=old.id and status <> 'pending') into v_used;
    else
      select exists(select 1 from public.factory_mesti_equipment_cleaning_occurrences where requirement_id=old.id and status <> 'pending') into v_used;
    end if;
    if old.effective_from <= (now() at time zone 'Asia/Kuala_Lumpur')::date or v_used then
      raise exception using errcode='22023', message='Change the Cleaning Method through a new requirement version.';
    end if;
  end if;
  new.cleaning_method_reference := public.factory_mesti_cleaning_method_reference(new.cleaning_method);
  if new.cleaning_method_reference is null then raise exception using errcode='22023', message='Select a valid Cleaning Method.'; end if;
  return new;
end $guard$;
