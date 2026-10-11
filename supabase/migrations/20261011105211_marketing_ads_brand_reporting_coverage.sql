-- Brand users see only their own projected reporting coverage, never organization residuals.
create function marketing_private.ads_reporting_coverage(p_payload jsonb,p_campaigns jsonb,p_rows jsonb) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object('campaigns',count(*),'reported_campaigns',count(r->>'campaign_id'),'reported_spend',sum((r#>>'{metrics,spend,value}')::numeric),'spend_campaigns',count(r#>>'{metrics,spend,value}'))
 from jsonb_array_elements(p_campaigns) c left join lateral
 (select a from jsonb_array_elements(p_rows) a where a->>'campaign_id'=c->>'id' and a->>'currency'=p_payload#>>'{account,currency}' and a->>'date_start'=p_payload->>'date_from' and a->>'date_stop'=p_payload->>'date_to' limit 1) v(r) on true;
$$;
revoke all on function marketing_private.ads_reporting_coverage(jsonb,jsonb,jsonb) from public,anon,authenticated;
do $$ declare f text;begin
 select pg_get_functiondef('marketing_private.ads_project(uuid,text,jsonb,uuid,boolean)'::regprocedure) into f;
 f:=replace(f,'return p_payload||jsonb_build_object(','if not (p_org_access and p_brand is null) then insights:=insights||jsonb_build_object(''scope_coverage'',marketing_private.ads_reporting_coverage(p_payload,campaigns,coalesce(insights->''campaign'',''[]'')));end if; return p_payload||jsonb_build_object(');
 execute f;
end $$;
