-- Manual recovery uses the existing bounded one-object Social Sync probe.
create or replace function public.marketing_meta_availability_targets(p_connection uuid,p_generation integer,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.marketing_connections;result jsonb;
begin
 if not public.marketing_meta_sync_guard(p_connection,p_generation,p_lease) then raise exception 'Synchronization authority expired.';end if;
 select * into c from public.marketing_connections where id=p_connection;
 with known as (
  select s.provider_post_id id,max(s.published_at) published_at from public.marketing_social_posts s
  where s.connection_id=c.id and s.organization_id=c.organization_id and s.brand_id=c.brand_id
   and (s.connection_generation=p_generation or s.provider_account_id=c.provider_account_id) and coalesce(s.media_product_type,'')<>'STORY' group by s.provider_post_id
  union all select j.provider_post_id,j.updated_at from public.marketing_jobs j join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
  where j.connection_id=c.id and j.organization_id=c.organization_id and j.brand_id=c.brand_id and j.connection_generation=p_generation and j.state='succeeded' and j.provider_post_id is not null
   and not exists(select 1 from jsonb_array_elements(r.payload->'variants') v where v->>'channel'=c.channel and v->>'format'='story')
 ), targets as (
  select k.id,max(k.published_at) published_at,a.last_attempt_at from known k left join marketing_private.publication_availability a
   on a.connection_id=c.id and a.connection_generation=p_generation and a.provider_post_id=k.id
  where k.id ~ '^[0-9]{1,30}(_[0-9]{1,30})?$' and coalesce(a.next_check_at,'-infinity')<=now() group by k.id,a.last_attempt_at
  order by a.last_attempt_at nulls first,max(k.published_at) desc nulls last,k.id limit 1
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'require_object_read',coalesce(marketing_private.publication_availability_projection(c.id,p_generation,c.provider_account_id,targets.id)->>'state' in ('deleted','manually_removed'),false))),'[]') into result from targets;
 return result;
end;$$;
revoke all on function public.marketing_meta_availability_targets(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.marketing_meta_availability_targets(uuid,integer,uuid) to service_role;

