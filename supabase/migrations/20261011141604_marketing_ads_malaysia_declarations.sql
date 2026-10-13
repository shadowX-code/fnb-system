-- Exact declarations are part of the canonical configuration fingerprint. No provider mutation.
do $$ declare body text; old_text text; new_text text;begin
 select pg_get_functiondef('public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure) into body;
 old_text:=' -- Duplicate retry returns the original intent';
 new_text:=$patch$
 if p_previous is not null then
  select * into old from marketing_private.ads_changes where id=p_previous;
  if old.id is null or old.organization_id<>p_org or old.brand_id<>p_brand or old.connection_id<>p_connection then raise exception 'Revision scope changed';end if;
  if old.state='reconciling' or old.configuration?'recovery_source' then
   if p_operation<>'create' or old.operation<>'create' or old.provider_state->>'pending' is distinct from 'adset'
    or old.provider_state ?| array['adset_id','creative_id','ad_id'] or not marketing_private.ads_change_current(old) then raise exception 'Only a known partial Ad Set creation may prepare declaration recovery';end if;
   config:=config||jsonb_build_object('recovery_source',coalesce(old.configuration->>'recovery_source',old.id::text));
   if (config-array['adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source']) is distinct from
      (old.configuration-array['media','adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source']) then raise exception 'Recovery may change only advertiser declarations and promoted Page';end if;
  end if;
 end if;
 if config?'recovery_source' and (p_previous is null or not (old.state='reconciling' or old.configuration?'recovery_source')) then raise exception 'Recovery source must be derived from a known partial creation';end if;
 -- Duplicate retry returns the original intent$patch$;
 if position(old_text in body)=0 then raise exception 'Prepare contract changed';end if; body:=replace(body,old_text,new_text);
 old_text:='where k not in (''name'',''objective'',''maximum_budget'',''start_time'',''end_time'',''age_min'',''age_max'',''placements'',''asset_id'',''page_id'',''instagram_id'',''caption'',''headline'',''url''';
 body:=replace(body,old_text,old_text||',''adset_contract_version'',''regional_regulated_categories'',''regional_regulation_identities'',''promoted_object'',''recovery_source''');
 old_text:=' start_at:=(config->>''start_time'')::timestamptz;';
 new_text:=$patch$
 if config->'adset_contract_version' is distinct from '2'::jsonb or config->'regional_regulated_categories' is distinct from '["MALAYSIA_UNIVERSAL"]'::jsonb
  or jsonb_typeof(config->'regional_regulation_identities') is distinct from 'object'
  or (config->'regional_regulation_identities'-array['universal_beneficiary','universal_payer']) is distinct from '{}'::jsonb
  or jsonb_typeof(config#>'{regional_regulation_identities,universal_beneficiary}') is distinct from 'string'
  or jsonb_typeof(config#>'{regional_regulation_identities,universal_payer}') is distinct from 'string'
  or coalesce(config#>>'{regional_regulation_identities,universal_beneficiary}','') !~ '^[0-9]{1,30}$'
  or coalesce(config#>>'{regional_regulation_identities,universal_payer}','') !~ '^[0-9]{1,30}$' then raise exception 'Explicit Meta advertiser and payer identity IDs are required';end if;
 if config->>'objective'='OUTCOME_AWARENESS' then
  if config->'promoted_object' is distinct from jsonb_build_object('page_id',config->>'page_id') then raise exception 'Promoted Page must match the selected brand Page';end if;
 elsif config?'promoted_object' then raise exception 'Promoted object is unsupported for Website Traffic';end if;
 if config?'recovery_source' and p_previous is null then raise exception 'Recovery requires a known source revision';end if;
 start_at:=(config->>'start_time')::timestamptz;$patch$;
 if position(old_text in body)=0 then raise exception 'Schedule contract changed';end if; body:=replace(body,old_text,new_text);
 old_text:='old.state not in (''draft'',''review'',''approved'',''failed'',''stale'')';
 body:=replace(body,old_text,'old.state not in (''draft'',''review'',''approved'',''failed'',''stale'',''reconciling'')');
 old_text:='rev:=old.revision+1;update marketing_private.ads_changes set state=''superseded'',updated_at=now() where id=old.id;';
 new_text:='rev:=old.revision+1;if old.state<>''reconciling'' then update marketing_private.ads_changes set state=''superseded'',updated_at=now() where id=old.id;';
 if position(old_text in body)=0 then raise exception 'Revision contract changed';end if;body:=replace(body,old_text,new_text);
 old_text:='values(old.id,old.revision,''superseded'',actor);';
 body:=replace(body,old_text,old_text||'end if;');
 old_text:=' insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence)';
 body:=replace(body,old_text,$patch$
 if config?'recovery_source' then
  update marketing_private.ads_changes set provider_state=old.provider_state where id=r.id returning * into r;
 end if;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence)$patch$);
 execute body;
end $$;
-- Permit non-mutating validation of declaration-only proposals against their known paused parent.
do $$ declare body text;begin
 select pg_get_functiondef('public.marketing_ads_validation_material(uuid,uuid,text)'::regprocedure) into body;
 body:=replace(body,'r.state<>''reconciling''','not (r.state=''reconciling'' or (r.configuration?''recovery_source'' and r.state in (''draft'',''review'',''approved'')))');
 body:=replace(body,' if exists(select 1 from marketing_private.ads_campaign_brands',$patch$
 if r.configuration?'recovery_source' and not exists(select 1 from marketing_private.ads_changes source
  where source.id=(r.configuration->>'recovery_source')::uuid and source.state='reconciling' and source.organization_id=r.organization_id and source.brand_id=r.brand_id
   and source.connection_id=r.connection_id and source.generation=r.generation and source.account_id=r.account_id
   and source.provider_state is not distinct from r.provider_state
   and (source.configuration-array['adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source']) is not distinct from
       (r.configuration-array['adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source'])) then raise exception 'Recovery source changed';end if;
 if exists(select 1 from marketing_private.ads_campaign_brands$patch$);
 execute body;
end $$;
-- Approval of a recovery proposal requires a successful current, exact-revision Meta validation.
do $$ declare body text;begin
 select pg_get_functiondef('public.marketing_ads_change_transition(uuid,text,text)'::regprocedure) into body;
 if position(' if p_action=''submit'' and' in body)=0 then raise exception 'Approval contract changed';end if;
 body:=replace(body,' if p_action=''submit'' and',$patch$
 if p_action='approve' and r.configuration?'recovery_source' and not exists(select 1 from marketing_private.ads_change_events e where e.change_id=r.id and e.revision=r.revision
   and e.event='validate_adset' and e.id=(select max(latest.id) from marketing_private.ads_change_events latest where latest.change_id=r.id and latest.event='validate_adset') and e.evidence->'valid'='true'::jsonb and e.created_at>now()-interval '1 hour') then raise exception 'Validate the exact declaration revision with Meta before approval';end if;
 if p_action='submit' and$patch$);
 execute body;
end $$;
-- Existing functions remain service-only/caller-scoped with their original controlled search_path and grants.
