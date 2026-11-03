-- Keep the 100,000-token/day limit. Release only measured completed reservations.
-- Unknown, failed and cancelled provider usage stays conservatively reserved.
do $migration$
declare definition text; old_expression text := 'select sum(reserved_tokens) from feedx_integrations.native_assistant_requests';
begin
 definition:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure);
 if position(old_expression in definition)=0 then raise exception 'Native Assistant budget contract changed; review before applying'; end if;
 execute replace(definition,old_expression,'select sum(case when state=''completed'' and input_tokens is not null and output_tokens is not null then input_tokens+output_tokens else reserved_tokens end) from feedx_integrations.native_assistant_requests');
end $migration$;
