-- Preserve opaque/unchanged media references during normal staff edits; validate and lock only explicit changes.
create or replace function public.marketing_creator_command(p_request uuid,p_org uuid,p_brand uuid,p_action text,p_id uuid default null,p_revision integer default 0,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare actor uuid;fp text;prior public.marketing_requests;result jsonb;c public.marketing_creators;a public.marketing_creator_accounts;
 v public.marketing_creator_collaborations;p public.marketing_creator_posts;d public.marketing_creator_deliverables;
 parsed jsonb;preview jsonb;item jsonb;metrics jsonb;entity text;record_id uuid;rev integer;linked_creator uuid;asset uuid;outlet uuid;campaign uuid;owner uuid;
begin
 actor:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
 if p_request is null or p_revision is null or p_brand is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536
 or p_action not in ('save_creator','share_creator','archive_creator','save_account','save_collaboration','save_post','add_metrics','capture_meta_metrics') then raise exception 'Choose a brand and valid creator action.';end if;
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
 if coalesce(p_payload->>'profile_url','')<>'' and p_payload->>'profile_url' !~ (case p_payload->>'platform' when 'facebook' then '^https://(www\.|m\.)?facebook\.com/' when 'instagram' then '^https://(www\.)?instagram\.com/' when 'tiktok' then '^https://(www\.)?tiktok\.com/' else '^https://(www\.)?xiaohongshu\.com/' end) then raise exception 'Profile URL must use the selected platform.';end if;
 if a.id is not null and a.platform<>p_payload->>'platform' and exists(select 1 from public.marketing_creator_posts cp where cp.account_id=a.id) then raise exception 'Preserve the platform of an account already linked to posts.';end if;
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

