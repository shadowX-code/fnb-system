-- One canonical Cleaning verification validator, shared by business writes and Agent preflight.
create function feedx_integrations.cleaning_verify_requirement(p_status text,p_result text,p_kind text default 'Cleaning',p_raise boolean default true)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare reason text;code text;
begin
 if p_status is distinct from 'completed' then reason:='Only completed '||p_kind||' occurrences can be verified.';code:='55000';
 elsif lower(coalesce(p_result,'verified')) not in ('verified','unsatisfactory') then reason:='Unsupported verification result.';code:='22023';end if;
 if reason is not null and p_raise then raise exception using errcode=code,message=reason;end if;
 return reason;
end $$;
revoke all on function feedx_integrations.cleaning_verify_requirement(text,text,text,boolean) from public,anon,authenticated;
do $repair$
declare definition text;r record;old text;
begin
 for r in select * from (values
 ('feedx_integrations.fa_mesti_verify_cleaning_occurrence(uuid,uuid,text,text)','2ef34420c692b092020c189190c20d01','Cleaning'),
 ('feedx_integrations.fa_mesti_verify_equipment_cleaning_occurrence(uuid,uuid,text,text)','e5e81275b19729797616f4eb9c05c05a','Equipment Cleaning')
 )v(signature,fingerprint,kind) loop
 definition:=pg_get_functiondef(r.signature::regprocedure);
 if md5(definition)<>r.fingerprint then raise exception 'Cleaning authority drift: %',r.signature;end if;
 old:=format($old$if v_occurrence.status <> 'completed' then raise exception using errcode = '55000', message = 'Only completed %s occurrences can be verified.'; end if;
  if v_result not in ('verified', 'unsatisfactory') then raise exception using errcode = '22023', message = 'Unsupported verification result.'; end if;$old$,r.kind);
 if position(old in definition)=0 then raise exception 'Verification validator preimage changed';end if;
 execute replace(definition,old,format('perform feedx_integrations.cleaning_verify_requirement(v_occurrence.status,p_result,%L);',r.kind));
 end loop;
 definition:=pg_get_functiondef('public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure);
 if md5(definition)<>'b28637f155a6a0e1dfbd86f0ce4f308b' then raise exception 'Dispatcher drift';end if;
 execute replace(definition,' if req.request_id is null then',E' if p_action in (''area_cleaning.verify'',''equipment_cleaning.verify'') then\n perform feedx_integrations.cleaning_verify_requirement(before_value->>''status'',p_input->>''result'',case when p_action=''area_cleaning.verify'' then ''Cleaning'' else ''Equipment Cleaning'' end);end if;\n if req.request_id is null then');
 definition:=pg_get_functiondef('public.external_agents_confirm_factory_action(uuid,uuid,text)'::regprocedure);
 if md5(definition)<>'e6a6689bdea39ebe4246cfa468e6259e' then raise exception 'Confirmation authority drift';end if;
 execute replace(definition,' update feedx_integrations.factory_action_requests set status=',E' if req.action in (''area_cleaning.verify'',''equipment_cleaning.verify'') then\n perform feedx_integrations.cleaning_verify_requirement(source_value->>''status'',req.input->>''result'',case when req.action=''area_cleaning.verify'' then ''Cleaning'' else ''Equipment Cleaning'' end);end if;\n update feedx_integrations.factory_action_requests set status=');
 definition:=pg_get_functiondef('public.factory_agent_action_context(text,text,uuid)'::regprocedure);
 if md5(definition)<>'e37200aa85cc1e76f6e4e654fdbcd41f' then raise exception 'Action context drift';end if;
 execute replace(definition,'''instruction'',feedx_integrations', '''lifecycle_requirement'',case when p_action in (''area_cleaning.verify'',''equipment_cleaning.verify'') then feedx_integrations.cleaning_verify_requirement(value->>''status'',null,case when p_action=''area_cleaning.verify'' then ''Cleaning'' else ''Equipment Cleaning'' end,false) end,''instruction'',feedx_integrations');
 definition:=pg_get_functiondef('public.external_agents_factory_action_requests(uuid)'::regprocedure);
 if md5(definition)<>'0d773e9583fa9b1b8e230f46e40dafcc' then raise exception 'Request projection drift';end if;
 definition:=replace(definition,'''can_confirm'',feedx_integrations.factory_human_action_can(a.key)', '''can_confirm'',feedx_integrations.factory_human_action_can(a.key) and (a.key not in (''area_cleaning.verify'',''equipment_cleaning.verify'') or feedx_integrations.cleaning_verify_requirement(feedx_integrations.factory_action_state(a.key,r.target_id)->>''status'',r.input->>''result'',''Cleaning'',false) is null),''lifecycle_requirement'',case when feedx_integrations.factory_human_action_can(a.key) and a.key in (''area_cleaning.verify'',''equipment_cleaning.verify'') then feedx_integrations.cleaning_verify_requirement(feedx_integrations.factory_action_state(a.key,r.target_id)->>''status'',r.input->>''result'',''Cleaning'',false) end');
 execute definition;
end $repair$;
notify pgrst,'reload schema';
