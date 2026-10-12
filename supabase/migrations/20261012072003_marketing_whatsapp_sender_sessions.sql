-- Manual declarations are not provider-verified connections. Historical recipient identity is immutable.
alter table public.marketing_whatsapp_senders add column revision integer not null default 1 check(revision>0), add column is_default boolean not null default false;
create unique index marketing_whatsapp_one_default on public.marketing_whatsapp_senders(brand_id) where is_default;
alter table public.marketing_whatsapp_senders add constraint marketing_whatsapp_active_default check(not is_default or active);
-- Existing registrations have no chosen default; do not invent one during migration.
create table marketing_private.whatsapp_staff_sessions(
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.marketing_campaigns(id), campaign_revision integer not null,
 sender_id uuid not null references public.marketing_whatsapp_senders(id), sender_revision integer not null,
 sender_snapshot jsonb not null, actor_employee_id uuid not null references public.employees(id),
 auth_session_id uuid not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '8 hours', ended_at timestamptz
);
alter table marketing_private.whatsapp_staff_sessions enable row level security;
revoke all on marketing_private.whatsapp_staff_sessions from public,anon,authenticated;
create index whatsapp_staff_sessions_campaign_actor on marketing_private.whatsapp_staff_sessions(campaign_id,actor_employee_id,auth_session_id) where ended_at is null;
alter table public.marketing_campaign_recipients add column sender_snapshot jsonb, add column sender_session_id uuid references marketing_private.whatsapp_staff_sessions(id);
-- Baseline only: old actions retained sender ID but not immutable name/number; label this evidence accurately.
update public.marketing_campaign_recipients r set sender_snapshot=jsonb_build_object('label',s.label,'phone_e164',s.phone_e164,'revision',s.revision,'provenance','registration_at_snapshot_migration') from public.marketing_whatsapp_senders s where r.sender_id=s.id;
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
 if p_action in ('contact_preference','consent','suppress','unsuppress','audience','sender','sender_edit','sender_default','sender_disable') then insert into public.marketing_campaign_events(brand_id,action,actor_employee_id) values(p_brand,p_action,actor);end if;
 result:=coalesce(result,jsonb_build_object('id',coalesce(cid,p_id)));if old.request_id is null then insert into public.marketing_requests values(p_request,actor,fp,case when p_action in ('open','confirm','skip','inspect') then result-'phone'-'caption' else result end);end if;return result;
end;$$;


revoke all on function public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;
