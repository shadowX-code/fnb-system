-- Remove transport adapters only; shared canonical read authorities and resource grants survive.
do $retire$
declare d text;obsolete text[]:=array['get_mesti_daily_status','list_mesti_exceptions','list_pending_verifications','get_mesti_evidence_details','get_mesti_requirement_schedule'];
begin
 -- There are no remaining partial legacy role grants in Staging. Fail closed on drift.
 if exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id join feedx_integrations.capabilities c on c.permission_code=p.code where c.tool_id=any(obsolete)) then raise exception 'Legacy grants remain; explicit retirement audit required';end if;
 delete from feedx_integrations.capabilities where tool_id=any(obsolete);
 delete from public.permissions where code=any(array['factory_mesti_inspection_status.view','factory_mesti_inspection_exceptions.view','factory_mesti_inspection_verifications.view','factory_mesti_inspection_evidence.view','factory_mesti_inspection_schedule.view']);
 update feedx_integrations.adapters set tools='[{"name":"query_factory_resources","read_only":true}]'::jsonb where key='factory_mesti';
 select pg_get_functiondef('feedx_integrations.discovery(uuid)'::regprocedure) into d;
 if position('query_mesti_resources' in d)=0 then raise exception 'Discovery drifted';end if;
 d:=regexp_replace(d,'select mcp_tool from granted[\s\S]*?\),operations as','select mcp_tool from granted where mcp_tool=''query_factory_resources''
 ),operations as');
 if position('query_mesti_resources' in d)>0 then raise exception 'Discovery replacement failed';end if;
 execute d;
end $retire$;
drop function public.factory_mesti_inspection(text,text,date,date,text,text);
drop function public.factory_mesti_resource_query(text,jsonb);
