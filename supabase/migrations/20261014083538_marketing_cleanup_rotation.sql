alter table public.marketing_assets add column cleanup_checked_at timestamptz not null default 'epoch';
create index marketing_cleanup_rotation on public.marketing_assets(cleanup_checked_at,created_at,id) where storage_policy='temporary' and state in ('ready','retiring');
CREATE OR REPLACE FUNCTION public.marketing_media_cleanup_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.marketing_assets;
begin
 for a in select * from public.marketing_assets where storage_policy='temporary' and
 (state='ready' or (state='retiring' and cleanup_started_at<now()-interval '10 minutes')) order by cleanup_checked_at,created_at,id limit 25 for update skip locked loop
  update public.marketing_assets set cleanup_checked_at=clock_timestamp() where id=a.id;
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
end;$function$
;
