-- Keep daily Waste requirements with an empty weekday array readable in the monthly projection.

create or replace function public.factory_mesti_waste_disposal_monthly(p_month date)
returns setof jsonb language plpgsql security definer stable set search_path = public, pg_temp as $$
begin
  if not (public.current_user_has_permission('factory_mesti_waste_disposal.view') or public.current_user_has_permission('factory_mesti_waste_disposal.manage')) then raise exception using errcode='42501', message='Missing waste disposal view permission.'; end if;
  return query
  with days as (
    select d::date run_date from generate_series(date_trunc('month',p_month),date_trunc('month',p_month)+interval '1 month - 1 day','1 day') d
  ), applicable as (
    select r.logical_requirement_id,r.location_id,l.location_name,r.frequency,r.recurrence_weekdays,d.run_date,r.required_count
    from days d
    join public.factory_mesti_waste_disposal_requirements r on r.status='active' and r.effective_from<=d.run_date
      and (r.effective_until is null or r.effective_until>d.run_date)
      and public.factory_mesti_recurrence_due(r.frequency,r.recurrence_weekdays,d.run_date)
    join public.factory_storage_locations l on l.id=r.location_id
  ), counts as (
    select a.*,s.id session_id,s.status session_status,s.submitted_at,s.verified_at,
      coalesce(sb.nickname,sb.full_name) submitted_by_name,coalesce(vb.nickname,vb.full_name) verified_by_name,
      count(e.id)::integer completed_count,
      coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('completed_by_name',coalesce(c.nickname,c.full_name)) order by e.disposed_at) filter(where e.id is not null),'[]'::jsonb) events
    from applicable a
    left join public.factory_mesti_waste_disposal_sessions s on s.disposal_date=a.run_date
    left join public.factory_mesti_waste_disposal_events e on e.session_id=s.id and e.location_id=a.location_id
    left join public.employees c on c.id=e.completed_by
    left join public.employees sb on sb.id=s.submitted_by
    left join public.employees vb on vb.id=s.verified_by
    group by a.logical_requirement_id,a.location_id,a.location_name,a.frequency,a.recurrence_weekdays,a.run_date,a.required_count,s.id,s.status,s.submitted_at,s.verified_at,sb.nickname,sb.full_name,vb.nickname,vb.full_name
  )
  select jsonb_build_object(
    'logical_requirement_id',logical_requirement_id,'location_id',location_id,'location_name',location_name,
    'frequency',(array_agg(frequency order by run_date desc))[1],
    'recurrence_weekdays',(jsonb_agg(to_jsonb(recurrence_weekdays) order by run_date desc)->0),
    'days',jsonb_object_agg(run_date::text,jsonb_build_object(
      'disposal_date',run_date,'required_count',required_count,'completed_count',completed_count,'events',events,
      'session_id',session_id,'session_status',session_status,'submitted_by_name',submitted_by_name,'submitted_at',submitted_at,
      'verified_by_name',verified_by_name,'verified_at',verified_at
    ) order by run_date)
  )
  from counts group by logical_requirement_id,location_id,location_name order by location_name;
end $$;

revoke all on function public.factory_mesti_waste_disposal_monthly(date) from public,anon;
grant execute on function public.factory_mesti_waste_disposal_monthly(date) to authenticated;
