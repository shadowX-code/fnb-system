-- Extend existing Creator authorities; no new identity, Post or collaboration master.
alter table public.marketing_creator_collaborations alter column creator_id drop not null;
alter table public.marketing_creators add column locations text[] not null default '{}';
update public.marketing_creators set locations=array[location] where trim(location)<>'';
alter table public.marketing_creators add constraint creator_locations_bound check(cardinality(locations)<=20);
alter table public.marketing_creator_accounts add column avatar_url text,add column public_observation jsonb;
alter table public.marketing_creator_deliverables add column content_type text check(content_type in ('video','image'));
alter table public.marketing_creator_posts add column content_type text check(content_type in ('video','image')),add column publication_confirmed_at timestamptz,add column publication_confirmed_by uuid references public.employees(id);
alter table public.marketing_creator_collaborations drop constraint marketing_creator_collaborations_status_check;
alter table public.marketing_creator_collaborations add constraint marketing_creator_collaborations_status_check check(status in ('planned','in_progress','published','completed','confirmed','visited','awaiting_posts','cancelled'));
create table public.marketing_creator_options(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 kind text not null check(kind in ('location','category')),name text not null check(length(trim(name)) between 1 and 60),
 normalized text generated always as (lower(regexp_replace(trim(name),'\s+',' ','g'))) stored,
 archived boolean not null default false,revision integer not null default 1,unique(organization_id,kind,normalized)
);
alter table public.marketing_creator_options enable row level security;
revoke all on public.marketing_creator_options from public,anon,authenticated;
insert into public.marketing_creator_options(organization_id,kind,name)
select distinct organization_id,'location',trim(location) from public.marketing_creators where length(trim(location)) between 1 and 60
on conflict do nothing;
insert into public.marketing_creator_options(organization_id,kind,name)
select distinct c.organization_id,'category',trim(t) from public.marketing_creators c cross join lateral unnest(c.categories) t where length(trim(t)) between 1 and 60
on conflict do nothing;

create or replace function marketing_private.creator_visible(p_org uuid,p_id uuid,p_brand uuid default null) returns boolean
language sql stable security definer set search_path=public as $$
select exists(select 1 from public.marketing_creators c where c.id=p_id and c.organization_id=p_org and (
 exists(select 1 from public.marketing_creator_brands cb where cb.organization_id=p_org and cb.creator_id=c.id and (p_brand is null or cb.brand_id=p_brand) and marketing_private.brand_allowed(p_org,cb.brand_id))
 or (not exists(select 1 from public.marketing_creator_brands cb where cb.creator_id=c.id)
 and (c.created_by=marketing_private.actor() or marketing_private.all_brands_allowed(p_org))
 and (p_brand is null or marketing_private.brand_allowed(p_org,p_brand)))))
$$;

create function marketing_private.creator_bind(p_org uuid,p_brand uuid,p_creator uuid) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
begin
 if p_creator is null then return;end if;
 perform 1 from public.marketing_creators where id=p_creator and organization_id=p_org and not archived for update;
 if not found or not marketing_private.creator_visible(p_org,p_creator) then raise exception using errcode='42501',message='Choose an accessible active Creator.';end if;
 insert into public.marketing_creator_brands values(p_org,p_creator,p_brand,actor,now()) on conflict do nothing;
end;$$;

create function marketing_private.creator_labels(p_org uuid,p_creator uuid,p_payload jsonb) returns public.marketing_creators
language plpgsql security definer set search_path=public as $$
declare c public.marketing_creators;kind text;names text[];n text;
begin
 perform marketing_private.require_access(p_org,null,'marketing_creators.manage');
 select * into c from public.marketing_creators where id=p_creator and organization_id=p_org for update;
 if not marketing_private.creator_editable(p_org,c.id) then raise exception using errcode='42501',message='Shared profile access changed.';end if;
 if p_payload?'locations' then
 if jsonb_typeof(p_payload->'locations')<>'array' or jsonb_array_length(p_payload->'locations')>20 then raise exception 'Choose up to twenty locations.';end if;
 select coalesce(array_agg(name order by ord),'{}') into names from(select distinct on(lower(trim(value))) trim(value) name,ord from jsonb_array_elements_text(p_payload->'locations') with ordinality a(value,ord) where trim(value)<>'' order by lower(trim(value)),ord)x;
 if exists(select 1 from unnest(names) a where length(a)>60) then raise exception 'Location names must be at most sixty characters.';end if;
 update public.marketing_creators set locations=names,location=coalesce(names[1],'') where id=c.id returning * into c;
 end if;
 foreach kind in array array['location','category'] loop
 names:=case when kind='location' then c.locations else c.categories end;
 foreach n in array names loop
 if length(trim(n)) between 1 and 60 then insert into public.marketing_creator_options(organization_id,kind,name) values(p_org,kind,regexp_replace(trim(n),'\s+',' ','g')) on conflict(organization_id,kind,normalized) do update set archived=false;end if;
 end loop;end loop;return c;
end;$$;

create function marketing_private.creator_option_command(p_org uuid,p_action text,p_id uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_creators.manage');o public.marketing_creator_options;c public.marketing_creators;n text:=regexp_replace(trim(coalesce(p_payload->>'name','')),'\s+',' ','g');uses integer;old text;
begin
 if p_payload->>'kind' not in ('location','category') then raise exception 'Choose Location or Category.';end if;
 perform pg_advisory_xact_lock(hashtextextended('creator-options:'||p_org,0));
 if p_action='option_create' then
 if length(n) not between 1 and 60 then raise exception 'Enter an option name up to sixty characters.';end if;
 insert into public.marketing_creator_options(organization_id,kind,name) values(p_org,p_payload->>'kind',n)
 on conflict(organization_id,kind,normalized) do update set archived=false,revision=marketing_creator_options.revision+1 returning * into o;return to_jsonb(o);
 end if;
 select * into o from public.marketing_creator_options where id=p_id and organization_id=p_org and kind=p_payload->>'kind' for update;
 if o.id is null or o.revision<>p_revision then raise exception using errcode='40001',message='Option changed. Reload before saving.';end if;
 old:=o.name;
 select count(*) into uses from public.marketing_creators c where c.organization_id=p_org and old=any(case when o.kind='location' then c.locations else c.categories end);
 if uses>0 and coalesce((p_payload->>'confirm_impact')::boolean,false)<>true then raise exception 'Confirm the option impact before saving.';end if;
 if p_action='option_delete' then
 update public.marketing_creator_options set archived=true,revision=revision+1 where id=o.id returning * into o;
 -- Hide from future choices; never remove existing Creator associations.
 else
 if length(n) not between 1 and 60 then raise exception 'Enter an option name up to sixty characters.';end if;
 if exists(select 1 from public.marketing_creators c where c.organization_id=p_org and old=any(case when o.kind='location' then c.locations else c.categories end) and not marketing_private.creator_editable(p_org,c.id)) then raise exception using errcode='42501',message='Renaming affects restricted profiles. Ask an authorized administrator.';end if;
 update public.marketing_creator_options set name=n,revision=revision+1 where id=o.id returning * into o;
 for c in select * from public.marketing_creators where organization_id=p_org and old=any(case when o.kind='location' then locations else categories end) for update loop
 update public.marketing_creators set locations=case when o.kind='location' then array_replace(locations,old,n) else locations end,
 location=case when o.kind='location' and location=old then n else location end,
 categories=case when o.kind='category' then array_replace(categories,old,n) else categories end,
 revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
 insert into marketing_private.creator_revisions values('creator',c.id,c.revision,to_jsonb(c),actor,now());
 end loop;
 end if;return to_jsonb(o);
end;$$;

create function marketing_private.creator_post_details(p_org uuid,p_brand uuid,p_post uuid,p_payload jsonb) returns public.marketing_creator_posts
language plpgsql security definer set search_path=public as $$
declare p public.marketing_creator_posts;d public.marketing_creator_deliverables;actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');
begin
 select * into p from public.marketing_creator_posts where id=p_post and organization_id=p_org and brand_id=p_brand for update;
 if p_payload?'content_type' and nullif(p_payload->>'content_type','') is not null then
 if p_payload->>'content_type' not in ('image','video') then raise exception 'Choose Picture / Carousel or Reels / Video.';end if;
 update public.marketing_creator_posts set content_type=p_payload->>'content_type' where id=p.id returning * into p;
 end if;
 if p.deliverable_id is not null then
 select * into d from public.marketing_creator_deliverables where id=p.deliverable_id;
 if d.status='cancelled' or (d.content_type is not null and d.content_type is distinct from p.content_type) then raise exception 'Choose a matching active publishing entry and content type.';end if;
 end if;
 if coalesce((p_payload->>'confirm_published')::boolean,false) then
 update public.marketing_creator_posts set publication_confirmed_at=coalesce(publication_confirmed_at,now()),publication_confirmed_by=coalesce(publication_confirmed_by,actor) where id=p.id returning * into p;
 end if;return p;
end;$$;

create function marketing_private.creator_link_post(p_org uuid,p_brand uuid,p_post uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'marketing_creators.manage');p public.marketing_creator_posts;v public.marketing_creator_collaborations;d public.marketing_creator_deliverables;
begin
 if coalesce((p_payload->>'confirm_link')::boolean,false)<>true then raise exception 'Confirm linking this existing Post.';end if;
 select * into p from public.marketing_creator_posts where id=p_post and organization_id=p_org and brand_id=p_brand for update;
 if p.id is null or p.revision<>p_revision then raise exception using errcode='40001',message='Post changed or is outside this Brand.';end if;
 select * into v from public.marketing_creator_collaborations where id=nullif(p_payload->>'collaboration_id','')::uuid and organization_id=p_org and brand_id=p_brand for update;
 if v.id is null or v.status='cancelled' then raise exception 'Choose an active same-brand collaboration.';end if;
 if p.collaboration_id is not null and p.collaboration_id<>v.id or p.creator_id is not null and p.creator_id<>v.creator_id then raise exception 'This Post is already associated with another Creator or collaboration.';end if;
 if nullif(p_payload->>'deliverable_id','') is not null then
 select * into d from public.marketing_creator_deliverables where id=(p_payload->>'deliverable_id')::uuid and collaboration_id=v.id and platform=p.platform and status<>'cancelled';
 if d.id is null or (p.deliverable_id is not null and p.deliverable_id<>d.id) then raise exception 'Choose the matching publishing entry.';end if;
 end if;
 perform marketing_private.creator_bind(p_org,p_brand,v.creator_id);
 update public.marketing_creator_posts set creator_id=coalesce(v.creator_id,p.creator_id),collaboration_id=v.id,deliverable_id=coalesce(d.id,deliverable_id),revision=revision+1,updated_by=actor,updated_at=now() where id=p.id returning * into p;
 p:=marketing_private.creator_post_details(p_org,p_brand,p.id,p_payload);
 return to_jsonb(p);
end;$$;

-- Modify the canonical command in place, retaining all existing retries, revisions and media checks.
do $$
declare body text;needle text;replacement text;
begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 body:=replace(body,'or p_brand is null or jsonb_typeof(p_payload)', 'or (p_brand is null and p_action not in (''save_creator'',''archive_creator'',''save_account'',''archive_account'',''option_create'',''option_rename'',''option_delete'')) or jsonb_typeof(p_payload)');
 body:=replace(body,'''archive_account'',''save_collaboration''','''archive_account'',''option_create'',''option_rename'',''option_delete'',''link_post'',''save_collaboration''');
 needle:='if p_action=''save_creator'' then';
 replacement:='if p_action in (''option_create'',''option_rename'',''option_delete'') then result:=marketing_private.creator_option_command(p_org,p_action,p_id,p_revision,p_payload);entity:=''creator_option'';record_id:=(result->>''id'')::uuid;rev:=(result->>''revision'')::integer;
 elsif p_action=''link_post'' then result:=marketing_private.creator_link_post(p_org,p_brand,p_id,p_revision,p_payload);entity:=''post'';record_id:=(result->>''id'')::uuid;rev:=(result->>''revision'')::integer;
 elsif p_action=''save_creator'' then';
 if position(needle in body)=0 then raise exception 'Creator command changed';end if;body:=replace(body,needle,replacement);
 body:=replace(body,'insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now());','if p_brand is not null then insert into public.marketing_creator_brands values(p_org,c.id,p_brand,actor,now());end if;');
 body:=replace(body,'if p_payload?''profiles'' then','c:=marketing_private.creator_labels(p_org,c.id,p_payload);if p_payload?''profiles'' then');
 needle:='if not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception ''Link this creator to the selected brand first.'';end if;';
 replacement:='perform marketing_private.creator_bind(p_org,p_brand,linked_creator);
 if p_payload->>''status''=''published'' and not exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=v.id and cp.brand_id=p_brand and (cp.published_at is not null or cp.published_date is not null or cp.publication_confirmed_at is not null)) then raise exception ''Published requires a confirmed linked published Post URL.'';end if;';
 if position(needle in body)=0 then raise exception 'Collaboration contract changed';end if;body:=replace(body,needle,replacement);
 body:=replace(body,'if linked_creator is not null and not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception ''Choose a creator linked to this brand.'';end if;', 'if linked_creator is not null and coalesce((p_payload->>''confirm_link'')::boolean,false) then perform marketing_private.creator_bind(p_org,p_brand,linked_creator);end if;
 if linked_creator is not null and not marketing_private.creator_visible(p_org,linked_creator,p_brand) then raise exception ''Confirm the Creator for this Brand.'';end if;');
 body:=replace(body,'if v.id is not null and linked_creator<>v.creator_id then','if v.id is not null and v.creator_id is not null and linked_creator is distinct from v.creator_id then');
 body:=replace(body,'and brand_id=p_brand and creator_id=linked_creator;', 'and brand_id=p_brand and (creator_id is null or creator_id is not distinct from linked_creator);');
 body:=replace(body,'insert into public.marketing_creator_deliverables(collaboration_id,title,platform,due_date,status) values(v.id,trim(item->>''title''),item->>''platform'',nullif(item->>''due_date'','''')::date,coalesce(item->>''status'',''pending''));','insert into public.marketing_creator_deliverables(collaboration_id,title,platform,due_date,status,content_type) values(v.id,trim(item->>''title''),item->>''platform'',nullif(item->>''due_date'','''')::date,coalesce(item->>''status'',''pending''),nullif(item->>''content_type'',''''));');
 body:=replace(body,'update public.marketing_creator_deliverables set title=trim(item->>''title''),platform=item->>''platform''','update public.marketing_creator_deliverables set content_type=coalesce(nullif(item->>''content_type'',''''),d.content_type),title=trim(item->>''title''),platform=item->>''platform''');
 body:=replace(body,'p:=marketing_private.creator_confirm_public(p.id,p_org,p_brand,p_payload);','p:=marketing_private.creator_confirm_public(p.id,p_org,p_brand,p_payload);p:=marketing_private.creator_post_details(p_org,p_brand,p.id,p_payload);');
 -- Bounded observed profile data stays staff-confirmed; never promotes platform ownership.
 needle:='result:=to_jsonb(a);entity:=''account'';';
 replacement:='if p_payload?''public_observation'' then
 if jsonb_typeof(p_payload->''public_observation'')<>''object'' or octet_length((p_payload->''public_observation'')::text)>8000 then raise exception ''Invalid profile observation.'';end if;
 if nullif(p_payload->''public_observation''->>''avatar_url'','''') is not null and p_payload->''public_observation''->>''avatar_url'' !~ ''^https://([A-Za-z0-9-]+[.])*(cdninstagram[.]com|fbcdn[.]net|xhscdn[.]com|sns-i11[.]rednotecdn[.]com|tiktokcdn[.]com|tiktokcdn-us[.]com|tiktokv[.]com|ibytedtos[.]com)/[^[:space:]]+$'' then raise exception ''Unsupported profile image.'';end if;
 update public.marketing_creator_accounts set public_observation=jsonb_build_object(''source'',''public_profile_staff_confirmed'',''source_hint'',left(p_payload->''public_observation''->>''source'',150),''captured_at'',p_payload->''public_observation''->''captured_at'',''avatar_url'',p_payload->''public_observation''->''avatar_url'') where id=a.id returning * into a;end if;
 result:=to_jsonb(a);entity:=''account'';';body:=replace(body,needle,replacement);
 if position('creator_labels' in body)=0 or position('creator_post_details' in body)=0 or position('option_create' in body)=0 then raise exception 'Creator extensions incomplete';end if;
 execute body;
end;$$;

do $$
declare body text;needle text;
begin
 body:=pg_get_functiondef('public.marketing_creators_read(uuid,uuid)'::regprocedure);
 needle:='''brand_ids'',(select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb where cb.creator_id=c.id and marketing_private.brand_allowed(p_org,cb.brand_id))';
 if position(needle in body)=0 then raise exception 'Creator read contract changed';end if;
 body:=replace(body,needle,'''brand_ids'',coalesce((select jsonb_agg(cb.brand_id) from public.marketing_creator_brands cb where cb.creator_id=c.id and marketing_private.brand_allowed(p_org,cb.brand_id)),''[]''::jsonb)');
 body:=replace(body,'into result;return result;','into result;return result||jsonb_build_object(''options'',(select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object(''usage_count'',(select count(*) from public.marketing_creators c where c.organization_id=p_org and marketing_private.creator_visible(p_org,c.id) and o.name=any(case when o.kind=''location'' then c.locations else c.categories end)))) ,''[]'') from public.marketing_creator_options o where o.organization_id=p_org));');
 execute body;
end;$$;
revoke all on function marketing_private.creator_bind(uuid,uuid,uuid),marketing_private.creator_labels(uuid,uuid,jsonb),marketing_private.creator_option_command(uuid,text,uuid,integer,jsonb),marketing_private.creator_post_details(uuid,uuid,uuid,jsonb),marketing_private.creator_link_post(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
