-- A published period keeps its immutable Crew-facing revision while Admin
-- continues editing the working rows. This flag is intentionally owned by the
-- trusted roster authorities rather than inferred from the browser.
alter table public.roster_periods
  add column if not exists has_unpublished_changes boolean not null default false;

-- Existing published periods had no separate working state before this change.
-- Their last publication is therefore also their current working state.
update public.roster_periods
set has_unpublished_changes = false
where status = 'published';

do $migration$
declare
  v_definition text;
  v_old_fragment constant text := $old$
  elsif period_row.status = 'published' then
    update public.roster_periods
    set status = 'draft', locked_at = null, updated_at = now()
    where id = period_row.id
    returning * into period_row;
  end if;
$old$;
  v_new_fragment constant text := $new$
  elsif period_row.status = 'published' then
    update public.roster_periods
    set has_unpublished_changes = true, updated_at = now()
    where id = period_row.id
    returning * into period_row;
  end if;
$new$;
begin
  select pg_get_functiondef('public.save_roster_week_snapshot(uuid,uuid,date,jsonb)'::regprocedure)
  into v_definition;
  if position(v_old_fragment in v_definition) = 0 then
    raise exception 'Expected published roster working-state transition was not found.';
  end if;
  execute replace(v_definition, v_old_fragment, v_new_fragment);
end;
$migration$;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.publish_roster_week(uuid,uuid,date)'::regprocedure)
  into v_definition;
  v_definition := regexp_replace(
    v_definition,
    '(select[[:space:]]+\*[[:space:]]+into[[:space:]]+v_period[[:space:]]+from[[:space:]]+public\.roster_periods[[:space:]]+where[[:space:]]+outlet_id[[:space:]]*=[[:space:]]*p_outlet_id[[:space:]]+and[[:space:]]+week_start_date[[:space:]]*=[[:space:]]*p_week_start_date[[:space:]]+for[[:space:]]+update;)',
    E'\\1\n  if found and v_period.status=''published'' and not v_period.has_unpublished_changes then\n    select jsonb_build_object(''period'',to_jsonb(v_period),''rows'',coalesce(jsonb_agg(to_jsonb(r) order by r.roster_date,r.employee_id),''[]''::jsonb)) into v_result from public.duty_rosters r where r.outlet_id=p_outlet_id and r.roster_date between p_week_start_date and v_end;\n    update public.duty_roster_lifecycle_requests set result=v_result,completed_at=now() where request_id=p_request_id;\n    return v_result;\n  end if;',
    ''
  );
  v_definition := regexp_replace(
    v_definition,
    '(update[[:space:]]+public\.roster_periods[[:space:]]+set[[:space:]]+status[[:space:]]*=[[:space:]]*''published'',[[:space:]]*)',
    E'\\1has_unpublished_changes=false,',
    ''
  );
  if position('has_unpublished_changes=false' in v_definition) = 0
     or position('not v_period.has_unpublished_changes' in v_definition) = 0 then
    raise exception 'Expected roster publish transition was not found.';
  end if;
  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old_fragment constant text := $old$
  if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status) values(p_outlet_id,p_target_week_start_date,v_target_end,'draft') returning * into v_period; else update public.roster_periods set status='draft',locked_at=null,updated_at=now() where id=v_period.id returning * into v_period; end if;
$old$;
  v_new_fragment constant text := $new$
  if not found then insert into public.roster_periods(outlet_id,week_start_date,week_end_date,status) values(p_outlet_id,p_target_week_start_date,v_target_end,'draft') returning * into v_period; elsif v_period.status='published' then update public.roster_periods set has_unpublished_changes=true,updated_at=now() where id=v_period.id returning * into v_period; else update public.roster_periods set status='draft',locked_at=null,updated_at=now() where id=v_period.id returning * into v_period; end if;
$new$;
begin
  select pg_get_functiondef('public.copy_roster_week(uuid,uuid,date,date,boolean)'::regprocedure)
  into v_definition;
  if position(v_old_fragment in v_definition) = 0 then
    raise exception 'Expected roster copy transition was not found.';
  end if;
  execute replace(v_definition, v_old_fragment, v_new_fragment);
end;
$migration$;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.unpublish_roster_week(uuid,uuid,date)'::regprocedure)
  into v_definition;
  v_definition := replace(v_definition, 'status=''draft'',locked_at=null,updated_at=now()', 'status=''draft'',has_unpublished_changes=false,locked_at=null,updated_at=now()');
  execute v_definition;
end;
$migration$;

revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.copy_roster_week(uuid, uuid, date, date, boolean) from public, anon, authenticated;
revoke all on function public.publish_roster_week(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.unpublish_roster_week(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated;
grant execute on function public.copy_roster_week(uuid, uuid, date, date, boolean) to authenticated;
grant execute on function public.publish_roster_week(uuid, uuid, date) to authenticated;
grant execute on function public.unpublish_roster_week(uuid, uuid, date) to authenticated;
