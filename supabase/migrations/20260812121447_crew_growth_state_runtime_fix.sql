-- Forward fix for PL/pgSQL status variable ambiguity in the Growth state authority.
create or replace function public.crew_growth_employee_skill(p_employee_id uuid,p_skill_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare s public.crew_skills%rowtype; cert public.crew_skill_certifications%rowtype; requirements jsonb; history jsonb; total integer; done integer; automated_total integer; automated_done integer; practical_required boolean; manual_required boolean; v_status text; applicable boolean;
begin
  select * into s from public.crew_skills where id=p_skill_id;
  if not found then raise exception using errcode='P0002',message='Skill not found.'; end if;
  applicable:=public.crew_growth_skill_applicable(p_employee_id,p_skill_id);
  select c.* into cert from public.crew_skill_certifications c where c.employee_id=p_employee_id and c.skill_id=p_skill_id and c.status='certified' order by c.certified_at desc limit 1;
  select coalesce(jsonb_agg(public.crew_growth_requirement_evidence(p_employee_id,r.id) order by r.sort_order),'[]'::jsonb) into requirements from public.crew_skill_requirements r where r.skill_id=p_skill_id;
  select count(*) filter(where required),count(*) filter(where required and coalesce((e->>'completed')::boolean,false)),count(*) filter(where required and e->>'type' not in ('practical','manual','performance')),count(*) filter(where required and e->>'type' not in ('practical','manual','performance') and coalesce((e->>'completed')::boolean,false)),bool_or(required and e->>'type'='practical'),bool_or(required and e->>'type'='manual') into total,done,automated_total,automated_done,practical_required,manual_required from jsonb_array_elements(requirements) e;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'requirements_version',c.requirements_version,'certified_at',c.certified_at,'certified_by',c.certified_by,'expires_at',c.expires_at,'evidence',c.evidence_snapshot,'note',c.note) order by c.certified_at desc),'[]'::jsonb) into history from public.crew_skill_certifications c where c.employee_id=p_employee_id and c.skill_id=p_skill_id;
  if not applicable then v_status:='not_applicable';
  elsif cert.id is not null and cert.expires_at is not null and cert.expires_at<=now() then v_status:='expired';
  elsif cert.id is not null and cert.expires_at is not null and cert.expires_at<=now()+interval '30 days' then v_status:='needs_renewal';
  elsif cert.id is not null then v_status:='certified';
  elsif coalesce(automated_total,0)>0 and automated_done=automated_total and coalesce(practical_required,false) then v_status:='ready_for_review';
  elsif coalesce(automated_done,0)=coalesce(automated_total,0) and coalesce(manual_required,false) then v_status:='ready_for_review';
  elsif total>0 and done=total then v_status:='ready_for_review';
  elsif done>0 then v_status:='in_progress';
  else v_status:='not_started'; end if;
  return jsonb_build_object('employee_id',p_employee_id,'skill_id',p_skill_id,'status',v_status,'applicable',applicable,'requirements',requirements,'requirements_completed',coalesce(done,0),'requirements_total',coalesce(total,0),'certification',case when cert.id is null then null else jsonb_build_object('id',cert.id,'certified_at',cert.certified_at,'expires_at',cert.expires_at,'requirements_version',cert.requirements_version) end,'certification_history',history);
end;
$$;
revoke all on function public.crew_growth_employee_skill(uuid,uuid) from public,anon,authenticated;
