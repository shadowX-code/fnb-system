-- Read projections reuse canonical tag matching, consent and suppression authorities.
create table marketing_private.campaign_audience_reviews (
 campaign_id uuid not null references public.marketing_campaigns(id),
 revision integer not null, criteria jsonb not null, breakdown jsonb not null,
 eligible_customers jsonb not null, actor_employee_id uuid not null references public.employees(id),
 created_at timestamptz not null default now(), primary key(campaign_id,revision)
);
alter table marketing_private.campaign_audience_reviews enable row level security;
revoke all on marketing_private.campaign_audience_reviews from public,anon,authenticated;

create function marketing_private.audience_breakdown(p_brand uuid,p_rules jsonb) returns jsonb
language sql stable set search_path=public as $$
 with matches as (
 select marketing_private.whatsapp_consent(p_brand,b.customer_id) is not null eligible,
 marketing_private.contact_state(p_brand,b.customer_id) contact_state
 from public.platform_customer_brands b where b.brand_id=p_brand and marketing_private.audience_matches(b,p_rules)
 ) select jsonb_build_object('matching',count(*),'excluded',count(*) filter(where not eligible),
 'eligible',count(*) filter(where eligible),'not_subscribed',count(*) filter(where not eligible and contact_state='not_subscribed'),
 'do_not_contact',count(*) filter(where not eligible and contact_state='do_not_contact'),
 'other_excluded',count(*) filter(where not eligible and contact_state not in ('not_subscribed','do_not_contact'))) from matches;
$$;
revoke all on function marketing_private.audience_breakdown(uuid,jsonb) from public,anon,authenticated;

create function public.marketing_campaign_audience_preview(p_org uuid,p_brand uuid,p_criteria jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.manage');
 if p_brand is null or jsonb_typeof(p_criteria) is distinct from 'object' or p_criteria-'tags'-'tag'-'language'-'outlet_id'<>'{}' then raise exception 'Select valid audience filters.';end if;
 if p_criteria ? 'tags' and (jsonb_typeof(p_criteria->'tags') is distinct from 'array') then raise exception 'Select valid tags.';end if;
 if jsonb_array_length(coalesce(p_criteria->'tags','[]'))>20 then raise exception 'Use up to 20 tags.';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_criteria->'tags','[]')) t where marketing_private.tag_name(p_brand,t) is null) then raise exception 'Select current brand tags.';end if;
 if coalesce(p_criteria->>'tag','')<>'' and marketing_private.tag_name(p_brand,p_criteria->>'tag') is null then raise exception 'Select a current brand tag.';end if;
 if coalesce(p_criteria->>'language','') not in ('','EN','ZH','BM') then raise exception 'Language unavailable.';end if;
 if nullif(p_criteria->>'outlet_id','') is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id::text=p_criteria->>'outlet_id') then raise exception 'Outlet unavailable for this brand.';end if;
 return marketing_private.audience_breakdown(p_brand,p_criteria);
end;$$;
revoke all on function public.marketing_campaign_audience_preview(uuid,uuid,jsonb) from public,anon;
grant execute on function public.marketing_campaign_audience_preview(uuid,uuid,jsonb) to authenticated;

create function marketing_private.campaign_audience_projection(c public.marketing_campaigns) returns jsonb
language plpgsql stable set search_path=public as $$
declare review marketing_private.campaign_audience_reviews; rules jsonb; n bigint; eligible bigint; handled bigint; started boolean;
begin
 select * into review from marketing_private.campaign_audience_reviews where campaign_id=c.id and revision=c.revision;
 select coalesce(review.criteria,a.criteria) into rules from public.marketing_audiences a where a.id=c.audience_id and a.brand_id=c.brand_id;
 select count(*),count(*) filter(where state in ('staff_confirmed','skipped')),coalesce(bool_or(state<>'pending'),false) into n,handled,started from public.marketing_campaign_recipients where campaign_id=c.id;
 if c.status='ready' or n>0 then
  select count(*) into eligible from public.marketing_campaign_recipients r join public.platform_customers x on x.id=r.customer_id
  where r.campaign_id=c.id and marketing_private.whatsapp_consent(c.brand_id,x.id) is not null and x.revision=r.customer_revision and x.phone_e164=r.phone_e164;
 elsif review.campaign_id is not null then
  select count(*) into eligible from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id and b.brand_id=c.brand_id
  where review.eligible_customers @> jsonb_build_array(jsonb_build_object('id',x.id,'revision',x.revision))
  and marketing_private.audience_matches(b,rules) and marketing_private.whatsapp_consent(c.brand_id,x.id) is not null;
 else eligible:=(marketing_private.audience_breakdown(c.brand_id,rules)->>'eligible')::bigint;end if;
 return jsonb_build_object('audience_criteria',rules,'audience_breakdown',coalesce(review.breakdown,marketing_private.audience_breakdown(c.brand_id,rules)),
 'audience_basis',case when review.campaign_id is not null then 'reviewed' else 'current' end,
 'eligible_recipients',eligible,'recipient_count',n,'handled_count',handled,'queued',c.status='ready' or n>0,
 'can_revise',c.status in ('draft','review','approved','ready') and not started,
 'approval_current',c.approved_revision=c.revision and (c.status='ready' or (review.campaign_id is not null and c.audience_revision=(select revision from public.marketing_audiences where id=c.audience_id))));
end;$$;
revoke all on function marketing_private.campaign_audience_projection(public.marketing_campaigns) from public,anon,authenticated;

create or replace function public.marketing_outreach_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;fp text;old public.marketing_requests;result jsonb;cid uuid:=p_id;c public.marketing_campaigns;a public.marketing_audiences;r public.marketing_campaign_recipients;cu public.platform_customers;link public.platform_customer_brands;consent uuid;permission text;count_n integer;rules jsonb;s public.marketing_whatsapp_senders;ss marketing_private.whatsapp_staff_sessions;auth_session uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
 permission:=case when p_action in ('contact_preference','consent','suppress','unsuppress','audience') then 'marketing_audience.manage' when p_action='approve' then 'marketing_campaigns.approve' when p_action in ('queue','open','confirm','skip','inspect','sender_session') then 'marketing_campaigns.execute' when p_action in ('sender','sender_edit','sender_default','sender_disable') then 'marketing_settings.configure' else 'marketing_campaigns.manage' end;
 actor:=marketing_private.require_access(p_org,p_brand,permission);if p_brand is null or p_request is null then raise exception 'Select a brand.';end if;
 fp:=md5(jsonb_build_array('outreach',p_org,p_brand,p_action,p_id,p_payload)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into old from public.marketing_requests where request_id=p_request;
 -- Recipient actions always recheck live eligibility, even on an identical retry.
 if found and (old.actor_employee_id<>actor or old.fingerprint<>fp) then raise exception 'Request changed.';end if;
 if old.request_id is not null and p_action not in ('open','confirm','skip','inspect','sender_session') then return old.result;end if;
 perform 1 from public.brands where id=p_brand for update;
 if p_action in ('contact_preference','consent','suppress','unsuppress') then
  select x.* into cu from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id where x.id=p_id and b.brand_id=p_brand and b.organization_id=p_org for update of x;if cu.id is null then raise exception 'Customer unavailable for this brand.';end if;
  if p_action='contact_preference' then
   if coalesce(p_payload->>'state','') not in ('subscribed','not_subscribed','do_not_contact') or length(trim(coalesce(p_payload->>'source',''))) not between 1 and 120 then raise exception 'Select a contact preference and consent source.';end if;
   if p_payload->>'state'='subscribed' and not cu.active then raise exception 'Inactive customers cannot subscribe.';end if;
   insert into public.marketing_consent_evidence(brand_id,customer_id,phone_e164,decision,source,evidence,occurred_at,actor_employee_id)
    values(p_brand,cu.id,cu.phone_e164,case p_payload->>'state' when 'subscribed' then 'granted' when 'do_not_contact' then 'withdrawn' else 'not_subscribed' end,trim(p_payload->>'source'),'Staff recorded contact preference: '||(p_payload->>'state'),now(),actor);
   if p_payload->>'state'='do_not_contact' then
    insert into public.marketing_suppressions values(p_brand,cu.phone_e164,'Do Not Contact',actor,now()) on conflict(brand_id,phone_e164) do update set reason=excluded.reason,actor_employee_id=excluded.actor_employee_id,created_at=now();
   else delete from public.marketing_suppressions where brand_id=p_brand and phone_e164=cu.phone_e164;end if;
  elsif p_action='consent' then
   insert into public.marketing_consent_evidence(brand_id,customer_id,phone_e164,decision,source,evidence,occurred_at,expires_at,actor_employee_id) values(p_brand,cu.id,cu.phone_e164,p_payload->>'decision',trim(p_payload->>'source'),trim(p_payload->>'evidence'),(p_payload->>'occurred_at')::timestamptz,nullif(p_payload->>'expires_at','')::timestamptz,actor);
  elsif p_action='suppress' then insert into public.marketing_suppressions values(p_brand,cu.phone_e164,trim(p_payload->>'reason'),actor,now()) on conflict(brand_id,phone_e164) do update set reason=excluded.reason,actor_employee_id=excluded.actor_employee_id,created_at=now();
  else delete from public.marketing_suppressions where brand_id=p_brand and phone_e164=cu.phone_e164;end if;
 elsif p_action='audience' then
  if coalesce(p_payload->'criteria','{}')-'language'-'tag'-'outlet_id'<>'{}' then raise exception 'Unsupported segment criteria.';end if;
  if nullif(p_payload->'criteria'->>'outlet_id','') is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id=(p_payload->'criteria'->>'outlet_id')::uuid) then raise exception 'Outlet unavailable for this brand.';end if;
  if cid is null then insert into public.marketing_audiences(organization_id,brand_id,name,criteria,created_by) values(p_org,p_brand,trim(p_payload->>'name'),coalesce(p_payload->'criteria','{}'),actor) returning id into cid;
  else update public.marketing_audiences set name=trim(p_payload->>'name'),criteria=coalesce(p_payload->'criteria','{}'),revision=revision+1 where id=cid and brand_id=p_brand and revision=(p_payload->>'revision')::integer;if not found then raise exception 'Audience changed. Reload.';end if;end if;
 elsif p_action in ('sender','sender_edit','sender_default','sender_disable') then
  if p_action='sender' then
   if length(trim(coalesce(p_payload->>'label',''))) not between 1 and 160 then raise exception 'Enter a sender name.';end if;
   if exists(select 1 from public.marketing_whatsapp_senders where brand_id=p_brand and phone_e164=marketing_private.my_phone(p_payload->>'phone')) then raise exception 'This WhatsApp number is already registered. Edit the existing sender.';end if;
   insert into public.marketing_whatsapp_senders(organization_id,brand_id,label,phone_e164,registered_by,is_default)
    values(p_org,p_brand,trim(p_payload->>'label'),marketing_private.my_phone(p_payload->>'phone'),actor,not exists(select 1 from public.marketing_whatsapp_senders where brand_id=p_brand and active)) returning id into cid;
  else
   select * into s from public.marketing_whatsapp_senders where id=p_id and organization_id=p_org and brand_id=p_brand for update;
   if s.id is null or s.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Sender changed. Refresh and try again.';end if;
   if p_action='sender_edit' then
    if length(trim(coalesce(p_payload->>'label',''))) not between 1 and 160 then raise exception 'Enter a sender name.';end if;
    if exists(select 1 from public.marketing_whatsapp_senders where brand_id=p_brand and id<>s.id and phone_e164=marketing_private.my_phone(p_payload->>'phone')) then raise exception 'This WhatsApp number is already registered.';end if;
    update public.marketing_whatsapp_senders set label=trim(p_payload->>'label'),phone_e164=marketing_private.my_phone(p_payload->>'phone'),revision=revision+1 where id=s.id;
   elsif p_action='sender_default' then
    if not s.active then raise exception 'Disabled senders cannot be default.';end if;
    update public.marketing_whatsapp_senders set is_default=false where brand_id=p_brand and is_default;
    update public.marketing_whatsapp_senders set is_default=true where id=s.id;
   else update public.marketing_whatsapp_senders set active=false,is_default=false,revision=revision+1 where id=s.id;end if;
   cid:=s.id;
   if p_action<>'sender_default' then update marketing_private.whatsapp_staff_sessions set ended_at=now() where sender_id=s.id and ended_at is null;end if;
  end if;
 elsif p_action='sender_session' then
  if auth_session is null or not exists(select 1 from auth.sessions where id=auth_session and user_id=auth.uid() and (not_after is null or not_after>now())) then raise exception 'Sign in again to confirm your WhatsApp sender.';end if;
  select * into c from public.marketing_campaigns where id=p_id and organization_id=p_org and brand_id=p_brand for update;
  select * into s from public.marketing_whatsapp_senders where id=(p_payload->>'senderId')::uuid and brand_id=p_brand and active;
  if c.id is null or c.status<>'ready' or c.revision<>c.approved_revision or c.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Approved campaign changed. Refresh.';end if;
  if s.id is null or s.revision is distinct from (p_payload->>'senderRevision')::integer then raise exception 'Sender changed. Choose an available sender.';end if;
  if old.request_id is not null then
   select * into ss from marketing_private.whatsapp_staff_sessions where id=(old.result->>'id')::uuid and ended_at is null and auth_session_id=auth_session and expires_at>now();
   if ss.id is null then raise exception 'Start a new sending session.';end if;
   return old.result;
  end if;
  update marketing_private.whatsapp_staff_sessions set ended_at=now() where campaign_id=c.id and actor_employee_id=actor and auth_session_id=auth_session and ended_at is null;
  insert into marketing_private.whatsapp_staff_sessions(campaign_id,campaign_revision,sender_id,sender_revision,sender_snapshot,actor_employee_id,auth_session_id)
   values(c.id,c.revision,s.id,s.revision,jsonb_build_object('label',s.label,'phone_e164',s.phone_e164,'revision',s.revision),actor,auth_session) returning * into ss;
  result:=jsonb_build_object('id',ss.id,'campaign_id',c.id,'campaign_revision',c.revision,'sender_id',s.id,'sender_revision',s.revision,'sender_snapshot',ss.sender_snapshot,'expires_at',ss.expires_at);
  insert into public.marketing_campaign_events(campaign_id,brand_id,action,actor_employee_id) values(c.id,p_brand,'sender_session',actor);
 elsif p_action in ('open','confirm','skip','inspect') then
  select * into r from public.marketing_campaign_recipients where id=p_id for update;select * into c from public.marketing_campaigns where id=r.campaign_id and organization_id=p_org and brand_id=p_brand for update;if c.id is null or c.status<>'ready' or c.approved_revision<>c.revision or r.campaign_revision<>c.revision then raise exception 'Approved campaign unavailable.';end if;
  select * into cu from public.platform_customers where id=r.customer_id for update;
  consent:=marketing_private.whatsapp_consent(p_brand,cu.id);
  if p_action<>'skip' and (consent is null or cu.revision<>r.customer_revision or cu.phone_e164<>r.phone_e164) then raise exception 'Recipient consent, suppression or identity changed. No recipient action is allowed.';end if;
  if r.state='skipped' or r.state='staff_confirmed' then if old.request_id is not null and p_action in ('confirm','skip') then return old.result;end if;raise exception 'Recipient already handled.';end if;
  if r.handled_by is not null and r.handled_by<>actor then raise exception 'This recipient is being handled by another staff member.';end if;
  if p_action='inspect' then null;elsif p_action='skip' then update public.marketing_campaign_recipients set state='skipped',handled_by=actor,skip_reason=coalesce(nullif(trim(p_payload->>'reason'),''),'Skipped by staff') where id=r.id;
  else
   select * into ss from marketing_private.whatsapp_staff_sessions where id=nullif(p_payload->>'senderSessionId','')::uuid and campaign_id=c.id and campaign_revision=c.revision and actor_employee_id=actor and auth_session_id=auth_session and ended_at is null and expires_at>now();
   if ss.id is null or ss.sender_id is distinct from nullif(p_payload->>'senderId','')::uuid or not exists(select 1 from auth.sessions where id=auth_session and user_id=auth.uid() and (not_after is null or not_after>now())) or not exists(select 1 from public.marketing_whatsapp_senders where id=ss.sender_id and brand_id=p_brand and active and revision=ss.sender_revision) then raise exception 'Confirm your WhatsApp sender for this sending session.';end if;
   if r.sender_snapshot is not null and (r.sender_snapshot->>'phone_e164') is distinct from (ss.sender_snapshot->>'phone_e164') then raise exception 'This recipient was opened with a different sender number. Skip it or restore the original sender.';end if;

   if r.sender_id is not null and r.sender_id<>(p_payload->>'senderId')::uuid then raise exception 'Keep the confirmed sender for this recipient.';end if;
   if p_action='confirm' and r.state<>'opened' then raise exception 'Open WhatsApp before confirming your manual send.';end if;
   update public.marketing_campaign_recipients set state=case when p_action='open' then 'opened' else 'staff_confirmed' end,sender_id=ss.sender_id,sender_snapshot=coalesce(sender_snapshot,ss.sender_snapshot),sender_session_id=ss.id,handled_by=actor,opened_at=coalesce(opened_at,now()),confirmed_at=case when p_action='confirm' then now() else confirmed_at end where id=r.id;
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
    if exists(select 1 from jsonb_array_elements_text(coalesce(rules->'tags','[]')) x where marketing_private.tag_name(p_brand,x) is null) or (coalesce(rules->>'tag','')<>'' and marketing_private.tag_name(p_brand,rules->>'tag') is null) then raise exception 'Select current brand tags.';end if;
    if rules ? 'tags' then rules:=jsonb_set(rules,'{tags}',(select coalesce(jsonb_agg(t order by t),'[]') from (select distinct marketing_private.tag_name(p_brand,x) t from jsonb_array_elements_text(rules->'tags') x) names));end if;
    if coalesce(rules->>'tag','')<>'' then rules:=jsonb_set(rules,'{tag}',to_jsonb(marketing_private.tag_name(p_brand,rules->>'tag')));end if;
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
   insert into public.marketing_campaign_revisions select id,revision,jsonb_build_object('title',title,'caption',caption,'audience_id',audience_id,'asset_id',asset_id,'adapter',adapter,'audience_criteria',a.criteria),actor,now() from public.marketing_campaigns where id=cid;
  elsif p_action='review' and c.status='draft' then
   select * into a from public.marketing_audiences where id=c.audience_id for update;
   insert into marketing_private.campaign_audience_reviews(campaign_id,revision,criteria,breakdown,eligible_customers,actor_employee_id)
   select c.id,c.revision,a.criteria,marketing_private.audience_breakdown(p_brand,a.criteria),
   coalesce(jsonb_agg(jsonb_build_object('id',x.id,'revision',x.revision) order by x.id),'[]'),actor
   from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id
   where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,x.id) is not null;
   update public.marketing_campaigns set status='review',audience_revision=a.revision where id=cid;
  elsif p_action='approve' and c.status='review' then select * into a from public.marketing_audiences where id=c.audience_id for update;if a.revision<>c.audience_revision or not exists(select 1 from marketing_private.campaign_audience_reviews where campaign_id=c.id and revision=c.revision) then raise exception 'Audience changed. Revise and review this campaign again.';end if;update public.marketing_campaigns set status='approved',approved_revision=revision,audience_revision=a.revision,approved_by=actor,approved_at=now() where id=cid;
  elsif p_action='queue' and c.status='approved' then
   select * into a from public.marketing_audiences where id=c.audience_id for update;if a.revision<>c.audience_revision or c.adapter<>'whatsapp_manual' or not exists(select 1 from marketing_private.campaign_audience_reviews where campaign_id=c.id and revision=c.revision) then raise exception 'Audience changed or delivery adapter unavailable. Review again.';end if;
   select count(*) into count_n from public.platform_customer_brands b where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,b.customer_id) is not null;if count_n>5000 then raise exception 'Split audiences larger than 5,000 recipients.';end if;
   insert into public.marketing_campaign_recipients(campaign_id,customer_id,customer_revision,campaign_revision,phone_e164,caption,consent_id)
   select cid,x.id,x.revision,c.revision,x.phone_e164,replace(replace(c.caption,'{name}',x.display_name),'{brand}',(select name from public.brands where id=p_brand)),marketing_private.whatsapp_consent(p_brand,x.id) from public.platform_customers x join public.platform_customer_brands b on b.customer_id=x.id where b.brand_id=p_brand and marketing_private.audience_matches(b,a.criteria) and marketing_private.whatsapp_consent(p_brand,x.id) is not null
   and exists(select 1 from marketing_private.campaign_audience_reviews rv where rv.campaign_id=c.id and rv.revision=c.revision and rv.eligible_customers @> jsonb_build_array(jsonb_build_object('id',x.id,'revision',x.revision)));
   update public.marketing_campaigns set status='ready' where id=cid;
  elsif p_action='cancel' then update public.marketing_campaigns set status='cancelled' where id=cid;
  else raise exception 'Campaign transition unavailable.';end if;
  insert into public.marketing_campaign_events(campaign_id,brand_id,action,actor_employee_id) values(cid,p_brand,p_action,actor);
 end if;
 if p_action in ('contact_preference','consent','suppress','unsuppress','audience','sender','sender_edit','sender_default','sender_disable') then insert into public.marketing_campaign_events(brand_id,action,actor_employee_id) values(p_brand,p_action,actor);end if;
 result:=coalesce(result,jsonb_build_object('id',coalesce(cid,p_id)));if old.request_id is null then insert into public.marketing_requests values(p_request,actor,fp,case when p_action in ('open','confirm','skip','inspect') then result-'phone'-'caption' else result end);end if;return result;
end;$$;


revoke all on function public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;

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
 select coalesce(jsonb_agg(to_jsonb(c)||marketing_private.campaign_audience_projection(c) order by c.created_at desc),'[]') into campaigns from public.marketing_campaigns c where c.brand_id=p_brand;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from public.marketing_assets a where a.brand_id=p_brand and a.state='ready' and a.mime_type like 'image/%';
 if p_campaign is not null then
  if not exists(select 1 from public.marketing_campaigns where id=p_campaign and brand_id=p_brand) then raise exception 'Campaign unavailable.';end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into recipients from(select r.*,x.display_name,marketing_private.whatsapp_consent(p_brand,r.customer_id) is not null and x.revision=r.customer_revision and x.phone_e164=r.phone_e164 as eligible from public.marketing_campaign_recipients r join public.platform_customers x on x.id=r.customer_id where r.campaign_id=p_campaign order by case r.state when 'opened' then 0 when 'pending' then 1 else 2 end,r.id limit 50 offset (greatest(1,p_page)-1)*50)q;
  select coalesce(jsonb_object_agg(state,n),'{}') into counts from(select state,count(*) n from public.marketing_campaign_recipients where campaign_id=p_campaign group by state)t;
 end if;end if;campaigns:=coalesce(campaigns,'[]');assets:=coalesce(assets,'[]');
 return jsonb_build_object('tags',(select coalesce(jsonb_agg(name order by name),'[]') from public.platform_customer_tags where brand_id=p_brand and active),'tag_catalog',marketing_private.tags_read(p_brand),'customers',coalesce(customers,'[]'),'audiences',audiences,'campaigns',campaigns,'senders',senders,'assets',assets,'recipients',coalesce(recipients,'[]'),'progress',coalesce(counts,'{}'),'customer_total',(select count(*) from public.platform_customer_brands where brand_id=p_brand),'verified_delivery',null,'verified_redemptions',null,'cloud_api_available',false,'shared_customers',case when public.current_user_has_permission('platform_customers.manage') then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'phone',x.phone_e164)),'[]') from public.platform_customers x where x.organization_id=p_org and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and b.brand_id=p_brand) and exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id) and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and not marketing_private.brand_allowed(p_org,b.brand_id))) else '[]'::jsonb end,'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)),'[]') from public.brand_outlets b join public.outlets o on o.id=b.outlet_id where b.brand_id=p_brand));
end;$$;

