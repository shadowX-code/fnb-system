-- The paged Admin queue and Crew trend must use the same period-correct
-- projection as the open monthly result; neither may re-label stale evidence
-- as reviewed after an employment correction.
create or replace function public.crew_performance_admin_page(p_outlet_id uuid,p_period date,
  p_listing text,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_source jsonb; v_rows jsonb; v_total integer;
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_query text:=coalesce(p_filters->>'query','');
  v_position text:=coalesce(p_filters->>'position','all');
  v_status text:=coalesce(p_filters->>'status','all');
begin
  if p_listing not in ('review_queue','team') then
    raise exception using errcode='22023',message='Unsupported Performance listing.';
  end if;
  v_source:=public.crew_performance_admin_data(p_outlet_id,p_period);
  with rows as (select value as row from jsonb_array_elements(coalesce(v_source->'crew','[]'::jsonb))),
  classified as (
    select row,(coalesce((row->'result'->>'employment_review_required')::boolean,false)=false
      and row->'result'->'components'->'service'->>'status'='reviewed'
      and jsonb_typeof(row->'result'->'components'->'peer'->'score')='number') as reviewed
    from rows
  ),filtered as (
    select row,reviewed from classified where
      (v_query='' or concat_ws(' ',row->'employee'->>'full_name',row->'employee'->>'employee_code',
        row->'employee'->>'position') ilike '%'||v_query||'%')
      and (v_position='all' or row->'employee'->>'position'=v_position)
      and (v_status='all' or (v_status='awaiting' and not reviewed)
        or (v_status='reviewed' and reviewed)
        or (v_status='finalized' and row->'result'->>'status'='finalized'))
  ),numbered as (
    select row,row_number() over(order by
      case when p_listing='review_queue' then reviewed else false end,
      row->'employee'->>'full_name') as rn from filtered
  )
  select count(*)::integer,
    coalesce(jsonb_agg(row order by rn) filter(where rn>(v_page-1)*v_size and rn<=v_page*v_size),'[]'::jsonb)
    into v_total,v_rows from numbered;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,
    'summary',jsonb_build_object('period_summary',coalesce(v_source->'summary','{}'::jsonb),
      'scoring_framework',coalesce(v_source->'scoring_framework','[]'::jsonb)));
end $$;
revoke all on function public.crew_performance_admin_page(uuid,date,text,jsonb,integer,integer)
  from public,anon,authenticated;
grant execute on function public.crew_performance_admin_page(uuid,date,text,jsonb,integer,integer)
  to authenticated;

create or replace function public.crew_performance_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid:=public.crew_session_employee(p_token); result_id uuid;
  result public.crew_performance_results%rowtype; v_trend_result public.crew_performance_results%rowtype;
  trend jsonb:='[]'::jsonb; safe_components jsonb;
  scored_components integer; pending_names jsonb; v_employment jsonb; v_pending boolean:=false;
  v_trend_employment jsonb; v_trend_pending boolean;
begin
  result_id:=public.crew_refresh_performance(employee,p_period);
  v_employment:=public.crew_performance_period_employment(employee,p_period);
  if result_id is not null then
    select * into result from public.crew_performance_results where id=result_id;
    v_pending:=public.crew_performance_employment_needs_review(result,v_employment);
  elsif v_employment->>'state' not in ('unresolved','mixed') then
    return null;
  else
    v_pending:=true;
  end if;
  if v_pending then
    safe_components:=jsonb_build_object(
      'attendance',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'service',jsonb_build_object('score',null,'max_score',30,'status','review_required'),
      'customer',jsonb_build_object('score',null,'max_score',20,'status','pending'),
      'knowledge',jsonb_build_object('score',null,'max_score',15,'status','review_required'),
      'peer',jsonb_build_object('score',null,'max_score',5,'status','review_required'));
  else
    safe_components:=jsonb_build_object('attendance',result.components->'attendance',
      'service',(result.components->'service')-'manager_note',
      'customer',result.components->'customer',
      'knowledge',result.components->'knowledge','peer',result.components->'peer');
  end if;
  select count(*) filter(where jsonb_typeof(value->'score')='number')::integer,
    coalesce(jsonb_agg(key order by key) filter(where jsonb_typeof(value->'score') is distinct from 'number'),'[]'::jsonb)
    into scored_components,pending_names from jsonb_each(safe_components);
  for v_trend_result in select * from public.crew_performance_results
      where employee_id=employee order by period_start desc limit 6 loop
    v_trend_employment:=public.crew_performance_period_employment(employee,v_trend_result.period_start);
    v_trend_pending:=public.crew_performance_employment_needs_review(v_trend_result,v_trend_employment);
    trend:=trend||jsonb_build_array(jsonb_build_object(
      'period_start',v_trend_result.period_start,
      'score',case when v_trend_pending then null else v_trend_result.total_score end,
      'status',case when v_trend_pending then 'review_required' else v_trend_result.status end));
  end loop;
  return jsonb_build_object('period_start',date_trunc('month',p_period)::date,
    'status',case when v_pending then 'review_required' else result.status end,
    'score',case when v_pending then null when scored_components>0 then result.current_score else null end,
    'current_score',case when v_pending then null else result.current_score end,
    'total_score',case when v_pending then null else result.total_score end,
    'score_state',case when v_pending then 'unavailable' when scored_components>0 then 'partial' else 'unavailable' end,
    'scored_components',scored_components,'pending_components',5-scored_components,
    'pending_component_names',pending_names,'total_components',5,
    'calculation_version','performance-v2','breakdown',safe_components,
    'trend',trend,'updated_at',result.computed_at);
end $$;
revoke all on function public.crew_performance_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_performance_mobile(text,date) to anon,authenticated;
