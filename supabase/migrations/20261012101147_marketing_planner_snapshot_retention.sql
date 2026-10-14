-- Completed production with reconciled publication no longer needs a reusable temporary original; all existing cleanup proof requirements remain.
create or replace function public.marketing_media_cleanup_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.marketing_assets;
begin
 for a in select * from public.marketing_assets where storage_policy='temporary' and
 (state='ready' or (state='retiring' and cleanup_started_at<now()-interval '10 minutes')) order by created_at for update skip locked loop
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
