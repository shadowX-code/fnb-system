-- Brand Master owns branding. Existing objects and Outlet references remain historical evidence.
alter table public.brands add column logo_media_id uuid references public.outlet_logo_media(id) on delete restrict,
 add column brand_accent_color text check(brand_accent_color is null or brand_accent_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.outlet_logo_media alter column outlet_id drop not null;
alter table public.outlet_logo_media add column brand_id uuid references public.brands(id) on delete restrict,
 add column branding_request_id uuid unique;
alter table public.outlet_logo_media add constraint logo_source_owner check(outlet_id is not null or brand_id is not null);
create index brand_logo_media_owner on public.outlet_logo_media(brand_id,status);
-- Inherit only a single proven asset/color from exclusively mapped Outlets; never choose a conflicting candidate.
with candidates as (
 select b.id,count(distinct o.logo_media_id) logos,min(o.logo_media_id::text)::uuid logo,
 count(distinct upper(o.brand_accent_color)) colors,min(upper(o.brand_accent_color)) color
 from public.brands b join public.brand_outlets bo on bo.brand_id=b.id join public.outlets o on o.id=bo.outlet_id
 where not exists(select 1 from public.brand_outlets other where other.outlet_id=o.id and other.brand_id<>b.id)
 group by b.id
) update public.brands b set logo_media_id=case when c.logos=1 then c.logo end, brand_accent_color=case when c.colors=1 then c.color end from candidates c where b.id=c.id;
update public.outlet_logo_media m set brand_id=b.id from public.brands b where b.logo_media_id=m.id;

create function marketing_private.brand_branding(p_brand uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('logo_path',m.object_path,'logo_version',extract(epoch from m.updated_at)::bigint,'brand_accent_color',b.brand_accent_color)
 from public.brands b left join public.outlet_logo_media m on m.id=b.logo_media_id and m.status='ready'
 where b.id=p_brand and marketing_private.brand_allowed(b.organization_id,b.id);
$$;
revoke all on function marketing_private.brand_branding(uuid) from public,anon,authenticated;

create function public.platform_brand_logo_prepare(p_brand uuid,p_revision integer,p_request uuid,p_filename text,p_mime_type text,p_size bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();b public.brands; m public.outlet_logo_media; ident uuid:=gen_random_uuid();ext text;
begin
 select * into b from public.brands where id=p_brand for update;
 if b.id is null or not public.current_user_has_permission('platform_organizations.manage') or not marketing_private.brand_allowed(b.organization_id,b.id) then raise exception using errcode='42501',message='Brand management access is required.';end if;
 if b.revision is distinct from p_revision then raise exception using errcode='40001',message='Brand changed. Reload before uploading.';end if;
 if p_request is null or p_mime_type not in ('image/jpeg','image/png','image/webp') or p_size is null or p_size<1 or p_size>2097152 or length(p_filename)>255 then raise exception 'Choose a PNG, JPG or WebP logo up to 2 MB.';end if;
 select * into m from public.outlet_logo_media where branding_request_id=p_request;
 if found then
 if m.brand_id<>p_brand or m.uploaded_by<>auth.uid() or m.mime_type<>p_mime_type or m.file_size_bytes<>p_size or m.original_filename<>p_filename or m.status<>'pending' then raise exception 'Logo request changed. Reopen and inspect before retrying.';end if;
 return jsonb_build_object('id',m.id,'bucket',m.bucket_id,'object_path',m.object_path);end if;
 ext:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 insert into public.outlet_logo_media(id,brand_id,branding_request_id,object_path,original_filename,mime_type,file_size_bytes)
 values(ident,p_brand,p_request,'brands/'||p_brand::text||'/'||ident::text||'/logo.'||ext,p_filename,p_mime_type,p_size) returning * into m;
 return jsonb_build_object('id',m.id,'bucket',m.bucket_id,'object_path',m.object_path);
end;$$;
revoke all on function public.platform_brand_logo_prepare(uuid,integer,uuid,text,text,bigint) from public,anon;
grant execute on function public.platform_brand_logo_prepare(uuid,integer,uuid,text,text,bigint) to authenticated;

create policy brand_logo_media_select on public.outlet_logo_media for select to authenticated using(
 brand_id is not null and exists(select 1 from public.brands b where b.id=brand_id and marketing_private.brand_allowed(b.organization_id,b.id))
);
create policy "brand logo upload" on storage.objects for insert to authenticated with check(
 bucket_id='outlet-logos' and exists(select 1 from public.outlet_logo_media m join public.brands b on b.id=m.brand_id
 where m.bucket_id=storage.objects.bucket_id and m.object_path=storage.objects.name and m.status='pending' and m.uploaded_by=auth.uid()
 and public.current_user_has_permission('platform_organizations.manage') and marketing_private.brand_allowed(b.organization_id,b.id))
);
-- No physical delete or overwrite: replacing/removing the active Brand pointer retains historical assets.
revoke all on function public.outlet_prepare_logo_upload(uuid,text,text,bigint),public.outlet_finalize_logo_upload(uuid),public.outlet_prepare_logo_remove(uuid),public.outlet_finalize_logo_remove(uuid) from authenticated;
drop policy "outlet logo upload" on storage.objects;
drop policy "outlet logo remove" on storage.objects;
create function marketing_private.freeze_legacy_outlet_branding() returns trigger language plpgsql set search_path=public as $$
begin
 if (tg_op='INSERT' and (new.logo_media_id is not null or new.brand_accent_color is not null)) or (tg_op='UPDATE' and (new.logo_media_id is distinct from old.logo_media_id or new.brand_accent_color is distinct from old.brand_accent_color)) then raise exception 'Manage Brand branding from Restaurant System Brands.';end if;return new;
end;$$;
revoke all on function marketing_private.freeze_legacy_outlet_branding() from public,anon,authenticated;
create trigger outlet_branding_readonly before insert or update of logo_media_id,brand_accent_color on public.outlets for each row execute function marketing_private.freeze_legacy_outlet_branding();

CREATE OR REPLACE FUNCTION public.platform_organization_command(p_command text, p_org uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       if not marketing_private.brand_allowed(org,brand) then raise exception using errcode='42501',message='Brand access is unavailable.';end if;
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
       if brand is null and not marketing_private.all_brands_allowed(org) then raise exception using errcode='42501',message='Adding Brands requires full managed Brand scope.';end if;
       if brand is null then insert into public.brands(organization_id,name,timezone) values(org,trim(p_payload->>'name'),timezone_name) returning id into brand;
       else update public.brands set name=trim(p_payload->>'name'),timezone=timezone_name,revision=revision+1,updated_at=now() where id=brand;end if;
       if p_payload ? 'brand_accent_color' then
         if nullif(p_payload->>'brand_accent_color','') is not null and p_payload->>'brand_accent_color' !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Choose a six-digit accent color.';end if;
         update public.brands set brand_accent_color=upper(nullif(p_payload->>'brand_accent_color','')) where id=brand;
       end if;
       if p_payload ? 'logo_media_id' then
         if nullif(p_payload->>'logo_media_id','') is not null and (p_payload->>'logo_media_id')::uuid is distinct from current_brand.logo_media_id then
           perform 1 from public.outlet_logo_media m where m.id=(p_payload->>'logo_media_id')::uuid and m.brand_id=brand
            and m.status in ('pending','ready') and m.uploaded_by=auth.uid() and exists(select 1 from storage.objects s where s.bucket_id=m.bucket_id and s.name=m.object_path) for update;
           if not found then raise exception using errcode='42501',message='Brand logo is unavailable or upload is incomplete.';end if;
           update public.outlet_logo_media set status='ready',updated_at=now() where id=(p_payload->>'logo_media_id')::uuid and status='pending';
         end if;
         update public.brands set logo_media_id=nullif(p_payload->>'logo_media_id','')::uuid where id=brand;
       end if;
       insert into public.organization_outlets select org,unnest(selected_outlets) on conflict do nothing;
       if exists(select 1 from unnest(selected_outlets) oid where not exists(select 1 from public.organization_outlets where organization_id=org and outlet_id=oid)) then raise exception 'Outlet ownership changed. Reload and review.';end if;
       delete from public.brand_outlets where brand_id=brand and not (outlet_id=any(selected_outlets));
       insert into public.brand_outlets select org,brand,unnest(selected_outlets) on conflict do nothing;
     end if;
     select to_jsonb(b)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id order by outlet_id),'[]') from public.brand_outlets where brand_id=brand)) into after_state from public.brands b where b.id=brand;
   elsif p_command='add_member' then
     if not marketing_private.all_brands_allowed(org) then raise exception using errcode='42501',message='Adding team members requires full managed Brand scope.';end if;
     if not public.current_user_has_permission('employees.view') then raise exception using errcode='42501',message='Employee visibility is required.'; end if;
     employee:=(p_payload->>'employee_id')::uuid;
     if not marketing_private.employee_visible(employee) then raise exception using errcode='42501',message='Employee is outside your visibility scope.'; end if;
     if not exists(select 1 from public.employees where id=employee and auth_user_id is not null and enable_system_login and access_state='active' and is_active) then raise exception 'Choose an active FeedX employee.'; end if;
     insert into public.organization_memberships values(org,employee) on conflict do nothing;
   elsif p_command='remove_member' then
     if not marketing_private.all_brands_allowed(org) then raise exception using errcode='42501',message='Removing team access requires full managed Brand scope.';end if;
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.platform_brands_read(p_org uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.actor();
begin
 if not public.current_user_has_permission('platform_organizations.manage') then raise exception using errcode='42501',message='Organization management permission is required.';end if;
 if p_org is not null and not marketing_private.member(p_org) then raise exception using errcode='42501',message='Organization access is unavailable.';end if;
 return jsonb_build_object(
 'organizations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.name),'[]') from public.organizations o where marketing_private.member(o.id)),
 'brands',(select coalesce(jsonb_agg(to_jsonb(b)||marketing_private.brand_branding(b.id)||jsonb_build_object('outlet_ids',(select coalesce(jsonb_agg(outlet_id),'[]') from public.brand_outlets where brand_id=b.id),
 'impact',jsonb_build_object('scheduled_posts',(select count(*) from public.marketing_content where brand_id=b.id and status='scheduled'),'open_collaborations',(select count(*) from public.marketing_creator_collaborations where brand_id=b.id and status not in ('completed','cancelled')),'connections',(select count(*) from public.marketing_connections where brand_id=b.id))) order by b.name),'[]') from public.brands b where marketing_private.brand_allowed(b.organization_id,b.id) and (p_org is null or b.organization_id=p_org)),
 'outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'code',o.code,'location',o.location,'is_active',o.is_active,'brands',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',case when marketing_private.brand_allowed(b.organization_id,b.id) then b.name else 'Other linked Brand (restricted)' end)),'[]') from public.brand_outlets bo join public.brands b on b.id=bo.brand_id where bo.outlet_id=o.id),'organization_id',oo.organization_id) order by o.name),'[]') from public.outlets o left join public.organization_outlets oo on oo.outlet_id=o.id where public.current_user_can_access_outlet(o.id) and (oo.organization_id is null or marketing_private.member(oo.organization_id))),
 'events',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select e.id,e.organization_id,e.brand_id,e.action,e.created_at,e.details,coalesce(a.full_name,'Staff unavailable') actor from public.marketing_events e left join public.employees a on a.id=e.actor_employee_id where e.action in ('platform_save_brand','platform_set_brand_status') and e.brand_id is not null and marketing_private.brand_allowed(e.organization_id,e.brand_id) and (p_org is null or e.organization_id=p_org) order by e.created_at desc limit 200)x));
end;$function$
;

CREATE OR REPLACE FUNCTION public.marketing_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor uuid:=marketing_private.actor(); orgs jsonb; brands jsonb;
begin
 if not public.current_user_has_permission('marketing_workspace.access') then raise exception using errcode='42501',message='Marketing workspace access is required.'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.name),'[]') into orgs from public.organizations o where marketing_private.member(o.id);
 select coalesce(jsonb_agg(to_jsonb(b)||marketing_private.brand_branding(b.id)||jsonb_build_object('outlets',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from public.brand_outlets bo join public.outlets o on o.id=bo.outlet_id where bo.brand_id=b.id),'outlet_ids',(select coalesce(jsonb_agg(outlet_id),'[]') from public.brand_outlets where brand_id=b.id)) order by b.name),'[]') into brands from public.brands b where marketing_private.brand_allowed(b.organization_id,b.id);
 return jsonb_build_object('organizations',orgs,'brands',brands,'actor_employee_id',actor);
end; $function$
;

-- Public feedback uses a uniquely mapped canonical Brand; ambiguous legacy relationships are not guessed.
CREATE OR REPLACE FUNCTION public.crew_feedback_public_entry(p_outlet_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('outlet',jsonb_strip_nulls(jsonb_build_object('name',o.name,'public_feedback_token',o.public_feedback_token,'logo_path',media.object_path,'logo_version',extract(epoch from media.updated_at)::bigint,'brand_accent_color',case when canonical_brand.id is not null then canonical_brand.brand_accent_color else o.brand_accent_color end)),'crew',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'on_shift',x.on_shift) order by x.on_shift desc,x.last_shift desc nulls last,x.full_name) from (select e.id,e.full_name,e.position,exists(select 1 from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.status='open') on_shift,(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.clock_in_at>now()-interval '14 days') last_shift from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=o.id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and exists(select 1 from public.crew_attendance_records recent where recent.employee_id=e.id and recent.outlet_id=o.id and recent.clock_in_at>now()-interval '14 days') order by on_shift desc,last_shift desc nulls last limit 12)x),'[]'::jsonb)) from public.outlets o left join lateral (select b.* from public.brand_outlets bo join public.brands b on b.id=bo.brand_id where bo.outlet_id=o.id and (select count(*) from public.brand_outlets where outlet_id=o.id)=1) canonical_brand on true left join public.outlet_logo_media media on media.id=case when canonical_brand.id is not null then canonical_brand.logo_media_id else o.logo_media_id end and media.status='ready' where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
$function$
;
