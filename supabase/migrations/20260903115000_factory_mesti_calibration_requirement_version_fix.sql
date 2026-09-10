-- Forward-only repair for the requirement version-boundary variable ambiguity.
create or replace function public.factory_save_mesti_calibration_requirement(p_requirement jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  a uuid := public.factory_current_active_employee_id(); cur public.factory_mesti_calibration_requirements%rowtype; saved public.factory_mesti_calibration_requirements%rowtype;
  v_id uuid := nullif(p_requirement->>'id','')::uuid;
  requested_effective_from date := coalesce(nullif(p_requirement->>'effective_from','')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_effective_from date; latest_evidence_date date; typ text := btrim(p_requirement->>'calibration_type'); eq uuid := nullif(p_requirement->>'equipment_id','')::uuid;
  months integer := (p_requirement->>'interval_months')::integer; stat text := coalesce(nullif(p_requirement->>'status',''),'active'); changed boolean;
begin
  if not (public.current_user_has_permission('factory_mesti_calibration.create') or public.current_user_has_permission('factory_mesti_calibration.edit') or public.current_user_has_permission('factory_mesti_calibration.manage')) then raise exception using errcode='42501',message='Missing calibration setup permission.'; end if;
  if eq is null or typ='' or months not in (1,3,6,12) or stat not in ('active','inactive') then raise exception using errcode='22023',message='Equipment, Calibration Type, status and a valid interval are required.'; end if;
  if stat='active' and not exists(select 1 from public.factory_equipment where id=eq and status='active') then raise exception using errcode='22023',message='Only active Factory Equipment may have an active calibration requirement.'; end if;
  if v_id is null then insert into public.factory_mesti_calibration_requirements(equipment_id,calibration_type,interval_months,effective_from,status,created_by) values(eq,typ,months,requested_effective_from,stat,a) returning * into saved; return to_jsonb(saved)||jsonb_build_object('version_created',true); end if;
  select * into cur from public.factory_mesti_calibration_requirements where id=v_id;
  if cur.id is null then raise exception using errcode='22023',message='Calibration requirement was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(cur.logical_requirement_id::text,0));
  select * into cur from public.factory_mesti_calibration_requirements where logical_requirement_id=cur.logical_requirement_id and effective_until is null order by version_no desc limit 1 for update;
  if cur.id is null then raise exception using errcode='22023',message='Calibration requirement has no current version.'; end if;
  changed:=cur.equipment_id is distinct from eq or lower(cur.calibration_type) is distinct from lower(typ) or cur.interval_months is distinct from months or cur.status is distinct from stat or cur.effective_from is distinct from requested_effective_from;
  if not changed then return to_jsonb(cur)||jsonb_build_object('version_created',false); end if;
  select max(calibrated_date) into latest_evidence_date from public.factory_mesti_calibration_records where logical_requirement_id=cur.logical_requirement_id;
  v_effective_from:=greatest(requested_effective_from,(now() at time zone 'Asia/Kuala_Lumpur')::date,cur.effective_from+1,coalesce(latest_evidence_date+1,'-infinity'::date));
  update public.factory_mesti_calibration_requirements set effective_until=v_effective_from,updated_at=now() where id=cur.id;
  insert into public.factory_mesti_calibration_requirements(logical_requirement_id,equipment_id,calibration_type,interval_months,effective_from,status,version_no,created_by) values(cur.logical_requirement_id,eq,typ,months,v_effective_from,stat,cur.version_no+1,a) returning * into saved;
  update public.factory_mesti_calibration_requirements set superseded_by=saved.id,updated_at=now() where id=cur.id;
  return to_jsonb(saved)||jsonb_build_object('version_created',true);
end $$;

revoke all on function public.factory_save_mesti_calibration_requirement(jsonb) from public,anon;
grant execute on function public.factory_save_mesti_calibration_requirement(jsonb) to authenticated;
