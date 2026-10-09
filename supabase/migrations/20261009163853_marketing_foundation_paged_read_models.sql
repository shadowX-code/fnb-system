-- Separate bounded operational queues and media paging; no change to execution authorization.
create function public.marketing_listing(p_org uuid,p_brand uuid,p_kind text,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid; permission text; rows jsonb; total integer;
begin
 permission:=case p_kind when 'assets' then 'marketing_content.view' when 'jobs' then 'marketing_overview.view' when 'analytics_jobs' then 'marketing_analytics.view' when 'approvals' then 'marketing_overview.view' end;
 if permission is null or p_page is null or p_page<1 or p_page_size is null or p_page_size not in (20,50,100) then raise exception 'Choose a valid list and page.'; end if;
 actor:=marketing_private.require_access(p_org,p_brand,permission);
 if p_kind='assets' then
   select count(*) into total from public.marketing_assets a where a.organization_id=p_org and (p_brand is null or a.brand_id=p_brand) and a.state='ready' and marketing_private.brand_allowed(p_org,a.brand_id);
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (select a.* from public.marketing_assets a where a.organization_id=p_org and (p_brand is null or a.brand_id=p_brand) and a.state='ready' and marketing_private.brand_allowed(p_org,a.brand_id) order by a.created_at desc,a.id limit p_page_size offset (p_page-1)*p_page_size)x;
 elsif p_kind='approvals' then
   select count(*) into total from public.marketing_content c where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.status='review' and marketing_private.brand_allowed(p_org,c.brand_id);
   select coalesce(jsonb_agg(row),'[]') into rows from (select to_jsonb(c)||jsonb_build_object('brand_name',b.name,'payload',r.payload) row
   from public.marketing_content c join public.brands b on b.id=c.brand_id join public.marketing_content_revisions r on r.content_id=c.id and r.revision=c.revision
   where c.organization_id=p_org and (p_brand is null or c.brand_id=p_brand) and c.status='review' and marketing_private.brand_allowed(p_org,c.brand_id)
   order by c.updated_at,c.id limit p_page_size offset (p_page-1)*p_page_size)x;
 else
   select count(*) into total from public.marketing_jobs j where j.organization_id=p_org and (p_brand is null or j.brand_id=p_brand) and marketing_private.brand_allowed(p_org,j.brand_id);
   select coalesce(jsonb_agg(row),'[]') into rows from (select to_jsonb(j)-'lease_token'-'lease_expires_at'||jsonb_build_object('title',r.payload->>'title','brand_name',b.name) row
   from public.marketing_jobs j join public.brands b on b.id=j.brand_id join public.marketing_content_revisions r on r.content_id=j.content_id and r.revision=j.revision
   where j.organization_id=p_org and (p_brand is null or j.brand_id=p_brand) and marketing_private.brand_allowed(p_org,j.brand_id)
   order by case when j.state in ('blocked','failed','reconciling') then 0 else 1 end,j.updated_at desc,j.id limit p_page_size offset (p_page-1)*p_page_size)x;
 end if;
 return jsonb_build_object('rows',rows,'total_count',total,'page',p_page,'page_size',p_page_size);
end; $$;
revoke all on function public.marketing_listing(uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.marketing_listing(uuid,uuid,text,integer,integer) to authenticated;

create or replace function public.marketing_context() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); orgs jsonb; brands jsonb;
begin
 if not public.current_user_has_permission('marketing_workspace.access') then raise exception using errcode='42501',message='Marketing workspace access is required.'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.name),'[]') into orgs from public.organizations o where marketing_private.member(o.id);
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from public.brand_outlets bo join public.outlets o on o.id=bo.outlet_id where bo.brand_id=b.id),'outlet_ids',(select coalesce(jsonb_agg(outlet_id),'[]') from public.brand_outlets where brand_id=b.id)) order by b.name),'[]') into brands from public.brands b where marketing_private.brand_allowed(b.organization_id,b.id);
 return jsonb_build_object('organizations',orgs,'brands',brands,'actor_employee_id',actor);
end; $$;
