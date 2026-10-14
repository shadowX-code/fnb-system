-- Existing campaigns resume their parent only. FeedX-created paused hierarchies need explicit scope approval.
do $$ declare body text;begin
 select pg_get_functiondef('public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid)'::regprocedure) into body;
 body:=replace(body,'''campaign_id'',''maximum_budget''','''campaign_id'',''maximum_budget'',''resume_scope''');
 body:=replace(body,'cap:=0;', $patch$
 if config?'resume_scope' and (p_operation<>'resume' or config->>'resume_scope' not in ('campaign','feedx_hierarchy')) then raise exception 'Unsupported activation scope';end if;
 if p_operation='resume' and config->>'resume_scope'='feedx_hierarchy' then
 if baseline#>>'{campaign,status}'<>'PAUSED' or jsonb_array_length(baseline->'adsets')<>1 or jsonb_array_length(baseline->'ads')<>1 or not exists(select 1 from marketing_private.ads_changes source where source.organization_id=p_org and source.brand_id=p_brand and source.connection_id=c.id and source.operation='create' and source.state='succeeded' and source.receipt->>'campaign_id'=config->>'campaign_id' and source.receipt->>'adset_id'=baseline#>>'{adsets,0,id}' and source.receipt->>'ad_id'=baseline#>>'{ads,0,id}') then raise exception 'Only a reconciled FeedX-created paused hierarchy may be activated together';end if;
 end if;
 cap:=0;
 $patch$);
 execute body;
end $$;
