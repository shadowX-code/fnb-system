-- Safe batching delegates every row to the existing revision-bound attribution authority.
create function public.marketing_ads_attribute_batch(p_org uuid,p_account text,p_rows jsonb,p_brand uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.manage'); fp text; prior public.marketing_requests; r jsonb; result jsonb:='[]';
begin
 if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.manage') then raise exception using errcode='42501',message='Organization advertising management required.';end if;
 if p_request is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>20000 then raise exception 'Select 1–100 campaigns.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) a where jsonb_typeof(a) is distinct from 'object' or coalesce(a->>'campaign_id','') !~ '^[0-9]{1,30}$' or coalesce(a->>'revision','') !~ '^[0-9]{1,9}$' or a->>'request_id' is null)
 or (select count(distinct a->>'campaign_id') from jsonb_array_elements(p_rows) a)<>jsonb_array_length(p_rows)
 or (select count(distinct a->>'request_id') from jsonb_array_elements(p_rows) a)<>jsonb_array_length(p_rows) then raise exception 'Invalid or duplicate campaign selection.';end if;
 fp:=encode(extensions.digest(jsonb_build_array('ads_attribute_batch',p_org,p_account,p_rows,p_brand)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from marketing_requests where request_id=p_request;
 if found then
   if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Attribution request changed.';end if;
   return prior.result;
 end if;
 -- Stable ordering prevents deadlocks between overlapping batches. Any conflict rolls back all rows.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'campaign_id' loop
  result:=result||jsonb_build_array(public.marketing_ads_attribute(p_org,p_account,r->>'campaign_id',p_brand,(r->>'revision')::integer,(r->>'request_id')::uuid));
 end loop;
 insert into marketing_requests values(p_request,actor,fp,result);
 return result;
end;$$;
revoke all on function public.marketing_ads_attribute_batch(uuid,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.marketing_ads_attribute_batch(uuid,text,jsonb,uuid,uuid) to authenticated;

-- Only canonical connected social identities can support a proposed brand match.
create function public.marketing_ads_review_context(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.view'); result jsonb;
begin
 if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view') then raise exception using errcode='42501',message='Organization advertising access required.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('brand_id',brand_id,'channel',channel,'account_id',provider_account_id)),'[]') into result
 from marketing_connections where organization_id=p_org and channel in ('facebook','instagram') and provider_account_id is not null and status in ('test_authorized','production_authorized');
 return result;
end;$$;
revoke all on function public.marketing_ads_review_context(uuid) from public,anon;
grant execute on function public.marketing_ads_review_context(uuid) to authenticated;

-- Advisory preparation only. No provider invocation, ad mutation or autonomous action.
create function public.marketing_ads_copilot_prepare(p_org uuid,p_brand uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid; facts jsonb; rev integer; reporting jsonb;
begin
 if p_brand is null then raise exception 'Select an explicitly attributed brand.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');
 select k.revision,s.profile into rev,facts from marketing_knowledge k join marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=p_brand;
 if facts is null or facts='{}' then raise exception 'Approve current verified Brand Knowledge first.';end if;
 reporting:=public.marketing_ads_read(p_org,p_brand,p_from,p_to);
 if jsonb_array_length(reporting->'reports')=0 or not exists(select 1 from jsonb_array_elements(reporting->'reports') r where jsonb_array_length(r#>'{payload,configs,campaigns}')>0) then raise exception 'Synchronize explicitly attributed campaigns first.';end if;
 return jsonb_build_object('state','evidence_prepared','brand_id',p_brand,'knowledge_revision',rev,'approved_facts',facts,'reporting',reporting,'provider_execution_enabled',false,'external_execution_enabled',false);
end;$$;
revoke all on function public.marketing_ads_copilot_prepare(uuid,uuid,date,date) from public,anon;
grant execute on function public.marketing_ads_copilot_prepare(uuid,uuid,date,date) to authenticated;
-- Reconnect keeps the canonical organization slot even after provider identity is cleared.
do $$ declare f text;begin
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into f;
 f:=replace(f,'''account_id'',c.provider_account_id', '''account_id'',c.provider_account_id,''account_slot'',c.account_slot');
 execute f;
end $$;
