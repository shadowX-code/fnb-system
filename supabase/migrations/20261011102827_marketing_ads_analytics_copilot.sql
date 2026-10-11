-- Organization-only attribution coverage; never subtract partial brand totals from account spend.
do $$ declare f text; begin
 select pg_get_functiondef('marketing_private.ads_project(uuid,text,jsonb,uuid,boolean)'::regprocedure) into f;
 f:=replace(f,'return p_payload||jsonb_build_object(', 'if p_org_access and p_brand is null then insights:=insights||jsonb_build_object(''attribution_spend'',(select coalesce(jsonb_agg(q),''[]'') from (select c->>''feedx_brand_id'' brand_id,count(*) campaigns,count(r->>''campaign_id'') reported_campaigns,sum((r#>>''{metrics,spend,value}'')::numeric) reported_spend from jsonb_array_elements(campaigns) c left join lateral (select a from jsonb_array_elements(coalesce(insights->''campaign'',''[]'')) a where a->>''campaign_id''=c->>''id'' and a->>''currency''=p_payload#>>''{account,currency}'' and a->>''date_start''=p_payload->>''date_from'' and a->>''date_stop''=p_payload->>''date_to'' limit 1) v(r) on true group by c->>''feedx_brand_id'') q));end if; return p_payload||jsonb_build_object(');
 execute f;
end $$;

-- Missing approved brand context permits generic performance advice, never invented facts.
create or replace function public.marketing_ads_copilot_prepare(p_org uuid,p_brand uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid;facts jsonb;rev integer;reporting jsonb;
begin
 if p_brand is null then raise exception 'Select an explicitly attributed brand.';end if;
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');
 select k.revision,s.profile into rev,facts from marketing_knowledge k join marketing_inbox_knowledge s on s.brand_id=k.brand_id and s.knowledge_revision=k.revision where k.brand_id=p_brand;
 reporting:=public.marketing_ads_read(p_org,p_brand,p_from,p_to);
 if jsonb_array_length(reporting->'reports')=0 or not exists(select 1 from jsonb_array_elements(reporting->'reports') r where jsonb_array_length(r#>'{payload,configs,campaigns}')>0) then raise exception 'Synchronize explicitly attributed campaigns first.';end if;
 return jsonb_build_object('state','evidence_prepared','brand_id',p_brand,'knowledge_revision',coalesce(rev,0),'brand_context_available',facts is not null and facts<>'{}','approved_facts',coalesce(facts,'{}'),'reporting',reporting,'provider_execution_enabled',false,'external_execution_enabled',false);
end;$$;

create table marketing_private.ads_ai_runs (
 id uuid primary key,organization_id uuid not null references public.organizations(id),brand_id uuid not null references public.brands(id),
 actor_employee_id uuid not null references public.employees(id), connection_id uuid not null,generation integer not null,date_from date not null,date_to date not null,
 fingerprint text not null,evidence jsonb not null,state text not null default 'prepared' check(state in ('prepared','generating','proposed','failed','stale')),
 lease uuid,lease_until timestamptz,proposal jsonb,provider_model text,input_tokens integer,output_tokens integer,cost_usd numeric,cost_basis text,
 reviewed_at timestamptz,reviewed_by uuid references public.employees(id),created_at timestamptz not null default now(),
 foreign key(connection_id,generation,date_from,date_to) references marketing_private.ads_snapshots(connection_id,generation,date_from,date_to) on delete cascade
);
alter table marketing_private.ads_ai_runs enable row level security;
revoke all on marketing_private.ads_ai_runs from public,anon,authenticated;

create function marketing_private.ads_ai_current(r marketing_private.ads_ai_runs) returns boolean
language sql stable security definer set search_path=public as $$
 select marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_ads.ai')
 and (case when r.evidence#>>'{knowledge,brand_context_available}'='true' then exists(select 1 from marketing_knowledge k join marketing_inbox_knowledge a on a.brand_id=k.brand_id and a.knowledge_revision=k.revision where k.brand_id=r.brand_id and k.revision=(r.evidence#>>'{knowledge,knowledge_revision}')::integer) else not exists(select 1 from marketing_knowledge k join marketing_inbox_knowledge a on a.brand_id=k.brand_id and a.knowledge_revision=k.revision where k.brand_id=r.brand_id and a.profile<>'{}') end)
 and exists(select 1 from marketing_connections c join marketing_private.ads_snapshots s on s.connection_id=c.id and s.generation=c.credential_generation where c.id=r.connection_id and c.credential_generation=r.generation and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and s.date_from=r.date_from and s.date_to=r.date_to and s.observed_at=(r.evidence#>>'{report,observed_at}')::timestamptz)
 and not exists(select 1 from jsonb_array_elements(r.evidence#>'{report,payload,configs,campaigns}') a where not exists(select 1 from marketing_private.ads_campaign_brands m join marketing_connections c on c.id=r.connection_id where m.organization_id=r.organization_id and m.account_id=c.provider_account_id and m.campaign_id=a->>'id' and m.brand_id=r.brand_id and m.revision=(a->>'feedx_attribution_revision')::integer));
$$;
revoke all on function marketing_private.ads_ai_current(marketing_private.ads_ai_runs) from public,anon,authenticated;

create function public.marketing_ads_ai_prepare(p_request uuid,p_org uuid,p_brand uuid,p_connection uuid,p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');packet jsonb;r marketing_private.ads_ai_runs;c public.marketing_connections;fp text;
begin
 if p_request is null or p_brand is null then raise exception 'Select a brand and request.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,62));
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,61));
 select * into r from marketing_private.ads_ai_runs where id=p_request;
 if found then
  if r.actor_employee_id<>actor or r.organization_id<>p_org or r.brand_id<>p_brand or r.connection_id<>p_connection or r.date_from<>p_from or r.date_to<>p_to then raise exception 'Recommendation request changed.';end if;
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
create function public.marketing_ads_ai_claim(p_request uuid,p_auth_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_ai_runs;
begin
 select * into r from marketing_private.ads_ai_runs where id=p_request for update;
 if r.id is null or not exists(select 1 from employees where id=r.actor_employee_id and auth_user_id=p_auth_user) or not marketing_private.actor_allowed(r.actor_employee_id,r.organization_id,r.brand_id,'marketing_ads.ai') then raise exception using errcode='42501',message='Recommendation access changed.';end if;
 -- Never automatically re-invoke a provider after an ambiguous/expired generation.
 if r.state<>'prepared' then return null;end if;
 if not marketing_private.ads_ai_current(r) then raise exception 'Recommendation evidence changed.';end if;
 update marketing_private.ads_ai_runs set state='generating',lease=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=r.id returning * into r;
 return jsonb_build_object('lease',r.lease,'evidence',r.evidence);
end;$$;
create function public.marketing_ads_ai_finish(p_request uuid,p_lease uuid,p_proposal jsonb,p_model text,p_input integer,p_output integer,p_cost numeric,p_cost_basis text,p_error boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_ai_runs;rev integer;valid boolean;
begin
 select * into r from marketing_private.ads_ai_runs where id=p_request for update;
 if r.state<>'generating' or r.lease is distinct from p_lease or r.lease_until<=now() then raise exception 'Recommendation generation changed.';end if;
 select revision into rev from marketing_knowledge where brand_id=r.brand_id;
 valid:=marketing_private.ads_ai_current(r);
 update marketing_private.ads_ai_runs set state=case when not valid then 'stale' when p_error then 'failed' else 'proposed' end,proposal=case when valid and not p_error then p_proposal else null end,provider_model=p_model,input_tokens=p_input,output_tokens=p_output,cost_usd=p_cost,cost_basis=p_cost_basis,lease=null,lease_until=null where id=r.id;
 return jsonb_build_object('id',r.id,'state',case when not valid then 'stale' when p_error then 'failed' else 'proposed' end,'proposal',case when valid and not p_error then p_proposal else null end,'model',p_model,'input_tokens',p_input,'output_tokens',p_output,'cost_usd',p_cost,'cost_basis',p_cost_basis,'external_execution_enabled',false);
end;$$;
create function public.marketing_ads_ai_read(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.ai');begin
 if p_brand is null then raise exception 'Select a brand.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select id,case when marketing_private.ads_ai_current(r) then state else 'stale' end state,case when marketing_private.ads_ai_current(r) then proposal else null end proposal,provider_model,input_tokens,output_tokens,cost_usd,cost_basis,date_from,date_to,created_at,reviewed_at,evidence#>'{knowledge,knowledge_revision}' knowledge_revision from marketing_private.ads_ai_runs r where organization_id=p_org and brand_id=p_brand order by created_at desc limit 20) q);
end;$$;
create function public.marketing_ads_ai_review(p_request uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_ai_runs;actor uuid;begin
 select * into r from marketing_private.ads_ai_runs where id=p_request for update;
 actor:=marketing_private.require_access(r.organization_id,r.brand_id,'marketing_ads.review');
 if r.state<>'proposed' or not marketing_private.ads_ai_current(r) then raise exception 'Recommendation is unavailable.';end if;
 update marketing_private.ads_ai_runs set reviewed_at=coalesce(reviewed_at,now()),reviewed_by=coalesce(reviewed_by,actor) where id=r.id;
 return jsonb_build_object('reviewed',true,'external_execution_enabled',false);
end;$$;
revoke all on function public.marketing_ads_ai_prepare(uuid,uuid,uuid,uuid,date,date),public.marketing_ads_ai_read(uuid,uuid),public.marketing_ads_ai_review(uuid) from public,anon;
grant execute on function public.marketing_ads_ai_prepare(uuid,uuid,uuid,uuid,date,date),public.marketing_ads_ai_read(uuid,uuid),public.marketing_ads_ai_review(uuid) to authenticated;
revoke all on function public.marketing_ads_ai_claim(uuid,uuid),public.marketing_ads_ai_finish(uuid,uuid,jsonb,text,integer,integer,numeric,text,boolean) from public,anon,authenticated;
grant execute on function public.marketing_ads_ai_claim(uuid,uuid),public.marketing_ads_ai_finish(uuid,uuid,jsonb,text,integer,integer,numeric,text,boolean) to service_role;
