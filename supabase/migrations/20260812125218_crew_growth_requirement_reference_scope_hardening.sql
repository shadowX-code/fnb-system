-- Validate every Learning/SOP evidence reference inside the Growth authority.
-- The browser only lists scoped evidence, but server authority must reject a
-- caller-crafted UUID from another outlet or an unpublished draft.
create or replace function public.crew_growth_save_skill(p_skill jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_skill_id uuid; v_outlet_id uuid; prior_version integer; item jsonb; ordinal integer:=0; reference_ok boolean;
begin
  v_outlet_id:=(p_skill->>'outlet_id')::uuid;
  if not public.current_user_has_permission('crew_growth.manage') or not public.current_user_can_access_outlet(v_outlet_id) then raise exception using errcode='42501',message='You cannot manage Growth for this outlet.'; end if;
  if nullif(trim(p_skill->>'name'),'') is null or nullif(trim(p_skill->>'category'),'') is null then raise exception using errcode='22023',message='Skill name and category are required.'; end if;
  if jsonb_typeof(coalesce(p_skill->'positions','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_skill->'outlets','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_skill->'requirements','[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Skill collections must be arrays.'; end if;
  v_skill_id:=nullif(p_skill->>'id','')::uuid;
  if v_skill_id is null then
    insert into public.crew_skills(outlet_id,name,category,description,status,certification_method,validity_months,created_by) values(v_outlet_id,trim(p_skill->>'name'),trim(p_skill->>'category'),nullif(trim(p_skill->>'description'),''),coalesce(p_skill->>'status','active'),coalesce(p_skill->>'certification_method','learning'),nullif(p_skill->>'validity_months','')::integer,auth.uid()) returning id into v_skill_id;
  else
    select requirements_version into prior_version from public.crew_skills where id=v_skill_id and outlet_id=v_outlet_id for update;
    if not found then raise exception using errcode='42501',message='Skill is unavailable.'; end if;
    update public.crew_skills set name=trim(p_skill->>'name'),category=trim(p_skill->>'category'),description=nullif(trim(p_skill->>'description'),''),status=coalesce(p_skill->>'status','active'),certification_method=coalesce(p_skill->>'certification_method','learning'),validity_months=nullif(p_skill->>'validity_months','')::integer,requirements_version=prior_version+1,updated_at=now() where id=v_skill_id;
    delete from public.crew_skill_positions where skill_id=v_skill_id;
    delete from public.crew_skill_outlets where skill_id=v_skill_id;
    delete from public.crew_skill_requirements where skill_id=v_skill_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'positions','[]'::jsonb)) loop insert into public.crew_skill_positions values(v_skill_id,trim(both '"' from item::text)) on conflict do nothing; end loop;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'outlets','[]'::jsonb)) loop if public.current_user_can_access_outlet((trim(both '"' from item::text))::uuid) then insert into public.crew_skill_outlets values(v_skill_id,(trim(both '"' from item::text))::uuid) on conflict do nothing; else raise exception using errcode='42501',message='Skill outlet scope is unavailable.'; end if; end loop;
  for item in select value from jsonb_array_elements(coalesce(p_skill->'requirements','[]'::jsonb)) loop
    ordinal:=ordinal+1;
    reference_ok:=true;
    if item->>'type'='module' then
      select exists(select 1 from public.crew_journey_modules m join public.crew_journeys j on j.id=m.journey_id where m.id=nullif(item->>'reference_id','')::uuid and j.outlet_id=v_outlet_id and j.status='published') into reference_ok;
    elsif item->>'type'='lesson' then
      select exists(select 1 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id where l.id=nullif(item->>'reference_id','')::uuid and j.outlet_id=v_outlet_id and j.status='published') into reference_ok;
    elsif item->>'type'='quiz' then
      select exists(select 1 from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id where q.id=nullif(item->>'reference_id','')::uuid and q.status='published' and j.outlet_id=v_outlet_id and j.status='published') into reference_ok;
    elsif item->>'type'='sop' then
      select exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=nullif(item->>'reference_id','')::uuid and v.status='published' and s.outlet_id=v_outlet_id) into reference_ok;
    end if;
    if not reference_ok then raise exception using errcode='42501',message='Growth requirement evidence is unavailable for this outlet.'; end if;
    insert into public.crew_skill_requirements(skill_id,requirement_type,reference_id,label_snapshot,required,config,sort_order) values(v_skill_id,item->>'type',nullif(item->>'reference_id','')::uuid,coalesce(nullif(trim(item->>'label'),''),'Requirement'),coalesce((item->>'required')::boolean,true),coalesce(item->'config','{}'::jsonb),ordinal);
  end loop;
  return v_skill_id;
end;
$$;
revoke all on function public.crew_growth_save_skill(jsonb) from public,anon,authenticated;
grant execute on function public.crew_growth_save_skill(jsonb) to authenticated;
