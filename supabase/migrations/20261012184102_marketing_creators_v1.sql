-- Marketing owns creator relationships; Platform continues to own brand/outlet identity.
insert into public.permissions(code,module,description,requires_restaurant_outlet_scope)
values ('marketing_creators.view','Marketing Creators','View scoped creator relationships and performance.',false),
 ('marketing_creators.manage','Marketing Creators','Manage creators, collaborations and recorded evidence; no external execution.',false)
on conflict(code) do nothing;

create table public.marketing_creators (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 160), email text not null default '' check(length(email)<=254),
 phone text not null default '' check(length(phone)<=40),location text not null default '' check(length(location)<=160),
 categories text[] not null default '{}',notes text not null default '' check(length(notes)<=4000),
 avatar_asset_id uuid references public.marketing_assets(id),archived boolean not null default false,revision integer not null default 1,
 created_by uuid not null references public.employees(id),updated_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,id),check(cardinality(categories)<=20)
);
create table public.marketing_creator_brands (
 organization_id uuid not null,creator_id uuid not null,brand_id uuid not null,created_by uuid not null references public.employees(id),created_at timestamptz not null default now(),
 primary key(creator_id,brand_id),foreign key(organization_id,creator_id) references public.marketing_creators(organization_id,id),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id)
);
create table public.marketing_creator_accounts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,creator_id uuid not null,
 platform text not null check(platform in ('facebook','instagram','xhs','tiktok')),display_name text not null default '' check(length(display_name)<=160),
 handle text not null default '' check(length(handle)<=160),profile_url text not null default '' check(length(profile_url)<=1500),
 external_id text not null default '' check(length(external_id)<=160),identity_verified boolean not null default false,
 identity_source text not null default 'staff_recorded' check(identity_source in ('staff_recorded','authorized_meta')),
 revision integer not null default 1,created_by uuid not null references public.employees(id),updated_at timestamptz not null default now(),
 foreign key(organization_id,creator_id) references public.marketing_creators(organization_id,id),unique(organization_id,id)
);
create unique index marketing_creator_account_external on public.marketing_creator_accounts(organization_id,platform,external_id) where external_id<>'';
create unique index marketing_creator_account_handle on public.marketing_creator_accounts(organization_id,platform,lower(handle)) where handle<>'';
create table public.marketing_creator_collaborations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,creator_id uuid not null,
 outlet_id uuid references public.outlets(id),campaign_id uuid references public.marketing_campaigns(id),
 title text not null check(length(trim(title)) between 1 and 200),owner_id uuid references public.employees(id),
 visit_at timestamptz,timezone text not null default 'Asia/Kuala_Lumpur',follow_up_date date,
 status text not null default 'planned' check(status in ('planned','confirmed','visited','awaiting_posts','completed','cancelled')),
 cash_cost numeric(14,2) not null default 0 check(cash_cost>=0),in_kind_cost numeric(14,2) not null default 0 check(in_kind_cost>=0),
 currency text not null default 'MYR' check(currency ~ '^[A-Z]{3}$'),cost_state text not null default 'estimated' check(cost_state in ('estimated','recorded')),
 notes text not null default '' check(length(notes)<=4000),revision integer not null default 1,
 created_by uuid not null references public.employees(id),updated_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,creator_id) references public.marketing_creators(organization_id,id),foreign key(organization_id,brand_id) references public.brands(organization_id,id),unique(organization_id,id)
);
create table public.marketing_creator_deliverables (
 id uuid primary key default gen_random_uuid(),collaboration_id uuid not null references public.marketing_creator_collaborations(id),
 title text not null check(length(trim(title)) between 1 and 200),platform text not null check(platform in ('facebook','instagram','xhs','tiktok')),
 due_date date,status text not null default 'pending' check(status in ('pending','submitted','completed','cancelled')),revision integer not null default 1
);
create table public.marketing_creator_posts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,brand_id uuid not null,creator_id uuid,account_id uuid,
 collaboration_id uuid,deliverable_id uuid references public.marketing_creator_deliverables(id),outlet_id uuid references public.outlets(id),
 platform text not null check(platform in ('facebook','instagram','xhs','tiktok')),post_key text not null,canonical_url text not null,
 caption text not null default '' check(length(caption)<=8000),published_at timestamptz,asset_id uuid references public.marketing_assets(id),
 metadata_source text not null default 'manual',match_method text not null default 'unlinked' check(match_method in ('unlinked','manual_confirmed','verified_identity')),
 revision integer not null default 1,created_by uuid not null references public.employees(id),updated_by uuid not null references public.employees(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,brand_id) references public.brands(organization_id,id),foreign key(organization_id,creator_id) references public.marketing_creators(organization_id,id),
 foreign key(organization_id,account_id) references public.marketing_creator_accounts(organization_id,id),
 foreign key(organization_id,collaboration_id) references public.marketing_creator_collaborations(organization_id,id),unique(organization_id,platform,post_key)
);
create table public.marketing_creator_metric_snapshots (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.marketing_creator_posts(id),
 metrics jsonb not null,source text not null check(source in ('manual','authorized_meta')),source_note text not null check(length(trim(source_note)) between 1 and 500),
 captured_at timestamptz not null,recorded_at timestamptz not null default now(),recorded_by uuid not null references public.employees(id),
 metric_window text not null default 'lifetime' check(metric_window='lifetime'),request_id uuid not null unique
);
create index marketing_creator_brands_scope on public.marketing_creator_brands(organization_id,brand_id);
create index marketing_creator_collaborations_scope on public.marketing_creator_collaborations(organization_id,brand_id,visit_at);
create index marketing_creator_posts_scope on public.marketing_creator_posts(organization_id,brand_id,published_at);
create index marketing_creator_metrics_history on public.marketing_creator_metric_snapshots(post_id,captured_at desc,recorded_at desc);
create table marketing_private.creator_revisions (
 entity text not null,record_id uuid not null,revision integer not null,snapshot jsonb not null,actor uuid not null references public.employees(id),recorded_at timestamptz not null default now(),
 primary key(entity,record_id,revision)
);
do $$ declare t text;begin
 foreach t in array array['marketing_creators','marketing_creator_brands','marketing_creator_accounts','marketing_creator_collaborations','marketing_creator_deliverables','marketing_creator_posts','marketing_creator_metric_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end;$$;
alter table marketing_private.creator_revisions enable row level security;
revoke all on marketing_private.creator_revisions from public,anon,authenticated;

create function marketing_private.creator_visible(p_org uuid,p_id uuid,p_brand uuid default null) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.marketing_creator_brands cb where cb.organization_id=p_org and cb.creator_id=p_id
 and (p_brand is null or cb.brand_id=p_brand) and marketing_private.brand_allowed(p_org,cb.brand_id));
$$;
create function marketing_private.creator_editable(p_org uuid,p_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select marketing_private.creator_visible(p_org,p_id) and not exists(select 1 from public.marketing_creator_brands cb
 where cb.organization_id=p_org and cb.creator_id=p_id and not marketing_private.brand_allowed(p_org,cb.brand_id));
$$;
-- Only exact supported hosts and post paths are accepted. No caller URL is fetched.
create function marketing_private.creator_url(p_url text) returns jsonb language plpgsql immutable set search_path=public as $$
declare u text:=trim(p_url);host text;path text;m text[];platform text;key text;canonical text;author text:='';
begin
 if length(u)>1500 or u !~ '^https?://' or u ~ '[[:space:]@\\]' then raise exception 'Paste a valid public social post URL.';end if;
 host:=lower(substring(u from '^https?://([^/?#]+)'));path:=regexp_replace(u,'^https?://[^/]+','');path:=split_part(path,'#',1);
 if host in ('instagram.com','www.instagram.com') then
  m:=regexp_match(path,'^/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)/?(?:\?.*)?$');if m is null then raise exception 'Use an Instagram post or Reel link.';end if;
  platform:='instagram';key:=m[1];canonical:='https://www.instagram.com/p/'||key||'/';
 elsif host in ('facebook.com','www.facebook.com','m.facebook.com','web.facebook.com') then
  m:=regexp_match(path,'^/(?:[^/?]+/)?(?:posts|videos|reel)/([0-9A-Za-z_-]+)/?(?:\?.*)?$');
  if m is not null then key:=m[1];canonical:='https://www.facebook.com'||split_part(path,'?',1);
  else m:=regexp_match(path,'[?&](?:fbid|story_fbid)=([0-9]+)');
   if m is not null and path ~ '^/(photo(?:\.php)?|story\.php)\?' then key:=m[1];canonical:='https://www.facebook.com/photo/?fbid='||key;
   else m:=regexp_match(path,'^/share/(?:[prv]/)?([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a Facebook post, photo, video or share link.';end if;key:='share:'||m[1];canonical:='https://www.facebook.com'||split_part(path,'?',1);end if;
  end if;platform:='facebook';canonical:=regexp_replace(canonical,'(?<!:)/{2,}','/','g');
 elsif host in ('tiktok.com','www.tiktok.com') then
  m:=regexp_match(path,'^/@([^/?]+)/video/([0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a TikTok video link.';end if;
  platform:='tiktok';author:=m[1];key:=m[2];canonical:='https://www.tiktok.com/@'||author||'/video/'||key;
 elsif host in ('vm.tiktok.com','vt.tiktok.com') then
  m:=regexp_match(path,'^/([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a valid TikTok share link.';end if;
  platform:='tiktok';key:=host||':'||m[1];canonical:='https://'||host||'/'||m[1]||'/';
 elsif host in ('xiaohongshu.com','www.xiaohongshu.com') then
  m:=regexp_match(path,'^/(?:explore|discovery/item)/([A-Fa-f0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a Xiaohongshu post link.';end if;
  platform:='xhs';key:=lower(m[1]);canonical:='https://www.xiaohongshu.com/explore/'||key;
 elsif host in ('xhslink.com','www.xhslink.com') then
  m:=regexp_match(path,'^/(?:a/)?([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a valid Xiaohongshu share link.';end if;
  platform:='xhs';key:='short:'||m[1];canonical:='https://xhslink.com'||split_part(path,'?',1);
 else raise exception 'Supported platforms: Facebook, Instagram, Xiaohongshu and TikTok.';end if;
 return jsonb_build_object('platform',platform,'post_key',key,'canonical_url',canonical,'author_handle',author,'identity_verified',false,
 'short_link',key like 'share:%' or key like 'short:%' or key like '%tiktok.com:%');
end;$$;

create function marketing_private.creator_existing_url(p_url text) returns jsonb language plpgsql immutable set search_path=public as $$ begin return marketing_private.creator_url(p_url);exception when others then return null;end;$$;
revoke all on function marketing_private.creator_existing_url(text) from public,anon,authenticated;

create function public.marketing_creator_post_preview(p_org uuid,p_brand uuid,p_url text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare parsed jsonb;duplicate public.marketing_creator_posts;observed public.marketing_social_posts; matched uuid;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');if p_brand is null then raise exception 'Choose a brand for this post.';end if;
 parsed:=marketing_private.creator_url(p_url);
 select * into duplicate from public.marketing_creator_posts where organization_id=p_org and platform=parsed->>'platform' and post_key=parsed->>'post_key';
 if duplicate.id is not null then
 parsed:=parsed||jsonb_build_object('duplicate',true,'duplicate_id',case when marketing_private.brand_allowed(p_org,duplicate.brand_id) then duplicate.id end,'duplicate_brand_id',case when marketing_private.brand_allowed(p_org,duplicate.brand_id) then duplicate.brand_id end,'metadata_status','duplicate');if not marketing_private.brand_allowed(p_org,duplicate.brand_id) then return parsed;end if;end if;
 if public.current_user_has_permission('marketing_analytics.view') then
 select * into observed from public.marketing_social_posts s where s.organization_id=p_org and s.brand_id=p_brand
 and s.channel=parsed->>'platform' and s.permalink<>'' and marketing_private.creator_existing_url(s.permalink)->>'post_key'=parsed->>'post_key'
 order by s.observed_at desc limit 1;
 end if;
 if observed.id is not null then
 select a.creator_id into matched from public.marketing_creator_accounts a where a.organization_id=p_org and a.platform=observed.channel
 and a.external_id=observed.provider_account_id and a.identity_verified and marketing_private.creator_visible(p_org,a.creator_id,p_brand);
 return parsed||jsonb_build_object('metadata_status','authorized_meta','caption',observed.caption,'published_at',observed.published_at,
 'author_external_id',observed.provider_account_id,'identity_verified',observed.provider_account_id<>'','matched_creator_id',matched,
 'metrics',observed.metrics,'captured_at',observed.observed_at,'source','Existing authorized Meta synchronization');
 end if;
 return parsed||jsonb_build_object('metadata_status','unavailable','source','Manual entry','message',case when (parsed->>'short_link')::boolean then 'Share link recorded. Original post identity and author are unavailable; use the full post link where possible.' else 'Automatic metadata is unavailable for this account. Enter the post details and confirm its creator manually.' end);
end;$$;

create function public.marketing_creator_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid;fp text;prior public.marketing_requests;result jsonb;c public.marketing_creators;a public.marketing_creator_accounts;
 v public.marketing_creator_collaborations;p public.marketing_creator_posts;d public.marketing_creator_deliverables;
 parsed jsonb;preview jsonb;item jsonb;metrics jsonb;entity text;record_id uuid;rev integer;linked_creator uuid;asset uuid;outlet uuid;campaign uuid;owner uuid;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
 if p_request is null or p_revision is null or p_brand is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536
 or p_action not in ('save_creator','share_creator','archive_creator','save_account','save_collaboration','save_post','add_metrics','capture_meta_metrics') then raise exception 'Choose a brand and valid creator action.';end if;
 fp:=md5(jsonb_build_array(p_org,p_brand,p_action,p_id,p_revision,p_payload)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry changed. Use a new request.';end if;return prior.result;end if;
 if p_action in ('save_creator','archive_creator','share_creator') and p_id is not null then
 select * into c from public.marketing_creators where id=p_id and organization_id=p_org for update;
 if c.id is null or not marketing_private.creator_visible(p_org,c.id) then raise exception using errcode='42501',message='Creator is unavailable in your brand scope.';end if;
 if c.revision<>p_revision then raise exception using errcode='40001',message='Creator changed. Reload before saving.';end if;
 if p_action<>'share_creator' and not marketing_private.creator_editable(p_org,c.id) then raise exception using errcode='42501',message='Shared profile changes require access to every linked brand.';end if;
 end if;
 if p_action='save_creator' then
 asset:=nullif(p_payload->>'avatar_asset_id','')::uuid;
 if asset is not null and not exists(select 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.state='ready'
 and m.mime_type like 'image/%' and marketing_private.brand_allowed(p_org,m.brand_id) and public.current_user_has_permission('marketing_content.view')) then raise exception 'Choose authorized ready image media.';end if;
 if p_id is null then
 insert into public.marketing_creators(organization_id,name,email,phone,location,categories,notes,avatar_asset_id,created_by,updated_by)
 values(p_org,trim(p_payload->>'name'),trim(coalesce(p_payload->>'email','')),trim(coalesce(p_payload->>'phone','')),trim(coalesce(p_payload->>'location','')),
 array(select distinct trim(value) from jsonb_array_elements_text(coalesce(p_payload->'categories','[]')) where length(trim(value)) between 1 and 60),coalesce(p_payload->>'notes',''),asset,actor,actor) returning * into c;
 insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now());
 else
 update public.marketing_creators set name=trim(p_payload->>'name'),email=trim(coalesce(p_payload->>'email','')),phone=trim(coalesce(p_payload->>'phone','')),location=trim(coalesce(p_payload->>'location','')),
 categories=array(select distinct trim(value) from jsonb_array_elements_text(coalesce(p_payload->'categories','[]')) where length(trim(value)) between 1 and 60),notes=coalesce(p_payload->>'notes',''),
 avatar_asset_id=asset,revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 end if;result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='share_creator' then
 if c.id is null then raise exception 'Choose an existing visible creator.';end if;
 insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now()) on conflict do nothing;
 update public.marketing_creators set revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='archive_creator' then
 update public.marketing_creators set archived=coalesce((p_payload->>'archived')::boolean,true),revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='save_account' then
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 select * into c from public.marketing_creators where id=linked_creator and organization_id=p_org for update;
 if c.id is null or not marketing_private.creator_editable(p_org,c.id) or not marketing_private.creator_visible(p_org,c.id,p_brand) then raise exception using errcode='42501',message='Shared account changes require access to every linked brand.';end if;
 if p_id is not null then select * into a from public.marketing_creator_accounts where id=p_id and creator_id=c.id for update;
 if a.id is null or a.revision<>p_revision then raise exception using errcode='40001',message='Account changed. Reload.';end if;end if;
 if coalesce(p_payload->>'profile_url','')<>'' and (p_payload->>'profile_url' !~ '^https://(www\.|m\.)?(facebook\.com|instagram\.com|tiktok\.com|xiaohongshu\.com)/' or p_payload->>'profile_url' ~ '[[:space:]@\\]') then
 -- TikTok profile handles contain @ in their path; authority still uses a fixed supported host.
 if p_payload->>'profile_url' !~ '^https://(www\.)?tiktok\.com/@[A-Za-z0-9._-]+/?$' then raise exception 'Use the platform public HTTPS profile URL.';end if;end if;
 if p_id is null then
 insert into public.marketing_creator_accounts(organization_id,creator_id,platform,display_name,handle,profile_url,external_id,created_by)
 values(p_org,c.id,p_payload->>'platform',trim(coalesce(p_payload->>'display_name','')),lower(ltrim(trim(coalesce(p_payload->>'handle','')),'@')),coalesce(p_payload->>'profile_url',''),trim(coalesce(p_payload->>'external_id','')),actor) returning * into a;
 else
 update public.marketing_creator_accounts set platform=p_payload->>'platform',display_name=trim(coalesce(p_payload->>'display_name','')),handle=lower(ltrim(trim(coalesce(p_payload->>'handle','')),'@')),
 profile_url=coalesce(p_payload->>'profile_url',''),external_id=trim(coalesce(p_payload->>'external_id','')),identity_verified=false,identity_source='staff_recorded',revision=revision+1,updated_at=now() where id=a.id returning * into a;
 end if;
 if a.handle='' and a.external_id='' and a.profile_url='' then raise exception 'Enter a handle, platform ID or profile URL.';end if;
 result:=to_jsonb(a);entity:='account';record_id:=a.id;rev:=a.revision;
 elsif p_action='save_collaboration' then
 if p_id is not null then select * into v from public.marketing_creator_collaborations where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if v.id is null or v.revision<>p_revision then raise exception using errcode='40001',message='Collaboration changed or is unavailable. Reload.';end if;end if;
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 if not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception 'Link this creator to the selected brand first.';end if;
 if v.id is not null and linked_creator<>v.creator_id then raise exception 'Preserve the collaboration creator. Create a new collaboration for another creator.';end if;
 outlet:=nullif(p_payload->>'outlet_id','')::uuid;campaign:=nullif(p_payload->>'campaign_id','')::uuid;owner:=nullif(p_payload->>'owner_id','')::uuid;
 if outlet is not null and not exists(select 1 from public.brand_outlets bo where bo.organization_id=p_org and bo.brand_id=p_brand and bo.outlet_id=outlet) then raise exception 'Choose a canonical brand-linked outlet.';end if;
 if campaign is not null and (not public.current_user_has_permission('marketing_campaigns.view') or not exists(select 1 from public.marketing_campaigns mc where mc.id=campaign and mc.organization_id=p_org and mc.brand_id=p_brand)) then raise exception 'Choose an authorized same-brand campaign.';end if;
 if not marketing_private.creative_assignee_allowed(p_org,p_brand,owner) then raise exception 'Choose an authorized brand owner.';end if;
 if coalesce(p_payload->>'timezone','Asia/Kuala_Lumpur')<>'Asia/Kuala_Lumpur' then raise exception 'V1 visit schedules use Malaysia time.';end if;
 if p_id is null then
 insert into public.marketing_creator_collaborations(organization_id,brand_id,creator_id,outlet_id,campaign_id,title,owner_id,visit_at,follow_up_date,status,cash_cost,in_kind_cost,currency,cost_state,notes,created_by,updated_by)
 values(p_org,p_brand,linked_creator,outlet,campaign,trim(p_payload->>'title'),owner,nullif(p_payload->>'visit_at','')::timestamptz,nullif(p_payload->>'follow_up_date','')::date,
 coalesce(p_payload->>'status','planned'),coalesce((p_payload->>'cash_cost')::numeric,0),coalesce((p_payload->>'in_kind_cost')::numeric,0),coalesce(p_payload->>'currency','MYR'),coalesce(p_payload->>'cost_state','estimated'),coalesce(p_payload->>'notes',''),actor,actor) returning * into v;
 else
 update public.marketing_creator_collaborations set outlet_id=outlet,campaign_id=campaign,title=trim(p_payload->>'title'),owner_id=owner,visit_at=nullif(p_payload->>'visit_at','')::timestamptz,
 follow_up_date=nullif(p_payload->>'follow_up_date','')::date,status=p_payload->>'status',cash_cost=coalesce((p_payload->>'cash_cost')::numeric,0),in_kind_cost=coalesce((p_payload->>'in_kind_cost')::numeric,0),
 currency=coalesce(p_payload->>'currency','MYR'),cost_state=p_payload->>'cost_state',notes=coalesce(p_payload->>'notes',''),revision=revision+1,updated_by=actor,updated_at=now() where id=v.id returning * into v;
 end if;
 if jsonb_typeof(p_payload->'deliverables')<>'array' or jsonb_array_length(p_payload->'deliverables')>50 then raise exception 'Use up to fifty deliverables.';end if;
 for item in select value from jsonb_array_elements(p_payload->'deliverables') loop
 if nullif(item->>'id','') is null then
 insert into public.marketing_creator_deliverables(collaboration_id,title,platform,due_date,status) values(v.id,trim(item->>'title'),item->>'platform',nullif(item->>'due_date','')::date,coalesce(item->>'status','pending'));
 else
 select * into d from public.marketing_creator_deliverables where id=(item->>'id')::uuid and collaboration_id=v.id for update;
 if d.id is null then raise exception 'Deliverable is unavailable.';end if;
 if d.platform<>item->>'platform' and exists(select 1 from public.marketing_creator_posts cp where cp.deliverable_id=d.id) then raise exception 'Preserve the platform of a linked deliverable.';end if;
 update public.marketing_creator_deliverables set title=trim(item->>'title'),platform=item->>'platform',due_date=nullif(item->>'due_date','')::date,status=item->>'status',revision=revision+1 where id=d.id;
 end if;end loop;
 result:=to_jsonb(v)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(dd)),'[]') from public.marketing_creator_deliverables dd where dd.collaboration_id=v.id));entity:='collaboration';record_id:=v.id;rev:=v.revision;
 elsif p_action='save_post' then
 if p_id is not null then select * into p from public.marketing_creator_posts where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null or p.revision<>p_revision then raise exception using errcode='40001',message='Post changed or is unavailable. Reload.';end if;end if;
 parsed:=marketing_private.creator_url(p_payload->>'url');
 if p.id is not null and (p.platform<>parsed->>'platform' or p.post_key<>parsed->>'post_key') then raise exception 'Keep the original post identity. Add another post for a different URL.';end if;
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 if linked_creator is not null and not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception 'Choose a creator linked to this brand.';end if;
 a:=null;if nullif(p_payload->>'account_id','') is not null then
 select * into a from public.marketing_creator_accounts where id=(p_payload->>'account_id')::uuid and organization_id=p_org and creator_id=linked_creator and platform=parsed->>'platform' for update;
 if a.id is null then raise exception 'Choose this creator’s matching platform account.';end if;end if;
 preview:=public.marketing_creator_post_preview(p_org,p_brand,p_payload->>'url');
 if linked_creator is not null and preview->>'matched_creator_id' is distinct from linked_creator::text and coalesce((p_payload->>'confirm_link')::boolean,false)<>true then raise exception 'Confirm the creator manually; display names never establish identity.';end if;
 if a.id is not null and preview->>'author_external_id'=a.external_id and coalesce((preview->>'identity_verified')::boolean,false) then
 if not marketing_private.creator_editable(p_org,a.creator_id) then raise exception 'Verifying a shared account requires access to every linked brand.';end if;
 update public.marketing_creator_accounts set identity_verified=true,identity_source='authorized_meta',revision=revision+1,updated_at=now() where id=a.id returning * into a;
 insert into marketing_private.creator_revisions values('account',a.id,a.revision,to_jsonb(a),actor,now());end if;
 v:=null;if nullif(p_payload->>'collaboration_id','') is not null then
 select * into v from public.marketing_creator_collaborations where id=(p_payload->>'collaboration_id')::uuid and organization_id=p_org and brand_id=p_brand and creator_id=linked_creator;
 if v.id is null then raise exception 'Choose a same-brand collaboration for this creator.';end if;end if;
 d:=null;if nullif(p_payload->>'deliverable_id','') is not null then
 select * into d from public.marketing_creator_deliverables where id=(p_payload->>'deliverable_id')::uuid and collaboration_id=v.id and platform=parsed->>'platform';
 if d.id is null then raise exception 'Choose the matching collaboration deliverable.';end if;end if;
 outlet:=nullif(p_payload->>'outlet_id','')::uuid;
 if outlet is not null and not exists(select 1 from public.brand_outlets bo where bo.organization_id=p_org and bo.brand_id=p_brand and bo.outlet_id=outlet) then raise exception 'Choose a canonical brand-linked outlet.';end if;
 asset:=nullif(p_payload->>'asset_id','')::uuid;
 if asset is not null and not exists(select 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.brand_id=p_brand and m.state='ready' and public.current_user_has_permission('marketing_content.view')) then raise exception 'Choose authorized same-brand media.';end if;
 if p_id is null then
 insert into public.marketing_creator_posts(organization_id,brand_id,creator_id,account_id,collaboration_id,deliverable_id,outlet_id,platform,post_key,canonical_url,caption,published_at,asset_id,metadata_source,match_method,created_by,updated_by)
 values(p_org,p_brand,linked_creator,a.id,v.id,d.id,outlet,parsed->>'platform',parsed->>'post_key',parsed->>'canonical_url',coalesce(p_payload->>'caption',preview->>'caption',''),
 nullif(p_payload->>'published_at','')::timestamptz,asset,coalesce(preview->>'metadata_status','manual'),case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text then 'verified_identity' else 'manual_confirmed' end,actor,actor) returning * into p;
 else
 update public.marketing_creator_posts set creator_id=linked_creator,account_id=a.id,collaboration_id=v.id,deliverable_id=d.id,outlet_id=outlet,caption=coalesce(p_payload->>'caption',''),published_at=nullif(p_payload->>'published_at','')::timestamptz,
 asset_id=asset,match_method=case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text then 'verified_identity' else 'manual_confirmed' end,revision=revision+1,updated_by=actor,updated_at=now() where id=p.id returning * into p;
 end if;result:=to_jsonb(p);entity:='post';record_id:=p.id;rev:=p.revision;
 elsif p_action in ('add_metrics','capture_meta_metrics') then
 select * into p from public.marketing_creator_posts where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null then raise exception using errcode='42501',message='Post is unavailable.';end if;
 metrics:=p_payload->'metrics';
 if p_action='capture_meta_metrics' then
 preview:=public.marketing_creator_post_preview(p_org,p_brand,p.canonical_url);
 if preview->>'metadata_status'<>'authorized_meta' then raise exception 'Authorized Meta metrics are unavailable for this post.';end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into metrics from jsonb_each(preview->'metrics') where key in ('views','reach','likes','comments','shares','saves','interactions') and jsonb_typeof(value)='number';
 p_payload:=p_payload||jsonb_build_object('source_note','Authorized Meta synchronization','captured_at',preview->>'captured_at');
 end if;
 if jsonb_typeof(metrics)<>'object' or metrics='{}' or exists(select 1 from jsonb_each(metrics) x where x.key not in ('views','reach','likes','comments','shares','saves','interactions') or jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric<0 or (x.value::text)::numeric>1000000000000000) then raise exception 'Record non-negative available metrics only. Leave unavailable values blank.';end if;
 if nullif(p_payload->>'captured_at','') is null or (p_payload->>'captured_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Choose an actual capture time, not a future estimate.';end if;
 insert into public.marketing_creator_metric_snapshots(post_id,metrics,source,source_note,captured_at,recorded_by,request_id)
 values(p.id,metrics,case when p_action='capture_meta_metrics' then 'authorized_meta' else 'manual' end,trim(p_payload->>'source_note'),(p_payload->>'captured_at')::timestamptz,actor,p_request) returning to_jsonb(marketing_creator_metric_snapshots.*) into result;
 entity:='metrics';record_id:=p.id;rev:=null;
 end if;
 if rev is not null then insert into marketing_private.creator_revisions values(entity,record_id,rev,result,actor,now());end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 values(p_org,p_brand,'creators.'||p_action,actor,jsonb_build_object('entity',entity,'record_id',record_id,'revision',rev,'request_id',p_request));
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
 exception when unique_violation then raise exception using errcode='23505',message='This account or post identity already exists. Reload and open the existing record.';
end;$$;

create function public.marketing_creators_read(p_org uuid,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 if (select count(*) from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id))>5000 then raise exception 'Choose a brand to narrow this workspace.';end if;
 select jsonb_build_object(
 'creators',(select coalesce(jsonb_agg(to_jsonb(c)-'avatar_asset_id'||jsonb_build_object('avatar_asset_id',case when public.current_user_has_permission('marketing_content.view') and exists(select 1 from public.marketing_assets m where m.id=c.avatar_asset_id and marketing_private.brand_allowed(p_org,m.brand_id)) then c.avatar_asset_id end,
 'editable',marketing_private.creator_editable(p_org,c.id),'brand_ids',(select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb where cb.creator_id=c.id and marketing_private.brand_allowed(p_org,cb.brand_id))) order by c.name,c.id),'[]')
 from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id,p_brand)),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.platform,a.display_name),'[]') from public.marketing_creator_accounts a where a.organization_id=p_org and marketing_private.creator_visible(p_org,a.creator_id,p_brand)),
 'collaborations',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(d) order by d.due_date,d.id),'[]') from public.marketing_creator_deliverables d where d.collaboration_id=v.id)) order by v.created_at desc),'[]') from public.marketing_creator_collaborations v
 where v.organization_id=p_org and (p_brand is null or v.brand_id=p_brand) and marketing_private.brand_allowed(p_org,v.brand_id)),
 'posts',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('latest_metrics',(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from (select distinct on(k.key) k.key,k.value
 from public.marketing_creator_metric_snapshots s cross join lateral jsonb_each(s.metrics) k where s.post_id=p.id order by k.key,s.captured_at desc,s.recorded_at desc,s.id desc)x)) order by p.created_at desc),'[]')
 from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'snapshots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.captured_at desc,s.recorded_at desc,s.id desc),'[]') from public.marketing_creator_metric_snapshots s join public.marketing_creator_posts p on p.id=s.post_id
 where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'brand_ids',(select jsonb_agg(b.id) from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))) order by e.full_name),'[]') from public.employees e
 join public.organization_memberships om on om.employee_id=e.id and om.organization_id=p_org where e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))),
 'campaigns',case when public.current_user_has_permission('marketing_campaigns.view') then (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'brand_id',c.brand_id)),'[]') from public.marketing_campaigns c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)) else '[]'::jsonb end,
 'assets',case when public.current_user_has_permission('marketing_content.view') then (select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.marketing_assets m where m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) and (
 exists(select 1 from public.marketing_creators c where c.avatar_asset_id=m.id and marketing_private.creator_visible(p_org,c.id,p_brand)) or
 exists(select 1 from public.marketing_creator_posts p where p.asset_id=m.id and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)))) else '[]'::jsonb end
 ) into result;return result;
end;$$;
revoke all on function marketing_private.creator_visible(uuid,uuid,uuid),marketing_private.creator_editable(uuid,uuid),marketing_private.creator_url(text) from public,anon,authenticated;
revoke all on function public.marketing_creators_read(uuid,uuid),public.marketing_creator_post_preview(uuid,uuid,text),public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb) from public,anon;
grant execute on function public.marketing_creators_read(uuid,uuid),public.marketing_creator_post_preview(uuid,uuid,text),public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb) to authenticated;

-- Existing Media authority retains active creator/post references.
create or replace function public.marketing_media_cleanup_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets;
begin
 for a in select * from public.marketing_assets where storage_policy='temporary' and
 (state='ready' or (state='retiring' and cleanup_started_at<now()-interval '10 minutes')) order by created_at for update skip locked loop
  if exists(select 1 from public.marketing_creators c where c.avatar_asset_id=a.id) or exists(select 1 from public.marketing_creator_posts p where p.asset_id=a.id) then continue;end if;
  if exists(select 1 from public.marketing_creative_tasks t where a.id=any(t.asset_ids) and t.deleted_at is null and (t.status<>'completed' or t.linked_content_id is null or exists(select 1 from public.marketing_content linked where linked.id=t.linked_content_id and linked.status<>'published'))) then continue;end if;
  if exists(select 1 from public.marketing_content c join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision where r.payload::text like '%'||a.id::text||'%' and c.status<>'published') then continue;end if;
  if exists(select 1 from public.marketing_campaign_revisions r where r.payload::text like '%'||a.id::text||'%') or exists(select 1 from marketing_private.ads_changes r where r.configuration::text like '%'||a.id::text||'%') then continue;end if;
  if not exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and j.state='succeeded') then continue;end if;
  if exists(select 1 from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision where r.payload::text like '%'||a.id::text||'%' and
   (j.state not in ('succeeded','cancelled') or (j.state='succeeded' and not exists(select 1 from public.marketing_social_posts s where s.connection_id=j.connection_id and s.connection_generation=j.connection_generation and s.provider_post_id=j.provider_post_id and s.channel=j.channel)))) then continue;end if;
  update public.marketing_assets set state='retiring',cleanup_lease=gen_random_uuid(),cleanup_started_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
 end loop;return null;
end;$$;
