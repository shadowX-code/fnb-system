-- Adds local-only drafts and source-bound create revisions. No execution settings change.
create function marketing_private.ads_source_post(p_org uuid,p_brand uuid,p_job uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('job_id',j.id,'content_id',j.content_id,'revision',j.revision,'page_id',c.provider_account_id,
  'page_connection_id',c.id,'page_generation',c.credential_generation,'provider_post_id',j.provider_post_id,
  'format',v->>'format','caption',coalesce(v->>'caption',''))
 from public.marketing_jobs j join public.marketing_connections c on c.id=j.connection_id
 join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
 cross join lateral jsonb_array_elements(r.payload->'variants') v
 where j.id=p_job and j.organization_id=p_org and j.brand_id=p_brand and j.channel='facebook' and j.state='succeeded'
 and c.organization_id=p_org and c.brand_id=p_brand and c.channel='facebook'
 and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
 and j.provider_post_id ~ ('^'||c.provider_account_id||'_[0-9]{1,30}$')
 and v->>'channel'='facebook' and v->>'format' in ('text','image')
 and coalesce(marketing_private.publication_availability_projection(c.id,c.credential_generation,c.provider_account_id,j.provider_post_id)->>'state','') not in ('deleted','manually_removed','unavailable','access_restricted','temporarily_unavailable','conflict')
 limit 1;
$$;
revoke all on function marketing_private.ads_source_post(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function marketing_private.ads_workspace_config(p_org uuid,p_brand uuid,p_connection uuid,p_config jsonb,p_hash text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c jsonb:=p_config; a marketing_private.ads_accounts; m public.marketing_assets; source jsonb; start_at timestamptz;end_at timestamptz;g jsonb;
begin
 if c->'draft_only'='true'::jsonb then
  if (c-array['draft_only','name','workspace'])<>'{}'::jsonb or jsonb_typeof(c->'workspace') is distinct from 'object'
   or length(coalesce(c->>'name','')) not between 1 and 150 or octet_length(c::text)>10000 or exists(select 1 from jsonb_each(c->'workspace') e where e.key not in ('name','creative_source','objective','page_id','source_job_id','asset_id','placements','caption','headline','url','budget','start_local','end_local','age_min','age_max','audience_type','city_key','city_name','latitude','longitude','radius','universal_beneficiary','universal_payer') or jsonb_typeof(e.value) not in ('string','number')) then raise exception 'Invalid ad draft.';end if;
  return c;
 end if;
 if c->'create_contract_version' is distinct from '3'::jsonb or (c-array['create_contract_version','creative_source','name','objective','maximum_budget','start_local','end_local','age_min','age_max','placements','asset_id','page_id','instagram_id','caption','headline','url','adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','audience','source_job_id'])<>'{}'::jsonb
 or not (c ?& array['name','objective','maximum_budget','start_local','end_local','age_min','age_max','placements','page_id','audience']) then raise exception 'Unsupported ad configuration.';end if;
 select * into a from marketing_private.ads_accounts where connection_id=p_connection;
 if a.currency is distinct from 'MYR' or not exists(select 1 from pg_timezone_names where name=a.timezone) then raise exception 'A verified MYR account and timezone are required.';end if;
 if length(trim(coalesce(c->>'name',''))) not between 1 and 150 or coalesce(c->>'maximum_budget','') !~ '^[1-9][0-9]{0,8}$'
 or coalesce(c->>'age_min','') !~ '^[0-9]{2}$' or coalesce(c->>'age_max','') !~ '^[0-9]{2}$'
 or (c->>'age_min')::int<18 or (c->>'age_max')::int>65 or (c->>'age_min')::int>(c->>'age_max')::int
 or coalesce(c->>'objective','') not in ('OUTCOME_AWARENESS','OUTCOME_TRAFFIC')
 or coalesce(c->>'placements','') not in ('facebook_feed','instagram_feed','both_feeds') then raise exception 'Check the name, objective, ages and lifetime budget.';end if;
 if coalesce(c->>'start_local','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or coalesce(c->>'end_local','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Choose start and end dates in the account timezone.';end if;
 start_at:=(c->>'start_local')::timestamp at time zone a.timezone;end_at:=(c->>'end_local')::timestamp at time zone a.timezone;
 if start_at<=now() or end_at<=start_at or end_at-start_at>interval '90 days'
 or to_char(start_at at time zone a.timezone,'YYYY-MM-DD"T"HH24:MI')<>c->>'start_local'
 or to_char(end_at at time zone a.timezone,'YYYY-MM-DD"T"HH24:MI')<>c->>'end_local' then raise exception 'Use a valid future schedule up to 90 days.';end if;
 if not exists(select 1 from public.marketing_connections p where p.organization_id=p_org and p.brand_id=p_brand and p.channel='facebook' and p.provider_account_id=c->>'page_id' and p.status in ('test_authorized','production_authorized') and p.expires_at>now()) then raise exception 'Select this Brand’s current Facebook Page.';end if;
 if c->>'placements'<>'facebook_feed' and not exists(select 1 from public.marketing_connections i where i.organization_id=p_org and i.brand_id=p_brand and i.channel='instagram' and i.provider_account_id=c->>'instagram_id' and i.status in ('test_authorized','production_authorized') and i.expires_at>now()) then raise exception 'Select this Brand’s current Instagram account.';end if;
 if c->'adset_contract_version' is distinct from '2'::jsonb or c->'regional_regulated_categories' is distinct from '["MALAYSIA_UNIVERSAL"]'::jsonb
 or jsonb_typeof(c->'regional_regulation_identities') is distinct from 'object'
 or ((c->'regional_regulation_identities')-array['universal_beneficiary','universal_payer'])<>'{}'::jsonb
 or coalesce(c#>>'{regional_regulation_identities,universal_beneficiary}','') !~ '^[0-9]{1,30}$'
 or coalesce(c#>>'{regional_regulation_identities,universal_payer}','') !~ '^[0-9]{1,30}$' then raise exception 'Enter the verified Meta advertiser and payer identity IDs.';end if;
 if c->>'objective'='OUTCOME_AWARENESS' then
  if c->'promoted_object' is distinct from jsonb_build_object('page_id',c->>'page_id') then raise exception 'Promoted Page does not match.';end if;
 elsif c?'promoted_object' then raise exception 'Website Traffic does not accept a promoted object.';end if;
 g:=c->'audience';
 if jsonb_typeof(g) is distinct from 'object' or coalesce(g->>'type','') not in ('city','radius') or (g-array['type','key','name','latitude','longitude','radius'])<>'{}'::jsonb
 or jsonb_typeof(g->'radius') is distinct from 'number' or (g->>'radius')::numeric not between 1 and 80 then raise exception 'Choose a local audience and radius from 1–80 km.';end if;
 if g->>'type'='city' then
  if coalesce(g->>'key','') !~ '^[0-9]{1,30}$' or length(coalesce(g->>'name','')) not between 1 and 150 or (g-array['type','key','name','radius'])<>'{}'::jsonb
   or (g->>'radius')::numeric<17 or trunc((g->>'radius')::numeric)<>(g->>'radius')::numeric then raise exception 'Select a Meta Malaysian city with a 17–80 km radius.';end if;
 else
  if (g-array['type','latitude','longitude','radius'])<>'{}'::jsonb or jsonb_typeof(g->'latitude') is distinct from 'number' or jsonb_typeof(g->'longitude') is distinct from 'number'
   or (g->>'latitude')::numeric not between 0 and 8 or (g->>'longitude')::numeric not between 99 and 120 then raise exception 'Choose coordinates in Malaysia; Meta must verify delivery eligibility.';end if;
 end if;
 if c->>'creative_source'='facebook_post' then
  if c->>'objective'<>'OUTCOME_AWARENESS' or c->>'placements'<>'facebook_feed' or c ?| array['asset_id','instagram_id','caption','headline','url'] then raise exception 'Promote Facebook posts with Awareness in Facebook Feed only.';end if;
  source:=marketing_private.ads_source_post(p_org,p_brand,(c->>'source_job_id')::uuid);
  if source is null or source->>'page_id' is distinct from c->>'page_id' then raise exception 'Published source post is unavailable or belongs to another Brand/Page.';end if;
  c:=c||jsonb_build_object('source_post',source);
 elsif c->>'creative_source'='new_image' then
  if c?'source_job_id' or coalesce(c->>'url','') !~ '^https://[^[:space:]]+$' or length(coalesce(c->>'caption','')) not between 1 and 2200 or length(coalesce(c->>'headline','')) not between 1 and 120 then raise exception 'Provide a caption, headline and HTTPS destination.';end if;
  select * into m from public.marketing_assets where id=(c->>'asset_id')::uuid and organization_id=p_org and brand_id=p_brand and state='ready'
   and mime_type in ('image/jpeg','image/png') and size_bytes<=8388608 and (c->>'placements'='facebook_feed' or mime_type='image/jpeg');
  if m.id is null or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Choose one compatible Brand image up to 8 MB.';end if;
  c:=c||jsonb_build_object('media',jsonb_build_object('id',m.id,'object_path',m.object_path,'mime_type',m.mime_type,'size_bytes',m.size_bytes,'sha256',p_hash));
 else raise exception 'Choose Promote Existing Post or Create New Ad.';end if;
 return c||jsonb_build_object('start_time',start_at,'end_time',end_at);
end;$$;
revoke all on function marketing_private.ads_workspace_config(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.marketing_ads_change_prepare(p_request uuid, p_auth_user uuid, p_org uuid, p_brand uuid, p_connection uuid, p_operation text, p_config jsonb, p_media_hash text DEFAULT NULL::text, p_previous uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid; c marketing_connections; a marketing_private.ads_accounts; r marketing_private.ads_changes; old marketing_private.ads_changes; m marketing_private.ads_campaign_brands; asset marketing_assets; baseline jsonb; config jsonb:=p_config; cap bigint; fp text; rev int:=1; tree jsonb; start_at timestamptz; end_at timestamptz;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 if p_brand is null or not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage') then raise exception using errcode='42501',message='Brand advertising management required.';end if;
 if p_request is null or p_operation not in ('create','pause','resume','budget') or config is null or jsonb_typeof(config)<>'object' or length(config::text)>12000 then raise exception 'Invalid advertising intent';end if;
 perform pg_advisory_xact_lock(hashtextextended('ads_change:'||p_request,0));
 select * into c from marketing_connections where id=p_connection and organization_id=p_org and channel='ad_account' and status in ('test_authorized','production_authorized') and expires_at>now();
 select * into a from marketing_private.ads_accounts where connection_id=c.id and generation=c.credential_generation and read_verified;
 if a.connection_id is null or a.currency<>'MYR' then raise exception 'A verified MYR account is required; other currencies use Ads Manager.';end if;

 if p_previous is not null then
  select * into old from marketing_private.ads_changes where id=p_previous;
  if old.id is null or old.organization_id<>p_org or old.brand_id<>p_brand or old.connection_id<>p_connection then raise exception 'Revision scope changed';end if;
  if old.state='reconciling' or old.configuration?'recovery_source' then
   if p_operation<>'create' or old.operation<>'create' or old.provider_state->>'pending' is distinct from 'adset'
    or old.provider_state ?| array['adset_id','creative_id','ad_id'] or not marketing_private.ads_change_current(old) then raise exception 'Only a known partial Ad Set creation may prepare declaration recovery';end if;
   config:=config||jsonb_build_object('recovery_source',coalesce(old.configuration->>'recovery_source',old.id::text));
   if (config-array['adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source']) is distinct from
      (old.configuration-array['media','adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source']) then raise exception 'Recovery may change only advertiser declarations and promoted Page';end if;
  end if;
 end if;
 if config?'recovery_source' and (p_previous is null or not (old.state='reconciling' or old.configuration?'recovery_source')) then raise exception 'Recovery source must be derived from a known partial creation';end if;
 -- Duplicate retry returns the original intent before recomputing a potentially changed provider baseline.
 select * into r from marketing_private.ads_changes where id=p_request;
 if found then
 if r.created_by<>actor or r.organization_id<>p_org or r.brand_id<>p_brand or r.connection_id<>p_connection or r.operation<>p_operation or r.previous_id is distinct from p_previous or (r.configuration - (case when r.configuration->>'create_contract_version'='3' then array['media','source_post','start_time','end_time'] else array['media'] end)) is distinct from config then raise exception 'Advertising request changed';end if;
 return to_jsonb(r)-'lease'-'lease_until';end if;
 if p_operation='create' and (config->>'create_contract_version'='3' or config->'draft_only'='true'::jsonb) then
 config:=marketing_private.ads_workspace_config(p_org,p_brand,p_connection,config,p_media_hash);cap:=coalesce((config->>'maximum_budget')::bigint,0);
 elsif p_operation='create' then
 if not (config ?& array['name','objective','maximum_budget','start_time','end_time','age_min','age_max','placements','asset_id','page_id','caption','headline','url']) or exists(select 1 from jsonb_object_keys(config) k where k not in ('name','objective','maximum_budget','start_time','end_time','age_min','age_max','placements','asset_id','page_id','instagram_id','caption','headline','url','adset_contract_version','regional_regulated_categories','regional_regulation_identities','promoted_object','recovery_source'))
 or length(trim(config->>'name')) not between 1 and 150 or config->>'objective' not in ('OUTCOME_AWARENESS','OUTCOME_TRAFFIC')
 or coalesce(config->>'maximum_budget','') !~ '^[1-9][0-9]{0,8}$' or coalesce(config->>'age_min','') !~ '^[0-9]{2}$' or coalesce(config->>'age_max','') !~ '^[0-9]{2}$'
 or (config->>'age_min')::int<18 or (config->>'age_max')::int>65 or (config->>'age_max')::int<(config->>'age_min')::int
 or config->>'placements' not in ('facebook_feed','instagram_feed','both_feeds') or coalesce(config->>'url','') !~ '^https://[^[:space:]]+$'
 or length(coalesce(config->>'caption','')) not between 1 and 2200 or length(coalesce(config->>'headline','')) not between 1 and 120 then raise exception 'Use a supported Awareness or Website Traffic image configuration.';end if;

 if config->'adset_contract_version' is distinct from '2'::jsonb or config->'regional_regulated_categories' is distinct from '["MALAYSIA_UNIVERSAL"]'::jsonb
  or jsonb_typeof(config->'regional_regulation_identities') is distinct from 'object'
  or ((config->'regional_regulation_identities')-array['universal_beneficiary','universal_payer']) is distinct from '{}'::jsonb
  or jsonb_typeof(config#>'{regional_regulation_identities,universal_beneficiary}') is distinct from 'string'
  or jsonb_typeof(config#>'{regional_regulation_identities,universal_payer}') is distinct from 'string'
  or coalesce(config#>>'{regional_regulation_identities,universal_beneficiary}','') !~ '^[0-9]{1,30}$'
  or coalesce(config#>>'{regional_regulation_identities,universal_payer}','') !~ '^[0-9]{1,30}$' then raise exception 'Explicit Meta advertiser and payer identity IDs are required';end if;
 if config->>'objective'='OUTCOME_AWARENESS' then
  if config->'promoted_object' is distinct from jsonb_build_object('page_id',config->>'page_id') then raise exception 'Promoted Page must match the selected brand Page';end if;
 elsif config?'promoted_object' then raise exception 'Promoted object is unsupported for Website Traffic';end if;
 if config?'recovery_source' and p_previous is null then raise exception 'Recovery requires a known source revision';end if;
 start_at:=(config->>'start_time')::timestamptz; end_at:=(config->>'end_time')::timestamptz;
 if start_at is null or end_at is null or end_at<=start_at or end_at-start_at>interval '90 days' or end_at<=now() then raise exception 'Select a bounded future schedule up to 90 days.';end if;
 if not exists(select 1 from marketing_connections p where p.organization_id=p_org and p.brand_id=p_brand and p.channel='facebook' and p.provider_account_id=config->>'page_id' and p.status in ('test_authorized','production_authorized')) then raise exception 'Select this brand''s connected Page.';end if;
 if config->>'placements'<>'facebook_feed' and not exists(select 1 from marketing_connections i where i.organization_id=p_org and i.brand_id=p_brand and i.channel='instagram' and i.provider_account_id=config->>'instagram_id' and i.status in ('test_authorized','production_authorized')) then raise exception 'Select this brand''s connected Instagram account.';end if;
 select * into asset from marketing_assets where id=(config->>'asset_id')::uuid and organization_id=p_org and brand_id=p_brand and state='ready' and mime_type in ('image/jpeg','image/png') and size_bytes<=8388608;
 if asset.id is null or coalesce(p_media_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified brand image required.';end if;
 config:=config||jsonb_build_object('media',jsonb_build_object('id',asset.id,'object_path',asset.object_path,'mime_type',asset.mime_type,'size_bytes',asset.size_bytes,'sha256',p_media_hash));
 cap:=(config->>'maximum_budget')::bigint;
 else
 if exists(select 1 from jsonb_object_keys(config) k where k not in ('campaign_id','maximum_budget','resume_scope')) or coalesce(config->>'campaign_id','') !~ '^[0-9]{1,30}$' then raise exception 'Invalid campaign operation';end if;
 select * into m from marketing_private.ads_campaign_brands where organization_id=p_org and account_id=c.provider_account_id and campaign_id=config->>'campaign_id' and brand_id=p_brand;
 if m.campaign_id is null then raise exception using errcode='42501',message='Campaign must be explicitly attributed to this brand.';end if;
 select marketing_private.ads_campaign_tree(s.payload,config->>'campaign_id') into baseline from marketing_private.ads_snapshots s where connection_id=c.id and generation=c.credential_generation order by observed_at desc limit 1;
 if baseline->'campaign' is null or baseline->'campaign'='null' then raise exception 'Synchronize this campaign first';end if;
 
 if config?'resume_scope' and (p_operation<>'resume' or config->>'resume_scope' not in ('campaign','feedx_hierarchy')) then raise exception 'Unsupported activation scope';end if;
 if p_operation='resume' and config->>'resume_scope'='feedx_hierarchy' then
 if baseline#>>'{campaign,status}'<>'PAUSED' or jsonb_array_length(baseline->'adsets')<>1 or jsonb_array_length(baseline->'ads')<>1 or not exists(select 1 from marketing_private.ads_changes source where source.organization_id=p_org and source.brand_id=p_brand and source.connection_id=c.id and source.operation='create' and source.state='succeeded' and source.receipt->>'campaign_id'=config->>'campaign_id' and source.receipt->>'adset_id'=baseline#>>'{adsets,0,id}' and source.receipt->>'ad_id'=baseline#>>'{ads,0,id}') then raise exception 'Only a reconciled FeedX-created paused hierarchy may be activated together';end if;
 end if;
 cap:=0;
 
 if p_operation in ('resume','budget') then
 if coalesce(baseline#>>'{campaign,lifetime_budget}','') !~ '^[1-9][0-9]{0,8}$' or coalesce((baseline#>>'{campaign,daily_budget}')::bigint,0)>0
 or exists(select 1 from jsonb_array_elements(baseline->'adsets') s where coalesce((s->>'daily_budget')::bigint,0)>0 or coalesce((s->>'lifetime_budget')::bigint,0)>0 or (s->>'end_time')::timestamptz is null or (s->>'end_time')::timestamptz<=now()) or jsonb_array_length(baseline->'adsets')=0 then raise exception 'Resume/budget changes require a bounded campaign lifetime budget. Use Ads Manager for advanced budgets.';end if;
 cap:=(baseline#>>'{campaign,lifetime_budget}')::bigint;
 if p_operation='budget' then
 if coalesce(config->>'maximum_budget','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'Exact positive lifetime budget required';end if;
 cap:=(config->>'maximum_budget')::bigint;
 elsif config?'maximum_budget' then raise exception 'Resume uses the verified Meta lifetime budget';end if;
 elsif config?'maximum_budget' then raise exception 'Pause cannot change budget';end if;
 end if;
 if p_previous is not null then
 select * into old from marketing_private.ads_changes where id=p_previous for update;
 if old.id is null or old.organization_id<>p_org or old.brand_id<>p_brand or old.connection_id<>p_connection or old.state not in ('draft','review','approved','failed','stale','reconciling') then raise exception 'This revision can no longer be changed';end if;
 rev:=old.revision+1;if old.state<>'reconciling' then update marketing_private.ads_changes set state='superseded',updated_at=now() where id=old.id;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor) values(old.id,old.revision,'superseded',actor);end if;
 end if;
 fp:=encode(extensions.digest(jsonb_build_object('request',p_request,'revision',rev,'org',p_org,'brand',p_brand,'connection',c.id,'generation',c.credential_generation,'account',c.provider_account_id,'currency',a.currency,'timezone',a.timezone,'operation',p_operation,'config',config,'baseline',baseline,'attribution_revision',m.revision,'maximum_budget',cap)::text,'sha256'),'hex');
 insert into marketing_private.ads_changes(id,organization_id,brand_id,connection_id,generation,account_id,currency,timezone,revision,previous_id,operation,configuration,baseline,attribution_revision,maximum_budget,fingerprint,created_by)
 values(p_request,p_org,p_brand,c.id,c.credential_generation,c.provider_account_id,a.currency,a.timezone,rev,p_previous,p_operation,config,baseline,m.revision,cap,fp,actor) returning * into r;

 if config?'recovery_source' then
  update marketing_private.ads_changes set provider_state=old.provider_state where id=r.id returning * into r;
 end if;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,rev,'draft',actor,jsonb_build_object('fingerprint',fp));
 return to_jsonb(r)-'lease'-'lease_until';
end;$function$;

CREATE OR REPLACE FUNCTION marketing_private.ads_change_current(r marketing_private.ads_changes)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select exists(select 1 from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id where c.id=r.connection_id and c.organization_id=r.organization_id and c.channel='ad_account' and c.provider_account_id=r.account_id and c.credential_generation=r.generation and c.status in ('test_authorized','production_authorized') and c.expires_at>now())
 and (r.operation<>'create' or coalesce(r.configuration->'draft_only'='true'::jsonb,false) or (r.configuration->>'creative_source'='facebook_post' and r.configuration->'source_post' is not distinct from marketing_private.ads_source_post(r.organization_id,r.brand_id,(r.configuration->>'source_job_id')::uuid) and r.configuration->'source_post' is not null) or (exists(select 1 from marketing_assets a where a.id=(r.configuration->>'asset_id')::uuid and a.brand_id=r.brand_id and a.organization_id=r.organization_id and a.state='ready' and a.object_path=r.configuration#>>'{media,object_path}' and a.size_bytes=(r.configuration#>>'{media,size_bytes}')::bigint and a.mime_type=r.configuration#>>'{media,mime_type}') and exists(select 1 from marketing_connections p where p.organization_id=r.organization_id and p.brand_id=r.brand_id and p.channel='facebook' and p.provider_account_id=r.configuration->>'page_id' and p.status in ('test_authorized','production_authorized'))))
 and (r.configuration->>'create_contract_version' is distinct from '3' or exists(select 1 from marketing_private.ads_accounts a where a.connection_id=r.connection_id and a.generation=r.generation and a.currency=r.currency and a.timezone=r.timezone))
 and (r.operation='create' or exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=r.organization_id and m.account_id=r.account_id and m.campaign_id=r.configuration->>'campaign_id' and m.brand_id=r.brand_id and m.revision=r.attribution_revision))
 and (r.operation='create' or r.baseline is not distinct from (select marketing_private.ads_campaign_tree(s.payload,r.configuration->>'campaign_id') from marketing_private.ads_snapshots s where s.connection_id=r.connection_id and s.generation=r.generation order by observed_at desc limit 1));
$function$;

CREATE OR REPLACE FUNCTION public.marketing_ads_change_transition(p_request uuid, p_fingerprint text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r marketing_private.ads_changes; actor uuid; permission text;
begin
 select * into r from marketing_private.ads_changes where id=p_request for update;
 if r.id is null then raise exception 'Proposal unavailable';end if;
 permission:=case p_action when 'submit' then 'marketing_ads.manage' when 'review' then 'marketing_ads.review' when 'approve' then 'marketing_ads.approve' when 'cancel' then 'marketing_ads.manage' end;
 if permission is null then raise exception 'Unsupported proposal action';end if;
 actor:=marketing_private.require_access(r.organization_id,r.brand_id,permission);
 if r.fingerprint is distinct from p_fingerprint then raise exception 'Revision changed';end if;
 if p_action<>'cancel' and not marketing_private.ads_change_current(r) then raise exception 'Authorization, attribution or Meta configuration changed. Prepare a new revision.';end if;

 if p_action in ('submit','review','approve') and r.configuration->'draft_only'='true'::jsonb then raise exception 'Complete the ad and prepare it for review before submitting.';end if;
 if p_action in ('submit','review','approve') and r.configuration->>'create_contract_version'='3' then perform marketing_private.ads_workspace_config(r.organization_id,r.brand_id,r.connection_id,r.configuration-array['media','source_post','start_time','end_time'],r.configuration#>>'{media,sha256}');end if;
 if p_action='approve' and r.configuration?'recovery_source' and not exists(select 1 from marketing_private.ads_change_events e where e.change_id=r.id and e.revision=r.revision
   and e.event='validate_adset' and e.id=(select max(latest.id) from marketing_private.ads_change_events latest where latest.change_id=r.id and latest.event='validate_adset') and e.evidence->'valid'='true'::jsonb and e.created_at>now()-interval '1 hour') then raise exception 'Validate the exact declaration revision with Meta before approval';end if;
 if p_action='submit' and r.state='draft' then r.state:='review';
 elsif p_action='review' and r.state='review' then r.reviewed_by:=actor;
 elsif p_action='approve' and r.state='review' and r.reviewed_by is not null then r.state:='approved';r.approved_by:=actor;r.approved_at:=now();r.approval_expires_at:=now()+interval '24 hours';
 elsif p_action='cancel' and r.state in ('draft','review','approved','failed','stale') then r.state:='cancelled';
 elsif (p_action='submit' and r.state='review') or (p_action='review' and r.reviewed_by=actor) or (p_action='approve' and r.state='approved' and r.approved_by=actor) or (p_action='cancel' and r.state='cancelled') then return to_jsonb(r)-'lease'-'lease_until';
 else raise exception 'Review the current proposal state';end if;
 update marketing_private.ads_changes set state=r.state,reviewed_by=r.reviewed_by,approved_by=r.approved_by,approved_at=r.approved_at,approval_expires_at=r.approval_expires_at,updated_at=now() where id=r.id returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,r.revision,p_action,actor,jsonb_build_object('fingerprint',r.fingerprint,'maximum_budget',r.maximum_budget));
 return to_jsonb(r)-'lease'-'lease_until';
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_ads_changes_read(p_org uuid, p_brand uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view'); rows jsonb; assets jsonb; pages jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'lease_until'||jsonb_build_object('current',marketing_private.ads_change_current(r),'events',(select coalesce(jsonb_agg(to_jsonb(e)-'actor' order by e.id),'[]') from marketing_private.ads_change_events e where e.change_id=r.id)) order by r.created_at desc),'[]') into rows from marketing_private.ads_changes r where r.organization_id=p_org and (p_brand is null or r.brand_id=p_brand) and marketing_private.brand_allowed(p_org,r.brand_id);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into assets from marketing_assets a where organization_id=p_org and (p_brand is null or brand_id=p_brand) and state='ready' and mime_type in ('image/jpeg','image/png') and size_bytes<=8388608 and marketing_private.brand_allowed(p_org,brand_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',c.brand_id,'page_id',c.provider_account_id,'name',c.account_name,'instagram_id',(select provider_account_id from marketing_connections i where i.organization_id=c.organization_id and i.brand_id=c.brand_id and i.channel='instagram' and i.status in ('test_authorized','production_authorized') limit 1))),'[]') into pages from marketing_connections c where c.organization_id=p_org and c.channel='facebook' and c.status in ('test_authorized','production_authorized') and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id);
 return jsonb_build_object('source_posts',coalesce((select jsonb_agg(source||jsonb_build_object('brand_id',j.brand_id) order by j.updated_at desc) from (select j.* from public.marketing_jobs j where j.organization_id=p_org and (p_brand is null or j.brand_id=p_brand) and j.channel='facebook' and j.state='succeeded' and marketing_private.brand_allowed(p_org,j.brand_id) order by j.updated_at desc limit 100) j cross join lateral (select marketing_private.ads_source_post(p_org,j.brand_id,j.id) source) p where p.source is not null),'[]'::jsonb),'changes',rows,'assets',assets,'pages',pages,'external_execution_enabled',false,'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'account_id',c.provider_account_id,'name',c.account_name,'health',jsonb_build_object('currency',a.currency,'timezone',a.timezone,'manage_verified',a.manage_verified))) from marketing_connections c join marketing_private.ads_accounts a on a.connection_id=c.id and a.generation=c.credential_generation where c.organization_id=p_org and c.channel='ad_account' and c.status in ('test_authorized','production_authorized') and a.read_verified and (marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.manage') or (p_brand is not null and marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage')))),'[]'::jsonb));
end;$function$;

-- Read-only provider preflight uses the existing account credential authority; never claims execution.
create function public.marketing_ads_workspace_material(p_auth_user uuid,p_org uuid,p_brand uuid,p_connection uuid,p_request uuid default null,p_fingerprint text default null,p_reserve boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid;c public.marketing_connections;r marketing_private.ads_changes;sealed jsonb;authorizer text;
begin
 select id into actor from public.employees where auth_user_id=p_auth_user;
 if not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage') then raise exception using errcode='42501',message='Brand advertising management required.';end if;
 select * into c from public.marketing_connections where id=p_connection and organization_id=p_org and channel='ad_account' and status in ('test_authorized','production_authorized') and expires_at>now();
 if c.id is null then raise exception 'Current Ad Account required.';end if;
 if p_request is not null then
  select * into r from marketing_private.ads_changes where id=p_request and organization_id=p_org and brand_id=p_brand and connection_id=c.id and fingerprint=p_fingerprint and operation='create' for update;
  if r.id is null or r.state not in ('draft','review','approved') or r.configuration->>'create_contract_version' is distinct from '3' or not marketing_private.ads_change_current(r) then raise exception 'Prepare the current complete ad revision before checking readiness.';end if;
 end if;
 select sealed_token,meta_user_id into sealed,authorizer from marketing_private.credentials where connection_id=c.id;
 if sealed is null then raise exception 'Ad Account authorization unavailable.';end if;
 if p_request is not null and p_reserve and (select count(*) from marketing_private.ads_change_events where change_id=r.id and event='readiness' and created_at>now()-interval '1 hour')>=10 then raise exception 'Readiness check limit reached. Try later.';end if;
 if p_request is not null and p_reserve then insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,r.revision,'readiness',actor,jsonb_build_object('fingerprint',r.fingerprint,'phase','requested'));end if;
 return jsonb_build_object('change',to_jsonb(r)-'lease'-'lease_until','connection',jsonb_build_object('id',c.id,'organization_id',c.organization_id,'brand_id',c.brand_id,'provider_account_id',c.provider_account_id,'credential_generation',c.credential_generation,'channel',c.channel,'meta_user_id',authorizer,'sealed_token',sealed));
end;$$;
revoke all on function public.marketing_ads_workspace_material(uuid,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.marketing_ads_workspace_material(uuid,uuid,uuid,uuid,uuid,text,boolean) to service_role;
