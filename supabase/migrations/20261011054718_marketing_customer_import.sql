-- Brand-scoped preview/commit; no consent, suppression, phone or ownership changes.
create function marketing_private.customer_snapshot(p_brand uuid,p_customer uuid) returns text
language sql stable security definer set search_path=public as $$
 select md5(jsonb_build_array(c.id,c.revision,c.display_name,c.phone_e164,c.active,b.language,b.tags,b.outlet_id,
  (select max(record_order) from public.marketing_consent_evidence where brand_id=p_brand and customer_id=c.id),
  (select created_at from public.marketing_suppressions where brand_id=p_brand and phone_e164=c.phone_e164),
  (select jsonb_agg(brand_id order by brand_id) from public.platform_customer_brands where customer_id=c.id))::text)
 from public.platform_customers c join public.platform_customer_brands b on b.customer_id=c.id and b.brand_id=p_brand where c.id=p_customer;
$$;
create or replace function public.platform_customer_command(p_request uuid,p_org uuid,p_brand uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');c public.platform_customers; cid uuid;fp text;old public.marketing_requests;phone text;
begin
 if p_brand is null or p_request is null then raise exception 'Select a brand and request identity.';end if;fp:=md5(jsonb_build_array('platform_customer',p_org,p_brand,p_payload)::text);perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));select * into old from public.marketing_requests where request_id=p_request;if found then if old.actor_employee_id<>actor or old.fingerprint<>fp then raise exception 'Request changed.';end if;return old.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('platform_customer:'||p_org::text,0));
 phone:=marketing_private.my_phone(p_payload->>'phone');perform 1 from public.brands where id=p_brand for update;
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

create function marketing_private.customer_import_row(p_org uuid,p_brand uuid,p_row jsonb) returns jsonb
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
  select coalesce(array_agg(distinct trim(x) order by trim(x)) filter(where trim(x)<>''),'{}') into tags from jsonb_array_elements_text(p_row->'tags') x;
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

create function public.platform_customer_import_preview(p_org uuid,p_brand uuid,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');r jsonb;out_rows jsonb:='[]';phones text[]:='{}'; phone text; duplicates text[]:='{}';v jsonb;i integer:=0;
begin
 if p_brand is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 or octet_length(p_rows::text)>2000000 then raise exception 'Import 1–500 rows per file (maximum 2 MB mapped data).';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  begin phone:=marketing_private.my_phone(trim(r->>'phone'));if phone=any(phones) then duplicates:=array_append(duplicates,phone);end if;phones:=array_append(phones,phone);exception when raise_exception then null;end;
 end loop;
 for r in select value from jsonb_array_elements(p_rows) loop
  i:=i+1;v:=marketing_private.customer_import_row(p_org,p_brand,r||jsonb_build_object('row',i));
  if v->'values'->>'phone'=any(duplicates) then v:=v||jsonb_build_object('classification','conflict','reason','Duplicate normalized phone in file. Resolve duplicate rows before importing.');end if;
  out_rows:=out_rows||jsonb_build_array(v);
 end loop;
 return jsonb_build_object('rows',out_rows);
end;$$;

create function public.platform_customer_import_commit(p_request uuid,p_org uuid,p_brand uuid,p_rows jsonb,p_decisions jsonb) returns jsonb
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
    result:=public.platform_customer_command(gen_random_uuid(),p_org,p_brand,r->'values');status:='created';
   else
    if jsonb_typeof(d->'fields') is distinct from 'array' or jsonb_array_length(d->'fields')=0 then raise exception 'Select the exact fields to update.';end if;
    select * into cu from public.platform_customers where id=(r->>'customer_id')::uuid;
    select * into b from public.platform_customer_brands where brand_id=p_brand and customer_id=cu.id;
    payload:=jsonb_build_object('customer_id',cu.id,'name',cu.display_name,'phone',cu.phone_e164,'language',b.language,'tags',to_jsonb(b.tags),'outlet_id',b.outlet_id,'edit',true,'revision',cu.revision,'snapshot',r->>'snapshot','confirm_name',true);
    for k in select jsonb_array_elements_text(d->'fields') loop
     if k not in ('name','language','tags','outlet_id') or not (r->'differences' ? k) then raise exception 'Selected field is not a reviewed difference.';end if;
     payload:=payload||jsonb_build_object(k,r->'values'->k);changed:=true;
    end loop;
    if changed then result:=public.platform_customer_command(gen_random_uuid(),p_org,p_brand,payload);status:='updated';end if;
   end if;
  exception when raise_exception or check_violation or unique_violation or invalid_text_representation then status:='conflict';err:=case when sqlstate='23505' then 'Customer identity changed. Validate again.' else sqlerrm end;
  end;
  results:=results||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('row',r->'row','status',status,'reason',err,'fields',case when status='updated' then d->'fields' else null end)));
 end loop;
 result:=jsonb_build_object('rows',results,'completed_at',clock_timestamp());
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
end;$$;

create function public.marketing_customers_read(p_org uuid,p_brand uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 20) returns jsonb
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
 (select max(coalesce(r.confirmed_at,r.opened_at)) from public.marketing_campaign_recipients r join public.marketing_campaigns ca on ca.id=r.campaign_id where r.customer_id=c.id and ca.brand_id=p_brand) last_activity
 from public.platform_customers c join public.platform_customer_brands b on b.customer_id=c.id and b.brand_id=p_brand join public.brands br on br.id=b.brand_id left join public.outlets o on o.id=b.outlet_id
 where c.organization_id=p_org
 and (coalesce(p_filters->>'search','')='' or c.display_name ilike '%'||left(p_filters->>'search',160)||'%' or c.phone_e164 ilike '%'||left(p_filters->>'search',30)||'%' or exists(select 1 from unnest(b.tags) t where t ilike '%'||left(p_filters->>'search',60)||'%'))
 and (coalesce(p_filters->>'outlet','')='' or b.outlet_id::text=p_filters->>'outlet')
 and (coalesce(p_filters->>'status','')='' or c.active=(p_filters->>'status'='active'))
 and (coalesce(p_filters->>'segment','')='' or marketing_private.audience_matches(b,(select criteria from public.marketing_audiences where id::text=p_filters->>'segment' and brand_id=p_brand)))
 ), filtered as(select * from customers where coalesce(p_filters->>'consent','')='' or (p_filters->>'consent'='eligible' and eligible) or (p_filters->>'consent'='suppressed' and suppressed) or (p_filters->>'consent'='required' and not eligible and not suppressed)), page as (
 select * from filtered order by case when p_filters->>'sort'='name_desc' then display_name end desc, case when p_filters->>'sort'='activity' then last_activity end desc nulls last,display_name,id limit lim offset (greatest(1,p_page)-1)*lim)
 select jsonb_build_object('customers',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'total',(select count(*) from filtered)) into result;
 return result;
end;$$;
revoke all on function marketing_private.customer_snapshot(uuid,uuid),marketing_private.customer_import_row(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.platform_customer_import_preview(uuid,uuid,jsonb),public.platform_customer_import_commit(uuid,uuid,uuid,jsonb,jsonb),public.marketing_customers_read(uuid,uuid,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.platform_customer_import_preview(uuid,uuid,jsonb),public.platform_customer_import_commit(uuid,uuid,uuid,jsonb,jsonb),public.marketing_customers_read(uuid,uuid,jsonb,integer,integer) to authenticated;
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
 return jsonb_build_object('customers',coalesce(customers,'[]'),'audiences',audiences,'campaigns',campaigns,'senders',senders,'assets',assets,'recipients',coalesce(recipients,'[]'),'progress',coalesce(counts,'{}'),'customer_total',(select count(*) from public.platform_customer_brands where brand_id=p_brand),'verified_delivery',null,'verified_redemptions',null,'cloud_api_available',false,'shared_customers',case when public.current_user_has_permission('platform_customers.manage') then (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'phone',x.phone_e164)),'[]') from public.platform_customers x where x.organization_id=p_org and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and b.brand_id=p_brand) and exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id) and not exists(select 1 from public.platform_customer_brands b where b.customer_id=x.id and not marketing_private.brand_allowed(p_org,b.brand_id))) else '[]'::jsonb end,'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name)),'[]') from public.brand_outlets b join public.outlets o on o.id=b.outlet_id where b.brand_id=p_brand));
end;$$;
