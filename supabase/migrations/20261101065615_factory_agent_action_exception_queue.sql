-- Read projection only: saved intents, approvals, receipts and execution remain unchanged.
-- Existing can_manage binds Auth to this identity's editable role and delegable grants.
-- Existing factory_human_action_can still gates every target/input/evidence/receipt field.
create or replace function public.external_agents_factory_action_requests(p_identity_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; a feedx_integrations.factory_actions%rowtype; item jsonb; output jsonb:='[]';
 source_value jsonb; policy jsonb; inspect boolean; reason text; reason_code text; state text; next_action text;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 -- Open work cannot be displaced by a burst of completed operations. History stays bounded.
 for r in with history as (
  select * from feedx_integrations.factory_action_requests where identity_id=p_identity_id and status='completed' order by requested_at desc,request_id limit 50
 ) select * from feedx_integrations.factory_action_requests where identity_id=p_identity_id and status<>'completed'
 union all select * from history order by requested_at desc,request_id
 loop
  select * into strict a from feedx_integrations.factory_actions where key=r.action;
  inspect:=feedx_integrations.factory_human_action_can(a.key);
  source_value:=null;reason:=null;reason_code:=null;next_action:=null;
  policy:=feedx_integrations.factory_execution_policy(a.key);
  if r.status='completed' then state:='completed';
  elsif not a.requires_confirmation then
   -- An awaiting/confirmed intent under a now-direct policy is historical, not new work.
   state:='legacy_pending';reason_code:='policy_now_direct';
   reason:='Saved under the previous confirmation policy. This action now executes directly when authorized.';
   next_action:='If the work is still needed, review current Factory evidence and give the Agent a new instruction. Do not replay this old intent blindly.';
  elsif r.status='confirmed' and (r.confirmed_at is null or r.confirmed_at < clock_timestamp()-interval '30 minutes') then
   state:='expired';reason_code:='confirmation_expired';reason:='The approval window has expired.';
   next_action:='If still needed, ask the Agent to read current evidence and submit a new intent.';
  else
   state:=case when r.status='confirmed' then 'awaiting_execution' else 'pending_approval' end;
   if not inspect then
    state:='needs_resolution';reason_code:='review_access_required';reason:='Your corresponding Factory permission is required to inspect this request.';
    next_action:='Ask an authorized Factory reviewer to inspect the request.';
   else
    begin
     source_value:=feedx_integrations.factory_action_state(a.key,r.target_id);
     if a.target_required and (source_value is null or source_value->>'id' is null) then
      reason_code:='source_unavailable';reason:='The Factory record is no longer available.';
     elsif a.target_required and feedx_integrations.factory_action_version(source_value) is distinct from r.expected_version then
      reason_code:='source_changed';reason:='Factory evidence changed after this request was saved.';
     elsif a.key in ('area_cleaning.verify','equipment_cleaning.verify') then
      reason:=feedx_integrations.cleaning_verify_requirement(source_value->>'status',r.input->>'result','Cleaning',false);
      if reason is not null then reason_code:='cleaning_lifecycle';end if;
     end if;
     policy:=feedx_integrations.factory_execution_policy(a.key,source_value);
    exception when others then
     reason_code:='source_unavailable';reason:='Current Factory evidence could not be read. Inspect the record before continuing.';
    end;
    if reason is not null then
     state:='needs_resolution';next_action:='Review the current Factory record, resolve the evidence requirement, then ask the Agent to submit a new intent.';
    elsif state='pending_approval' and coalesce((policy->>'eligible_without_confirmation')::boolean,false) then
     state:='awaiting_execution';reason_code:='eligible_continuation';reason:='Current canonical evidence permits execution without another approval.';
     next_action:='Continue this saved request with the Agent. Access and evidence are revalidated on execution.';
    elsif state='awaiting_execution' then
     reason:='Human approval is recorded; the Agent has not executed this request.';
     next_action:='Continue this approved request with the Agent before its approval expires. Approval does not execute the action.';
    else
     reason:=policy->>'execution_reason';next_action:='Review the exact intent and genuine evidence before approving. Approval authorizes Agent execution; it does not execute the action.';
    end if;
   end if;
  end if;
  item:=jsonb_build_object('request_id',r.request_id,'identity_id',r.identity_id,'action',r.action,'status',r.status,
   'requested_at',r.requested_at,'confirmed_at',r.confirmed_at,'label',a.label,'requires_confirmation',a.requires_confirmation,
   'execution_policy',policy->>'execution_policy','queue_state',state,'reason_code',reason_code,'resolution_reason',reason,'next_action',next_action,
   'can_confirm',inspect and state='pending_approval','can_continue',inspect and state='awaiting_execution');
  if inspect then item:=item||jsonb_build_object('target_id',r.target_id,'input',r.input,'expected_version',r.expected_version,
   'confirmed_by',r.confirmed_by,'evidence_reference',r.evidence_reference,'receipt',r.receipt);end if;
  output:=output||jsonb_build_array(item);
 end loop;
 return output;
end $$;
revoke all on function public.external_agents_factory_action_requests(uuid) from public,anon;
grant execute on function public.external_agents_factory_action_requests(uuid) to authenticated;
notify pgrst,'reload schema';
