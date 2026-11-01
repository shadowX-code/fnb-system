-- Historical Cleaning requests keep their original evidence; only current eligibility changes.
do $repair$
declare definition text;
begin
 definition:=pg_get_functiondef('public.external_agents_factory_action_requests(uuid)'::regprocedure);
 if md5(definition)<>'8475aa33a0195d8d949e1a23ae47582b' then raise exception 'Action request projection changed';end if;
 execute replace(definition,$old$'can_confirm',feedx_integrations.factory_human_action_can(a.key)$old$,$new$'can_confirm',a.requires_confirmation and feedx_integrations.factory_human_action_can(a.key)$new$);
end $repair$;
notify pgrst,'reload schema';
