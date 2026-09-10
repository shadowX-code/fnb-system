-- Forward-only repair: verification ordering must distinguish consecutive lifecycle events.
create or replace function public.factory_mesti_verify_calibration(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  a uuid := public.factory_current_active_employee_id();
  rec public.factory_mesti_calibration_records%rowtype;
  settings public.factory_mesti_calibration_settings%rowtype;
  verified_at_value timestamptz := clock_timestamp();
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.review') or public.current_user_has_permission('factory_mesti_calibration.manage')) then
    raise exception using errcode='42501',message='Missing calibration verification permission.';
  end if;
  select * into settings from public.factory_mesti_calibration_settings where singleton;
  if settings.singleton is not true or (select role_id from public.employees where id=a) is distinct from settings.verifier_role_id then
    raise exception using errcode='42501',message='Your role is not authorized to verify calibration.';
  end if;
  select * into rec from public.factory_mesti_calibration_records where id=p_record_id for update;
  if rec.id is null or rec.status <> 'awaiting_verification' then raise exception 'Calibration record is not awaiting verification.'; end if;
  if rec.recorded_by=a then raise exception 'Self-verification is not allowed.'; end if;
  update public.factory_mesti_calibration_records
  set status='verified',verified_by=a,verified_at=verified_at_value,updated_at=verified_at_value
  where id=rec.id
  returning * into rec;
  return to_jsonb(rec);
end $$;

revoke all on function public.factory_mesti_verify_calibration(uuid) from public,anon;
grant execute on function public.factory_mesti_verify_calibration(uuid) to authenticated;
