create or replace function marketing_private.creator_option_command(p_org uuid,p_action text,p_id uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_creators.manage');o public.marketing_creator_options;affected public.marketing_creators;n text:=regexp_replace(trim(coalesce(p_payload->>'name','')),'\s+',' ','g');uses integer;old text;
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
 for affected in select * from public.marketing_creators where organization_id=p_org and old=any(case when o.kind='location' then locations else categories end) for update loop
 update public.marketing_creators set locations=case when o.kind='location' then array_replace(locations,old,n) else locations end,
 location=case when o.kind='location' and location=old then n else location end,
 categories=case when o.kind='category' then array_replace(categories,old,n) else categories end,
 revision=revision+1,updated_by=actor,updated_at=now() where id=affected.id returning * into affected;
 insert into marketing_private.creator_revisions values('creator',affected.id,affected.revision,to_jsonb(affected),actor,now());
 end loop;
 end if;return to_jsonb(o);
end;$$;


do $$
declare body text;
begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 body:=replace(body,'if v.id is not null and v.creator_id is not null and linked_creator is distinct from v.creator_id then','if v.id is not null and v.creator_id is null and linked_creator is not null and exists(select 1 from public.marketing_creator_posts cp where cp.collaboration_id=v.id and cp.creator_id is not null and cp.creator_id<>linked_creator) then raise exception ''Linked Posts belong to another Creator.'';end if; if v.id is not null and v.creator_id is not null and linked_creator is distinct from v.creator_id then');
 body:=replace(body,'identity_verified=case when identity_changed then false else identity_verified end','public_observation=case when identity_changed then null else public_observation end,identity_verified=case when identity_changed then false else identity_verified end');
 execute body;
end;$$;
revoke all on function marketing_private.creator_option_command(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
