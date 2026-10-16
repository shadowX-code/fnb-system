-- Creator Master / social identity are already tenant-owned. Do not recreate IDs,
-- reassign Posts, merge names or repurpose legacy Brand relationships.
alter table public.marketing_creators add column shared_notes text not null default '' check(length(shared_notes)<=4000);
comment on column public.marketing_creators.notes is 'Retained pre-shared-directory notes; private legacy Brand context, never a shared profile field.';
comment on column public.marketing_creators.shared_notes is 'Tenant-shared profile notes. Commercial notes belong to Brand collaborations.';

create or replace function marketing_private.creator_visible(p_org uuid,p_id uuid,p_brand uuid default null)
returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.member(p_org)
 and public.current_user_has_permission('marketing_workspace.access')
 and public.current_user_has_permission('marketing_creators.view')
 and (p_brand is null or marketing_private.brand_allowed(p_org,p_brand))
 and exists(select 1 from public.marketing_creators c where c.id=p_id and c.organization_id=p_org);
$$;
create or replace function marketing_private.creator_editable(p_org uuid,p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select marketing_private.creator_visible(p_org,p_id) and public.current_user_has_permission('marketing_creators.manage');
$$;
-- A single projection for Directory, mutation results and replay redaction.
create function marketing_private.creator_shared_profile(c public.marketing_creators)
returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(c)-'notes'-'shared_notes'-'avatar_asset_id'||jsonb_build_object(
 'notes',c.shared_notes,'profile_scope','organization',
 'avatar_asset_id',case when public.current_user_has_permission('marketing_content.view') and exists(
 select 1 from public.marketing_assets m where m.id=c.avatar_asset_id and m.organization_id=c.organization_id
 and marketing_private.brand_allowed(c.organization_id,m.brand_id)) then c.avatar_asset_id end);
$$;
revoke all on function marketing_private.creator_shared_profile(public.marketing_creators) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION public.marketing_creator_directory(p_org uuid, p_brand uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 with visible_creators as materialized (
  select c.* from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id,p_brand)
 ), allowed_brands as materialized (
  select b.id,b.name from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id)
 ), history as (
  select v.creator_id,v.brand_id,b.name,count(distinct v.id) collaboration_count
  from public.marketing_creator_collaborations v join visible_creators c on c.id=v.creator_id join allowed_brands b on b.id=v.brand_id
  where v.organization_id=p_org group by v.creator_id,v.brand_id,b.name
 ), history_rows as (
  select creator_id,jsonb_agg(jsonb_build_object('brand_id',brand_id,'collaboration_count',collaboration_count) order by name,brand_id) rows from history group by creator_id
 )
 select jsonb_build_object(
 'creators',(select coalesce(jsonb_agg(marketing_private.creator_shared_profile(c)||jsonb_build_object(
  'avatar_asset_id',case when public.current_user_has_permission('marketing_content.view') and exists(select 1 from public.marketing_assets m where m.id=c.avatar_asset_id and marketing_private.brand_allowed(p_org,m.brand_id)) then c.avatar_asset_id end,
  'editable',marketing_private.creator_editable(p_org,c.id),
  'legacy_brand_notes',case when c.notes<>'' and (
   (exists(select 1 from public.marketing_creator_brands cb where cb.organization_id=p_org and cb.creator_id=c.id)
   and not exists(select 1 from public.marketing_creator_brands cb where cb.organization_id=p_org and cb.creator_id=c.id and not marketing_private.brand_allowed(p_org,cb.brand_id)))
   or (not exists(select 1 from public.marketing_creator_brands cb where cb.organization_id=p_org and cb.creator_id=c.id)
   and (c.created_by=marketing_private.actor() or marketing_private.all_brands_allowed(p_org)))) then c.notes end,
  'brand_ids',coalesce((select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb join allowed_brands b on b.id=cb.brand_id where cb.creator_id=c.id),'[]'::jsonb),
  'collaboration_history',coalesce(h.rows,'[]'::jsonb)) order by c.name,c.id),'[]') from visible_creators c left join history_rows h on h.creator_id=c.id),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.platform,a.display_name),'[]') from public.marketing_creator_accounts a join visible_creators c on c.id=a.creator_id where a.organization_id=p_org)
 ) into result;
 return result||jsonb_build_object('options',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('usage_count',(select count(*) from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id) and exists(select 1 from unnest(case when o.kind='location' then c.locations else c.categories end) tag where lower(regexp_replace(trim(tag),'\s+',' ','g'))=o.normalized)))) ,'[]') from public.marketing_creator_options o where o.organization_id=p_org));
end;$function$;

CREATE OR REPLACE FUNCTION marketing_private.creators_workspace(p_org uuid, p_brand uuid, p_history boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; directory jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 if (select count(*) from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id))>5000 then raise exception 'Choose a brand to narrow this workspace.';end if;
 directory:=public.marketing_creator_directory(p_org,null);
 select jsonb_build_object(
 'creators',directory->'creators','accounts',directory->'accounts',
 'collaborations',(select coalesce(jsonb_agg(marketing_private.creator_collaboration_lifecycle(to_jsonb(v))||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(d) order by d.due_date,d.id),'[]') from public.marketing_creator_deliverables d where d.collaboration_id=v.id)) order by v.created_at desc),'[]') from public.marketing_creator_collaborations v
 where v.organization_id=p_org and (p_brand is null or v.brand_id=p_brand) and marketing_private.brand_allowed(p_org,v.brand_id)),
 'posts',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('snapshot_count',(select count(*) from public.marketing_creator_metric_snapshots s where s.post_id=p.id),'latest_metrics',(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from (select distinct on(k.key) k.key,k.value
 from public.marketing_creator_metric_snapshots s cross join lateral jsonb_each(s.metrics) k where s.post_id=p.id order by k.key,s.captured_at desc,s.recorded_at desc,s.id desc)x)) order by p.created_at desc),'[]')
 from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'snapshots',case when p_history then (select coalesce(jsonb_agg(to_jsonb(s) order by s.captured_at desc,s.recorded_at desc,s.id desc),'[]') from public.marketing_creator_metric_snapshots s join public.marketing_creator_posts p on p.id=s.post_id
 where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)) else '[]'::jsonb end,
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',coalesce(nullif(btrim(e.nickname),''),e.full_name),'brand_ids',(select jsonb_agg(b.id) from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))) order by e.full_name),'[]') from public.employees e
 join public.organization_memberships om on om.employee_id=e.id and om.organization_id=p_org where e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))),
 'campaigns',case when public.current_user_has_permission('marketing_campaigns.view') then (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'brand_id',c.brand_id)),'[]') from public.marketing_campaigns c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)) else '[]'::jsonb end,
 'assets',case when public.current_user_has_permission('marketing_content.view') then (select coalesce(jsonb_agg(to_jsonb(m)-'cleanup_lease'-'cleanup_started_at'),'[]') from public.marketing_assets m where m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) and (
 exists(select 1 from public.marketing_creators c where c.avatar_asset_id=m.id and marketing_private.creator_visible(p_org,c.id,p_brand)) or
 exists(select 1 from public.marketing_creator_posts p where p.asset_id=m.id and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)))) else '[]'::jsonb end
 ) into result;return result||jsonb_build_object('options',directory->'options');
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_creator_command(p_request uuid, p_org uuid, p_brand uuid, p_action text, p_id uuid DEFAULT NULL::uuid, p_revision integer DEFAULT 0, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare actor uuid;fp text;prior public.marketing_requests;result jsonb;c public.marketing_creators;a public.marketing_creator_accounts;
 v public.marketing_creator_collaborations;p public.marketing_creator_posts;d public.marketing_creator_deliverables;
 parsed jsonb;preview jsonb;item jsonb;metrics jsonb;entity text;record_id uuid;rev integer;linked_creator uuid;asset uuid;outlet uuid;campaign uuid;owner uuid;profile jsonb;child jsonb;account_result jsonb;identity_changed boolean;
begin
 actor:=marketing_private.require_access(p_org,case when p_action in ('save_creator','archive_creator','save_account','archive_account','option_create','option_rename','option_delete') then null else p_brand end,'marketing_creators.manage');
 if p_request is null or p_revision is null or (p_brand is null and p_action not in ('save_creator','archive_creator','save_account','archive_account','option_create','option_rename','option_delete')) or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536
 or p_action not in ('save_creator','share_creator','archive_creator','save_account','archive_account','option_create','option_rename','option_delete','link_post','remove_publishing','save_collaboration','save_post','add_metrics','capture_meta_metrics') then raise exception 'Choose a brand and valid creator action.';end if;
 if p_action='capture_meta_metrics' then raise exception 'Meta references are read-only in V1. Record metrics with independent staff-provided evidence.';end if;
 fp:=md5(jsonb_build_array(p_org,p_brand,p_action,p_id,p_revision,p_payload)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry changed. Use a new request.';end if;if p_action in ('save_creator','archive_creator','share_creator') and prior.result->>'profile_scope' is distinct from 'organization' then
 return (prior.result-'notes'-'shared_notes'-'avatar_asset_id')||jsonb_build_object('notes','','profile_scope','organization');
 end if;return prior.result;end if;
 if p_action in ('save_creator','archive_creator','share_creator') and p_id is not null then
 select * into c from public.marketing_creators where id=p_id and organization_id=p_org for update;
 if c.id is null or not marketing_private.creator_visible(p_org,c.id) then raise exception using errcode='42501',message='Creator is unavailable in your brand scope.';end if;
 if c.revision<>p_revision then raise exception using errcode='40001',message='Creator changed. Reload before saving.';end if;
 if p_action<>'share_creator' and not marketing_private.creator_editable(p_org,c.id) then raise exception using errcode='42501',message='Manage Creators permission is required.';end if;
 end if;
 if p_action in ('option_create','option_rename','option_delete') then result:=marketing_private.creator_option_command(p_org,p_action,p_id,p_revision,p_payload);entity:='creator_option';record_id:=(result->>'id')::uuid;rev:=(result->>'revision')::integer;
 elsif p_action='remove_publishing' then result:=marketing_private.creator_remove_publishing(p_org,p_brand,p_id,p_revision,p_payload);entity:='collaboration';record_id:=p_id;rev:=(result->>'revision')::integer; elsif p_action='link_post' then result:=marketing_private.creator_link_post(p_org,p_brand,p_id,p_revision,p_payload);entity:='post';record_id:=(result->>'id')::uuid;rev:=(result->>'revision')::integer;
 elsif p_action='save_creator' then
 asset:=case when p_payload?'avatar_asset_id' then nullif(p_payload->>'avatar_asset_id','')::uuid else c.avatar_asset_id end;
 if asset is distinct from c.avatar_asset_id and not public.current_user_has_permission('marketing_content.view') then raise exception 'Media permission is required to change the profile image.';end if;
 if asset is not null and asset is distinct from c.avatar_asset_id then perform 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) for update;end if;
 if asset is not null and asset is distinct from c.avatar_asset_id and not exists(select 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.state='ready'
 and m.mime_type like 'image/%' and marketing_private.brand_allowed(p_org,m.brand_id) and public.current_user_has_permission('marketing_content.view')) then raise exception 'Choose authorized ready image media.';end if;
 if p_id is null then
 insert into public.marketing_creators(organization_id,name,email,phone,location,categories,shared_notes,avatar_asset_id,created_by,updated_by)
 values(p_org,trim(p_payload->>'name'),trim(coalesce(p_payload->>'email','')),trim(coalesce(p_payload->>'phone','')),trim(coalesce(p_payload->>'location','')),
 array(select distinct trim(value) from jsonb_array_elements_text(coalesce(p_payload->'categories','[]')) where length(trim(value)) between 1 and 60),coalesce(p_payload->>'notes',''),asset,actor,actor) returning * into c;
 else
 update public.marketing_creators set name=trim(p_payload->>'name'),email=trim(coalesce(p_payload->>'email','')),phone=trim(coalesce(p_payload->>'phone','')),location=trim(coalesce(p_payload->>'location','')),
 categories=array(select distinct trim(value) from jsonb_array_elements_text(coalesce(p_payload->'categories','[]')) where length(trim(value)) between 1 and 60),shared_notes=coalesce(p_payload->>'notes',''),
 avatar_asset_id=asset,revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 end if;
 c:=marketing_private.creator_labels(p_org,c.id,p_payload);if p_payload?'profiles' then
 if jsonb_typeof(p_payload->'profiles')<>'array' or jsonb_array_length(p_payload->'profiles')>30 then raise exception 'Use up to thirty social profiles.';end if;
 for child in select value from jsonb_array_elements(p_payload->'profiles') loop
 if jsonb_typeof(child)<>'object' then raise exception 'Invalid social profile.';end if;
 account_result:=public.marketing_creator_command(gen_random_uuid(),p_org,p_brand,
 case when coalesce((child->>'archived')::boolean,false) then 'archive_account' else 'save_account' end,
 nullif(child->>'id','')::uuid,coalesce((child->>'revision')::integer,0),child||jsonb_build_object('creator_id',c.id));
 end loop;end if;
 if p_action='save_creator' and p_payload?'primary_instagram_account_id' then
 if nullif(p_payload->>'primary_instagram_account_id','') is not null and not exists(select 1 from public.marketing_creator_accounts ca where ca.id=(p_payload->>'primary_instagram_account_id')::uuid and ca.creator_id=c.id and ca.organization_id=p_org and ca.platform='instagram' and not ca.archived) then raise exception 'Choose this Creator’s active Instagram profile.';end if;
 update public.marketing_creators set primary_instagram_account_id=nullif(p_payload->>'primary_instagram_account_id','')::uuid where id=c.id returning * into c;end if;
 result:=marketing_private.creator_shared_profile(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='share_creator' then
 if c.id is null then raise exception 'Choose an existing visible creator.';end if;
 insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now()) on conflict do nothing;
 update public.marketing_creators set revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 if p_action='save_creator' and p_payload?'primary_instagram_account_id' then
 if nullif(p_payload->>'primary_instagram_account_id','') is not null and not exists(select 1 from public.marketing_creator_accounts ca where ca.id=(p_payload->>'primary_instagram_account_id')::uuid and ca.creator_id=c.id and ca.organization_id=p_org and ca.platform='instagram' and not ca.archived) then raise exception 'Choose this Creator’s active Instagram profile.';end if;
 update public.marketing_creators set primary_instagram_account_id=nullif(p_payload->>'primary_instagram_account_id','')::uuid where id=c.id returning * into c;end if;
 result:=marketing_private.creator_shared_profile(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='archive_creator' then
 update public.marketing_creators set archived=coalesce((p_payload->>'archived')::boolean,true),revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 if p_action='save_creator' and p_payload?'primary_instagram_account_id' then
 if nullif(p_payload->>'primary_instagram_account_id','') is not null and not exists(select 1 from public.marketing_creator_accounts ca where ca.id=(p_payload->>'primary_instagram_account_id')::uuid and ca.creator_id=c.id and ca.organization_id=p_org and ca.platform='instagram' and not ca.archived) then raise exception 'Choose this Creator’s active Instagram profile.';end if;
 update public.marketing_creators set primary_instagram_account_id=nullif(p_payload->>'primary_instagram_account_id','')::uuid where id=c.id returning * into c;end if;
 result:=marketing_private.creator_shared_profile(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action in ('save_account','archive_account') then
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 select * into c from public.marketing_creators where id=linked_creator and organization_id=p_org for update;
 if c.id is null or not marketing_private.creator_editable(p_org,c.id) or not marketing_private.creator_visible(p_org,c.id) then raise exception using errcode='42501',message='Manage Creators permission is required.';end if;
 if p_id is not null then select * into a from public.marketing_creator_accounts where id=p_id and creator_id=c.id for update;
 if a.id is null or a.revision<>p_revision then raise exception using errcode='40001',message='Account changed. Reload.';end if;end if;
 if p_action='archive_account' then
 if a.id is null then raise exception 'Choose an existing social profile.';end if;
 update public.marketing_creator_accounts set archived=true,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 else
 if nullif(p_payload->>'followers','') is not null then raise exception 'Followers are system-sourced only.';end if; profile:=marketing_private.creator_profile(p_payload);
 identity_changed:=a.id is null or (a.platform,a.handle,a.external_id,a.profile_url) is distinct from
 (profile->>'platform',profile->>'handle',profile->>'external_id',profile->>'profile_url');
 if a.id is not null and a.platform<>profile->>'platform' and exists(select 1 from public.marketing_creator_posts cp where cp.account_id=a.id) then raise exception 'Preserve the platform of an account already linked to posts.';end if;
 if p_id is null then
 insert into public.marketing_creator_accounts(organization_id,creator_id,platform,display_name,handle,profile_url,external_id,created_by)
 values(p_org,c.id,profile->>'platform',trim(coalesce(p_payload->>'display_name','')),lower(ltrim(trim(coalesce(profile->>'handle','')),'@')),coalesce(profile->>'profile_url',''),trim(coalesce(profile->>'external_id','')),actor) returning * into a;
 else
 update public.marketing_creator_accounts set platform=profile->>'platform',display_name=trim(coalesce(p_payload->>'display_name','')),handle=lower(ltrim(trim(coalesce(profile->>'handle','')),'@')),
 profile_url=coalesce(profile->>'profile_url',''),external_id=trim(coalesce(profile->>'external_id','')),public_observation=case when identity_changed then null else public_observation end,identity_verified=case when identity_changed then false else identity_verified end,identity_source=case when identity_changed then 'staff_recorded' else identity_source end,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 end if;
 update public.marketing_creator_accounts set archived=false where id=a.id returning * into a;
 if a.handle='' and a.external_id='' and a.profile_url='' then raise exception 'Enter a handle, platform ID or profile URL.';end if;
 end if;
 if p_payload?'public_observation' then
 if nullif(p_payload->'public_observation'->>'captured_at','') is null or (p_payload->'public_observation'->>'captured_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Choose an actual profile observation time.';end if;
 if jsonb_typeof(p_payload->'public_observation')<>'object' or octet_length((p_payload->'public_observation')::text)>8000 then raise exception 'Invalid profile observation.';end if;
 if nullif(p_payload->'public_observation'->>'avatar_url','') is not null and p_payload->'public_observation'->>'avatar_url' !~ '^https://([A-Za-z0-9-]+[.])*(cdninstagram[.]com|fbcdn[.]net|xhscdn[.]com|sns-i11[.]rednotecdn[.]com|tiktokcdn[.]com|tiktokcdn-us[.]com|tiktokv[.]com|ibytedtos[.]com)/[^[:space:]]+$' then raise exception 'Unsupported profile image.';end if;
 update public.marketing_creator_accounts set public_observation=jsonb_build_object('source','public_profile_staff_confirmed','source_hint',left(p_payload->'public_observation'->>'source',150),'captured_at',p_payload->'public_observation'->'captured_at','avatar_url',p_payload->'public_observation'->'avatar_url','avatar_kind',case when a.platform='instagram' and p_payload->'public_observation'->>'avatar_kind'='profile_picture' and p_payload->'public_observation'->>'profile_url'=a.profile_url then 'profile_picture' end,'profile_url',case when p_payload->'public_observation'->>'profile_url'=a.profile_url then a.profile_url end) where id=a.id returning * into a;end if;
 result:=to_jsonb(a);entity:='account';record_id:=a.id;rev:=a.revision;
 elsif p_action='save_collaboration' then
 if p_id is not null then select * into v from public.marketing_creator_collaborations where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if v.id is null or v.revision<>p_revision then raise exception using errcode='40001',message='Collaboration changed or is unavailable. Reload.';end if;end if;
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 perform marketing_private.creator_bind(p_org,p_brand,linked_creator);
 if coalesce(p_payload->>'status','planned') not in ('planned','in_progress') and not (v.id is not null and p_payload->>'status'=v.status and v.status in ('completed','published','cancelled','awaiting_posts')) then raise exception 'Choose Planned or In Progress. Published is determined by confirmed publishing entries.';end if;
 if v.id is not null and v.creator_id is null and linked_creator is not null and exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=v.id and cp.creator_id is not null and cp.creator_id<>linked_creator) then raise exception 'Linked Posts belong to another Creator.';end if; if v.id is not null and v.creator_id is not null and linked_creator is distinct from v.creator_id then raise exception 'Preserve the collaboration creator. Create a new collaboration for another creator.';end if;
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
 update public.marketing_creator_collaborations set creator_id=coalesce(v.creator_id,linked_creator),outlet_id=outlet,campaign_id=campaign,title=trim(p_payload->>'title'),owner_id=owner,visit_at=nullif(p_payload->>'visit_at','')::timestamptz,
 follow_up_date=nullif(p_payload->>'follow_up_date','')::date,status=p_payload->>'status',cash_cost=coalesce((p_payload->>'cash_cost')::numeric,0),in_kind_cost=coalesce((p_payload->>'in_kind_cost')::numeric,0),
 currency=coalesce(p_payload->>'currency','MYR'),cost_state=p_payload->>'cost_state',notes=coalesce(p_payload->>'notes',''),revision=revision+1,updated_by=actor,updated_at=now() where id=v.id returning * into v;
 end if;
 if jsonb_typeof(p_payload->'deliverables')<>'array' or jsonb_array_length(p_payload->'deliverables')>50 then raise exception 'Use up to fifty deliverables.';end if;
 for item in select value from jsonb_array_elements(p_payload->'deliverables') loop
 if nullif(item->>'id','') is null then
 insert into public.marketing_creator_deliverables(collaboration_id,title,platform,due_date,status,content_type) values(v.id,trim(item->>'title'),item->>'platform',nullif(item->>'due_date','')::date,coalesce(item->>'status','pending'),nullif(item->>'content_type',''));
 else
 select * into d from public.marketing_creator_deliverables where id=(item->>'id')::uuid and collaboration_id=v.id for update;
 if d.id is null then raise exception 'Deliverable is unavailable.';end if;
 if d.platform<>item->>'platform' and exists(select 1 from public.marketing_creator_posts cp where cp.deliverable_id=d.id) then raise exception 'Preserve the platform of a linked deliverable.';end if;
 if exists(select 1 from public.marketing_creator_posts cp where cp.deliverable_id=d.id) and ((nullif(item->>'content_type','') is not null and nullif(item->>'content_type','') is distinct from d.content_type) or item->>'status'='cancelled') then raise exception 'Preserve a publishing entry with linked Posts.';end if; update public.marketing_creator_deliverables set content_type=coalesce(nullif(item->>'content_type',''),d.content_type),title=trim(item->>'title'),platform=item->>'platform',due_date=nullif(item->>'due_date','')::date,status=item->>'status',revision=revision+1 where id=d.id;
 end if;end loop;
 result:=to_jsonb(v)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(dd)),'[]') from public.marketing_creator_deliverables dd where dd.collaboration_id=v.id));entity:='collaboration';record_id:=v.id;rev:=v.revision;
 elsif p_action='save_post' then
 if p_id is not null then select * into p from public.marketing_creator_posts where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null or p.revision<>p_revision then raise exception using errcode='40001',message='Post changed or is unavailable. Reload.';end if;end if;
 if p.collaboration_id is not null then
 perform 1 from public.marketing_creator_collaborations where id=p.collaboration_id for update;
 if exists(select 1 from public.marketing_creator_collaborations where id=p.collaboration_id and status='published') and (nullif(p_payload->>'collaboration_id','')::uuid is distinct from p.collaboration_id or (nullif(p_payload->>'published_at','') is null and nullif(p_payload->>'published_date','') is null and p.publication_confirmed_at is null and coalesce((p_payload->>'confirm_published')::boolean,false)=false)) and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=p.collaboration_id and cp.id<>p.id and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then raise exception 'Change the collaboration status before removing its last published Post evidence.';end if;end if; parsed:=marketing_private.creator_url(p_payload->>'url'); if parsed->>'platform'='xhs' and (parsed->>'short_link')::boolean and p.id is null then raise exception 'Resolve the Xiaohongshu short link or paste its complete share URL before saving.';end if;
 if p.id is not null and (p.platform<>parsed->>'platform' or p.post_key<>parsed->>'post_key') then raise exception 'Keep the original post identity. Add another post for a different URL.';end if;
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 if linked_creator is not null and coalesce((p_payload->>'confirm_link')::boolean,false) then perform marketing_private.creator_bind(p_org,p_brand,linked_creator);end if;
 if linked_creator is not null and not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception 'Confirm the Creator for this Brand.';end if;
 a:=null;if nullif(p_payload->>'account_id','') is not null then
 select * into a from public.marketing_creator_accounts where id=(p_payload->>'account_id')::uuid and organization_id=p_org and creator_id=linked_creator and platform=parsed->>'platform' for update;
 if a.id is null or (a.archived and (p.id is null or a.id is distinct from p.account_id)) then raise exception 'Choose this creator’s active matching platform account.';end if;end if;
 preview:=public.marketing_creator_post_preview(p_org,p_brand,p_payload->>'url');
 if linked_creator is not null and (preview->>'matched_creator_id' is distinct from linked_creator::text or preview->>'matched_account_id' is distinct from a.id::text) and (p.id is null or linked_creator is distinct from p.creator_id or a.id is distinct from p.account_id) and coalesce((p_payload->>'confirm_link')::boolean,false)<>true then raise exception 'Confirm the creator manually; display names never establish identity.';end if;
 v:=null;if nullif(p_payload->>'collaboration_id','') is not null then
 select * into v from public.marketing_creator_collaborations where id=(p_payload->>'collaboration_id')::uuid and organization_id=p_org and brand_id=p_brand and (creator_id is null or creator_id is not distinct from linked_creator);
 if v.id is null then raise exception 'Choose a same-brand collaboration for this creator.';end if; perform 1 from public.marketing_creator_collaborations where id=v.id for update;end if;
 d:=null;if nullif(p_payload->>'deliverable_id','') is not null then
 select * into d from public.marketing_creator_deliverables where id=(p_payload->>'deliverable_id')::uuid and collaboration_id=v.id and platform=parsed->>'platform';
 if d.id is null then raise exception 'Choose the matching collaboration deliverable.';end if;end if;
 outlet:=nullif(p_payload->>'outlet_id','')::uuid;
 if outlet is not null and not exists(select 1 from public.brand_outlets bo where bo.organization_id=p_org and bo.brand_id=p_brand and bo.outlet_id=outlet) then raise exception 'Choose a canonical brand-linked outlet.';end if;
 asset:=case when p_payload?'asset_id' then nullif(p_payload->>'asset_id','')::uuid else p.asset_id end;
 if asset is distinct from p.asset_id and not public.current_user_has_permission('marketing_content.view') then raise exception 'Media permission is required to change the preview.';end if;
 if asset is not null and asset is distinct from p.asset_id then perform 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.brand_id=p_brand for update;end if;
 if asset is not null and asset is distinct from p.asset_id and not exists(select 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.brand_id=p_brand and m.state='ready' and public.current_user_has_permission('marketing_content.view')) then raise exception 'Choose authorized same-brand media.';end if;
 if p_id is null then
 insert into public.marketing_creator_posts(organization_id,brand_id,creator_id,account_id,collaboration_id,deliverable_id,outlet_id,platform,post_key,canonical_url,caption,published_at,asset_id,metadata_source,match_method,created_by,updated_by)
 values(p_org,p_brand,linked_creator,a.id,v.id,d.id,outlet,parsed->>'platform',parsed->>'post_key',parsed->>'canonical_url',coalesce(p_payload->>'caption',''),
 nullif(p_payload->>'published_at','')::timestamptz,asset,'staff_recorded',case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text and preview->>'matched_account_id'=a.id::text then 'verified_identity' else 'manual_confirmed' end,actor,actor) returning * into p;
 else
 update public.marketing_creator_posts set creator_id=linked_creator,account_id=a.id,collaboration_id=v.id,deliverable_id=d.id,outlet_id=outlet,caption=coalesce(p_payload->>'caption',''),published_at=nullif(p_payload->>'published_at','')::timestamptz,
 asset_id=asset,match_method=case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text and preview->>'matched_account_id'=a.id::text then 'verified_identity' else 'manual_confirmed' end,revision=revision+1,updated_by=actor,updated_at=now() where id=p.id returning * into p;
 end if;p:=marketing_private.creator_confirm_public(p.id,p_org,p_brand,p_payload);p:=marketing_private.creator_post_details(p_org,p_brand,p.id,p_payload);result:=to_jsonb(p);entity:='post';record_id:=p.id;rev:=p.revision;
 elsif p_action='add_metrics' then
 select * into p from public.marketing_creator_posts where id=p_id and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null then raise exception using errcode='42501',message='Post is unavailable.';end if;
 metrics:=p_payload->'metrics';
 if jsonb_typeof(metrics)<>'object' or metrics='{}' or exists(select 1 from jsonb_each(metrics) x where x.key not in ('views','reach','likes','comments','shares','saves','interactions') or jsonb_typeof(x.value)<>'number' or (x.value::text)::numeric<0 or (x.value::text)::numeric>1000000000000000) then raise exception 'Record non-negative available metrics only. Leave unavailable values blank.';end if;
 if nullif(p_payload->>'captured_at','') is null or (p_payload->>'captured_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Choose an actual capture time, not a future estimate.';end if;
 insert into public.marketing_creator_metric_snapshots(post_id,metrics,source,source_note,captured_at,recorded_by,request_id)
 values(p.id,metrics,'manual',trim(p_payload->>'source_note'),(p_payload->>'captured_at')::timestamptz,actor,p_request) returning to_jsonb(marketing_creator_metric_snapshots.*) into result;
 entity:='metrics';record_id:=p.id;rev:=null;
 end if;
 if rev is not null then insert into marketing_private.creator_revisions values(entity,record_id,rev,result,actor,now());end if;
 if entity='collaboration' then result:=marketing_private.creator_collaboration_lifecycle(result);end if; insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 values(p_org,case when entity in ('creator','account','creator_option') then null else p_brand end,'creators.'||p_action,actor,jsonb_build_object('entity',entity,'record_id',record_id,'revision',rev,'request_id',p_request));
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
 exception when unique_violation then raise exception using errcode='23505',message='This account or post identity already exists. Reload and open the existing record.';
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_creator_inspection_access(p_org uuid, p_brand uuid, p_begin boolean DEFAULT true, p_lease uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.view');v marketing_private.creator_inspection_meter;
begin
 perform pg_advisory_xact_lock(hashtextextended('creator-inspect-actor:'||actor,0));perform pg_advisory_xact_lock(hashtextextended('creator-inspect:'||p_org,0));
 if not p_begin then
  update marketing_private.creator_inspection_meter set lease=null,lease_until=null where creator_inspection_meter.actor=actor and organization_id=p_org and lease=p_lease;
  return null;
 end if;
 select * into v from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor and organization_id=p_org for update;
 if exists(select 1 from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor and lease_until>clock_timestamp()) then raise exception 'A post is already being inspected. Wait a moment.';end if;
 if (select coalesce(sum(requests),0) from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor and day=current_date)>=30 or (select coalesce(sum(requests),0) from marketing_private.creator_inspection_meter where organization_id=p_org and day=current_date)>=100 then raise exception 'Daily inspection limit reached. Manual entry remains available.';end if;
 insert into marketing_private.creator_inspection_meter(actor,organization_id,day,requests,lease,lease_until)
 values(actor,p_org,current_date,1,gen_random_uuid(),clock_timestamp()+interval '1 minute')
 on conflict on constraint creator_inspection_meter_pkey do update set organization_id=p_org,day=current_date,requests=case when creator_inspection_meter.day=current_date then creator_inspection_meter.requests+1 else 1 end,lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '1 minute'
 returning * into v;return v.lease;
end;$function$;


create function public.marketing_creator_profile_connection(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.view');
 return jsonb_build_object('eligible',false,'reason','organization_profile_authorization_required');
end;$$;
revoke all on function public.marketing_creator_profile_connection(uuid) from public,anon;
grant execute on function public.marketing_creator_profile_connection(uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.marketing_creator_followers_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.marketing_creator_accounts; c public.marketing_connections;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Worker required.';end if;
 select ca.* into a from public.marketing_creator_accounts ca join public.marketing_creators cr on cr.id=ca.creator_id
 where not ca.archived and not cr.archived and ca.platform in ('facebook','instagram') and ca.followers_due_at<=now() and (ca.followers_lease_until is null or ca.followers_lease_until<now())
 order by ca.followers_due_at,ca.id limit 1 for update of ca skip locked;
 if a.id is null then return null;end if;
 -- Current canonical Social credentials are Brand-owned. Shared-profile consent is not available.
 c:=null;
 update public.marketing_creator_accounts set followers_sync_status='syncing',followers_sync_reason=null,followers_lease=gen_random_uuid(),followers_lease_until=now()+interval '90 seconds',followers_attempted_at=now() where id=a.id returning * into a;
 return to_jsonb(a)||jsonb_build_object('connection_id',c.id,'connection_generation',c.credential_generation,'connection_brand',c.brand_id);
end;$function$;

CREATE OR REPLACE FUNCTION public.marketing_creator_followers_finish(p_account uuid, p_lease uuid, p_connection uuid, p_generation integer, p_count bigint DEFAULT NULL::bigint, p_source text DEFAULT NULL::text, p_status text DEFAULT 'failed'::text, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.marketing_creator_accounts;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='Worker required.';end if;
 select * into a from public.marketing_creator_accounts where id=p_account and followers_lease=p_lease and followers_lease_until>now() and not archived for update;
 if a.id is null then return false;end if;
 if not exists(select 1 from public.marketing_creators where id=a.creator_id and not archived) then return false;end if;
 if p_count is not null then
 if p_count<0 or p_count>1000000000000000 or p_source not in ('meta_instagram_business_discovery','meta_facebook_page') or p_source is null or p_status<>'ready' then raise exception 'Invalid follower evidence.';end if;
 -- Reject in-flight legacy Brand-token evidence after the authority change.
 p_count:=null;p_status:='unavailable';p_reason:='organization_profile_authorization_required';
 end if;
 if p_status not in ('ready','unavailable','unsupported','failed') or (p_status='ready' and p_count is null) then raise exception 'Invalid follower result.';end if;
 update public.marketing_creator_accounts set followers=case when p_count is not null then p_count else followers end,followers_captured_at=case when p_count is not null then now() else followers_captured_at end,followers_source=case when p_count is not null then p_source else followers_source end,
 followers_sync_status=p_status,followers_sync_reason=left(p_reason,120),followers_due_at=now()+case when p_status='failed' then interval '1 hour' else interval '1 day' end,followers_lease=null,followers_lease_until=null where id=a.id;
 return true;
end;$function$;


revoke all on function marketing_private.creator_visible(uuid,uuid,uuid),marketing_private.creator_editable(uuid,uuid),marketing_private.creators_workspace(uuid,uuid,boolean) from public,anon,authenticated;
-- Existing unique organization/platform identities and Post keys are deliberately unchanged.
