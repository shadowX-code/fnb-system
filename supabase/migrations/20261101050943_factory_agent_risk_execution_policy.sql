-- Only administrative review of existing attested evidence may skip a second human gate.
create function feedx_integrations.factory_execution_policy(p_action text,p_source jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare policy text; reason text; eligible boolean:=false; attested boolean:=false; prior_action text;
begin
 select case when not requires_confirmation then 'autonomous' when key in ('receiving.verify','production.verify','product_stock_check.approve','raw_stock_check.approve') then 'conditional' else 'human_approval' end into strict policy
 from feedx_integrations.factory_actions where key=p_action;
 if policy='autonomous' then eligible:=true;reason:='Administrative intent; canonical transition and source checks still apply.';
 elsif policy='human_approval' then reason:='This operation records physical work, measurements, counts or an independent physical inspection. An authorized human must attest the exact evidence.';
 else
  prior_action:=case p_action when 'receiving.verify' then 'receiving.complete' when 'production.verify' then 'production.complete' when 'product_stock_check.approve' then 'product_stock_check.submit' else 'raw_stock_check.submit' end;
  attested:=nullif(p_source->>case when p_action like '%stock_check.approve' then 'submitted_by' else 'completed_by' end,'') is not null;
  attested:=attested or exists(select 1 from feedx_integrations.factory_action_requests r where r.status='completed' and r.action=prior_action and r.confirmed_by is not null and r.receipt->>'target_id'=p_source->>'id' and r.receipt->>'after_version'=feedx_integrations.factory_action_version(p_source));
  if p_action like '%stock_check.approve' then
   eligible:=attested and p_source->>'status'='submitted' and jsonb_array_length(coalesce(p_source->case p_action when 'product_stock_check.approve' then 'factory_product_stock_check_items' else 'factory_raw_material_stock_check_items' end,'[]'))>0
    and not exists(select 1 from jsonb_array_elements(p_source->case p_action when 'product_stock_check.approve' then 'factory_product_stock_check_items' else 'factory_raw_material_stock_check_items' end) item where (item->>'variance_qty')::numeric is distinct from 0 or coalesce(item->>'count_status','counted')<>'counted');
   reason:='Automatic independent approval requires an attested submitted count with every item counted and zero variance. Adjustments or missing attestation require human review.';
  else
   eligible:=attested and p_source->>'status'='completed' and p_source->>'verification_status'='awaiting_verification';
   reason:='Automatic independent record verification requires completed, human-attested evidence awaiting verification. Missing attestation requires human review.';
  end if;
 end if;
 return jsonb_build_object('execution_policy',policy,'eligible_without_confirmation',coalesce(eligible,false),'execution_reason',reason);
end $$;
revoke all on function feedx_integrations.factory_execution_policy(text,jsonb) from public,anon,authenticated;

-- Retain the existing fixed dispatcher, grants, locks, source validation and SOD guard.
do $$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('public.factory_agent_execute_action(text,uuid,text,uuid,text,jsonb)'::regprocedure);
 if md5(definition)<>'aa403b19cc8b98f75edfb9736ef464d7' then raise exception 'Dispatcher authority drift';end if;
 old:=' if req.request_id is null then';
 if position(old in definition)=0 then raise exception 'Dispatcher preimage changed';end if;
 definition:=replace(definition,old,E' a.requires_confirmation:=a.requires_confirmation and not coalesce((feedx_integrations.factory_execution_policy(p_action,before_value)->>''eligible_without_confirmation'')::boolean,false);\n'||old);
 definition:=replace(definition,'''message'',''An authorized human must review this exact action and confirm existing physical evidence in AI Integrations. Nothing has been executed.''','''message'',feedx_integrations.factory_execution_policy(p_action,before_value)->>''execution_reason'',''execution_policy'',feedx_integrations.factory_execution_policy(p_action,before_value)->>''execution_policy''');
 execute definition;
 definition:=pg_get_functiondef('public.factory_agent_action_context(text,text,uuid)'::regprocedure);
 definition:=replace(definition,'''requires_human_confirmation'',a.requires_confirmation', '''requires_human_confirmation'',not coalesce((feedx_integrations.factory_execution_policy(p_action,value)->>''eligible_without_confirmation'')::boolean,false)');
 definition:=replace(definition,'''instruction'',case', '''execution'',feedx_integrations.factory_execution_policy(p_action,value),''instruction'',case');
 execute definition;
 definition:=pg_get_functiondef('feedx_integrations.factory_action_catalog(uuid)'::regprocedure);
 definition:=replace(definition,'''execution_requirement'',case','''execution_policy'',feedx_integrations.factory_execution_policy(a.key)->>''execution_policy'',''execution_reason'',feedx_integrations.factory_execution_policy(a.key)->>''execution_reason'',''execution_requirement'',case');
 execute definition;
end $$;
notify pgrst,'reload schema';
-- Only pending decisions/execution exceptions belong in the request queue. Receipts stay in audit.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.external_agents_factory_action_requests(uuid)'::regprocedure);
 if position('where identity_id=p_identity_id order by requested_at' in definition)=0 then raise exception 'Request projection drift';end if;
 definition:=replace(definition,'where identity_id=p_identity_id order by requested_at','where identity_id=p_identity_id and status<>''completed'' order by requested_at');
 definition:=replace(definition,'''requires_confirmation'',a.requires_confirmation,','''requires_confirmation'',a.requires_confirmation,''execution_policy'',feedx_integrations.factory_execution_policy(a.key)->>''execution_policy'',''execution_reason'',feedx_integrations.factory_execution_policy(a.key)->>''execution_reason'',');
 -- Exact retry metadata is already visible only to the matching business authority.
 definition:=replace(definition,'evidence_reference,receipt','evidence_reference,receipt,expected_version');
 definition:=replace(definition,$old$to_jsonb(r)-'input'-'target_id'-'evidence_reference'-'receipt'$old$,$new$to_jsonb(r)-'input'-'target_id'-'evidence_reference'-'receipt'-'expected_version'$new$);
 execute definition;
end $$;
notify pgrst,'reload schema';
