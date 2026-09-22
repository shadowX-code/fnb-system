-- The Performance authority already records mutable current_score against the
-- full 100-point denominator. Expose that read-only projection to Crew Mobile
-- so partial evidence is never presented as a finalized outcome.
create or replace function public.crew_performance_mobile(p_token text,p_period date default current_date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare employee uuid; result_id uuid; result public.crew_performance_results%rowtype; trend jsonb; safe_components jsonb; scored_components integer:=0; total_components constant integer:=5; score_state text;
begin
 employee:=public.crew_session_employee(p_token);
 result_id:=public.crew_refresh_performance(employee,p_period);
 select * into result from public.crew_performance_results where id=result_id;
 safe_components:=jsonb_build_object('attendance',(result.components->'attendance')-('manager_note'::text),'service',(result.components->'service')-('manager_note'::text),'customer',(result.components->'customer')-('moderation_reason'::text),'knowledge',result.components->'knowledge','conduct',(result.components->'conduct')-('manager_note'::text));
 select count(*)::integer into scored_components
 from jsonb_each(safe_components) component
 where jsonb_typeof(component.value->'score')='number';
 score_state:=case
   when result.status='finalized' then 'finalized'
   when result.total_score is not null then 'complete'
   when scored_components>0 then 'partial'
   else 'unavailable'
 end;
 select coalesce(jsonb_agg(jsonb_build_object('period_start',period_start,'score',total_score,'status',status) order by period_start),'[]'::jsonb)
 into trend
 from (select period_start,total_score,status from public.crew_performance_results where employee_id=employee order by period_start desc limit 6) x;
 return jsonb_build_object(
   'period_start',result.period_start,
   'status',result.status,
   'score',case when score_state='partial' then result.current_score when score_state in ('complete','finalized') then result.total_score else null end,
   'current_score',result.current_score,
   'total_score',result.total_score,
   'score_state',score_state,
   'scored_components',scored_components,
   'pending_components',total_components-scored_components,
   'total_components',total_components,
   'calculation_version',result.calculation_version,
   'breakdown',safe_components,
   'trend',trend,
   'updated_at',result.computed_at
 );
end; $$;
revoke all on function public.crew_performance_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_performance_mobile(text,date) to anon,authenticated;
