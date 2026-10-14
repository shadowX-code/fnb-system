-- Manual profile observations remain within Creator authority; no provider data is copied.
alter table public.marketing_creator_accounts add column archived boolean not null default false,
 add column followers bigint check(followers>=0),add column followers_captured_at timestamptz;
create function marketing_private.creator_profile(p jsonb) returns jsonb language plpgsql immutable set search_path=public as $$
declare u text:=trim(coalesce(p->>'profile_url',''));platform text:=p->>'platform';host text;path text;handle text:=lower(ltrim(trim(coalesce(p->>'handle','')),'@'));eid text:=trim(coalesce(p->>'external_id',''));m text[];
begin
 if platform not in ('facebook','instagram','xhs','tiktok') or platform is null then raise exception 'Choose a supported platform.';end if;
 if u<>'' then
 if length(u)>1500 or u !~ '^https://' or u ~ '[[:space:]\\]' then raise exception 'Use a public HTTPS profile URL.';end if;
 host:=lower(substring(u from '^https://([^/?#]+)'));path:=regexp_replace(u,'^https://[^/]+','');
 if host in ('instagram.com','www.instagram.com') then
 platform:='instagram';m:=regexp_match(path,'^/([A-Za-z0-9._]+)/?(?:[?#].*)?$');
 if m is null or lower(m[1]) in ('p','reel','reels','stories','explore','accounts','direct') then raise exception 'Use an Instagram profile link, not a post.';end if;
 if handle<>'' and handle<>lower(m[1]) then raise exception 'Handle does not match this profile URL.';end if;handle:=lower(m[1]);u:='https://www.instagram.com/'||handle||'/';
 elsif host in ('tiktok.com','www.tiktok.com') then
 platform:='tiktok';m:=regexp_match(path,'^/@([A-Za-z0-9._-]+)/?(?:[?#].*)?$');if m is null then raise exception 'Use a TikTok profile link.';end if;
 if handle<>'' and handle<>lower(m[1]) then raise exception 'Handle does not match this profile URL.';end if;handle:=lower(m[1]);u:='https://www.tiktok.com/@'||handle;
 elsif host in ('xiaohongshu.com','www.xiaohongshu.com') then
 platform:='xhs';m:=regexp_match(path,'^/user/profile/([A-Fa-f0-9]+)/?(?:[?#].*)?$');if m is null then raise exception 'Use a Xiaohongshu profile link.';end if;
 if eid<>'' and eid<>lower(m[1]) then raise exception 'Account ID does not match this profile URL.';end if;eid:=lower(m[1]);u:='https://www.xiaohongshu.com/user/profile/'||eid;
 elsif host in ('facebook.com','www.facebook.com','m.facebook.com') then
 platform:='facebook';m:=regexp_match(path,'^/profile\.php\?(?:[^#]*&)?id=([0-9]+)(?:[&#].*)?$');
 if m is not null then
 if eid<>'' and eid<>m[1] then raise exception 'Account ID does not match this profile URL.';end if;eid:=m[1];u:='https://www.facebook.com/profile.php?id='||eid;
 else m:=regexp_match(path,'^/([A-Za-z0-9._-]+)/?(?:[?#].*)?$');if m is null or lower(m[1]) in ('share','reel','watch','photo','story.php','groups','pages') then raise exception 'Use a Facebook profile link.';end if;
 if m[1] ~ '^[0-9]+$' then if eid<>'' and eid<>m[1] then raise exception 'Account ID does not match this profile URL.';end if;eid:=m[1];
 else if handle<>'' and handle<>lower(m[1]) then raise exception 'Handle does not match this profile URL.';end if;handle:=lower(m[1]);end if;u:='https://www.facebook.com/'||lower(m[1]);end if;
 else raise exception 'Use a Facebook, Instagram, Xiaohongshu or TikTok profile URL.';end if;
 if platform<>p->>'platform' then raise exception 'Profile URL must match the selected platform.';end if;
 end if;
 if handle='' and eid='' and u='' then raise exception 'Enter a profile URL or handle.';end if;
 return p||jsonb_build_object('platform',platform,'profile_url',u,'handle',handle,'external_id',eid);
end;$$;
revoke all on function marketing_private.creator_profile(jsonb) from public,anon,authenticated;
-- Retain removed identities for linked post/history evidence and prevent identity recycling.
create unique index marketing_creator_account_profile on public.marketing_creator_accounts(organization_id,platform,lower(profile_url)) where profile_url<>'';
create or replace function public.marketing_creator_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid;fp text;prior public.marketing_requests;result jsonb;c public.marketing_creators;a public.marketing_creator_accounts;
 v public.marketing_creator_collaborations;p public.marketing_creator_posts;d public.marketing_creator_deliverables;
 parsed jsonb;preview jsonb;item jsonb;metrics jsonb;entity text;record_id uuid;rev integer;linked_creator uuid;asset uuid;outlet uuid;campaign uuid;owner uuid;profile jsonb;child jsonb;account_result jsonb;identity_changed boolean;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
 if p_request is null or p_revision is null or p_brand is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536
 or p_action not in ('save_creator','share_creator','archive_creator','save_account','archive_account','save_collaboration','save_post','add_metrics','capture_meta_metrics') then raise exception 'Choose a brand and valid creator action.';end if;
 if p_action='capture_meta_metrics' then raise exception 'Meta references are read-only in V1. Record metrics with independent staff-provided evidence.';end if;
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
 asset:=case when p_payload?'avatar_asset_id' then nullif(p_payload->>'avatar_asset_id','')::uuid else c.avatar_asset_id end;
 if asset is distinct from c.avatar_asset_id and not public.current_user_has_permission('marketing_content.view') then raise exception 'Media permission is required to change the profile image.';end if;
 if asset is not null and asset is distinct from c.avatar_asset_id then perform 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) for update;end if;
 if asset is not null and asset is distinct from c.avatar_asset_id and not exists(select 1 from public.marketing_assets m where m.id=asset and m.organization_id=p_org and m.state='ready'
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
 end if;
 if p_payload?'profiles' then
 if jsonb_typeof(p_payload->'profiles')<>'array' or jsonb_array_length(p_payload->'profiles')>30 then raise exception 'Use up to thirty social profiles.';end if;
 for child in select value from jsonb_array_elements(p_payload->'profiles') loop
 if jsonb_typeof(child)<>'object' then raise exception 'Invalid social profile.';end if;
 account_result:=public.marketing_creator_command(gen_random_uuid(),p_org,p_brand,
 case when coalesce((child->>'archived')::boolean,false) then 'archive_account' else 'save_account' end,
 nullif(child->>'id','')::uuid,coalesce((child->>'revision')::integer,0),child||jsonb_build_object('creator_id',c.id));
 end loop;end if;
 result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='share_creator' then
 if c.id is null then raise exception 'Choose an existing visible creator.';end if;
 insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now()) on conflict do nothing;
 update public.marketing_creators set revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action='archive_creator' then
 update public.marketing_creators set archived=coalesce((p_payload->>'archived')::boolean,true),revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c);entity:='creator';record_id:=c.id;rev:=c.revision;
 elsif p_action in ('save_account','archive_account') then
 linked_creator:=nullif(p_payload->>'creator_id','')::uuid;
 select * into c from public.marketing_creators where id=linked_creator and organization_id=p_org for update;
 if c.id is null or not marketing_private.creator_editable(p_org,c.id) or not marketing_private.creator_visible(p_org,c.id,p_brand) then raise exception using errcode='42501',message='Shared account changes require access to every linked brand.';end if;
 if p_id is not null then select * into a from public.marketing_creator_accounts where id=p_id and creator_id=c.id for update;
 if a.id is null or a.revision<>p_revision then raise exception using errcode='40001',message='Account changed. Reload.';end if;end if;
 if p_action='archive_account' then
 if a.id is null then raise exception 'Choose an existing social profile.';end if;
 update public.marketing_creator_accounts set archived=true,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 else
 profile:=marketing_private.creator_profile(p_payload);
 identity_changed:=a.id is null or (a.platform,a.handle,a.external_id,a.profile_url) is distinct from
 (profile->>'platform',profile->>'handle',profile->>'external_id',profile->>'profile_url');
 if profile->>'followers' is not null and ((profile->>'followers')::numeric<0 or (profile->>'followers')::numeric>1000000000000000 or (profile->>'followers')::numeric<>trunc((profile->>'followers')::numeric)) then raise exception 'Enter an observed non-negative whole follower count.';end if;
 if profile->>'followers' is not null and (nullif(profile->>'followers_captured_at','') is null or (profile->>'followers_captured_at')::timestamptz>now()+interval '5 minutes') then raise exception 'Choose the actual follower observation date.';end if;
 if a.id is not null and a.platform<>profile->>'platform' and exists(select 1 from public.marketing_creator_posts cp where cp.account_id=a.id) then raise exception 'Preserve the platform of an account already linked to posts.';end if;
 if p_id is null then
 insert into public.marketing_creator_accounts(organization_id,creator_id,platform,display_name,handle,profile_url,external_id,created_by)
 values(p_org,c.id,profile->>'platform',trim(coalesce(p_payload->>'display_name','')),lower(ltrim(trim(coalesce(profile->>'handle','')),'@')),coalesce(profile->>'profile_url',''),trim(coalesce(profile->>'external_id','')),actor) returning * into a;
 else
 update public.marketing_creator_accounts set platform=profile->>'platform',display_name=trim(coalesce(p_payload->>'display_name','')),handle=lower(ltrim(trim(coalesce(profile->>'handle','')),'@')),
 profile_url=coalesce(profile->>'profile_url',''),external_id=trim(coalesce(profile->>'external_id','')),identity_verified=case when identity_changed then false else identity_verified end,identity_source=case when identity_changed then 'staff_recorded' else identity_source end,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 end if;
 update public.marketing_creator_accounts set followers=nullif(profile->>'followers','')::bigint,followers_captured_at=case when profile->>'followers' is not null then (profile->>'followers_captured_at')::timestamptz end,archived=false where id=a.id returning * into a;
 if a.handle='' and a.external_id='' and a.profile_url='' then raise exception 'Enter a handle, platform ID or profile URL.';end if;
 end if;
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
 if linked_creator is not null and preview->>'matched_creator_id' is distinct from linked_creator::text and (p.id is null or linked_creator is distinct from p.creator_id or a.id is distinct from p.account_id) and coalesce((p_payload->>'confirm_link')::boolean,false)<>true then raise exception 'Confirm the creator manually; display names never establish identity.';end if;
 v:=null;if nullif(p_payload->>'collaboration_id','') is not null then
 select * into v from public.marketing_creator_collaborations where id=(p_payload->>'collaboration_id')::uuid and organization_id=p_org and brand_id=p_brand and creator_id=linked_creator;
 if v.id is null then raise exception 'Choose a same-brand collaboration for this creator.';end if;end if;
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
 nullif(p_payload->>'published_at','')::timestamptz,asset,'staff_recorded',case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text then 'verified_identity' else 'manual_confirmed' end,actor,actor) returning * into p;
 else
 update public.marketing_creator_posts set creator_id=linked_creator,account_id=a.id,collaboration_id=v.id,deliverable_id=d.id,outlet_id=outlet,caption=coalesce(p_payload->>'caption',''),published_at=nullif(p_payload->>'published_at','')::timestamptz,
 asset_id=asset,match_method=case when linked_creator is null then 'unlinked' when preview->>'matched_creator_id'=linked_creator::text then 'verified_identity' else 'manual_confirmed' end,revision=revision+1,updated_by=actor,updated_at=now() where id=p.id returning * into p;
 end if;result:=to_jsonb(p);entity:='post';record_id:=p.id;rev:=p.revision;
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
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
 values(p_org,p_brand,'creators.'||p_action,actor,jsonb_build_object('entity',entity,'record_id',record_id,'revision',rev,'request_id',p_request));
 insert into public.marketing_requests values(p_request,actor,fp,result);
 return result;
 exception when unique_violation then raise exception using errcode='23505',message='This account or post identity already exists. Reload and open the existing record.';
end;$$;


create or replace function public.marketing_creator_post_preview(p_org uuid,p_brand uuid,p_url text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare parsed jsonb;duplicate public.marketing_creator_posts;observed public.marketing_social_posts; matched uuid;matched_account uuid;
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
 select a.creator_id,a.id into matched,matched_account from public.marketing_creator_accounts a where a.organization_id=p_org and a.platform=observed.channel
 and a.external_id=observed.provider_account_id and a.identity_verified and not a.archived and marketing_private.creator_visible(p_org,a.creator_id,p_brand);
 return parsed||jsonb_build_object('metadata_status','authorized_meta','caption',observed.caption,'published_at',observed.published_at,
 'author_external_id',observed.provider_account_id,'identity_verified',observed.provider_account_id<>'','matched_creator_id',matched,'matched_account_id',matched_account,
 'metrics',observed.metrics,'captured_at',observed.observed_at,'source','Existing authorized Meta synchronization');
 end if;
 return parsed||jsonb_build_object('metadata_status','unavailable','source','Manual entry','message',case when (parsed->>'short_link')::boolean then 'Share link recorded. Original post identity and author are unavailable; use the full post link where possible.' else 'Automatic metadata is unavailable for this account. Enter the post details and confirm its creator manually.' end);
end;$$;

