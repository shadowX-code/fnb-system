-- Cleaning alone uses the existing Complete/Verify grants as execution authority.
-- No role grants, operational records or historical receipts are rewritten.
do $$ begin
 if (select count(*) from feedx_integrations.factory_actions where key in ('area_cleaning.complete','area_cleaning.verify','equipment_cleaning.complete','equipment_cleaning.verify'))<>4 then raise exception 'Cleaning action catalog incomplete';end if;
end $$;
update feedx_integrations.factory_actions set requires_confirmation=false where key in ('area_cleaning.complete','area_cleaning.verify','equipment_cleaning.complete','equipment_cleaning.verify');
update feedx_integrations.capabilities set requires_human_approval=false where tool_id in ('area_cleaning.complete','area_cleaning.verify','equipment_cleaning.complete','equipment_cleaning.verify');
do $repair$
declare definition text;
begin
 definition:=pg_get_functiondef('public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure);
 if md5(definition)<>'20b0d3f828ecc78f333a0a3d95ca2d56' then raise exception 'Dispatcher changed; reconcile before release';end if;
 execute replace(definition,$old$if a.action in ('verify','approve') and exists($old$,$new$if p_action not in ('area_cleaning.verify','equipment_cleaning.verify') and a.action in ('verify','approve') and exists($new$);
 definition:=pg_get_functiondef('public.factory_mesti_cleaning_task_action(uuid,date,text,jsonb)'::regprocedure);
 if md5(definition)<>'62bdd7c88be5d277a420dff429b710a1' then raise exception 'Cleaning task authority changed';end if;
 definition:=replace(definition,' and feedx_integrations.factory_cleaning_independent_verifier(v_row.id,v_actor.id)','');
 definition:=replace(definition,$old$      elsif p_action='verify' and not feedx_integrations.factory_cleaning_independent_verifier(v_row.id,v_actor.id) then v_reason := 'Independent verifier required';$old$,'');
 if position('factory_cleaning_independent_verifier' in definition)>0 then raise exception 'Unreconciled Cleaning self-review dependency';end if;
 execute definition;
 definition:=pg_get_functiondef('feedx_integrations.factory_execution_policy(text,jsonb)'::regprocedure);
 if md5(definition)<>'b72a74d06a09756010a50db8ee39e3f4' then raise exception 'Execution policy changed';end if;
 execute replace(definition,$old$reason:='Administrative intent; canonical transition and source checks still apply.';$old$,$new$reason:=case when p_action in ('area_cleaning.complete','area_cleaning.verify','equipment_cleaning.complete','equipment_cleaning.verify') then 'Direct execution with the corresponding Cleaning permission. Complete before Verify; record only genuine work and inspection evidence. The same actor may perform both actions when both are granted.' else 'Administrative intent; canonical transition and source checks still apply.' end;$new$);
end $repair$;
-- This private, stateless helper no longer owns an active rule. Restrict fails on any unexpected dependency.
drop function feedx_integrations.factory_cleaning_independent_verifier(uuid,uuid);
notify pgrst,'reload schema';
