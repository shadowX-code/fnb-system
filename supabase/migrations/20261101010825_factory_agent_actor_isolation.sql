-- Machine-token execution must never borrow a concurrently present human JWT actor.
-- Fixed signatures and exact preimages prevent rewriting unrelated/concurrently changed authority.
do $repair$
declare r record; definition text;
begin
 for r in select * from (values ('feedx_integrations.fa_approve_raw_material_stock_check(uuid,uuid,uuid)','c2935bd83416a9696cc37b38140c97fa'),('feedx_integrations.fa_cancel_job_order(uuid,uuid)','26f4f5e034f51b3bb2ef2150efefa28a'),('feedx_integrations.fa_cancel_raw_material_receiving(uuid,uuid)','db2e3c479150e62253525abe2eea1d6d'),('feedx_integrations.fa_complete_production_with_raw_batch_allocations_impl_050(uuid,uuid,jsonb)','59168b35fbccb2e4b5ccfacecf79bfb0'),('feedx_integrations.fa_current_active_employee_id(uuid)','ab622bea20ce5ea2847e19c3cead921f'),('feedx_integrations.fa_current_active_employee_name(uuid)','52ea5c9c74f1e68f7b9da09ca0ab61da'),('feedx_integrations.fa_mesti_current_employee(uuid)','ffa1551765c81df8fc183c2c5ed49cca'),('feedx_integrations.fa_release_job_order(uuid,uuid)','23b4dcd30f4410d1f2dd636482a64c9f'),('feedx_integrations.fa_save_job_order_structure(uuid,uuid,uuid,numeric,text,date,date,text,text,text,numeric,numeric)','abf1ca12d3bad26174ece8ff09f90e9f'),('feedx_integrations.fa_save_raw_material_receiving(uuid,uuid,uuid,uuid,text,date,text,jsonb,boolean)','14928949afa73857a6bef8510cd80c37'),('feedx_integrations.fa_save_raw_material_receiving_impl_supplier_material_link(uuid,uuid,uuid,uuid,text,date,text,jsonb,boolean)','955aaee6352221b8e59ad3f3dee1b3ce'),('feedx_integrations.fa_verify_raw_material_receiving(uuid,uuid)','d29ba81d79e0d4a96aa9de535b9230be'))v(signature,expected_hash) loop
  definition:=pg_get_functiondef(r.signature::regprocedure);
  if md5(definition)<>r.expected_hash then raise exception 'Factory actor authority drift: %',r.signature;end if;
  execute replace(definition,'auth.uid()','(case when p_machine_identity_id is null then auth.uid() else null::uuid end)');
 end loop;
end $repair$;

create or replace function public.external_agents_confirm_factory_action(p_identity_id uuid,p_request_id uuid,p_evidence_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req feedx_integrations.factory_action_requests%rowtype; a feedx_integrations.factory_actions%rowtype; employee_id_value uuid; source_value jsonb;
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 employee_id_value:=public.factory_current_active_employee_id();
 select * into strict req from feedx_integrations.factory_action_requests where identity_id=p_identity_id and request_id=p_request_id for update;
 select * into strict a from feedx_integrations.factory_actions where key=req.action;
 if not a.requires_confirmation or not feedx_integrations.factory_human_action_can(a.key) then raise exception using errcode='42501',message='The corresponding Factory business authority is required.';end if;
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
end $$;

create or replace function public.external_agents_factory_action_requests(p_identity_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Agent management authority is required.';end if;
 return (select coalesce(jsonb_agg((case when feedx_integrations.factory_human_action_can(a.key) then to_jsonb(r) else to_jsonb(r)-'input'-'target_id'-'evidence_reference'-'receipt' end)||jsonb_build_object('label',a.label,'requires_confirmation',a.requires_confirmation,
 'can_confirm',feedx_integrations.factory_human_action_can(a.key)) order by r.requested_at desc),'[]')
 from (select request_id,identity_id,action,target_id,input,status,requested_at,confirmed_by,confirmed_at,evidence_reference,receipt
 from feedx_integrations.factory_action_requests where identity_id=p_identity_id order by requested_at desc limit 50)r
 join feedx_integrations.factory_actions a on a.key=r.action);
end $$;

notify pgrst,'reload schema';
