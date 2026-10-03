-- Rollback-only Staging contract for dated float readback and general settings isolation.
begin;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','266912cf-0e84-4074-82b5-0fc483080741','role','authenticated')::text,true);
do $$
declare
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_today date := timezone('Asia/Kuala_Lumpur',now())::date;
  v_original_float numeric;
  v_initial_history integer;
  v_after_float_history integer;
  v_settings jsonb;
  v_context jsonb;
begin
  v_context:=public.crew_cash_admin_context(v_outlet);
  v_original_float:=(v_context#>>'{settings,effective_floating_cash}')::numeric;
  v_initial_history:=jsonb_array_length(v_context->'float_history');
  perform public.crew_cash_save_settings(v_outlet,jsonb_build_object(
    'floating_cash',v_original_float+50,'effective_date',v_today+1,'reason','Rollback-only future float readback QA'));
  v_after_float_history:=jsonb_array_length(public.crew_cash_admin_context(v_outlet)->'float_history');
  if v_after_float_history<>v_initial_history+1 then raise exception 'Floating Cash adjustment was not recorded'; end if;
  perform public.crew_cash_save_settings(v_outlet,jsonb_build_object(
    'variance_tolerance',7.50,
    'required_position_ids',jsonb_build_array('3964e387-29cc-4ce4-957b-fbedd6d985c8'),
    'closing_deadline','22:30',
    'require_receiver_confirmation',false,
    'require_manager_review_over_tolerance',false));
  v_context:=public.crew_cash_admin_context(v_outlet);
  v_settings:=v_context->'settings';
  if (v_settings->>'effective_floating_cash')::numeric<>v_original_float
    or (v_settings->>'floating_cash')::numeric<>v_original_float+50
    or (v_settings->>'variance_tolerance')::numeric<>7.50
    or v_settings->'required_position_ids'<>jsonb_build_array('3964e387-29cc-4ce4-957b-fbedd6d985c8')
    or v_settings->>'closing_deadline'<>'22:30:00'
    or (v_settings->>'require_receiver_confirmation')::boolean<>false
    or (v_settings->>'require_manager_review_over_tolerance')::boolean<>false
    or jsonb_array_length(v_context->'float_history')<>v_after_float_history
  then raise exception 'Cash settings readback or float/history isolation failed: %',v_settings; end if;
end;
$$;
select jsonb_build_object(
  'general_settings',public.crew_cash_admin_context('e804c48d-6343-4bf8-99d7-9893c473948f'::uuid)->'settings',
  'history_count',jsonb_array_length(public.crew_cash_admin_context('e804c48d-6343-4bf8-99d7-9893c473948f'::uuid)->'float_history')
) as rollback_only_result;
rollback;
