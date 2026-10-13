-- Retries cannot expose stale proposals or re-invoke an ambiguous provider request.
create or replace function public.marketing_ads_ai_prepare(p_request uuid,p_org uuid,p_brand uuid,p_connection uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');packet jsonb;r marketing_private.ads_ai_runs;c public.marketing_connections;fp text;
begin
 if p_request is null or p_brand is null then raise exception 'Select a brand and request.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,62));
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,61));
 select * into r from marketing_private.ads_ai_runs where id=p_request;
 if found then
  if r.actor_employee_id<>actor or r.organization_id<>p_org or r.brand_id<>p_brand or r.connection_id<>p_connection or r.date_from<>p_from or r.date_to<>p_to then raise exception 'Recommendation request changed.';end if;
  if not marketing_private.ads_ai_current(r) then return jsonb_build_object('id',r.id,'state','stale','proposal',null);end if;
  if r.state='generating' and r.lease_until<=now() then return jsonb_build_object('id',r.id,'state','failed','proposal',null);end if;
  return jsonb_build_object('id',r.id,'state',r.state,'proposal',r.proposal,'model',r.provider_model,'input_tokens',r.input_tokens,'output_tokens',r.output_tokens,'cost_usd',r.cost_usd);
 end if;
 packet:=public.marketing_ads_copilot_prepare(p_org,p_brand,p_from,p_to);
 select value into packet from jsonb_array_elements(packet#>'{reporting,reports}') where value->>'connection_id'=p_connection::text;
 if packet is null or not exists(select 1 from jsonb_array_elements(packet#>'{payload,insights,campaign}') a where a#>>'{metrics,spend,value}' is not null) then raise exception 'Synchronize campaign performance for this brand and period first.';end if;
 packet:=jsonb_build_object('report',packet,'knowledge',(public.marketing_ads_copilot_prepare(p_org,p_brand,p_from,p_to))-'reporting');
 select * into c from marketing_connections where id=p_connection and organization_id=p_org and channel='ad_account';
 if c.id is null then raise exception 'Account unavailable.';end if;
 if (select count(*) from marketing_private.ads_ai_runs where actor_employee_id=actor and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before requesting more recommendations.';end if;
 if (select count(*) from marketing_private.ads_ai_runs where organization_id=p_org and created_at>now()-interval '1 day')>=50 then raise exception 'Organization AI daily request limit reached.';end if;
 fp:=encode(extensions.digest(packet::text,'sha256'),'hex');
 insert into marketing_private.ads_ai_runs(id,organization_id,brand_id,actor_employee_id,connection_id,generation,date_from,date_to,fingerprint,evidence)
 values(p_request,p_org,p_brand,actor,p_connection,c.credential_generation,p_from,p_to,fp,packet);
 return jsonb_build_object('id',p_request,'state','prepared');
end;$$;
create or replace function public.marketing_ads_ai_read(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select id,case when marketing_private.ads_ai_current(r) then case when state='generating' and lease_until<=now() then 'failed' else state end else 'stale' end state,case when marketing_private.ads_ai_current(r) then proposal else null end proposal,provider_model,input_tokens,output_tokens,cost_usd,cost_basis,date_from,date_to,created_at,reviewed_at,evidence#>'{knowledge,knowledge_revision}' knowledge_revision from marketing_private.ads_ai_runs r where organization_id=p_org and brand_id=p_brand order by created_at desc limit 20) q);
end;$$;
