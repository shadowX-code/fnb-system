-- Preserve the pre-existing geographic evidence shape/fingerprint on unrelated
-- normal shifts. The paid-holiday resolver owns geography; no second parser.
do $$ declare definition text; before_text text; after_text text; begin
  definition:=pg_get_functiondef('public.payroll_paid_holiday_resolve(uuid,uuid,date)'::regprocedure);
  before_text:='jsonb_build_object(''status'',''policy_required'',''year'',extract(year from p_date)::integer)';
  after_text:='jsonb_build_object(''status'',''policy_required'',''year'',extract(year from p_date)::integer,
    ''outlet_state_version_id'',v_state_id,''outlet_state_code'',v_state)';
  if strpos(definition,before_text)=0 then raise exception 'Paid holiday resolver anchor changed'; end if;
  execute replace(definition,before_text,after_text);

  definition:=pg_get_functiondef('public.payroll_time_evidence_base(uuid,date)'::regprocedure);
  before_text:='  if v_holiday.id is not null or v_paid_holiday->>''status''=''geography_required''';
  after_text:='  if v_paid_holiday->>''outlet_state_code'' is not null
    and (v_holiday.id is null or v_holiday.scope=''state'') then
    v_payload:=v_payload||jsonb_build_object(''outlet_state_version_id'',v_paid_holiday->''outlet_state_version_id'',
      ''outlet_state_code'',v_paid_holiday->''outlet_state_code'');
  end if;
  if v_holiday.id is not null or v_paid_holiday->>''status''=''geography_required''';
  if strpos(definition,before_text)=0 then raise exception 'Time geography compatibility anchor changed'; end if;
  execute replace(definition,before_text,after_text);

  definition:=pg_get_functiondef('public.payroll_holiday_history_read(uuid)'::regprocedure);
  before_text:='  return jsonb_build_object(''events'',v_rows,''editable'',v_editable);';
  after_text:='  v_editable:=v_editable and not exists(select 1 from public.payroll_holiday_calendar_versions c,
    lateral jsonb_array_elements(c.entries) e where c.status=''published'' and (e->>''holiday_id'')::uuid=p_holiday_id);
  return jsonb_build_object(''events'',v_rows,''editable'',v_editable);';
  if strpos(definition,before_text)=0 then raise exception 'Holiday history read anchor changed'; end if;
  execute replace(definition,before_text,after_text);
end $$;
