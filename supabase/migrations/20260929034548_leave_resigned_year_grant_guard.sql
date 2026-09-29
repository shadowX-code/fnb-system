-- A departed employee may still need a verified historical grant for the
-- year of resignation. Later years remain unavailable. This adjusts only the
-- guard in the newly installed V2 function; no existing grant is rewritten.
do $$
declare v_definition text; v_old text; v_new text;
begin
  v_definition:=pg_get_functiondef(
    'public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid)'::regprocedure);
  v_old:=$old$if not coalesce(v_employee.is_active,true)
    or coalesce(v_employee.employment_status,'') in ('resigned','terminated')
    or (v_employee.resigned_date is not null and v_start>v_employee.resigned_date)
    then raise exception using errcode='22023',message='Future leave entitlement cannot be generated for a departed employee.'; end if;$old$;
  v_new:=$new$if (v_employee.resigned_date is not null and v_start>v_employee.resigned_date)
    or ((not coalesce(v_employee.is_active,true)
      or coalesce(v_employee.employment_status,'') in ('resigned','terminated'))
      and v_employee.resigned_date is null)
    then raise exception using errcode='22023',message='Future leave entitlement cannot be generated for a departed employee.'; end if;$new$;
  if position(v_old in v_definition)=0 then
    raise exception 'Leave V2 grant guard changed; manual reconciliation required.';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
revoke all on function public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid)
  from public,anon,authenticated;
