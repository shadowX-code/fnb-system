-- Extend the existing scoped read projection only; mutation authorities and grants are unchanged.
create or replace function public.marketing_customers_read(p_org uuid,p_brand uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_audience.view');result jsonb;lim integer:=case when p_size in(20,50,100) then p_size else 20 end;
begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 if nullif(p_filters->>'segment','') is not null and not exists(select 1 from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand) then raise exception 'Segment unavailable.';end if;
 with customers as (
 select c.id,c.display_name,c.phone_e164,c.revision,c.active,b.language,b.tags,b.outlet_id,o.name outlet_name,br.name brand_name,
 marketing_private.customer_snapshot(p_brand,c.id) snapshot,marketing_private.whatsapp_consent(p_brand,c.id) is not null eligible,
 exists(select 1 from public.marketing_suppressions where brand_id=p_brand and phone_e164=c.phone_e164) suppressed,
 (select to_jsonb(e)-'phone_e164' from public.marketing_consent_evidence e where brand_id=p_brand and customer_id=c.id order by record_order desc limit 1) consent,
 (select max(coalesce(r.confirmed_at,r.opened_at)) from public.marketing_campaign_recipients r join public.marketing_campaigns ca on ca.id=r.campaign_id where r.customer_id=c.id and ca.brand_id=p_brand) last_activity,
 case when p_filters->>'detail'=c.id::text then jsonb_build_object(
 'consent_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.record_order desc) from (select decision,source,evidence,occurred_at,recorded_at,expires_at,record_order from public.marketing_consent_evidence where brand_id=p_brand and customer_id=c.id order by record_order desc limit 50) h),'[]'::jsonb),
 'consent_history_total',(select count(*) from public.marketing_consent_evidence where brand_id=p_brand and customer_id=c.id),
 'suppression',(select jsonb_build_object('reason',s.reason,'created_at',s.created_at) from public.marketing_suppressions s where s.brand_id=p_brand and s.phone_e164=c.phone_e164),
 'segments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name,a.id) from public.marketing_audiences a where a.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria)),'[]'::jsonb),
 'activity_available',public.current_user_has_permission('marketing_campaigns.view'),
 'activity',case when public.current_user_has_permission('marketing_campaigns.view') then coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.event_id desc) from (select e.id event_id,ca.title campaign,e.action,e.created_at from public.marketing_campaign_events e join public.marketing_campaign_recipients r on r.id=e.recipient_id join public.marketing_campaigns ca on ca.id=e.campaign_id where e.brand_id=p_brand and ca.brand_id=p_brand and r.campaign_id=ca.id and r.customer_id=c.id order by e.created_at desc,e.id desc limit 50) h),'[]'::jsonb) else null end
 ) else null end detail
 from public.platform_customers c join public.platform_customer_brands b on b.customer_id=c.id and b.brand_id=p_brand join public.brands br on br.id=b.brand_id left join public.outlets o on o.id=b.outlet_id
 where c.organization_id=p_org
 and (coalesce(p_filters->>'detail','')='' or c.id::text=p_filters->>'detail')
 and (coalesce(p_filters->>'search','')='' or c.display_name ilike '%'||left(p_filters->>'search',160)||'%' or c.phone_e164 ilike '%'||left(p_filters->>'search',30)||'%' or exists(select 1 from unnest(b.tags) t where t ilike '%'||left(p_filters->>'search',60)||'%'))
 and (coalesce(p_filters->>'outlet','')='' or b.outlet_id::text=p_filters->>'outlet')
 and (coalesce(p_filters->>'status','')='' or c.active=(p_filters->>'status'='active'))
 and (coalesce(p_filters->>'segment','')='' or marketing_private.audience_matches(b,(select criteria from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand)))
 ), filtered as(select * from customers where coalesce(p_filters->>'consent','')='' or (p_filters->>'consent'='eligible' and eligible) or (p_filters->>'consent'='suppressed' and suppressed) or (p_filters->>'consent'='required' and not eligible and not suppressed)), page as (
 select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from filtered)) into result;
 return result;
end;$$;
revoke all on function public.marketing_customers_read(uuid,uuid,jsonb,integer,integer) from public,anon;
grant execute on function public.marketing_customers_read(uuid,uuid,jsonb,integer,integer) to authenticated;
