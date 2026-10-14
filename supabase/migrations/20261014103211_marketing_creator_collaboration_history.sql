-- Summary only: canonical Collaboration identities, never Post/relationship counts.
create index marketing_creator_collaboration_history on public.marketing_creator_collaborations(organization_id,creator_id,brand_id) where creator_id is not null;
create or replace function public.marketing_creator_directory(p_org uuid,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $function$
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
 'creators',(select coalesce(jsonb_agg(to_jsonb(c)-'avatar_asset_id'||jsonb_build_object(
  'avatar_asset_id',case when public.current_user_has_permission('marketing_content.view') and exists(select 1 from public.marketing_assets m where m.id=c.avatar_asset_id and marketing_private.brand_allowed(p_org,m.brand_id)) then c.avatar_asset_id end,
  'editable',marketing_private.creator_editable(p_org,c.id),
  'brand_ids',coalesce((select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb join allowed_brands b on b.id=cb.brand_id where cb.creator_id=c.id),'[]'::jsonb),
  'collaboration_history',coalesce(h.rows,'[]'::jsonb)) order by c.name,c.id),'[]') from visible_creators c left join history_rows h on h.creator_id=c.id),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.platform,a.display_name),'[]') from public.marketing_creator_accounts a join visible_creators c on c.id=a.creator_id where a.organization_id=p_org)
 ) into result;
 return result||jsonb_build_object('options',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('usage_count',(select count(*) from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id) and exists(select 1 from unnest(case when o.kind='location' then c.locations else c.categories end) tag where lower(regexp_replace(trim(tag),'\s+',' ','g'))=o.normalized)))) ,'[]') from public.marketing_creator_options o where o.organization_id=p_org));
end;$function$;
-- Retain the established callable surface; no new authority or grants.
revoke all on function public.marketing_creator_directory(uuid,uuid) from public,anon;
grant execute on function public.marketing_creator_directory(uuid,uuid) to authenticated;
