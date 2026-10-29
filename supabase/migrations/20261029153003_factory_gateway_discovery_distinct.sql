-- Overlapping resource grants share one executable transport.
do $$declare d text;begin
 select pg_get_functiondef('feedx_integrations.discovery(uuid)'::regprocedure) into d;
 if position('select mcp_tool from granted where' in d)=0 then raise exception 'Discovery drifted';end if;
 execute replace(d,'select mcp_tool from granted where','select distinct mcp_tool from granted where');
end $$;
