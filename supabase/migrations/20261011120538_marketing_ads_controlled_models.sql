-- Immutable, brand-scoped advertising intent. No Meta execution is enabled by this migration.
create table marketing_private.ads_changes (
 id uuid primary key, organization_id uuid not null references public.organizations(id), brand_id uuid not null,
 connection_id uuid not null references marketing_private.credentials(connection_id) on delete cascade,
 generation integer not null, account_id text not null, currency text not null, timezone text not null,
 revision integer not null check(revision>0), previous_id uuid references marketing_private.ads_changes(id) on delete set null,
 operation text not null check(operation in ('create','pause','resume','budget')),
 configuration jsonb not null, baseline jsonb, attribution_revision integer,
 maximum_budget bigint not null check(maximum_budget>=0), fingerprint text not null,
 state text not null default 'draft' check(state in ('draft','review','approved','executing','reconciling','succeeded','failed','stale','cancelled','superseded')),
 created_by uuid not null references public.employees(id), reviewed_by uuid references public.employees(id), approved_by uuid references public.employees(id),
 approved_at timestamptz, approval_expires_at timestamptz, executor uuid references public.employees(id),
 lease uuid, lease_until timestamptz, provider_state jsonb not null default '{}', receipt jsonb, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create unique index ads_change_revision_child on marketing_private.ads_changes(previous_id) where previous_id is not null;
create index ads_change_scope on marketing_private.ads_changes(organization_id,brand_id,created_at desc);
create table marketing_private.ads_change_events (
 id bigint generated always as identity primary key, change_id uuid not null references marketing_private.ads_changes(id) on delete cascade,
 revision integer not null, event text not null, actor uuid references public.employees(id), evidence jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table marketing_private.ads_changes enable row level security;
alter table marketing_private.ads_change_events enable row level security;
revoke all on marketing_private.ads_changes,marketing_private.ads_change_events from public,anon,authenticated;

create function marketing_private.ads_campaign_tree(p_payload jsonb,p_campaign text) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('campaign',(select a from jsonb_array_elements(p_payload#>'{configs,campaigns}') a where a->>'id'=p_campaign),
 'adsets',coalesce((select jsonb_agg(a order by a->>'id') from jsonb_array_elements(p_payload#>'{configs,adsets}') a where a->>'campaign_id'=p_campaign),'[]'),
 'ads',coalesce((select jsonb_agg(a order by a->>'id') from jsonb_array_elements(p_payload#>'{configs,ads}') a where a->>'campaign_id'=p_campaign),'[]'));
$$;
create function marketing_private.ads_change_current(r marketing_private.ads_changes) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id where c.id=r.connection_id and c.organization_id=r.organization_id and c.channel='ad_account' and c.provider_account_id=r.account_id and c.credential_generation=r.generation and c.status in ('test_authorized','production_authorized') and c.expires_at>now())
 and (r.operation<>'create' or (exists(select 1 from marketing_assets a where a.id=(r.configuration->>'asset_id')::uuid and a.brand_id=r.brand_id and a.organization_id=r.organization_id and a.state='ready' and a.object_path=r.configuration#>>'{media,object_path}' and a.size_bytes=(r.configuration#>>'{media,size_bytes}')::bigint and a.mime_type=r.configuration#>>'{media,mime_type}') and exists(select 1 from marketing_connections p where p.organization_id=r.organization_id and p.brand_id=r.brand_id and p.channel='facebook' and p.provider_account_id=r.configuration->>'page_id' and p.status in ('test_authorized','production_authorized'))))
 and (r.operation='create' or exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=r.organization_id and m.account_id=r.account_id and m.campaign_id=r.configuration->>'campaign_id' and m.brand_id=r.brand_id and m.revision=r.attribution_revision))
 and (r.operation='create' or r.baseline is not distinct from (select marketing_private.ads_campaign_tree(s.payload,r.configuration->>'campaign_id') from marketing_private.ads_snapshots s where s.connection_id=r.connection_id and s.generation=r.generation order by observed_at desc limit 1));
$$;

create function public.marketing_ads_changes_read(p_org uuid,p_brand uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view'); rows jsonb; assets jsonb; pages jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'lease_until'||jsonb_build_object('current',marketing_private.ads_change_current(r),'events',(select coalesce(jsonb_agg(to_jsonb(e)-'actor' order by e.id),'[]') from marketing_private.ads_change_events e where e.change_id=r.id)) order by r.created_at desc),'[]') into rows from marketing_private.ads_changes r where r.organization_id=p_org and (p_brand is null or r.brand_id=p_brand) and marketing_private.brand_allowed(p_org,r.brand_id);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from marketing_assets a where organization_id=p_org and (p_brand is null or brand_id=p_brand) and state='ready' and mime_type in ('image/jpeg','image/png') and size_bytes<=8388608 and marketing_private.brand_allowed(p_org,brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'page_id',c.provider_account_id,'name',c.account_name,'instagram_id',(select provider_account_id from marketing_connections i where i.organization_id=c.organization_id and i.brand_id=c.brand_id and i.channel='instagram' and i.status in ('test_authorized','production_authorized') limit 1))),'[]') into pages from marketing_connections c where c.organization_id=p_org and c.channel='facebook' and c.status in ('test_authorized','production_authorized') and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 return jsonb_build_object('changes',rows,'assets',assets,'pages',pages,'external_execution_enabled',false);
end;$$;

-- Server-only proposal admission: hash/size come from real downloaded canonical media, never the browser.

revoke all on function marketing_private.ads_campaign_tree(jsonb,text),marketing_private.ads_change_current(marketing_private.ads_changes) from public,anon,authenticated,service_role; revoke all on function public.marketing_ads_changes_read(uuid,uuid) from public,anon; grant execute on function public.marketing_ads_changes_read(uuid,uuid) to authenticated;
