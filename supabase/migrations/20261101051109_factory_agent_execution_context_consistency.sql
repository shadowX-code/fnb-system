do $$
declare definition text; old text:=$old$'instruction',case when a.requires_confirmation then 'Submit the exact intent. An authorized human must confirm existing physical evidence before execution.' else 'Explicit action grant permits autonomous execution.' end$old$;
begin
 definition:=pg_get_functiondef('public.factory_agent_action_context(text,text,uuid)'::regprocedure);
 if position(old in definition)=0 then raise exception 'Action context drift';end if;
 execute replace(definition,old,$new$'instruction',feedx_integrations.factory_execution_policy(p_action,value)->>'execution_reason'$new$);
end $$;
notify pgrst,'reload schema';
