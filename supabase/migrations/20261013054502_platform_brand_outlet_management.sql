-- Platform identity remains shared; inactive status never removes historical access or scheduled jobs.
alter table public.brands add column revision integer not null default 1,add column updated_at timestamptz not null default now();
create unique index brands_normalized_name on public.brands(organization_id,lower(trim(name)));
create function public.platform_brands_read(p_org uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Organization management permission is required.';end if;
 if p_org is not null and not marketing_private.member(p_org) then raise exception using errcode='42501',message='Organization access is unavailable.';end if;
 return jsonb_build_object(
 'organizations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.name),'[]') from public.organizations o where marketing_private.member(o.id)),
 'brands',(select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id),'[]') from public.brand_outlets where brand_id=b.id),
 'impact',jsonb_build_object('scheduled_posts',(select count(*) from public.marketing_content where brand_id=b.id and status='scheduled'),'open_collaborations',(select count(*) from public.marketing_creator_collaborations where brand_id=b.id and status not in ('completed','cancelled')),'connections',(select count(*) from public.marketing_connections where brand_id=b.id))) order by b.name),'[]') from public.brands b where marketing_private.member(b.organization_id) and (p_org is null or b.organization_id=p_org)),
 'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'is_active',o.is_active,'organization_id',oo.organization_id) order by o.name),'[]') from public.outlets o left join public.organization_outlets oo on oo.outlet_id=o.id where public.current_user_can_access_outlet(o.id) and (oo.organization_id is null or marketing_private.member(oo.organization_id))),
 'events',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select e.id,e.organization_id,e.brand_id,e.action,e.created_at,e.details,coalesce(a.full_name,'Staff unavailable') actor from public.marketing_events e left join public.employees a on a.id=e.actor_employee_id where e.action in ('platform_save_brand','platform_set_brand_status') and marketing_private.member(e.organization_id) and (p_org is null or e.organization_id=p_org) order by e.created_at desc limit 200)x));
end;$$;
revoke all on function public.platform_brands_read(uuid) from public,anon;
grant execute on function public.platform_brands_read(uuid) to authenticated;
create function public.platform_outlet_brands_read() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();
begin
 if not public.current_user_has_permission('outlets.view') then raise exception using errcode='42501',message='Outlet visibility permission is required.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('outlet_id',o.id,'visibility',case when oo.organization_id is null or marketing_private.member(oo.organization_id) then 'scoped' else 'unavailable' end,
 'brands',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'is_active',b.is_active) order by b.name),'[]') from public.brand_outlets bo join public.brands b on b.id=bo.brand_id where bo.outlet_id=o.id and marketing_private.member(b.organization_id) and (public.current_user_has_permission('platform_organizations.manage') or marketing_private.brand_allowed(b.organization_id,b.id))))),'[]') from public.outlets o left join public.organization_outlets oo on oo.outlet_id=o.id where public.current_user_can_access_outlet(o.id));
end;$$;
revoke all on function public.platform_outlet_brands_read() from public,anon;
grant execute on function public.platform_outlet_brands_read() to authenticated;
create or replace function public.platform_organization_command(p_command text,p_org uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor(); org uuid:=p_org; brand uuid; outlet uuid; employee uuid; target_role uuid; timezone_name text;before_state jsonb;after_state jsonb;current_brand public.brands;request uuid;prior public.marketing_requests;fp text;result jsonb;selected_outlets uuid[];
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Organization management permission is required.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'Invalid organization request.';end if;
 if p_command<>'create_organization' and not marketing_private.member(org) then raise exception using errcode='42501',message='Organization access is unavailable.';end if;
 if p_command in ('save_brand','set_brand_status') then
 request:=nullif(p_payload->>'request_id','')::uuid;fp:=md5(jsonb_build_array(p_command,p_org,p_payload)::text);
 if request is not null then
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));select * into prior from public.marketing_requests where request_id=request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry changed. Use a new request.';end if;return prior.result;end if;end if;
 end if;
 if p_command='create_organization' then
   insert into public.organizations(name) values(trim(p_payload->>'name')) returning id into org;
   insert into public.organization_memberships values(org,actor);
 else
   if not marketing_private.member(org) then raise exception using errcode='42501',message='Organization access is unavailable.'; end if;
   perform 1 from public.organizations where id=org for update;
   if p_command in ('save_brand','set_brand_status') then
     brand:=nullif(p_payload->>'id','')::uuid;
     if brand is not null then
       select * into current_brand from public.brands where id=brand and organization_id=org for update;
       if not found then raise exception using errcode='42501',message='Brand is unavailable in this organization.';end if;
       if current_brand.revision is distinct from (p_payload->>'expected_revision')::integer then raise exception using errcode='40001',message='Brand changed. Reload and review before saving.';end if;
       before_state:=to_jsonb(current_brand)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]') from public.brand_outlets where brand_id=brand));
     end if;
     if p_command='set_brand_status' then
       if brand is null or jsonb_typeof(p_payload->'is_active')<>'boolean' or coalesce((p_payload->>'confirmed')::boolean,false)<>true then raise exception 'Confirm the Brand status impact before saving.';end if;
       update public.brands set is_active=(p_payload->>'is_active')::boolean,revision=revision+1,updated_at=now() where id=brand;
     else
       timezone_name:=coalesce(p_payload->>'timezone','Asia/Kuala_Lumpur');
       if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Choose a valid timezone.';end if;
       if jsonb_typeof(coalesce(p_payload->'outlet_ids','[]'))<>'array' then raise exception 'Choose valid outlet targets.';end if;
       select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}') into selected_outlets from jsonb_array_elements_text(coalesce(p_payload->'outlet_ids','[]'));
       if (brand is null and cardinality(selected_outlets)>0 or brand is not null and selected_outlets is distinct from array(select outlet_id from public.brand_outlets where brand_id=brand order by outlet_id)) and coalesce((p_payload->>'mapping_confirmed')::boolean,false)<>true then raise exception 'Review and confirm added and removed outlets.';end if;
       if exists(select 1 from public.brand_outlets bo where bo.brand_id=brand and not(bo.outlet_id=any(selected_outlets)) and not public.current_user_can_access_outlet(bo.outlet_id)) then raise exception using errcode='42501',message='Outlet removal exceeds your outlet access.';end if;
       for outlet in select unnest(selected_outlets) loop
         if not public.current_user_can_access_outlet(outlet) or not exists(select 1 from public.outlets where id=outlet)
         or (not exists(select 1 from public.brand_outlets bo where bo.brand_id=brand and bo.outlet_id=outlet) and not exists(select 1 from public.outlets where id=outlet and is_active))
         or exists(select 1 from public.organization_outlets where outlet_id=outlet and organization_id<>org) then raise exception using errcode='42501',message='Outlet is unavailable or belongs to another organization.';end if;
       end loop;
       if brand is null then insert into public.brands(organization_id,name,timezone) values(org,trim(p_payload->>'name'),timezone_name) returning id into brand;
       else update public.brands set name=trim(p_payload->>'name'),timezone=timezone_name,revision=revision+1,updated_at=now() where id=brand;end if;
       insert into public.organization_outlets select org,unnest(selected_outlets) on conflict do nothing;
       if exists(select 1 from unnest(selected_outlets) oid where not exists(select 1 from public.organization_outlets where organization_id=org and outlet_id=oid)) then raise exception 'Outlet ownership changed. Reload and review.';end if;
       delete from public.brand_outlets where brand_id=brand and not (outlet_id=any(selected_outlets));
       insert into public.brand_outlets select org,brand,unnest(selected_outlets) on conflict do nothing;
     end if;
     select to_jsonb(b)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]') from public.brand_outlets where brand_id=brand)) into after_state from public.brands b where b.id=brand;
   elsif p_command='add_member' then
     if not public.current_user_has_permission('employees.view') then raise exception using errcode='42501',message='Employee visibility is required.'; end if;
     employee:=(p_payload->>'employee_id')::uuid;
     if not marketing_private.employee_visible(employee) then raise exception using errcode='42501',message='Employee is outside your visibility scope.'; end if;
     if not exists(select 1 from public.employees where id=employee and auth_user_id is not null and enable_system_login and access_state='active' and is_active) then raise exception 'Choose an active FeedX employee.'; end if;
     insert into public.organization_memberships values(org,employee) on conflict do nothing;
   elsif p_command='remove_member' then
     employee:=(p_payload->>'employee_id')::uuid;
     if employee=actor then raise exception 'You cannot remove your own organization access.'; end if;
     delete from public.organization_memberships where organization_id=org and employee_id=employee;
   else raise exception 'Unknown organization action.';
   end if;
 end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,brand,'platform_'||p_command,actor,jsonb_build_object('employee_id',employee,'before',before_state,'after',after_state,'request_id',request));
 result:=jsonb_build_object('organization_id',org,'brand_id',brand,'brand',after_state);
 if request is not null then insert into public.marketing_requests values(request,actor,fp,result);end if;
 return result;
 exception when unique_violation then raise exception using errcode='23505',message='A Brand with this name already exists in this organization.';
end; $$;


-- Only new operational records are gated; sync, receipts, history and existing job execution are unchanged.
create function marketing_private.guard_active_brand_new_work() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='platform_customer_brands' then if exists(select 1 from public.platform_customer_brands where brand_id=new.brand_id and customer_id=new.customer_id) then return new;end if;end if;
 if tg_table_name='marketing_whatsapp_senders' then if exists(select 1 from public.marketing_whatsapp_senders where brand_id=new.brand_id and phone_e164=new.phone_e164) then return new;end if;end if;
 if not exists(select 1 from public.brands where id=new.brand_id and is_active) then raise exception 'This Brand is inactive. Reactivate it before starting new work.';end if;
 return new;
end;$$;
revoke all on function marketing_private.guard_active_brand_new_work() from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['marketing_content','marketing_creative_tasks','marketing_creative_templates','marketing_campaigns','marketing_creator_collaborations','platform_customer_brands','marketing_whatsapp_senders','marketing_jobs'] loop
 execute format('create trigger active_brand_new_work before insert on public.%I for each row execute function marketing_private.guard_active_brand_new_work()',t);
 end loop;end;$$;
create function marketing_private.guard_active_brand_schedule() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='scheduled' and (old.status<>'scheduled' or new.scheduled_at is distinct from old.scheduled_at) and not exists(select 1 from public.brands where id=new.brand_id and is_active) then raise exception 'This Brand is inactive. Existing schedules remain; new scheduling requires reactivation.';end if;return new;
end;$$;
revoke all on function marketing_private.guard_active_brand_schedule() from public,anon,authenticated;
create trigger active_brand_schedule before update on public.marketing_content for each row execute function marketing_private.guard_active_brand_schedule();
