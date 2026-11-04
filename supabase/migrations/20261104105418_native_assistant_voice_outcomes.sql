do $migration$
declare definition text;
 old_steps text := 'step in (''complete'',''interrupted'',''unavailable'')';
 old_outcome text := 'when step=''interrupted'' then ''voice_interrupted'' when message is null';
begin
 definition:=pg_get_functiondef('public.native_assistant_voice_history(uuid,jsonb)'::regprocedure);
 if position(old_steps in definition)=0 or position(old_outcome in definition)=0 then
  raise exception 'Native Assistant voice outcome contract changed';
 end if;
 definition:=replace(definition,old_steps,'step in (''complete'',''interrupted'',''unavailable'',''unfinished'',''failed'')');
 definition:=replace(definition,'and item.error_code=''voice_unfinished''','and item.error_code=''voice_unfinished'' and item.finished_at is null');
 definition:=replace(definition,'then ''completed'' else ''cancelled'' end','then ''completed'' when step=''failed'' then ''failed'' else ''cancelled'' end');
 execute replace(definition,old_outcome,'when step=''interrupted'' then ''voice_interrupted'' when step=''unfinished'' then ''voice_unfinished'' when step=''failed'' then ''voice_failed'' when message is null');
end $migration$;
