create function public.marketing_ads_ai_usage(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');begin
 return (select jsonb_build_object('feature','ads_copilot','requests',count(*),'input_tokens',sum(input_tokens),'output_tokens',sum(output_tokens),'usage_unavailable_requests',count(*) filter(where input_tokens is null or output_tokens is null),'estimated_cost_usd',sum(cost_usd),'cost_unavailable_requests',count(*) filter(where cost_usd is null),'period','Last 30 days') from marketing_private.ads_ai_runs r where r.organization_id=p_org and r.created_at>now()-interval '30 days' and (p_brand is null or r.brand_id=p_brand) and marketing_private.brand_allowed(p_org,r.brand_id));
end;$$;
revoke all on function public.marketing_ads_ai_usage(uuid,uuid) from public,anon;
grant execute on function public.marketing_ads_ai_usage(uuid,uuid) to authenticated;
