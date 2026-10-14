-- Managed brand tags extend Platform customer ownership; assignments retain their canonical text projection.
create table public.platform_customer_tags (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, brand_id uuid not null,
 name text not null check(length(name) between 1 and 60), normalized_name text not null,
 active boolean not null default true, redirect_id uuid,
 revision integer not null default 1, created_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id), unique(brand_id,normalized_name), unique(brand_id,id), foreign key(brand_id,redirect_id) references public.platform_customer_tags(brand_id,id)
);
alter table public.platform_customer_tags enable row level security;
revoke all on public.platform_customer_tags from public,anon,authenticated;
create function marketing_private.tag_key(p_name text) returns text language sql immutable set search_path=public as $$
 select lower(regexp_replace(trim(p_name),'\s+',' ','g'));
$$;
insert into public.platform_customer_tags(organization_id,brand_id,name,normalized_name)
 select organization_id,brand_id,min(regexp_replace(trim(t),'\s+',' ','g')),marketing_private.tag_key(t)
 from public.platform_customer_brands b cross join lateral unnest(b.tags) t where trim(t)<>'' group by organization_id,brand_id,marketing_private.tag_key(t);

create function marketing_private.tag_name(p_brand uuid,p_name text) returns text language sql stable set search_path=public as $$
 select coalesce(dest.name,case when src.active then src.name end) from public.platform_customer_tags src
 left join public.platform_customer_tags dest on dest.id=src.redirect_id and dest.brand_id=src.brand_id and dest.active
 where src.brand_id=p_brand and src.normalized_name=marketing_private.tag_key(p_name);
$$;
create function marketing_private.canonical_customer_tags() returns trigger language plpgsql security definer set search_path=public as $$
declare raw text;display text;resolved text;tags text[]:='{}';
begin
 perform 1 from public.brands where id=new.brand_id for update;
 if cardinality(new.tags)>20 then raise exception 'Use up to 20 tags.';end if;
 foreach raw in array new.tags loop
  display:=regexp_replace(trim(raw),'\s+',' ','g');
  if display is null or length(display) not between 1 and 60 then raise exception 'Tags must contain 1–60 characters.';end if;
  resolved:=marketing_private.tag_name(new.brand_id,display);
  if resolved is null then
   if exists(select 1 from public.platform_customer_tags where brand_id=new.brand_id and normalized_name=marketing_private.tag_key(display)) then raise exception 'This tag was removed. Reload tags before saving.';end if;
   insert into public.platform_customer_tags(organization_id,brand_id,name,normalized_name) values(new.organization_id,new.brand_id,display,marketing_private.tag_key(display)) returning name into resolved;
  end if;
  if not resolved=any(tags) then tags:=array_append(tags,resolved);end if;
 end loop;
 new.tags:=array(select t from unnest(tags) t order by t);return new;
end;$$;
create trigger platform_customer_brand_tags before insert or update of tags on public.platform_customer_brands for each row execute function marketing_private.canonical_customer_tags();
update public.platform_customer_brands set tags=tags;

create function marketing_private.tag_impact(p_brand uuid,p_name text) returns text language sql stable set search_path=public as $$
 select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(customer_id order by customer_id),'[]') from public.platform_customer_brands where brand_id=p_brand and p_name=any(tags)),
 (select coalesce(jsonb_agg(jsonb_build_array(id,revision) order by id),'[]') from public.marketing_audiences where brand_id=p_brand and (marketing_private.tag_name(p_brand,criteria->>'tag')=p_name or exists(select 1 from jsonb_array_elements_text(coalesce(criteria->'tags','[]')) x where marketing_private.tag_name(p_brand,x)=p_name))))::text);
$$;
create function marketing_private.tags_read(p_brand uuid) returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'revision',t.revision,
 'usage_count',(select count(*) from public.platform_customer_brands where brand_id=p_brand and t.name=any(tags)),
 'audience_count',(select count(*) from public.marketing_audiences where brand_id=p_brand and (marketing_private.tag_name(p_brand,criteria->>'tag')=t.name or exists(select 1 from jsonb_array_elements_text(coalesce(criteria->'tags','[]')) x where marketing_private.tag_name(p_brand,x)=t.name))),
 'impact_token',marketing_private.tag_impact(p_brand,t.name)) order by t.name),'[]') from public.platform_customer_tags t where t.brand_id=p_brand and t.active;
$$;
create function marketing_private.manage_customer_tag(p_org uuid,p_brand uuid,p_actor uuid,p_payload jsonb) returns jsonb language plpgsql set search_path=public as $$
declare t public.platform_customer_tags;target public.platform_customer_tags;display text;action text:=p_payload->>'action';cid uuid;affected uuid[]:='{}';
begin
 display:=regexp_replace(trim(p_payload->>'name'),'\s+',' ','g');
 if action not in ('tag_create','tag_rename','tag_merge','tag_delete') then raise exception 'Tag action unavailable.';end if;
 if action in ('tag_create','tag_rename') and (display is null or length(display) not between 1 and 60) then raise exception 'Tag name must contain 1–60 characters.';end if;
 if action<>'tag_create' then
  select * into t from public.platform_customer_tags where id=(p_payload->>'id')::uuid and brand_id=p_brand and active for update;
  if t.id is null or t.revision is distinct from (p_payload->>'revision')::integer then raise exception 'Tag changed. Reload tags.';end if;
  select coalesce(array_agg(id),'{}') into affected from public.marketing_audiences where brand_id=p_brand and (marketing_private.tag_name(p_brand,criteria->>'tag')=t.name or exists(select 1 from jsonb_array_elements_text(coalesce(criteria->'tags','[]')) x where marketing_private.tag_name(p_brand,x)=t.name));
  if action in ('tag_merge','tag_delete') and ((select count(*) from public.platform_customer_brands where brand_id=p_brand and t.name=any(tags))>0 or cardinality(affected)>0) then
   if p_payload->>'confirmed' is distinct from 'true' or p_payload->>'impact_token' is distinct from marketing_private.tag_impact(p_brand,t.name) then raise exception 'Review and confirm the current tag impact.';end if;
  end if;
 end if;
 if action='tag_create' then
  if exists(select 1 from public.platform_customer_tags where brand_id=p_brand and normalized_name=marketing_private.tag_key(display)) then raise exception 'Tag name already exists or is reserved by tag history.';end if;
  insert into public.platform_customer_tags(organization_id,brand_id,name,normalized_name) values(p_org,p_brand,display,marketing_private.tag_key(display)) returning id into cid;
 elsif action='tag_rename' and marketing_private.tag_key(display)=t.normalized_name then
  update public.platform_customer_tags set name=display,revision=revision+1 where id=t.id;
  update public.platform_customer_brands set tags=array_replace(tags,t.name,display) where brand_id=p_brand and t.name=any(tags);cid:=t.id;
 elsif action in ('tag_rename','tag_merge') then
  if action='tag_rename' then
   if exists(select 1 from public.platform_customer_tags where brand_id=p_brand and normalized_name=marketing_private.tag_key(display)) then raise exception 'Tag name already exists. Use Merge instead.';end if;
   insert into public.platform_customer_tags(organization_id,brand_id,name,normalized_name) values(p_org,p_brand,display,marketing_private.tag_key(display)) returning * into target;
  else
   select * into target from public.platform_customer_tags where id=(p_payload->>'target_id')::uuid and brand_id=p_brand and active and id<>t.id for update;
   if target.id is null or target.revision is distinct from (p_payload->>'target_revision')::integer then raise exception 'Select a current tag from this brand.';end if;
   affected:=affected||array(select id from public.marketing_audiences where brand_id=p_brand and (marketing_private.tag_name(p_brand,criteria->>'tag')=target.name or exists(select 1 from jsonb_array_elements_text(coalesce(criteria->'tags','[]')) x where marketing_private.tag_name(p_brand,x)=target.name))); 
  end if;
  update public.platform_customer_tags set active=false,redirect_id=target.id,revision=revision+1 where id=t.id or redirect_id=t.id;
  update public.platform_customer_brands set tags=array_replace(tags,t.name,target.name) where brand_id=p_brand and t.name=any(tags);cid:=target.id;
 else
  update public.platform_customer_brands set tags=array_remove(tags,t.name) where brand_id=p_brand and t.name=any(tags);
  update public.platform_customer_tags set active=false,redirect_id=null,revision=revision+1 where id=t.id or redirect_id=t.id;cid:=t.id;
 end if;
 -- Merge/removal changes live audience membership. Preserve definitions and queued snapshots;
 -- an unqueued approval must be reviewed again against the updated audience revision.
 if action in ('tag_merge','tag_delete') then
  update public.marketing_audiences set revision=revision+1 where brand_id=p_brand and id=any(affected);
 end if;
 insert into public.marketing_campaign_events(brand_id,action,actor_employee_id) values(p_brand,action,p_actor);
 return jsonb_build_object('id',cid);
end;$$;

-- Historical rule labels resolve through renamed/merged catalogue aliases; removed names stay retired.
create or replace function marketing_private.audience_matches(p_link public.platform_customer_brands,p_rules jsonb) returns boolean language sql stable set search_path=public as $$
 select (coalesce(p_rules->>'language','')='' or p_link.language=p_rules->>'language')
 and (coalesce(p_rules->>'tag','')='' or marketing_private.tag_name(p_link.brand_id,p_rules->>'tag')=any(p_link.tags))
 and (coalesce(p_rules->'tags','[]')='[]'::jsonb or p_link.tags && array(select marketing_private.tag_name(p_link.brand_id,x) from jsonb_array_elements_text(p_rules->'tags') x))
 and (coalesce(p_rules->>'outlet_id','')='' or p_link.outlet_id::text=p_rules->>'outlet_id');
$$;

alter table public.marketing_consent_evidence drop constraint marketing_consent_evidence_decision_check;
alter table public.marketing_consent_evidence add constraint marketing_consent_evidence_decision_check check(decision in ('granted','withdrawn','not_subscribed'));
create function marketing_private.contact_state(p_brand uuid,p_customer uuid) returns text language sql stable set search_path=public as $$
 select case when exists(select 1 from public.marketing_suppressions s where s.brand_id=p_brand and s.phone_e164=c.phone_e164)
 or (select e.decision='withdrawn' from public.marketing_consent_evidence e where e.brand_id=p_brand and e.customer_id=c.id order by record_order desc limit 1)
 then 'do_not_contact' when marketing_private.whatsapp_consent(p_brand,c.id) is not null then 'subscribed' else 'not_subscribed' end
 from public.platform_customers c where c.id=p_customer;
$$;
create or replace function public.platform_customer_command(p_request uuid,p_org uuid,p_brand uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');c public.platform_customers; cid uuid;fp text;old public.marketing_requests;phone text;
begin
 if p_brand is null or p_request is null then raise exception 'Select a brand and request identity.';end if;fp:=md5(jsonb_build_array('platform_customer',p_org,p_brand,p_payload)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into old from public.marketing_requests where request_id=p_request;if found then if old.actor_employee_id<>actor or old.fingerprint<>fp then raise exception 'Request changed.';end if;return old.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('platform_customer:'||p_org::text,0));
 perform 1 from public.brands where id=p_brand for update;
 if left(coalesce(p_payload->>'action',''),4)='tag_' then
  old.result:=marketing_private.manage_customer_tag(p_org,p_brand,actor,p_payload);
  insert into public.marketing_requests values(p_request,actor,fp,old.result);return old.result;
 end if;
 phone:=marketing_private.my_phone(p_payload->>'phone');
 if nullif(p_payload->>'customer_id','') is not null then
  cid:=(p_payload->>'customer_id')::uuid;select * into c from public.platform_customers where id=cid and organization_id=p_org for update;
  if c.id is null or not exists(select 1 from public.platform_customer_brands b where b.customer_id=cid and marketing_private.brand_allowed(p_org,b.brand_id)) or exists(select 1 from public.platform_customer_brands b where b.customer_id=cid and not marketing_private.brand_allowed(p_org,b.brand_id)) then raise exception using errcode='42501',message='Customer sharing requires access to all affected brands.';end if;
  if coalesce(p_payload->>'edit','false')<>'true' and exists(select 1 from public.platform_customer_brands where brand_id=p_brand and customer_id=cid) then raise exception 'Customer already belongs to this brand. Use Edit customer.';end if;
  if c.phone_e164<>phone then raise exception 'Shared phone changes require a separate verified identity workflow.';end if;
  if p_payload->>'edit'='true' then
   if c.revision is distinct from (p_payload->>'revision')::integer or marketing_private.customer_snapshot(p_brand,c.id) is distinct from p_payload->>'snapshot' then raise exception 'Customer changed. Reload before saving.';end if;
   if c.display_name is distinct from trim(p_payload->>'name') then
    if p_payload->>'confirm_name' is distinct from 'true' then raise exception 'Confirm the shared customer name change.';end if;
    update public.platform_customers set display_name=trim(p_payload->>'name'),revision=revision+1 where id=cid;
   end if;
  end if;

 else
  if exists(select 1 from public.platform_customers where organization_id=p_org and phone_e164=phone) then raise exception 'A customer with this number already exists. An authorized administrator must review brand sharing.';end if;
  insert into public.platform_customers(organization_id,display_name,phone_e164,created_by) values(p_org,trim(p_payload->>'name'),phone,actor) returning id into cid;
 end if;
 if nullif(p_payload->>'outlet_id','') is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id=(p_payload->>'outlet_id')::uuid) then raise exception 'Select an outlet belonging to this brand.';end if;
 insert into public.platform_customer_brands(organization_id,brand_id,customer_id,language,tags,outlet_id) values(p_org,p_brand,cid,coalesce(p_payload->>'language','EN'),array(select jsonb_array_elements_text(coalesce(p_payload->'tags','[]'))),nullif(p_payload->>'outlet_id','')::uuid) on conflict(brand_id,customer_id) do update set language=excluded.language,tags=excluded.tags,outlet_id=excluded.outlet_id where (platform_customer_brands.language,platform_customer_brands.tags,platform_customer_brands.outlet_id) is distinct from (excluded.language,excluded.tags,excluded.outlet_id);
 insert into public.marketing_requests values(p_request,actor,fp,jsonb_build_object('id',cid));return jsonb_build_object('id',cid);
end;$$;

create or replace function marketing_private.customer_import_row(p_org uuid,p_brand uuid,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare phone text; c public.platform_customers;b public.platform_customer_brands; v jsonb; diffs jsonb:='{}'; outlet uuid;tags text[]; k text; current_value jsonb;
begin
 if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'Each row must contain mapped customer fields.';end if;
 phone:=marketing_private.my_phone(trim(p_row->>'phone'));
 if length(trim(coalesce(p_row->>'name',''))) not between 1 and 160 then raise exception 'Name must contain 1–160 characters.';end if;
 if p_row-'row'-'name'-'phone'-'language'-'tags'-'outlet_id'<>'{}' then raise exception 'Unsupported mapped field.';end if;
 v:=jsonb_build_object('name',trim(p_row->>'name'),'phone',phone);
 if p_row ? 'language' then if coalesce(p_row->>'language','') not in ('EN','ZH','BM') then raise exception 'Language must be EN, ZH or BM.';end if;v:=v||jsonb_build_object('language',p_row->>'language');end if;
 if p_row ? 'tags' then
  if jsonb_typeof(p_row->'tags') is distinct from 'array' or jsonb_array_length(p_row->'tags')>20 then raise exception 'Use up to 20 tags.';end if;
  select coalesce(array_agg(t order by t),'{}') into tags from (select min(coalesce(marketing_private.tag_name(p_brand,x),regexp_replace(trim(x),'\s+',' ','g'))) t from jsonb_array_elements_text(p_row->'tags') x where trim(x)<>'' group by marketing_private.tag_key(x)) normalized;
  if exists(select 1 from unnest(tags) t join public.platform_customer_tags ct on ct.brand_id=p_brand and ct.normalized_name=marketing_private.tag_key(t) where marketing_private.tag_name(p_brand,t) is null) then raise exception 'This tag was removed. Use a current brand tag.';end if;
  if exists(select 1 from unnest(tags) t where length(t)>60) then raise exception 'Tags must be at most 60 characters.';end if;
  v:=v||jsonb_build_object('tags',to_jsonb(tags));
 end if;
 if p_row ? 'outlet_id' then
  outlet:=nullif(p_row->>'outlet_id','')::uuid;
  if outlet is not null and not exists(select 1 from public.brand_outlets where brand_id=p_brand and outlet_id=outlet) then raise exception 'Outlet is not assigned to this brand.';end if;
  v:=v||jsonb_build_object('outlet_id',outlet);
 end if;
 select * into c from public.platform_customers where organization_id=p_org and phone_e164=phone;
 if c.id is null then return jsonb_build_object('row',p_row->'row','classification','new','values',v,'snapshot','new');end if;
 select * into b from public.platform_customer_brands where brand_id=p_brand and customer_id=c.id;
 if b.customer_id is null or exists(select 1 from public.platform_customer_brands where customer_id=c.id and not marketing_private.brand_allowed(p_org,brand_id)) then
  return jsonb_build_object('row',p_row->'row','classification','conflict','values',v,'reason','Existing identity requires authorized brand-sharing review.');
 end if;
 if not c.active then return jsonb_build_object('row',p_row->'row','classification','conflict','values',v,'reason','Inactive customer requires identity review.');end if;
 foreach k in array array['name','language','tags','outlet_id'] loop
  if not (v ? k) then continue;end if;
  current_value:=case k when 'name' then to_jsonb(c.display_name) when 'language' then to_jsonb(b.language) when 'tags' then (select coalesce(jsonb_agg(t order by t),'[]') from unnest(b.tags) t) else coalesce(to_jsonb(b.outlet_id),'null') end;
  if current_value is distinct from v->k then diffs:=diffs||jsonb_build_object(k,jsonb_build_object('before',current_value,'after',v->k));end if;
 end loop;
 return jsonb_build_object('row',p_row->'row','classification',case when diffs='{}' then 'unchanged' else 'review' end,'customer_id',c.id,'revision',c.revision,'snapshot',marketing_private.customer_snapshot(p_brand,c.id),'values',v,'differences',diffs);
exception when invalid_text_representation then return jsonb_build_object('row',p_row->'row','classification','invalid','reason','Invalid outlet or field format.');
 when raise_exception then return jsonb_build_object('row',p_row->'row','classification','invalid','reason',sqlerrm);
end;$$;

create or replace function public.marketing_outreach_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;fp text;old public.marketing_requests;result jsonb;cid uuid:=p_id;c public.marketing_campaigns;a public.marketing_audiences;r public.marketing_campaign_recipients;cu public.platform_customers;link public.platform_customer_brands;consent uuid;permission text;count_n integer;rules jsonb;
begin
 permission:=case when p_action in ('contact_preference','consent','suppress','unsuppress','audience') then 'marketing_audience.manage' when p_action='approve' then 'marketing_campaigns.approve' when p_action in ('queue','open','confirm','skip','inspect') then 'marketing_campaigns.execute' when p_action='sender' then 'marketing_settings.configure' else 'marketing_campaigns.manage' end;
 actor:=marketing_private.require_access(p_org,p_brand,permission);if p_brand is null or p_request is null then raise exception 'Select a brand.';end if;
 fp:=md5(jsonb_build_array('outreach',p_org,p_brand,p_action,p_id,p_payload)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into old from public.marketing_requests where request_id=p_request;
 -- Recipient actions always recheck live eligibility, even on an identical retry.
 if found and (old.actor_employee_id<>actor or old.fingerprint<>fp) then raise exception 'Request changed.';end if;
 if old.request_id is not null and p_action not in ('open','confirm','skip','inspect') then return old.result;end if;
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
 if p_action in ('contact_preference','consent','suppress','unsuppress','audience','sender') then insert into public.marketing_campaign_events(brand_id,action,actor_employee_id) values(p_brand,p_action,actor);end if;
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
 return jsonb_build_object('tags',(select coalesce(jsonb_agg(name order by name),'[]') from public.platform_customer_tags where brand_id=p_brand and active),'tag_catalog',marketing_private.tags_read(p_brand),'customers',coalesce(customers,'[]'),'audiences',audiences,'campaigns',campaigns,'senders',senders,'assets',assets,'recipients',coalesce(recipients,'[]'),'progress',coalesce(counts,'{}'),'customer_total',(select count(*) from public.platform_customer_brands where brand_id=p_brand),'verified_delivery',null,'verified_redemptions',null,'cloud_api_available',false,'shared_customers',case when public.current_user_has_permission('platform_customers.manage') then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'phone',x.phone_e164)),'[]') from public.platform_customers x where x.organization_id=p_org and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and b.brand_id=p_brand) and exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id) and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and not marketing_private.brand_allowed(p_org,b.brand_id))) else '[]'::jsonb end,'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)),'[]') from public.brand_outlets b join public.outlets o on o.id=b.outlet_id where b.brand_id=p_brand));
end;$$;

create or replace function public.marketing_customers_read(p_org uuid,p_brand uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_audience.view');result jsonb;lim integer:=case when p_size in(20,50,100) then p_size else 20 end;
begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 if nullif(p_filters->>'segment','') is not null and not exists(select 1 from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand) then raise exception 'Segment unavailable.';end if;
 if p_filters ? 'tags' and jsonb_typeof(p_filters->'tags') is distinct from 'array' then raise exception 'Invalid tag filter.';end if;
 with customers as (
 select c.id,c.display_name,c.phone_e164,c.revision,c.active,marketing_private.contact_state(p_brand,c.id) contact_state,b.language,b.tags,b.outlet_id,o.name outlet_name,br.name brand_name,
 marketing_private.customer_snapshot(p_brand,c.id) snapshot,marketing_private.whatsapp_consent(p_brand,c.id) is not null eligible,
 exists(select 1 from public.marketing_suppressions where brand_id=p_brand and phone_e164=c.phone_e164) suppressed,
 (select to_jsonb(e)-'phone_e164' from public.marketing_consent_evidence e where brand_id=p_brand and customer_id=c.id order by record_order desc limit 1) consent,
 (select max(coalesce(r.confirmed_at,r.opened_at)) from public.marketing_campaign_recipients r join public.marketing_campaigns ca on ca.id=r.campaign_id where r.customer_id=c.id and ca.brand_id=p_brand) last_activity,
 case when p_filters->>'detail'=c.id::text then jsonb_build_object(
 'consent_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.record_order desc) from (select e.decision,e.source,e.evidence,e.occurred_at,e.recorded_at,e.expires_at,e.record_order,(select full_name from public.employees where id=e.actor_employee_id) actor_name from public.marketing_consent_evidence e where e.brand_id=p_brand and e.customer_id=c.id order by record_order desc limit 50) h),'[]'::jsonb),
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
 ), filtered as(select * from customers where coalesce(p_filters->>'consent','')='' or (p_filters->>'consent'='eligible' and eligible) or (p_filters->>'consent' in ('suppressed','do_not_contact') and contact_state='do_not_contact') or (p_filters->>'consent' in ('required','not_subscribed') and contact_state='not_subscribed') or (p_filters->>'consent'='subscribed' and contact_state='subscribed')), page as (
 select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from filtered)) into result;
 return result||jsonb_build_object('summary',(
 select jsonb_build_object('total',count(*),'subscribed',count(*) filter(where state='subscribed'),'not_subscribed',count(*) filter(where state='not_subscribed'),'do_not_contact',count(*) filter(where state='do_not_contact'))
 from (select marketing_private.contact_state(p_brand,c.id) state from public.platform_customers c join public.platform_customer_brands b on b.customer_id=c.id where b.brand_id=p_brand and b.organization_id=p_org and c.organization_id=p_org) all_customers));
end;$$;

revoke all on function marketing_private.tag_key(text),marketing_private.tag_name(uuid,text),marketing_private.canonical_customer_tags(),marketing_private.tag_impact(uuid,text),marketing_private.tags_read(uuid),marketing_private.manage_customer_tag(uuid,uuid,uuid,jsonb),marketing_private.contact_state(uuid,uuid) from public,anon,authenticated;
