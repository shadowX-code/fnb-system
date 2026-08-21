-- Only reviewed or provider-generated translations are valid runtime fallbacks.
-- A translation marked outdated must never override the current source content.

create or replace function public.crew_localized_content(p_token text,p_domain text,p_version_ids uuid[],p_language text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_employee_id uuid; v_employee_outlet uuid; v_version_id uuid; allowed boolean; snapshot jsonb; unit_entry record; resolved jsonb; value jsonb; result jsonb:='{}'::jsonb;
begin
  if p_language not in ('en','zh-CN','ms') then p_language:='en'; end if;
  if coalesce(cardinality(p_version_ids),0)>100 then raise exception using errcode='22023',message='Too many localized content versions requested.'; end if;
  v_employee_id:=public.crew_session_employee(p_token);
  select ca.primary_outlet_id into v_employee_outlet
  from public.crew_access ca where ca.employee_id=v_employee_id and ca.access_state='active';
  if v_employee_outlet is null then raise exception using errcode='42501',message='Crew access is unavailable.'; end if;
  foreach v_version_id in array coalesce(p_version_ids,'{}'::uuid[]) loop
    allowed:=false;
    if p_domain='sop' then
      allowed:=exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=v_version_id and v.status='published' and s.outlet_id=v_employee_outlet);
    elsif p_domain='onboarding' then
      allowed:=exists(select 1 from public.crew_journey_assignments a where a.employee_id=v_employee_id and a.journey_id=v_version_id);
    elsif p_domain='task' then
      allowed:=exists(select 1 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id where a.employee_id=v_employee_id and i.template_id=v_version_id);
    else raise exception using errcode='22023',message='Unsupported localized content domain.';
    end if;
    if not allowed then raise exception using errcode='42501',message='Localized content is unavailable for this Crew session.'; end if;
    if p_domain='sop' then
      select v.localized_content_snapshot into snapshot from public.crew_sop_versions v where v.id=v_version_id;
    elsif p_domain='onboarding' then
      select a.journey_snapshot->'localized_content' into snapshot from public.crew_journey_assignments a
      where a.employee_id=v_employee_id and a.journey_id=v_version_id order by a.assigned_at desc limit 1;
    else
      select i.template_snapshot->'localized_content' into snapshot from public.crew_operation_instances i
      join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee_id
      where i.template_id=v_version_id order by i.business_date desc,i.created_at desc limit 1;
    end if;
    snapshot:=coalesce(snapshot,public.crew_localization_snapshot(p_domain,v_version_id));
    resolved:='{}'::jsonb;
    for unit_entry in select key,entry.value from jsonb_each(snapshot) entry loop
      value:=coalesce(
          case when unit_entry.value->'translations'->p_language->>'status' in ('ai_translated','reviewed')
            then unit_entry.value->'translations'->p_language->'value' end,
          case when unit_entry.value->>'source_language'=p_language then unit_entry.value->'source_value' end,
          case when unit_entry.value->'translations'->'en'->>'status' in ('ai_translated','reviewed')
            then unit_entry.value->'translations'->'en'->'value' end,
          case when unit_entry.value->>'source_language'='en' then unit_entry.value->'source_value' end,
          unit_entry.value->'source_value',
          (select candidate.value->'value'
             from jsonb_each(unit_entry.value->'translations') candidate
            where candidate.value->>'status' in ('ai_translated','reviewed')
            limit 1)
        );
      if value is not null then resolved:=resolved||jsonb_build_object(unit_entry.key,value); end if;
    end loop;
    result:=result||jsonb_build_object(v_version_id::text,resolved);
  end loop;
  return result;
end; $$;

revoke all on function public.crew_localized_content(text,text,uuid[],text) from public;
grant execute on function public.crew_localized_content(text,text,uuid[],text) to anon,authenticated;
