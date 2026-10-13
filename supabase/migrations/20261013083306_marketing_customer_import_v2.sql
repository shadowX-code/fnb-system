-- Extend the canonical customer import. POS snapshots never write financial/loyalty ledgers.
alter table public.platform_customers add column email text, add column gender text, add column birthday date;
alter table public.platform_customers add constraint customer_gender_valid check(gender in ('male','female','other','unspecified'));
create table marketing_private.customer_pos_snapshots (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 brand_id uuid not null references public.brands, customer_id uuid not null references public.platform_customers,
 source text not null check(length(source) between 1 and 80), snapshot_date date not null,
 metrics jsonb not null, fingerprint text not null, imported_at timestamptz not null default clock_timestamp(),
 import_request uuid not null, import_job_id uuid, actor_employee_id uuid not null references public.employees,
 unique(brand_id,customer_id,source,snapshot_date,fingerprint)
);
create index customer_pos_latest on marketing_private.customer_pos_snapshots(brand_id,customer_id,source,snapshot_date desc,imported_at desc);
create table marketing_private.customer_import_mappings (
 brand_id uuid not null references public.brands, source text not null check(length(source) between 1 and 80),
 headers jsonb not null,mapping jsonb not null,updated_at timestamptz not null default now(),primary key(brand_id,source)
);
create table marketing_private.customer_import_jobs (
 id uuid primary key,organization_id uuid not null references public.organizations,brand_id uuid not null references public.brands,
 actor_employee_id uuid not null references public.employees,actor_auth_id uuid not null references auth.users,
 source text not null,snapshot_date date not null,file_name text not null,total integer not null check(total between 1 and 10000),
 fingerprint text not null,state text not null default 'uploading' check(state in('uploading','queued','running','completed','attention')),
 processed integer not null default 0,attempts integer not null default 0,error text,error_code text,
 created_at timestamptz not null default now(),checked_at timestamptz not null default now(),completed_at timestamptz
);
alter table marketing_private.customer_pos_snapshots add constraint customer_pos_job_fk foreign key(import_job_id) references marketing_private.customer_import_jobs;
create index customer_import_pending on marketing_private.customer_import_jobs(checked_at) where state in('queued','running');
create table marketing_private.customer_import_rows (
 job_id uuid not null references marketing_private.customer_import_jobs on delete cascade,row_number integer not null,
 input jsonb not null,decision jsonb not null,fingerprint text not null,phone text,outcome jsonb,
 primary key(job_id,row_number)
);
create index customer_import_phone on marketing_private.customer_import_rows(job_id,phone);
alter table marketing_private.customer_pos_snapshots enable row level security;
alter table marketing_private.customer_import_mappings enable row level security;
alter table marketing_private.customer_import_jobs enable row level security;
alter table marketing_private.customer_import_rows enable row level security;
revoke all on marketing_private.customer_pos_snapshots,marketing_private.customer_import_mappings,marketing_private.customer_import_jobs,marketing_private.customer_import_rows from public,anon,authenticated;

create function marketing_private.customer_import_date(p_value text) returns date
language plpgsql immutable set search_path=public as $$
declare v date;
begin
 if p_value is null then return null;end if;
 if p_value ~ '^\d{2}/\d{2}/\d{4}$' then v:=to_date(p_value,'DD/MM/YYYY');if to_char(v,'DD/MM/YYYY')<>p_value then raise exception 'Use a valid DD/MM/YYYY date.';end if;
 elsif p_value ~ '^\d{4}-\d{2}-\d{2}$' then v:=p_value::date;
 else raise exception 'Use DD/MM/YYYY or YYYY-MM-DD dates.';end if;return v;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Use a valid DD/MM/YYYY date.';
end;$$;
create function marketing_private.customer_pos_current(p_brand uuid,p_customer uuid,p_source text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('metrics',metrics,'snapshot_date',snapshot_date,'source',source,'imported_at',imported_at)
 from marketing_private.customer_pos_snapshots where brand_id=p_brand and customer_id=p_customer and source=p_source
 order by snapshot_date desc,imported_at desc limit 1;
$$;

CREATE OR REPLACE FUNCTION public.platform_customer_command(p_request uuid, p_org uuid, p_brand uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 -- Profile changes share the existing canonical identity/all-Brand authority and revision.
 if p_payload ? 'email' and nullif(trim(p_payload->>'email'),'') is not null and (length(p_payload->>'email')>254 or p_payload->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Enter a valid email address.';end if;
 if p_payload ? 'gender' and p_payload->>'gender' not in('male','female','other','unspecified') then raise exception 'Invalid gender.';end if;
 if nullif(p_payload->>'birthday','') is not null and marketing_private.customer_import_date(p_payload->>'birthday')>current_date then raise exception 'Birthday cannot be in the future.';end if;
 update public.platform_customers set email=coalesce(nullif(trim(p_payload->>'email'),''),email),
 gender=coalesce(nullif(p_payload->>'gender',''),gender),birthday=coalesce(marketing_private.customer_import_date(nullif(p_payload->>'birthday','')),birthday),revision=revision+1
 where id=cid and ((nullif(trim(p_payload->>'email'),'') is not null and email is distinct from trim(p_payload->>'email')) or
 (nullif(p_payload->>'gender','') is not null and gender is distinct from p_payload->>'gender') or
 (nullif(p_payload->>'birthday','') is not null and birthday is distinct from marketing_private.customer_import_date(p_payload->>'birthday')));
 insert into public.marketing_requests values(p_request,actor,fp,jsonb_build_object('id',cid));return jsonb_build_object('id',cid);
end;$function$
;
CREATE OR REPLACE FUNCTION marketing_private.customer_snapshot(p_brand uuid, p_customer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select md5(jsonb_build_array(c.id,c.revision,c.display_name,c.phone_e164,c.active,c.email,c.gender,c.birthday,b.language,b.tags,b.outlet_id,
  (select max(record_order) from public.marketing_consent_evidence where brand_id=p_brand and customer_id=c.id),
  (select created_at from public.marketing_suppressions where brand_id=p_brand and phone_e164=c.phone_e164),
  (select jsonb_agg(id order by id) from marketing_private.customer_pos_snapshots where brand_id=p_brand and customer_id=c.id),
  (select jsonb_agg(brand_id order by brand_id) from public.platform_customer_brands where customer_id=c.id))::text)
 from public.platform_customers c join public.platform_customer_brands b on b.customer_id=c.id and b.brand_id=p_brand where c.id=p_customer;
$function$
;
CREATE OR REPLACE FUNCTION public.marketing_customers_read(p_org uuid, p_brand uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_audience.view');result jsonb;lim integer:=case when p_size in(20,50,100) then p_size else 20 end;
begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 if nullif(p_filters->>'segment','') is not null and not exists(select 1 from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand) then raise exception 'Segment unavailable.';end if;
 if p_filters ? 'tags' and jsonb_typeof(p_filters->'tags') is distinct from 'array' then raise exception 'Invalid tag filter.';end if;
 with customers as (
 select c.id,c.display_name,c.phone_e164,c.email,c.gender,c.birthday,c.revision,c.active,marketing_private.contact_state(p_brand,c.id) contact_state,b.language,b.tags,b.outlet_id,o.name outlet_name,br.name brand_name,
 marketing_private.customer_snapshot(p_brand,c.id) snapshot,marketing_private.whatsapp_consent(p_brand,c.id) is not null eligible,
 exists(select 1 from public.marketing_suppressions where brand_id=p_brand and phone_e164=c.phone_e164) suppressed,
 (select to_jsonb(e)-'phone_e164' from public.marketing_consent_evidence e where brand_id=p_brand and customer_id=c.id order by record_order desc limit 1) consent,
 (select max(coalesce(r.confirmed_at,r.opened_at)) from public.marketing_campaign_recipients r join public.marketing_campaigns ca on ca.id=r.campaign_id where r.customer_id=c.id and ca.brand_id=p_brand) last_activity,
 case when p_filters->>'detail'=c.id::text then jsonb_build_object(
 'pos_snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from (select distinct on(source) source,snapshot_date,metrics,imported_at from marketing_private.customer_pos_snapshots where brand_id=p_brand and customer_id=c.id order by source,snapshot_date desc,imported_at desc)s),'[]'::jsonb),
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
end;$function$
;

alter function marketing_private.customer_import_row(uuid,uuid,jsonb) rename to customer_import_contact_row;
create function marketing_private.customer_import_row(p_org uuid,p_brand uuid,p_row jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare base jsonb;v jsonb;diffs jsonb;k text;value text;cu public.platform_customers;pos jsonb;metrics jsonb:='{}';current_metrics jsonb;current_value jsonb;snapshot_date date;source text;
begin
 if p_row-'row'-'name'-'phone'-'language'-'tags'-'outlet_id'-'brand'-'email'-'gender'-'birthday'-'total_visit'-'avg_spent'-'total_spent'-'last_visit'-'member_since'-'_source'-'_snapshot_date'<>'{}' then raise exception 'Unsupported mapped field. Consent and suppression cannot be imported.';end if;
 -- Blank optional cells never erase existing data.
 for k in select jsonb_object_keys(p_row) loop if p_row->k='null' or (jsonb_typeof(p_row->k)='string' and trim(p_row->>k)='') then p_row:=p_row-k;end if;end loop;
 if p_row ? 'brand' and not exists(select 1 from public.brands where id=p_brand and (id::text=p_row->>'brand' or lower(trim(name))=lower(trim(p_row->>'brand')))) then raise exception 'Brand must match the selected canonical Brand.';end if;
 select * into cu from public.platform_customers where organization_id=p_org and phone_e164=marketing_private.my_phone(p_row->>'phone');
 if p_row ? 'tags' then
  if jsonb_typeof(p_row->'tags') is distinct from 'array' or jsonb_array_length(p_row->'tags')>20 then raise exception 'Use up to 20 tags.';end if;
  p_row:=jsonb_set(p_row,'{tags}',(select coalesce(jsonb_agg(t),'[]') from (select distinct jsonb_array_elements_text(p_row->'tags') t union select unnest(b.tags) from public.platform_customer_brands b where b.brand_id=p_brand and b.customer_id=cu.id)x));
 end if;
 base:=marketing_private.customer_import_contact_row(p_org,p_brand,p_row-'brand'-'email'-'gender'-'birthday'-'total_visit'-'avg_spent'-'total_spent'-'last_visit'-'member_since'-'_source'-'_snapshot_date');
 if base->>'classification' in('invalid','conflict') then return base;end if;
 v:=base->'values';diffs:=coalesce(base->'differences','{}');
 foreach k in array array['email','gender','birthday','total_visit','avg_spent','total_spent','last_visit','member_since'] loop
  value:=trim(p_row->>k);if value is null then continue;end if;
  if k='email' then if length(value)>254 or value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid email address.';end if;v:=v||jsonb_build_object(k,value);
  elsif k='gender' then
   value:=case lower(value) when 'm' then 'male' when 'f' then 'female' when '男' then 'male' when '女' then 'female' else lower(value) end;
   if value not in('male','female','other','unspecified') then raise exception 'Gender must be Male, Female, Other or Unspecified.';end if;v:=v||jsonb_build_object(k,value);
  elsif k in('birthday','last_visit','member_since') then
   if marketing_private.customer_import_date(value)>current_date then raise exception '% cannot be in the future.',replace(k,'_',' ');end if;
   v:=v||jsonb_build_object(k,marketing_private.customer_import_date(value));
  elsif k='total_visit' then
   if value !~ '^\d{1,9}$' then raise exception 'Total Visit must be a nonnegative whole number (up to 999999999).';end if;v:=v||jsonb_build_object(k,value::integer);
  else
   value:=regexp_replace(value,'^(RM|MYR)\s*','','i');
   if value !~ '^(\d{1,12}|\d{1,3}(,\d{3}){1,3})(\.\d{1,2})?$' then raise exception '% must be a nonnegative MYR amount with up to two decimal places.',replace(k,'_',' ');end if;
   v:=v||jsonb_build_object(k,replace(value,',','')::numeric);
  end if;
 end loop;
 if v ?| array['total_visit','avg_spent','total_spent','last_visit','member_since'] then
  source:=trim(p_row->>'_source');snapshot_date:=marketing_private.customer_import_date(p_row->>'_snapshot_date');
  if source is null or length(source) not between 1 and 80 or snapshot_date is null or snapshot_date>current_date then raise exception 'POS metrics require a source and valid snapshot date.';end if;
  pos:=marketing_private.customer_pos_current(p_brand,cu.id,source);current_metrics:=coalesce(pos->'metrics','{}');
  foreach k in array array['total_visit','avg_spent','total_spent','last_visit','member_since'] loop if v ? k then metrics:=metrics||jsonb_build_object(k,v->k);end if;end loop;
  if pos is not null and current_metrics||metrics is distinct from current_metrics then
   if snapshot_date<(pos->>'snapshot_date')::date then raise exception 'Older POS snapshot cannot replace current metrics. Review the source date.';end if;
   if snapshot_date=(pos->>'snapshot_date')::date then raise exception 'Conflicting POS values for the same source and snapshot date. Review the source export.';end if;
   foreach k in array array['total_visit','total_spent','last_visit'] loop if metrics ? k and current_metrics ? k and (case when k='last_visit' then (metrics->>k)::date<(current_metrics->>k)::date else (metrics->>k)::numeric<(current_metrics->>k)::numeric end) then raise exception 'Cumulative POS values cannot regress. Review the source export.';end if;end loop;
   if metrics ? 'member_since' and current_metrics ? 'member_since' and metrics->'member_since' is distinct from current_metrics->'member_since' then raise exception 'Member Since conflicts with existing source evidence.';end if;
  end if;
  v:=v||jsonb_build_object('_source',source,'_snapshot_date',snapshot_date);
 end if;
 if base->>'classification' <> 'new' then
  foreach k in array array['email','gender','birthday','total_visit','avg_spent','total_spent','last_visit','member_since'] loop
   if not(v ? k) then continue;end if;
   current_value:=case k when 'email' then to_jsonb(cu.email) when 'gender' then to_jsonb(cu.gender) when 'birthday' then to_jsonb(cu.birthday) else current_metrics->k end;
   if coalesce(current_value,'null') is distinct from v->k then diffs:=diffs||jsonb_build_object(k,jsonb_build_object('before',current_value,'after',v->k));end if;
  end loop;
  base:=base||jsonb_build_object('classification',case when diffs='{}' then 'unchanged' else 'review' end,'differences',diffs);
 end if;
 return base||jsonb_build_object('values',v);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
 return jsonb_build_object('row',p_row->'row','classification','invalid','reason','Invalid field format. Review dates, amounts and the canonical Outlet.');
 when raise_exception then
 return jsonb_build_object('row',p_row->'row','classification',case when sqlerrm like '%snapshot%' or sqlerrm like '%regress%' or sqlerrm like 'Member Since conflicts%' then 'conflict' else 'invalid' end,'reason',sqlerrm);
end;$$;

create function marketing_private.customer_import_pos_write(p_org uuid,p_brand uuid,p_customer uuid,p_request uuid,p_values jsonb,p_fields jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v_metrics jsonb:='{}';k text;v_source text:=p_values->>'_source';
begin
 foreach k in array array['total_visit','avg_spent','total_spent','last_visit','member_since'] loop
  if p_values ? k and (p_fields is null or p_fields ? k) then v_metrics:=v_metrics||jsonb_build_object(k,p_values->k);end if;
 end loop;
 if v_metrics='{}' then return;end if;
 v_metrics:=coalesce(marketing_private.customer_pos_current(p_brand,p_customer,v_source)->'metrics','{}')||v_metrics;
 insert into marketing_private.customer_pos_snapshots(organization_id,brand_id,customer_id,source,snapshot_date,metrics,fingerprint,import_request,actor_employee_id)
 values(p_org,p_brand,p_customer,v_source,(p_values->>'_snapshot_date')::date,v_metrics,md5(v_metrics::text),p_request,marketing_private.require_access(p_org,p_brand,'platform_customers.manage')) on conflict(brand_id,customer_id,source,snapshot_date,fingerprint) do nothing;
end;$$;

create or replace function public.platform_customer_import_commit(p_request uuid,p_org uuid,p_brand uuid,p_rows jsonb,p_decisions jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');fp text;old public.marketing_requests; preview jsonb;r jsonb;d jsonb; source jsonb;payload jsonb;result jsonb;results jsonb:='[]';k text;cu public.platform_customers;b public.platform_customer_brands;status text;changed boolean;err text;
begin
 if p_request is null or p_brand is null or jsonb_typeof(p_decisions) is distinct from 'object' or octet_length(p_decisions::text)>1000000 then raise exception 'Invalid import request.';end if;
 fp:=md5(jsonb_build_array('customer_import',p_org,p_brand,p_rows,p_decisions)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.marketing_requests where request_id=p_request;
 if found then if old.actor_employee_id<>actor or old.fingerprint<>fp then raise exception 'Import request changed.';end if;return old.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('platform_customer:'||p_org::text,0));
 perform 1 from public.brands where id=p_brand for update;
 preview:=public.platform_customer_import_preview(p_org,p_brand,p_rows);
 -- Lock visible matches and their relationships before computing fresh differences.
 perform 1 from public.platform_customers where organization_id=p_org and id in(select (value->>'customer_id')::uuid from jsonb_array_elements(preview->'rows') where value ? 'customer_id') order by id for update;
 perform 1 from public.platform_customer_brands where brand_id=p_brand and customer_id in(select (value->>'customer_id')::uuid from jsonb_array_elements(preview->'rows') where value ? 'customer_id') order by customer_id for update;
 preview:=public.platform_customer_import_preview(p_org,p_brand,p_rows);
 for r in select value from jsonb_array_elements(preview->'rows') loop
  d:=p_decisions->(r->>'row');status:='skipped';err:=null;changed:=false;
  begin
   if r->>'classification' in ('invalid','conflict') then status:=r->>'classification';err:=r->>'reason';
   elsif r->>'classification'='unchanged' then status:='unchanged';
   elsif d is null or coalesce(d->>'selected','false')<>'true' then status:='skipped';
   elsif d->>'snapshot' is distinct from r->>'snapshot' then status:='conflict';err:='Customer changed since preview. Validate the file again.';
   elsif r->>'classification'='new' then
    result:=public.platform_customer_command(gen_random_uuid(),p_org,p_brand,r->'values');perform marketing_private.customer_import_pos_write(p_org,p_brand,(result->>'id')::uuid,p_request,r->'values',null);status:='created';
   else
    if jsonb_typeof(d->'fields') is distinct from 'array' or jsonb_array_length(d->'fields')=0 then raise exception 'Select the exact fields to update.';end if;
    select * into cu from public.platform_customers where id=(r->>'customer_id')::uuid;
    select * into b from public.platform_customer_brands where brand_id=p_brand and customer_id=cu.id;
    payload:=jsonb_build_object('customer_id',cu.id,'name',cu.display_name,'phone',cu.phone_e164,'language',b.language,'tags',to_jsonb(b.tags),'outlet_id',b.outlet_id,'edit',true,'revision',cu.revision,'snapshot',r->>'snapshot','confirm_name',true);
    for k in select jsonb_array_elements_text(d->'fields') loop
     if k not in ('name','language','tags','outlet_id','email','gender','birthday','total_visit','avg_spent','total_spent','last_visit','member_since') or not (r->'differences' ? k) then raise exception 'Selected field is not a reviewed difference.';end if;
     payload:=payload||jsonb_build_object(k,r->'values'->k);changed:=true;
    end loop;
    if changed then result:=public.platform_customer_command(gen_random_uuid(),p_org,p_brand,payload);perform marketing_private.customer_import_pos_write(p_org,p_brand,cu.id,p_request,r->'values',d->'fields');status:='updated';end if;
   end if;
  exception when raise_exception or check_violation or unique_violation or invalid_text_representation then status:='conflict';err:=case when sqlstate='23505' then 'Customer identity changed. Validate again.' else sqlerrm end;
  end;
  results:=results||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('row',r->'row','status',status,'reason',err,'fields',case when status='updated' then d->'fields' else null end)));
 end loop;
 result:=jsonb_build_object('rows',results,'completed_at',clock_timestamp());
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
end;$$;


create function public.platform_customer_import_job(p_org uuid,p_brand uuid,p_action text,p_job uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');j marketing_private.customer_import_jobs;r jsonb;v jsonb;i integer;fp text;phone text;source_name text:=trim(p_payload->>'source');
begin
 if p_brand is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'Invalid import context or batch.';end if;
 if p_action='mapping_read' then
  return jsonb_build_object('mapping',(select to_jsonb(m)-'brand_id' from marketing_private.customer_import_mappings m where m.brand_id=p_brand and m.source=source_name));
 elsif p_action='mapping_save' then
  if length(source_name) not between 1 and 80 or source_name is null or jsonb_typeof(p_payload->'headers') is distinct from 'array' or jsonb_array_length(p_payload->'headers') not between 1 and 100 or jsonb_typeof(p_payload->'mapping') is distinct from 'object' then raise exception 'Select a POS source and valid field mapping.';end if;
  if not(p_payload->'mapping' ?& array['name','phone']) or p_payload->'mapping'->>'name'='' or p_payload->'mapping'->>'phone'='' then raise exception 'Map Name and Phone.';end if;
  for r in select jsonb_build_object('key',key,'value',value) from jsonb_each_text(p_payload->'mapping') loop
   if r->>'key' not in('name','phone','email','gender','birthday','total_visit','avg_spent','total_spent','last_visit','member_since','tags','brand','outlet_id','language') or (r->>'value'<>'' and not(p_payload->'headers' ? (r->>'value'))) then raise exception 'Mapping contains an unsupported field or unavailable source column.';end if;
  end loop;
  if (select count(*) from jsonb_each_text(p_payload->'mapping') where value<>'')<>(select count(distinct value) from jsonb_each_text(p_payload->'mapping') where value<>'') then raise exception 'Each source column can map to only one field.';end if;
  insert into marketing_private.customer_import_mappings values(p_brand,source_name,p_payload->'headers',p_payload->'mapping',now()) on conflict(brand_id,source) do update set headers=excluded.headers,mapping=excluded.mapping,updated_at=now();return jsonb_build_object('saved',true);
 elsif p_action='history' then
  return jsonb_build_object('jobs',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,source,snapshot_date,file_name,total,state,processed,error,created_at,completed_at from marketing_private.customer_import_jobs where brand_id=p_brand and organization_id=p_org order by created_at desc limit 50)x),'[]'));
 elsif p_action='begin' then
  if p_job is null or source_name is null or length(source_name) not between 1 and 80 or length(coalesce(p_payload->>'file_name','')) not between 1 and 160 or (p_payload->>'total')::integer not between 1 and 10000 or marketing_private.customer_import_date(p_payload->>'snapshot_date') is null or marketing_private.customer_import_date(p_payload->>'snapshot_date')>current_date or length(coalesce(p_payload->>'file_digest',''))<>64 then raise exception 'Use a source, snapshot date and file with 1–10,000 rows.';end if;
  fp:=md5(jsonb_build_array(p_org,p_brand,p_payload)::text);
  insert into marketing_private.customer_import_jobs(id,organization_id,brand_id,actor_employee_id,actor_auth_id,source,snapshot_date,file_name,total,fingerprint) values(p_job,p_org,p_brand,actor,auth.uid(),source_name,marketing_private.customer_import_date(p_payload->>'snapshot_date'),p_payload->>'file_name',(p_payload->>'total')::integer,fp) on conflict(id) do nothing;
  select * into j from marketing_private.customer_import_jobs where id=p_job;
  if j.actor_employee_id<>actor or j.fingerprint<>fp then raise exception 'Import request changed. Start a new import.';end if;
 end if;
 if p_action in('upload','confirm','retry') then
  select * into j from marketing_private.customer_import_jobs where id=p_job and organization_id=p_org and brand_id=p_brand for update;
 else select * into j from marketing_private.customer_import_jobs where id=p_job and organization_id=p_org and brand_id=p_brand;end if;
 if j.id is null then raise exception 'Import unavailable for this Brand.';end if;
 if p_action in('upload','confirm','retry') and j.actor_employee_id<>actor then raise exception 'Only the confirming importer can resume this job.';end if;
 if p_action='upload' then
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 250 or (p_payload->>'start')::integer<1 or (p_payload->>'start')::integer+jsonb_array_length(p_payload->'rows')-1>j.total then raise exception 'Use bounded import batches of up to 250 rows.';end if;
  i:=(p_payload->>'start')::integer;
  for r in select value from jsonb_array_elements(p_payload->'rows') loop
   v:=r->'input'||jsonb_build_object('_source',j.source,'_snapshot_date',j.snapshot_date);fp:=md5(jsonb_build_array(v,r->'decision')::text);
   if exists(select 1 from marketing_private.customer_import_rows where job_id=j.id and row_number=i and fingerprint<>fp) then raise exception 'Uploaded batch changed. Start a new import.';end if;
   if j.state='uploading' then
    phone:=null;begin phone:=marketing_private.my_phone(v->>'phone');exception when raise_exception then null;end;
    if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(r->'decision') is distinct from 'object' then raise exception 'Invalid row approval.';end if;
    insert into marketing_private.customer_import_rows values(j.id,i,v,r->'decision',fp,phone,null) on conflict do nothing;
   end if;i:=i+1;
  end loop;
 elsif p_action='confirm' then
  if j.state='uploading' then
   if (select count(*) from marketing_private.customer_import_rows where job_id=j.id)<>j.total then raise exception 'Upload is incomplete. Resume the same file.';end if;
   update marketing_private.customer_import_jobs set state='queued',checked_at=now() where id=j.id;
  end if;
 elsif p_action='retry' then
  if j.state<>'attention' or j.attempts>=3 then raise exception 'This import cannot be retried automatically. Review its results.';end if;
  update marketing_private.customer_import_jobs set state='queued',error=null,checked_at=now() where id=j.id;
 elsif p_action not in('begin','read') then raise exception 'Unsupported import action.';end if;
 select * into j from marketing_private.customer_import_jobs where id=p_job;
 return jsonb_build_object('id',j.id,'source',j.source,'snapshot_date',j.snapshot_date,'file_name',j.file_name,'state',j.state,'total',j.total,'processed',j.processed,'attempts',j.attempts,'error',j.error,'error_code',j.error_code,'completed_at',j.completed_at,
 'uploaded',(select count(*) from marketing_private.customer_import_rows where job_id=j.id),
 'counts',coalesce((select jsonb_object_agg(status,n) from(select outcome->>'status' status,count(*) n from marketing_private.customer_import_rows where job_id=j.id and outcome is not null group by 1)x),'{}'),
 'rows',coalesce((select jsonb_agg(outcome order by row_number) from(select row_number,outcome from marketing_private.customer_import_rows where job_id=j.id and outcome is not null and row_number>coalesce((p_payload->>'after')::integer,0) order by row_number limit 250)x),'[]'));
end;$$;

create function marketing_private.customer_import_tick() returns integer
language plpgsql security definer set search_path=public set statement_timeout='8s' as $$
declare j marketing_private.customer_import_jobs;r marketing_private.customer_import_rows;v jsonb;n integer:=0;claims text:=current_setting('request.jwt.claims',true);duplicate boolean;row_request uuid;
begin
 -- Retain only sanitized outcomes after completion; abandoned uploads expire after 30 days.
 update marketing_private.customer_import_rows set input='{}',decision='{}',phone=null where job_id in(select id from marketing_private.customer_import_jobs where created_at<now()-interval '30 days' and state<>'completed') and input<>'{}';
 update marketing_private.customer_import_jobs set state='attention',attempts=3,error='This unfinished import expired. Upload the file again to validate remaining changes.' where created_at<now()-interval '30 days' and state<>'completed' and attempts<3;
 select * into j from marketing_private.customer_import_jobs where state in('queued','running') order by checked_at for update skip locked limit 1;
 if j.id is null then return 0;end if;
 begin
  -- Revalidate the original active Admin and current Brand authority every batch.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.actor_auth_id,'role','authenticated')::text,true);
  perform marketing_private.require_access(j.organization_id,j.brand_id,'platform_customers.manage');
  update marketing_private.customer_import_jobs set state='running',checked_at=clock_timestamp() where id=j.id;
  for r in select * from marketing_private.customer_import_rows where job_id=j.id and outcome is null order by row_number limit 100 loop
   duplicate:=r.phone is not null and (select count(*) from marketing_private.customer_import_rows where job_id=j.id and phone=r.phone)>1;
   if duplicate then v:=jsonb_build_object('status','conflict','reason','Duplicate normalized phone in file. Resolve duplicate rows before importing.');
   else
    row_request:=gen_random_uuid();
    v:=public.platform_customer_import_commit(row_request,j.organization_id,j.brand_id,jsonb_build_array(r.input),jsonb_build_object('1',r.decision))->'rows'->0;
    update marketing_private.customer_pos_snapshots set import_job_id=j.id where import_request=row_request;
   end if;
   update marketing_private.customer_import_rows set outcome=v||jsonb_build_object('row',r.row_number) where job_id=j.id and row_number=r.row_number;n:=n+1;
  end loop;
  update marketing_private.customer_import_jobs set processed=processed+n,state=case when processed+n=total then 'completed' else 'running' end,completed_at=case when processed+n=total then clock_timestamp() else null end where id=j.id;
 if j.processed+n=j.total then update marketing_private.customer_import_rows set input='{}',decision='{}',phone=null where job_id=j.id;end if;
 exception when others then
  update marketing_private.customer_import_jobs set state='attention',attempts=attempts+1,error_code=sqlstate,error=case when sqlstate='42501' then 'Import authority changed. Restore authorized Brand access before retrying.' else 'A batch could not finish. Committed rows are retained; retry the remaining rows.' end,checked_at=clock_timestamp() where id=j.id;n:=0;
 end;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);return n;
end;$$;
revoke all on function marketing_private.customer_import_date(text),marketing_private.customer_pos_current(uuid,uuid,text),marketing_private.customer_import_row(uuid,uuid,jsonb),marketing_private.customer_import_contact_row(uuid,uuid,jsonb),marketing_private.customer_import_pos_write(uuid,uuid,uuid,uuid,jsonb,jsonb),marketing_private.customer_import_tick() from public,anon,authenticated,service_role;
revoke all on function public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb) to authenticated;
-- One platform-wide schedule. No Brand-specific configuration or browser lifetime dependency.
select cron.schedule('feedx_customer_import_worker','10 seconds','select marketing_private.customer_import_tick()');
