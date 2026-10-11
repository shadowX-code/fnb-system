create function public.marketing_ads_change_prepare(p_request uuid,p_auth_user uuid,p_org uuid,p_brand uuid,p_connection uuid,p_operation text,p_config jsonb,p_media_hash text default null,p_previous uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; c marketing_connections; a marketing_private.ads_accounts; r marketing_private.ads_changes; old marketing_private.ads_changes; m marketing_private.ads_campaign_brands; asset marketing_assets; baseline jsonb; config jsonb:=p_config; cap bigint; fp text; rev int:=1; tree jsonb; start_at timestamptz; end_at timestamptz;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 if p_brand is null or not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_ads.manage') then raise exception using errcode='42501',message='Brand advertising management required.';end if;
 if p_request is null or p_operation not in ('create','pause','resume','budget') or config is null or jsonb_typeof(config)<>'object' or length(config::text)>12000 then raise exception 'Invalid advertising intent';end if;
 perform pg_advisory_xact_lock(hashtextextended('ads_change:'||p_request,0));
 select * into c from marketing_connections where id=p_connection and organization_id=p_org and channel='ad_account' and status in ('test_authorized','production_authorized') and expires_at>now();
 select * into a from marketing_private.ads_accounts where connection_id=c.id and generation=c.credential_generation and read_verified;
 if a.connection_id is null or a.currency<>'MYR' then raise exception 'A verified MYR account is required; other currencies use Ads Manager.';end if;
 -- Duplicate retry returns the original intent before recomputing a potentially changed provider baseline.
 select * into r from marketing_private.ads_changes where id=p_request;
 if found then
 if r.created_by<>actor or r.organization_id<>p_org or r.brand_id<>p_brand or r.connection_id<>p_connection or r.operation<>p_operation or r.previous_id is distinct from p_previous or (r.configuration-'media') is distinct from config then raise exception 'Advertising request changed';end if;
 return to_jsonb(r)-'lease'-'lease_until';end if;
 if p_operation='create' then
 if not (config ?& array['name','objective','maximum_budget','start_time','end_time','age_min','age_max','placements','asset_id','page_id','caption','headline','url']) or exists(select 1 from jsonb_object_keys(config) k where k not in ('name','objective','maximum_budget','start_time','end_time','age_min','age_max','placements','asset_id','page_id','instagram_id','caption','headline','url'))
 or length(trim(config->>'name')) not between 1 and 150 or config->>'objective' not in ('OUTCOME_AWARENESS','OUTCOME_TRAFFIC')
 or coalesce(config->>'maximum_budget','') !~ '^[1-9][0-9]{0,8}$' or coalesce(config->>'age_min','') !~ '^[0-9]{2}$' or coalesce(config->>'age_max','') !~ '^[0-9]{2}$'
 or (config->>'age_min')::int<18 or (config->>'age_max')::int>65 or (config->>'age_max')::int<(config->>'age_min')::int
 or config->>'placements' not in ('facebook_feed','instagram_feed','both_feeds') or coalesce(config->>'url','') !~ '^https://[^[:space:]]+$'
 or length(coalesce(config->>'caption','')) not between 1 and 2200 or length(coalesce(config->>'headline','')) not between 1 and 120 then raise exception 'Use a supported Awareness or Website Traffic image configuration.';end if;
 start_at:=(config->>'start_time')::timestamptz; end_at:=(config->>'end_time')::timestamptz;
 if start_at is null or end_at is null or end_at<=start_at or end_at-start_at>interval '90 days' or end_at<=now() then raise exception 'Select a bounded future schedule up to 90 days.';end if;
 if not exists(select 1 from marketing_connections p where p.organization_id=p_org and p.brand_id=p_brand and p.channel='facebook' and p.provider_account_id=config->>'page_id' and p.status in ('test_authorized','production_authorized')) then raise exception 'Select this brand''s connected Page.';end if;
 if config->>'placements'<>'facebook_feed' and not exists(select 1 from marketing_connections i where i.organization_id=p_org and i.brand_id=p_brand and i.channel='instagram' and i.provider_account_id=config->>'instagram_id' and i.status in ('test_authorized','production_authorized')) then raise exception 'Select this brand''s connected Instagram account.';end if;
 select * into asset from marketing_assets where id=(config->>'asset_id')::uuid and organization_id=p_org and brand_id=p_brand and state='ready' and mime_type in ('image/jpeg','image/png') and size_bytes<=8388608;
 if asset.id is null or coalesce(p_media_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Verified brand image required.';end if;
 config:=config||jsonb_build_object('media',jsonb_build_object('id',asset.id,'object_path',asset.object_path,'mime_type',asset.mime_type,'size_bytes',asset.size_bytes,'sha256',p_media_hash));
 cap:=(config->>'maximum_budget')::bigint;
 else
 if exists(select 1 from jsonb_object_keys(config) k where k not in ('campaign_id','maximum_budget')) or coalesce(config->>'campaign_id','') !~ '^[0-9]{1,30}$' then raise exception 'Invalid campaign operation';end if;
 select * into m from marketing_private.ads_campaign_brands where organization_id=p_org and account_id=c.provider_account_id and campaign_id=config->>'campaign_id' and brand_id=p_brand;
 if m.campaign_id is null then raise exception using errcode='42501',message='Campaign must be explicitly attributed to this brand.';end if;
 select marketing_private.ads_campaign_tree(s.payload,config->>'campaign_id') into baseline from marketing_private.ads_snapshots s where connection_id=c.id and generation=c.credential_generation order by observed_at desc limit 1;
 if baseline->'campaign' is null or baseline->'campaign'='null' then raise exception 'Synchronize this campaign first';end if;
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
 if old.id is null or old.organization_id<>p_org or old.brand_id<>p_brand or old.connection_id<>p_connection or old.state not in ('draft','review','approved','failed','stale') then raise exception 'This revision can no longer be changed';end if;
 rev:=old.revision+1;update marketing_private.ads_changes set state='superseded',updated_at=now() where id=old.id;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor) values(old.id,old.revision,'superseded',actor);
 end if;
 fp:=encode(extensions.digest(jsonb_build_object('request',p_request,'revision',rev,'org',p_org,'brand',p_brand,'connection',c.id,'generation',c.credential_generation,'account',c.provider_account_id,'currency',a.currency,'timezone',a.timezone,'operation',p_operation,'config',config,'baseline',baseline,'attribution_revision',m.revision,'maximum_budget',cap)::text,'sha256'),'hex');
 insert into marketing_private.ads_changes(id,organization_id,brand_id,connection_id,generation,account_id,currency,timezone,revision,previous_id,operation,configuration,baseline,attribution_revision,maximum_budget,fingerprint,created_by)
 values(p_request,p_org,p_brand,c.id,c.credential_generation,c.provider_account_id,a.currency,a.timezone,rev,p_previous,p_operation,config,baseline,m.revision,cap,fp,actor) returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,rev,'draft',actor,jsonb_build_object('fingerprint',fp));
 return to_jsonb(r)-'lease'-'lease_until';
end;$$;


revoke all on function public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid) from public,anon,authenticated; grant execute on function public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid) to service_role;
