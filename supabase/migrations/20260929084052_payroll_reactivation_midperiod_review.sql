-- A month that starts under a verified inactive assignment and becomes active
-- later has two employment states. The existing one-identity Payroll model
-- must review it, just as it reviews active -> inactive transitions.
do $migration$
declare v_definition text; v_changed text;
begin
  v_definition:=pg_get_functiondef('public.payroll_period_employment_resolve(uuid,uuid)'::regprocedure);
  v_changed:=replace(v_definition,
    'v_issue text; v_identity jsonb;',
    'v_issue text; v_identity jsonb; v_inactive_before_active boolean:=false;');
  if v_changed=v_definition then raise exception 'Payroll period declaration anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$      v_active:=true;
      if v_revision.legal_entity_id is not null then$old$,
    $new$      v_active:=true;
      if v_inactive_before_active then v_changed:=true; end if;
      if v_revision.legal_entity_id is not null then$new$);
  if v_changed=v_definition then raise exception 'Payroll period active-span anchor changed'; end if;
  v_definition:=v_changed;
  v_changed:=replace(v_definition,
    $old$    elsif v_first.id is not null then v_changed:=true;
    end if;$old$,
    $new$    elsif v_first.id is not null then v_changed:=true;
    else v_inactive_before_active:=true;
    end if;$new$);
  if v_changed=v_definition then raise exception 'Payroll period inactive-span anchor changed'; end if;
  execute v_changed;
end $migration$;
revoke all on function public.payroll_period_employment_resolve(uuid,uuid)
  from public,anon,authenticated;
