-- Sum only verified campaign rows in the selected scope and original currency.
-- Reach is non-additive; missing rows/values do not become zero.
create function marketing_private.ads_scope_totals(p_payload jsonb,p_campaigns jsonb,p_rows jsonb) returns jsonb
language plpgsql immutable security definer set search_path=public as $$
declare n integer:=jsonb_array_length(p_campaigns);rows jsonb;metrics jsonb:='{}';k text;v numeric;spend numeric;clicks numeric;impressions numeric;actions jsonb;costs jsonb;
begin
if n=0 then return '[]';end if;
select coalesce(jsonb_agg(row),'[]') into rows from (select distinct on(a->>'campaign_id') a as row from jsonb_array_elements(p_rows) a where exists(select 1 from jsonb_array_elements(p_campaigns) c where c->>'id'=a->>'campaign_id') and a->>'currency'=p_payload#>>'{account,currency}' and a->>'date_start'=p_payload->>'date_from' and a->>'date_stop'=p_payload->>'date_to' order by a->>'campaign_id') x;
if jsonb_array_length(rows)<>n then return '[]';end if;
foreach k in array array['spend','clicks','impressions'] loop
select case when count(a#>>array['metrics',k,'value'])=n then sum((a#>>array['metrics',k,'value'])::numeric) else null end into v from jsonb_array_elements(rows) a;
metrics:=metrics||jsonb_build_object(k,jsonb_build_object('value',v,'state',case when v is null then 'unavailable' else 'derived' end));
end loop;
spend:=(metrics#>>'{spend,value}')::numeric;clicks:=(metrics#>>'{clicks,value}')::numeric;impressions:=(metrics#>>'{impressions,value}')::numeric;
metrics:=metrics||jsonb_build_object('ctr',jsonb_build_object('value',100*clicks/nullif(impressions,0),'state','derived'),'cpc',jsonb_build_object('value',spend/nullif(clicks,0),'state','derived'),'cpm',jsonb_build_object('value',1000*spend/nullif(impressions,0),'state','derived'),'reach',case when n=1 then rows#>'{0,metrics,reach}' else jsonb_build_object('value',null,'state','unavailable','reason','Non-additive campaign reach') end);
-- Keep action types separate; absent action evidence in any campaign prevents that total.
select coalesce(jsonb_agg(jsonb_build_object('type',kind,'value',value)),'[]') into actions from (select a->>'type' kind,sum((a->>'value')::numeric) value from jsonb_array_elements(rows) r cross join lateral jsonb_array_elements(coalesce(nullif(r->'actions','null'::jsonb),'[]')) a group by a->>'type' having count(distinct r->>'campaign_id')=n) q;
select coalesce(jsonb_agg(jsonb_build_object('type',a->>'type','value',spend/nullif((a->>'value')::numeric,0))),'[]') into costs from jsonb_array_elements(actions) a;
return jsonb_build_array(jsonb_build_object('account_id',p_payload#>>'{account,id}','currency',p_payload#>>'{account,currency}','date_start',p_payload->>'date_from','date_stop',p_payload->>'date_to','metrics',metrics,'actions',actions,'cost_per_action_type',costs,'action_values',null,'roi',jsonb_build_object('value',null,'state','unavailable','reason','No verified FeedX revenue attribution'),'source','FeedX confirmed campaign attribution','attribution','Derived from confirmed campaigns in this scope using their original Meta attribution settings. Results are Meta-defined, not verified FeedX sales.'));
end;$$;
revoke all on function marketing_private.ads_scope_totals(jsonb,jsonb,jsonb) from public,anon,authenticated;
do $$ declare f text;begin
select pg_get_functiondef('marketing_private.ads_project(uuid,text,jsonb,uuid,boolean)'::regprocedure) into f;
if position('return p_payload||jsonb_build_object(' in f)=0 then raise exception 'Ads projection contract changed';end if;
f:=replace(f,'return p_payload||jsonb_build_object(', 'if not (p_org_access and p_brand is null) then insights:=insights||jsonb_build_object(''account'',marketing_private.ads_scope_totals(p_payload,campaigns,coalesce(insights->''campaign'',''[]'')));end if; return p_payload||jsonb_build_object(');execute f;
end $$;
