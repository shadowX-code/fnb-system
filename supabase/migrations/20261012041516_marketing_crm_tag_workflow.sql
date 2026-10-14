-- Extend existing audience rules; legacy single-tag/language/outlet semantics remain intact.
create or replace function marketing_private.audience_matches(p_link public.platform_customer_brands,p_rules jsonb) returns boolean language sql immutable set search_path=public as $$
 select (coalesce(p_rules->>'language','')='' or p_link.language=p_rules->>'language')
 and (coalesce(p_rules->>'tag','')='' or p_rules->>'tag'=any(p_link.tags))
 and (coalesce(p_rules->'tags','[]'::jsonb)='[]'::jsonb or p_link.tags && array(select jsonb_array_elements_text(p_rules->'tags')))
 and (coalesce(p_rules->>'outlet_id','')='' or p_link.outlet_id::text=p_rules->>'outlet_id');
$$;

create or replace function public.marketing_outreach_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;fp text;old public.marketing_requests;result jsonb;cid uuid:=p_id;c public.marketing_campaigns;a public.marketing_audiences;r public.marketing_campaign_recipients;cu public.platform_customers;link public.platform_customer_brands;consent uuid;permission text;count_n integer;rules jsonb;
begin
 permission:=case when p_action in ('consent','suppress','unsuppress','audience') then 'marketing_audience.manage' when p_action='approve' then 'marketing_campaigns.approve' when p_action in ('queue','open','confirm','skip','inspect') then 'marketing_campaigns.execute' when p_action='sender' then 'marketing_settings.configure' else 'marketing_campaigns.manage' end;
 actor:=marketing_private.require_access(p_org,p_brand,permission);if p_brand is null or p_request is null then raise exception 'Select a brand.';end if;
 fp:=md5(jsonb_build_array('outreach',p_org,p_brand,p_action,p_id,p_payload)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into old from public.marketing_requests where request_id=p_request;
 -- Recipient actions always recheck live eligibility, even on an identical retry.
 if found and (old.actor_employee_id<>actor or old.fingerprint<>fp) then raise exception 'Request changed.';end if;
 if old.request_id is not null and p_action not in ('open','confirm','skip','inspect') then return old.result;end if;
 perform 1 from public.brands where id=p_brand for update;
 if p_action in ('consent','suppress','unsuppress') then
  select x.* into cu from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id where x.id=p_id and b.brand_id=p_brand and b.organization_id=p_org for update of x;if cu.id is null then raise exception 'Customer unavailable for this brand.';end if;
  if p_action='consent' then
   insert into public.marketing_consent_evidence(brand_id,customer_id,phone_e164,decision,source,evidence,occurred_at,expires_at,actor_employee_id) values(p_brand,cu.id,cu.phone_e164,p_payload->>'decision',trim(p_payload->>'source'),trim(p_payload->>'evidence'),(p_payload->>'occurred_at')::timestamptz,nullif(p_payload->>'expires_at','')::timestamptz,actor);
  elsif p_action='suppress' then insert into public.marketing_suppressions values(p_brand,cu.phone_e164,trim(p_payload->>'reason'),actor,now()) on conflict(brand_id,phone_e164) do update set reason=excluded.reason,actor_employee_id=excluded.actor_employee_id,created_at=now();
  else delete from public.marketing_suppressions where brand_id=p_brand and phone_e164=cu.phone_e164;end if;
 elsif p_action='audience' then
  if coalesce(p_payload->'criteria','{}')-'language'-'tag'-'outlet_id'<>'{}' then raise exception 'Unsupported segment criteria.';end if;
  if nullif(p_payload->'criteria'->>'outlet_id','') is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id=(p_payload->'criteria'->>'outlet_id')::uuid) then raise exception 'Outlet unavailable for this brand.';end if;
  if cid is null then insert into public.marketing_audiences(organization_id,brand_id,name,criteria,created_by) values(p_org,p_brand,trim(p_payload->>'name'),coalesce(p_payload->'criteria','{}'),actor) returning id into cid;
  else update public.marketing_audiences set name=trim(p_payload->>'name'),criteria=coalesce(p_payload->'criteria','{}'),revision=revision+1 where id=cid and brand_id=p_brand and revision=(p_payload->>'revision')::integer;if not found then raise exception 'Audience changed. Reload.';end if;end if;
 elsif p_action='sender' then
  if p_payload->>'confirmed' is distinct from 'true' then raise exception 'Confirm this registered brand sender.';end if;
  insert into public.marketing_whatsapp_senders(organization_id,brand_id,label,phone_e164,registered_by) values(p_org,p_brand,trim(p_payload->>'label'),marketing_private.my_phone(p_payload->>'phone'),actor) on conflict(brand_id,phone_e164) do update set label=excluded.label,active=true returning id into cid;
 elsif p_action in ('open','confirm','skip','inspect') then
  select * into r from public.marketing_campaign_recipients where id=p_id for update;select * into c from public.marketing_campaigns where id=r.campaign_id and organization_id=p_org and brand_id=p_brand for update;if c.id is null or c.status<>'ready' or c.approved_revision<>c.revision or r.campaign_revision<>c.revision then raise exception 'Approved campaign unavailable.';end if;
  select * into cu from public.platform_customers where id=r.customer_id for update;
  consent:=marketing_private.whatsapp_consent(p_brand,cu.id);
  if p_action<>'skip' and (consent is null or cu.revision<>r.customer_revision or cu.phone_e164<>r.phone_e164) then raise exception 'Recipient consent, suppression or identity changed. No recipient action is allowed.';end if;
  if r.state='skipped' or r.state='staff_confirmed' then if old.request_id is not null and p_action in ('confirm','skip') then return old.result;end if;raise exception 'Recipient already handled.';end if;
  if r.handled_by is not null and r.handled_by<>actor then raise exception 'This recipient is being handled by another staff member.';end if;
  if p_action='inspect' then null;elsif p_action='skip' then update public.marketing_campaign_recipients set state='skipped',handled_by=actor,skip_reason=coalesce(nullif(trim(p_payload->>'reason'),''),'Skipped by staff') where id=r.id;
  else
   if p_payload->>'senderConfirmed' is distinct from 'true' or not exists(select 1 from public.marketing_whatsapp_senders s where s.id=(p_payload->>'senderId')::uuid and s.brand_id=p_brand and s.active) then raise exception 'Confirm the registered sender selected in WhatsApp.';end if;
   if r.sender_id is not null and r.sender_id<>(p_payload->>'senderId')::uuid then raise exception 'Keep the confirmed sender for this recipient.';end if;
   if p_action='confirm' and r.state<>'opened' then raise exception 'Open WhatsApp before confirming your manual send.';end if;
   update public.marketing_campaign_recipients set state=case when p_action='open' then 'opened' else 'staff_confirmed' end,sender_id=(p_payload->>'senderId')::uuid,handled_by=actor,opened_at=coalesce(opened_at,now()),confirmed_at=case when p_action='confirm' then now() else confirmed_at end where id=r.id;
  end if;
  cid:=r.id;result:=jsonb_build_object('id',r.id,'phone',r.phone_e164,'caption',r.caption,'state',case p_action when 'open' then 'opened' when 'confirm' then 'staff_confirmed' when 'inspect' then r.state else 'skipped' end);
  if old.request_id is null and p_action<>'inspect' then insert into public.marketing_campaign_events(campaign_id,brand_id,recipient_id,action,actor_employee_id) values(c.id,p_brand,r.id,p_action,actor);end if;
 else
  if cid is not null then select * into c from public.marketing_campaigns where id=cid and organization_id=p_org and brand_id=p_brand for update;if c.id is null or c.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Campaign changed. Reload.';end if;end if;
  if p_action='save' then
   if c.id is not null and exists(select 1 from public.marketing_campaign_recipients where campaign_id=c.id and state<>'pending') then raise exception 'Started campaigns cannot be revised. Cancel and create a new draft.';end if;
   if p_payload ? 'audience_criteria' then
    perform marketing_private.require_access(p_org,p_brand,'marketing_audience.manage');
    rules:=p_payload->'audience_criteria';
    if jsonb_typeof(rules) is distinct from 'object' or rules-'language'-'tag'-'tags'-'outlet_id'<>'{}' then raise exception 'Unsupported audience filters.';end if;
    if rules ? 'tags' then
     if jsonb_typeof(rules->'tags') is distinct from 'array' or jsonb_array_length(rules->'tags')>20 then raise exception 'Use up to 20 tags.';end if;
     if exists(select 1 from jsonb_array_elements(rules->'tags') t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 1 and 60) then raise exception 'Tags must contain 1–60 characters.';end if;
    end if;
    if coalesce(rules->>'language','') not in ('','EN','ZH','BM') then raise exception 'Language unavailable.';end if;
    if nullif(rules->>'outlet_id','') is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id=(rules->>'outlet_id')::uuid) then raise exception 'Outlet unavailable for this brand.';end if;
    -- A changed draft receives its own audience definition; historical audiences never change.
    select * into a from public.marketing_audiences where id=c.audience_id and brand_id=p_brand and criteria=rules;
    if a.id is null then insert into public.marketing_audiences(organization_id,brand_id,name,criteria,created_by) values(p_org,p_brand,left(trim(p_payload->>'title')||' · Audience',160),rules,actor) returning * into a;end if;
   else
    select * into a from public.marketing_audiences where id=(p_payload->>'audience_id')::uuid and brand_id=p_brand;
   end if;
   if a.id is null then raise exception 'Select a brand audience.';end if;
   if nullif(p_payload->>'asset_id','') is not null and not exists(select 1 from public.marketing_assets where id=(p_payload->>'asset_id')::uuid and brand_id=p_brand and state='ready' and mime_type like 'image/%') then raise exception 'Select a ready brand image.';end if;
   if regexp_replace(coalesce(p_payload->>'caption',''),'\{(name|brand)\}','','g') ~ '[{}]' then raise exception 'Use only {name} and {brand} personalization.';end if;
   if cid is null then insert into public.marketing_campaigns(organization_id,brand_id,title,audience_id,caption,asset_id,created_by) values(p_org,p_brand,trim(p_payload->>'title'),a.id,p_payload->>'caption',nullif(p_payload->>'asset_id','')::uuid,actor) returning id into cid;
   else delete from public.marketing_campaign_recipients where campaign_id=cid;update public.marketing_campaigns set title=trim(p_payload->>'title'),audience_id=a.id,caption=p_payload->>'caption',asset_id=nullif(p_payload->>'asset_id','')::uuid,revision=revision+1,status='draft',approved_revision=null,approved_by=null,approved_at=null,audience_revision=null where id=cid;end if;
   insert into public.marketing_campaign_revisions select id,revision,jsonb_build_object('title',title,'caption',caption,'audience_id',audience_id,'asset_id',asset_id,'adapter',adapter),actor,now() from public.marketing_campaigns where id=cid;
  elsif p_action='review' and c.status='draft' then select * into a from public.marketing_audiences where id=c.audience_id for update;update public.marketing_campaigns set status='review',audience_revision=a.revision where id=cid;
  elsif p_action='approve' and c.status='review' then select * into a from public.marketing_audiences where id=c.audience_id for update;if a.revision<>c.audience_revision then raise exception 'Audience changed. Revise and review this campaign again.';end if;update public.marketing_campaigns set status='approved',approved_revision=revision,audience_revision=a.revision,approved_by=actor,approved_at=now() where id=cid;
  elsif p_action='queue' and c.status='approved' then
   select * into a from public.marketing_audiences where id=c.audience_id for update;if a.revision<>c.audience_revision or c.adapter<>'whatsapp_manual' then raise exception 'Audience changed or delivery adapter unavailable. Review again.';end if;
   select count(*) into count_n from public.platform_customer_brands b where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,b.customer_id) is not null;if count_n>5000 then raise exception 'Split audiences larger than 5,000 recipients.';end if;
   insert into public.marketing_campaign_recipients(campaign_id,customer_id,customer_revision,campaign_revision,phone_e164,caption,consent_id)
   select cid,x.id,x.revision,c.revision,x.phone_e164,replace(replace(c.caption,'{name}',x.display_name),'{brand}',(select name from public.brands where id=p_brand)),marketing_private.whatsapp_consent(p_brand,x.id) from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,x.id) is not null;
   update public.marketing_campaigns set status='ready' where id=cid;
  elsif p_action='cancel' then update public.marketing_campaigns set status='cancelled' where id=cid;
  else raise exception 'Campaign transition unavailable.';end if;
  insert into public.marketing_campaign_events(campaign_id,brand_id,action,actor_employee_id) values(cid,p_brand,p_action,actor);
 end if;
 if p_action in ('consent','suppress','unsuppress','audience','sender') then insert into public.marketing_campaign_events(brand_id,action,actor_employee_id) values(p_brand,p_action,actor);end if;
 result:=coalesce(result,jsonb_build_object('id',coalesce(cid,p_id)));if old.request_id is null then insert into public.marketing_requests values(p_request,actor,fp,case when p_action in ('open','confirm','skip','inspect') then result-'phone'-'caption' else result end);end if;return result;
end;$$;

create or replace function public.marketing_outreach_read(p_org uuid,p_brand uuid,p_campaign uuid default null,p_page integer default 1,p_search text default '') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,case when public.current_user_has_permission('marketing_campaigns.view') then 'marketing_campaigns.view' else 'marketing_audience.view' end);v jsonb;customers jsonb;audiences jsonb;campaigns jsonb;senders jsonb;assets jsonb;recipients jsonb;counts jsonb;
begin
 if p_brand is null then raise exception 'Select a brand to manage audiences and campaigns.';end if;
 if public.current_user_has_permission('marketing_campaigns.view') or public.current_user_has_permission('marketing_settings.configure') then
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into senders from public.marketing_whatsapp_senders s where s.brand_id=p_brand;end if;senders:=coalesce(senders,'[]');
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('eligible_count',(select count(*) from public.platform_customer_brands b where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,b.customer_id) is not null))),'[]') into audiences from public.marketing_audiences a where a.brand_id=p_brand;
 if public.current_user_has_permission('marketing_audience.view') then
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into customers from(select x.id,x.display_name,x.phone_e164,b.language,b.tags,b.outlet_id,marketing_private.whatsapp_consent(p_brand,x.id) is not null as eligible,exists(select 1 from public.marketing_suppressions s where s.brand_id=p_brand and s.phone_e164=x.phone_e164) as suppressed,(select to_jsonb(e)-'phone_e164' from public.marketing_consent_evidence e where e.brand_id=p_brand and e.customer_id=x.id order by e.record_order desc limit 1) as consent from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id where b.brand_id=p_brand and (p_search='' or x.display_name ilike '%'||left(p_search,160)||'%' or x.phone_e164 ilike '%'||left(p_search,30)||'%') order by x.display_name,x.id limit 50 offset (greatest(1,p_page)-1)*50)q;end if;
 if public.current_user_has_permission('marketing_campaigns.view') then
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('audience_size',(select eligible_count from (select count(*) eligible_count from public.platform_customer_brands b join public.marketing_audiences a on a.id=c.audience_id where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,b.customer_id) is not null)t),'recipient_count',(select count(*) from public.marketing_campaign_recipients where campaign_id=c.id),'handled_count',(select count(*) from public.marketing_campaign_recipients where campaign_id=c.id and state in ('staff_confirmed','skipped'))) order by c.created_at desc),'[]') into campaigns from public.marketing_campaigns c where c.brand_id=p_brand;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from public.marketing_assets a where a.brand_id=p_brand and a.state='ready' and a.mime_type like 'image/%';
 if p_campaign is not null then
  if not exists(select 1 from public.marketing_campaigns where id=p_campaign and brand_id=p_brand) then raise exception 'Campaign unavailable.';end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into recipients from(select r.*,x.display_name,marketing_private.whatsapp_consent(p_brand,r.customer_id) is not null and x.revision=r.customer_revision and x.phone_e164=r.phone_e164 as eligible from public.marketing_campaign_recipients r join public.platform_customers x on x.id=r.customer_id where r.campaign_id=p_campaign order by case r.state when 'opened' then 0 when 'pending' then 1 else 2 end,r.id limit 50 offset (greatest(1,p_page)-1)*50)q;
  select coalesce(jsonb_object_agg(state,n),'{}') into counts from(select state,count(*) n from public.marketing_campaign_recipients where campaign_id=p_campaign group by state)t;
 end if;end if;campaigns:=coalesce(campaigns,'[]');assets:=coalesce(assets,'[]');
 return jsonb_build_object('tags',(select coalesce(jsonb_agg(t order by t),'[]') from (select distinct unnest(b.tags) t from public.platform_customer_brands b where b.brand_id=p_brand) tags),'customers',coalesce(customers,'[]'),'audiences',audiences,'campaigns',campaigns,'senders',senders,'assets',assets,'recipients',coalesce(recipients,'[]'),'progress',coalesce(counts,'{}'),'customer_total',(select count(*) from public.platform_customer_brands where brand_id=p_brand),'verified_delivery',null,'verified_redemptions',null,'cloud_api_available',false,'shared_customers',case when public.current_user_has_permission('platform_customers.manage') then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'phone',x.phone_e164)),'[]') from public.platform_customers x where x.organization_id=p_org and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and b.brand_id=p_brand) and exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id) and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and not marketing_private.brand_allowed(p_org,b.brand_id))) else '[]'::jsonb end,'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)),'[]') from public.brand_outlets b join public.outlets o on o.id=b.outlet_id where b.brand_id=p_brand));
end;$$;

create or replace function public.marketing_customers_read(p_org uuid,p_brand uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_audience.view');result jsonb;lim integer:=case when p_size in(20,50,100) then p_size else 20 end;
begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 if nullif(p_filters->>'segment','') is not null and not exists(select 1 from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand) then raise exception 'Segment unavailable.';end if;
 if p_filters ? 'tags' and jsonb_typeof(p_filters->'tags') is distinct from 'array' then raise exception 'Invalid tag filter.';end if;
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
 and (coalesce(p_filters->'tags','[]'::jsonb)='[]'::jsonb or b.tags && array(select jsonb_array_elements_text(p_filters->'tags')))
 and (coalesce(p_filters->>'outlet','')='' or b.outlet_id::text=p_filters->>'outlet')
 and (coalesce(p_filters->>'status','')='' or c.active=(p_filters->>'status'='active'))
 and (coalesce(p_filters->>'segment','')='' or marketing_private.audience_matches(b,(select criteria from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand)))
 ), filtered as(select * from customers where coalesce(p_filters->>'consent','')='' or (p_filters->>'consent'='eligible' and eligible) or (p_filters->>'consent'='suppressed' and suppressed) or (p_filters->>'consent'='required' and not eligible and not suppressed)), page as (
 select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from filtered)) into result;
 return result;
end;$$;
-- Existing permissions/grants remain on replaced functions; private rules stay private.
revoke all on function marketing_private.audience_matches(public.platform_customer_brands,jsonb) from public,anon,authenticated;
