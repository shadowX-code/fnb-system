-- Exact-period provider aggregates stay canonical. Long jobs checkpoint private pages;
-- partial pages are never projected as a complete report or summed into Reach.
alter table marketing_private.ads_sync_jobs add column progress jsonb not null default '{}';
do $$ declare n text;begin
 select conname into n from pg_constraint where conrelid='marketing_private.ads_sync_jobs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%date_to - date_from%';
 if n is null then raise exception 'Ads date constraint changed';end if;
 execute format('alter table marketing_private.ads_sync_jobs drop constraint %I',n);
end $$;
alter table marketing_private.ads_sync_jobs add constraint ads_history_range check(date_to>=date_from and date_to-date_from<=1133);

-- Preserve request deduplication, current caller authority, generation and hourly cap.
do $$ declare f text;begin
 select pg_get_functiondef('public.marketing_ads_request_sync(uuid,date,date)'::regprocedure) into f;
 if position('p_to-p_from>93' in f)=0 then raise exception 'Ads request contract changed';end if;
 f:=replace(f,'p_to-p_from>93','p_to-p_from>1133 or p_from<((now() at time zone (select timezone from marketing_private.ads_accounts where connection_id=c.id))-interval ''37 months'')::date or p_to>(now() at time zone (select timezone from marketing_private.ads_accounts where connection_id=c.id))::date');
 execute f;
end $$;

create function public.marketing_ads_checkpoint(p_job uuid,p_lease uuid,p_progress jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare j marketing_private.ads_sync_jobs;
begin
 select * into j from marketing_private.ads_sync_jobs where id=p_job and lease=p_lease and state='leased' for update;
 if j.id is null then raise exception 'Synchronization lease changed.';end if;
 perform public.marketing_ads_material(p_job,p_lease);
 if jsonb_typeof(p_progress)<>'object' or octet_length(p_progress::text)>3000000 or coalesce((p_progress->>'step')::int,-1) not between 0 and 8 then raise exception 'Invalid reporting progress';end if;
 -- Only persisted forward progress resets the per-page retry budget.
 if coalesce((p_progress->>'requests')::int,0)<=coalesce((j.progress->>'requests')::int,0) then raise exception 'Reporting progress did not advance';end if;
 update marketing_private.ads_sync_jobs set progress=p_progress,state='queued',attempts=0,lease=null,lease_until=null,retry_at=null,error_code=null where id=j.id;
end;$$;
revoke all on function public.marketing_ads_checkpoint(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_ads_checkpoint(uuid,uuid,jsonb) to service_role;

-- Erasure/revocation must also erase unfinished provider pages, not just snapshots.
do $$ declare f text;sig text;begin
 foreach sig in array array['marketing_private.ads_credential_removed()','marketing_private.ads_subject_removed()','public.marketing_ads_finish(uuid,uuid,jsonb,text)'] loop
 select pg_get_functiondef(sig::regprocedure) into f;
 f:=replace(f,'set state=''cancelled'',','set progress=''{}''::jsonb,state=''cancelled'',');
 f:=replace(f,'set state=''succeeded'',','set progress=''{}''::jsonb,state=''succeeded'',');
 execute f;
 end loop;
end $$;

create or replace function public.marketing_ads_read(p_org uuid,p_brand uuid default null,p_from date default current_date-29,p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_ads.view');org_access boolean:=marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.view');accounts jsonb;reports jsonb;jobs jsonb;catalogs jsonb;coverage jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1133 then raise exception 'Select a valid reporting period of up to 37 months';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'brand_id',null,'account_id',c.provider_account_id,'account_slot',c.account_slot,'name',c.account_name,'status',c.status,'expires_at',c.expires_at,'generation',c.credential_generation,'last_synced_at',c.last_synced_at,'error_code',c.error_code,'sync',marketing_private.ads_sync_status(c.id,c.credential_generation),'health',case when a.generation=c.credential_generation then to_jsonb(a)-'connection_id' else null end)),'[]') into accounts
 from marketing_connections c left join marketing_private.ads_accounts a on a.connection_id=c.id
 where c.organization_id=p_org and c.channel='ad_account' and (org_access or exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=p_org and m.account_id=c.provider_account_id and m.brand_id is not null and (p_brand is null or m.brand_id=p_brand) and marketing_private.brand_allowed(p_org,m.brand_id)));
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',s.connection_id,'date_from',s.date_from,'date_to',s.date_to,'observed_at',s.observed_at,'payload',marketing_private.ads_project(p_org,c.provider_account_id,s.payload,p_brand,org_access))),'[]') into reports
 from marketing_private.ads_snapshots s join marketing_connections c on c.id=s.connection_id and c.credential_generation=s.generation
 where c.organization_id=p_org and s.date_from=p_from and s.date_to=p_to and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
 -- Configuration is a catalog, never evidence of metric availability in another period.
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',c.id,'observed_at',s.observed_at,'payload',jsonb_build_object('configs',projected->'configs','account',projected->'account','scope',projected->'scope','insights','{}'::jsonb,'not_synced',true))),'[]') into catalogs
 from marketing_connections c join lateral(select x.* from marketing_private.ads_snapshots x where x.connection_id=c.id and x.generation=c.credential_generation order by x.observed_at desc limit 1)s on true
 cross join lateral(select marketing_private.ads_project(p_org,c.provider_account_id,s.payload,p_brand,org_access) projected)pr
 where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
 select coalesce(jsonb_agg(jsonb_build_object('connection_id',c.id,'request_floor',((now() at time zone h.timezone)-interval '37 months')::date,
 'ranges',(select coalesce(jsonb_agg(jsonb_build_object('from',s.date_from,'to',s.date_to,'observed_at',s.observed_at,'warnings',s.payload->'warnings') order by s.date_from,s.date_to),'[]') from marketing_private.ads_snapshots s where s.connection_id=c.id and s.generation=c.credential_generation))), '[]') into coverage
 from marketing_connections c join marketing_private.ads_accounts h on h.connection_id=c.id and h.generation=c.credential_generation where c.organization_id=p_org and c.status in ('test_authorized','production_authorized') and c.expires_at>now() and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=c.id::text);
 select case when org_access then coalesce(jsonb_agg((to_jsonb(j)-array['lease','lease_until','actor_employee_id','progress'])||jsonb_build_object('progress',jsonb_build_object('step',j.progress->'step','requests',j.progress->'requests'))),'[]') else '[]' end into jobs
 from marketing_private.ads_sync_jobs j join marketing_connections c on c.id=j.connection_id and c.credential_generation=j.generation where c.organization_id=p_org and (j.state in ('queued','leased','retry') or j.created_at>now()-interval '1 day');
 return jsonb_build_object('accounts',accounts,'reports',reports,'catalogs',catalogs,'coverage',coverage,'jobs',jobs,'organization_access',org_access,'external_execution_enabled',false);
end;$$;
-- Never leak partial provider pages through the connection health projection either.
do $$ declare f text;begin
 select pg_get_functiondef('marketing_private.ads_sync_status(uuid,integer)'::regprocedure) into f;
 f:=replace(f,'''actor_employee_id'',''lease'',''lease_until''','''actor_employee_id'',''lease'',''lease_until'',''progress''');execute f;
end $$;

create function marketing_private.ads_progress_cleanup() returns trigger
language plpgsql set search_path=public as $$ begin
 if new.state in ('succeeded','failed','cancelled') then new.progress:='{}'::jsonb;end if;
 return new;
end;$$;
revoke all on function marketing_private.ads_progress_cleanup() from public,anon,authenticated,service_role;
create trigger ads_progress_cleanup before update on marketing_private.ads_sync_jobs for each row execute function marketing_private.ads_progress_cleanup();
