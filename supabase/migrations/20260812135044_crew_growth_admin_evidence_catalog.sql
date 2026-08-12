-- Lightweight published evidence catalog for the Growth Skill editor.
create or replace function public.crew_growth_admin_evidence(p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not (public.current_user_has_permission('crew_growth.view') or public.current_user_has_permission('crew_growth.manage'))
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Growth evidence is unavailable for this outlet.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type',x.type,'id',x.id,'label',x.label) order by x.type_order,x.parent_order,x.item_order,x.label),'[]'::jsonb)
  into result
  from (
    select 'module'::text type,m.id,concat(j.name,' · ',m.title) label,1 type_order,m.sort_order parent_order,0 item_order
    from public.crew_journey_modules m join public.crew_journeys j on j.id=m.journey_id
    where j.outlet_id=p_outlet_id and j.status='published' and m.status='published'
    union all
    select 'lesson',l.id,concat(m.title,' · ',l.title),2,m.sort_order,l.sort_order
    from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id
    where j.outlet_id=p_outlet_id and j.status='published' and m.status='published'
    union all
    select 'quiz',q.id,concat(l.title,' · ',q.title),3,m.sort_order,l.sort_order
    from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id join public.crew_journeys j on j.id=m.journey_id
    where j.outlet_id=p_outlet_id and j.status='published' and m.status='published' and q.status='published'
    union all
    select 'sop',v.id,concat(s.title,' · v',v.version),4,0,v.version
    from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
    where s.outlet_id=p_outlet_id and v.status='published'
  ) x;
  return result;
end;
$$;
revoke all on function public.crew_growth_admin_evidence(uuid) from public,anon,authenticated;
grant execute on function public.crew_growth_admin_evidence(uuid) to authenticated;
