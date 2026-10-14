create function public.marketing_creator_directory(p_org uuid,p_brand uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $function$
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 return jsonb_build_object(
 'creators',(select coalesce(jsonb_agg(to_jsonb(c)-'avatar_asset_id'||jsonb_build_object('avatar_asset_id',case when public.current_user_has_permission('marketing_content.view') and exists(select 1 from public.marketing_assets m where m.id=c.avatar_asset_id and marketing_private.brand_allowed(p_org,m.brand_id)) then c.avatar_asset_id end,
 'editable',marketing_private.creator_editable(p_org,c.id),'brand_ids',coalesce((select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb where cb.creator_id=c.id and marketing_private.brand_allowed(p_org,cb.brand_id)),'[]'::jsonb)) order by c.name,c.id),'[]')
 from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id,p_brand)),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.platform,a.display_name),'[]') from public.marketing_creator_accounts a where a.organization_id=p_org and marketing_private.creator_visible(p_org,a.creator_id,p_brand))
 )||jsonb_build_object('options',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('usage_count',(select count(*) from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id) and exists(select 1 from unnest(case when o.kind='location' then c.locations else c.categories end) tag where lower(regexp_replace(trim(tag),'\s+',' ','g'))=o.normalized)))) ,'[]') from public.marketing_creator_options o where o.organization_id=p_org));
end;$function$;
revoke all on function public.marketing_creator_directory(uuid,uuid) from public,anon;
grant execute on function public.marketing_creator_directory(uuid,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.marketing_creators_read(p_org uuid, p_brand uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb; directory jsonb;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_creators.view');
 if (select count(*) from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id))>5000 then raise exception 'Choose a brand to narrow this workspace.';end if;
 directory:=public.marketing_creator_directory(p_org,p_brand);
 select jsonb_build_object(
 'creators',directory->'creators','accounts',directory->'accounts',
 'collaborations',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('deliverables',(select coalesce(jsonb_agg(to_jsonb(d) order by d.due_date,d.id),'[]') from public.marketing_creator_deliverables d where d.collaboration_id=v.id)) order by v.created_at desc),'[]') from public.marketing_creator_collaborations v
 where v.organization_id=p_org and (p_brand is null or v.brand_id=p_brand) and marketing_private.brand_allowed(p_org,v.brand_id)),
 'posts',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('latest_metrics',(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from (select distinct on(k.key) k.key,k.value
 from public.marketing_creator_metric_snapshots s cross join lateral jsonb_each(s.metrics) k where s.post_id=p.id order by k.key,s.captured_at desc,s.recorded_at desc,s.id desc)x)) order by p.created_at desc),'[]')
 from public.marketing_creator_posts p where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'snapshots',(select coalesce(jsonb_agg(to_jsonb(s) order by s.captured_at desc,s.recorded_at desc,s.id desc),'[]') from public.marketing_creator_metric_snapshots s join public.marketing_creator_posts p on p.id=s.post_id
 where p.organization_id=p_org and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'brand_ids',(select jsonb_agg(b.id) from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))) order by e.full_name),'[]') from public.employees e
 join public.organization_memberships om on om.employee_id=e.id and om.organization_id=p_org where e.is_active and exists(select 1 from public.brands b where b.organization_id=p_org and marketing_private.brand_allowed(p_org,b.id) and marketing_private.creative_assignee_allowed(p_org,b.id,e.id))),
 'campaigns',case when public.current_user_has_permission('marketing_campaigns.view') then (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'brand_id',c.brand_id)),'[]') from public.marketing_campaigns c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and marketing_private.brand_allowed(p_org,c.brand_id)) else '[]'::jsonb end,
 'assets',case when public.current_user_has_permission('marketing_content.view') then (select coalesce(jsonb_agg(to_jsonb(m)-'cleanup_lease'-'cleanup_started_at'),'[]') from public.marketing_assets m where m.organization_id=p_org and marketing_private.brand_allowed(p_org,m.brand_id) and (
 exists(select 1 from public.marketing_creators c where c.avatar_asset_id=m.id and marketing_private.creator_visible(p_org,c.id,p_brand)) or
 exists(select 1 from public.marketing_creator_posts p where p.asset_id=m.id and (p_brand is null or p.brand_id=p_brand) and marketing_private.brand_allowed(p_org,p.brand_id)))) else '[]'::jsonb end
 ) into result;return result||jsonb_build_object('options',directory->'options');
end;$function$;
