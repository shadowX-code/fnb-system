CREATE OR REPLACE FUNCTION public.external_agents_confirm_factory_action(p_identity_id uuid, p_request_id uuid, p_evidence_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare req feedx_integrations.factory_action_requests%rowtype; a feedx_integrations.factory_actions%rowtype; employee_id_value uuid; source_value jsonb;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 employee_id_value:=public.factory_current_active_employee_id();
 select * into strict req from feedx_integrations.factory_action_requests where identity_id=p_identity_id and request_id=p_request_id for update;
 select * into strict a from feedx_integrations.factory_actions where key=req.action;
 if not a.requires_confirmation or not feedx_integrations.factory_human_action_can(a.key) then raise exception using errcode='42501',message='The corresponding Factory business authority is required.';end if;
 if req.status in ('confirmed','completed') then
  if req.confirmed_by=employee_id_value and req.evidence_reference is not distinct from btrim(p_evidence_reference) then
   return jsonb_build_object('status',req.status,'request_id',p_request_id,'confirmed_at',req.confirmed_at,'replayed',true);
  end if;
  raise exception using errcode='40001',message='This intent already has a different confirmation. Refresh requests.';
 end if;
 if req.status<>'awaiting_confirmation' then raise exception using errcode='55000',message='This action is no longer awaiting confirmation.';end if;
 if nullif(btrim(p_evidence_reference),'') is null or length(p_evidence_reference)>1000 then raise exception using errcode='22023',message='Reference to observed physical or approved business evidence is required.';end if;
 source_value:=feedx_integrations.factory_action_state(req.action,req.target_id,true);
 if feedx_integrations.factory_action_version(source_value) is distinct from req.expected_version then raise exception using errcode='40001',message='Factory evidence changed. Ask the Agent to submit a new intent.';end if;
 if req.action='receiving.verify' and employee_id_value::text in (source_value->>'created_by',source_value->>'completed_by',source_value->>'recorded_by',source_value->>'submitted_by',source_value->>'operator_id') then
 raise exception using errcode='42501',message='An independent reviewer must confirm this action.';end if;
 update feedx_integrations.factory_action_requests set status='confirmed',confirmed_by=employee_id_value,confirmed_at=clock_timestamp(),evidence_reference=btrim(p_evidence_reference)
 where identity_id=p_identity_id and request_id=p_request_id;
 insert into public.audit_logs(action,module,user_id,user_name,description,metadata) values('external_agent_factory_action_confirmed','factory',auth.uid(),'Authorized Factory reviewer',
 'Exact Agent action confirmed against existing evidence; execution remains pending.',jsonb_build_object('identity_id',p_identity_id,'request_id',p_request_id,'action',req.action,'payload_hash',req.payload_hash,'evidence_reference',btrim(p_evidence_reference)));
 return jsonb_build_object('status','confirmed','request_id',p_request_id);
end $function$
;
